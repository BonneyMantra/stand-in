//! near-workspaces sandbox tests. Build the wasm first:
//!   (cd ../intents-replica && cargo near build non-reproducible-wasm --no-abi) and the same for
//!   ../project-demo and this crate. Run: cargo test --test sandbox -- --test-threads=1
use near_workspaces::types::{AccessKeyPermission, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::json;

type Sandbox = Worker<near_workspaces::network::Sandbox>;

fn wasm(rel: &str) -> Vec<u8> {
    let p = format!("{}/{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}: build the wasm first"))
}

struct Env {
    worker: Sandbox,
    guardian: Account, // the agent account itself, guardian deployed on it
    watcher: Account,
    stranger: Account,
    intents: Contract,
    project: Contract,
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let mk = |n: &'static str, near: u128| {
        root.create_subaccount(n).initial_balance(NearToken::from_near(near)).transact()
    };
    let agent = mk("agent", 30).await?.into_result()?;
    let watcher = mk("watch", 5).await?.into_result()?;
    let stranger = mk("stranger", 5).await?.into_result()?;
    let intents_acc = mk("intents", 10).await?.into_result()?;
    let project_acc = mk("project", 10).await?.into_result()?;

    let intents = intents_acc.deploy(&wasm("../intents-replica/target/near/standin_intents_replica.wasm")).await?.into_result()?;
    intents.call("new").transact().await?.into_result()?;
    let project = project_acc.deploy(&wasm("../project-demo/target/near/standin_project_demo.wasm")).await?.into_result()?;
    project.call("new").transact().await?.into_result()?;

    let g = agent.deploy(&wasm("target/near/standin_guardian.wasm")).await?.into_result()?;
    g.call("new")
        .args_json(json!({"watcher": watcher.id(), "intents_contract": intents.id()}))
        .transact()
        .await?
        .into_result()?;
    Ok(Env { worker, guardian: agent, watcher, stranger, intents, project })
}

impl Env {
    async fn add_agent_key(&self, pk: &near_workspaces::types::PublicKey, recv: &AccountId, methods: &[&str]) -> anyhow::Result<()> {
        self.guardian
            .call(self.guardian.id(), "add_agent_key")
            .args_json(json!({"public_key": pk, "receiver_id": recv, "method_names": methods, "allowance": "0"}))
            .transact().await?.into_result()?;
        Ok(())
    }
    async fn add_intents_key(&self, pk: &near_workspaces::types::PublicKey) -> anyhow::Result<()> {
        self.guardian
            .call(self.guardian.id(), "add_intents_key")
            .args_json(json!({"public_key": pk}))
            .max_gas().transact().await?.into_result()?;
        Ok(())
    }
    async fn has_chain_key(&self, pk: &near_workspaces::types::PublicKey) -> bool {
        self.worker.view_access_key(self.guardian.id(), pk).await.is_ok()
    }
    async fn intents_has(&self, pk: &near_workspaces::types::PublicKey) -> bool {
        self.intents
            .view("has_public_key")
            .args_json(json!({"account_id": self.guardian.id(), "public_key": pk}))
            .await.unwrap().json::<bool>().unwrap()
    }
    async fn freeze_as(&self, who: &Account) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
        Ok(who.call(self.guardian.id(), "freeze")
            .args_json(json!({"reason": "decoy key used", "decoy_public_key": "ed25519:decoy", "tx_hash": "H1"}))
            .gas(near_workspaces::types::Gas::from_tgas(60)).transact().await?)
    }
}

fn sign_payload(sk: &SecretKey, payload: &str) -> String {
    use ed25519_dalek::{Signer, SigningKey};
    let full = sk.to_string();
    let raw = bs58::decode(full.strip_prefix("ed25519:").unwrap()).into_vec().unwrap();
    let seed: [u8; 32] = raw[..32].try_into().unwrap();
    let sig = SigningKey::from_bytes(&seed).sign(payload.as_bytes());
    base64_std(&sig.to_bytes())
}

fn base64_std(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[tokio::test]
async fn freeze_deletes_all_agent_keys_and_removes_intents_keys() -> anyhow::Result<()> {
    let e = setup().await?;
    let k1 = SecretKey::from_random(KeyType::ED25519);
    let k2 = SecretKey::from_random(KeyType::ED25519);
    let ik = SecretKey::from_random(KeyType::ED25519);
    e.add_agent_key(&k1.public_key(), e.project.id(), &["record_deploy"]).await?;
    e.add_agent_key(&k2.public_key(), e.project.id(), &[]).await?;
    e.add_intents_key(&ik.public_key()).await?;
    assert!(e.has_chain_key(&k1.public_key()).await && e.has_chain_key(&k2.public_key()).await);
    assert!(e.intents_has(&ik.public_key()).await);

    let r = e.freeze_as(&e.watcher).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert!(r.logs().iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains(r#""standard":"standin""#) && l.contains(r#""event":"freeze""#)));
    e.worker.fast_forward(5).await?;

    assert!(!e.has_chain_key(&k1.public_key()).await, "k1 still on chain");
    assert!(!e.has_chain_key(&k2.public_key()).await, "k2 still on chain");
    assert!(!e.intents_has(&ik.public_key()).await, "intents key still registered");
    let st: serde_json::Value = e.guardian.view(e.guardian.id(), "get_state").await?.json()?;
    assert_eq!(st["frozen"], true);
    assert_eq!(st["agent_keys"].as_array().unwrap().len(), 0);
    assert_eq!(st["freeze_log"][0]["deleted_keys"].as_array().unwrap().len(), 2);
    assert_eq!(st["freeze_log"][0]["tx_hash"], "H1");
    // owner full-access key must survive the freeze
    let owner_key = e.guardian.secret_key().public_key();
    assert!(e.has_chain_key(&owner_key).await, "owner key must survive");
    Ok(())
}

#[tokio::test]
async fn queued_signed_intent_fails_public_key_not_exist_after_freeze() -> anyhow::Result<()> {
    let e = setup().await?;
    let ik = SecretKey::from_random(KeyType::ED25519);
    e.add_intents_key(&ik.public_key()).await?;
    let (p1, p2) = (r#"{"nonce":1,"intent":"transfer"}"#, r#"{"nonce":2,"intent":"transfer"}"#);
    let (s1, s2) = (sign_payload(&ik, p1), sign_payload(&ik, p2));
    let call = |p: &str, s: &str| {
        e.stranger.call(e.intents.id(), "execute_signed").args_json(json!({
            "signer_id": e.guardian.id(), "public_key": ik.public_key(), "payload": p, "signature": s}))
            .max_gas().transact()
    };
    // before freeze: valid signed intent executes
    let ok = call(p1, &s1).await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    // p2 stays "queued" (signed, not yet submitted) while the freeze lands
    assert!(e.freeze_as(&e.watcher).await?.is_success());
    e.worker.fast_forward(3).await?;
    let bad = call(p2, &s2).await?;
    assert!(bad.is_failure());
    let msg = format!("{:?}", bad.failures());
    assert!(msg.contains("PublicKeyNotExist"), "expected PublicKeyNotExist, got {msg}");
    // a forged signature is rejected before the key check
    let forged = call(p2, &s1).await?;
    assert!(format!("{:?}", forged.failures()).contains("InvalidSignature"));
    Ok(())
}

#[tokio::test]
async fn non_watcher_freeze_refused_and_keys_survive() -> anyhow::Result<()> {
    let e = setup().await?;
    let k = SecretKey::from_random(KeyType::ED25519);
    e.add_agent_key(&k.public_key(), e.project.id(), &[]).await?;
    let r = e.freeze_as(&e.stranger).await?;
    assert!(r.is_failure());
    assert!(format!("{:?}", r.failures()).contains("only watcher or owner may freeze"));
    e.worker.fast_forward(3).await?;
    assert!(e.has_chain_key(&k.public_key()).await);
    // the watcher cannot provision keys either
    let r = e.watcher.call(e.guardian.id(), "add_agent_key")
        .args_json(json!({"public_key": k.public_key(), "receiver_id": e.project.id(), "method_names": [], "allowance": "0"}))
        .transact().await?;
    assert!(r.is_failure());
    Ok(())
}

#[tokio::test]
async fn watcher_function_call_key_can_freeze_and_owner_can_unfreeze_and_reprovision() -> anyhow::Result<()> {
    let e = setup().await?;
    let wk = SecretKey::from_random(KeyType::ED25519);
    e.watcher.batch(e.watcher.id())
        .add_key(wk.public_key(), near_workspaces::types::AccessKey::function_call_access(
            e.guardian.id(), &["freeze"], Some(NearToken::from_near(10))))
        .transact().await?.into_result()?;
    let watcher_fc = Account::from_secret_key(e.watcher.id().clone(), wk, &e.worker);
    let k = SecretKey::from_random(KeyType::ED25519);
    e.add_agent_key(&k.public_key(), e.project.id(), &[]).await?;
    let r = e.freeze_as(&watcher_fc).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    e.worker.fast_forward(3).await?;
    assert!(!e.has_chain_key(&k.public_key()).await);
    // frozen blocks re-provisioning until the owner unfreezes
    let blocked = e.guardian.call(e.guardian.id(), "add_agent_key")
        .args_json(json!({"public_key": k.public_key(), "receiver_id": e.project.id(), "method_names": [], "allowance": "0"}))
        .transact().await?;
    assert!(blocked.is_failure());
    e.guardian.call(e.guardian.id(), "unfreeze").transact().await?.into_result()?;
    e.add_agent_key(&k.public_key(), e.project.id(), &[]).await?;
    assert!(e.has_chain_key(&k.public_key()).await);
    Ok(())
}

#[tokio::test]
async fn agent_fc_key_calls_project_but_cannot_transfer_or_add_keys() -> anyhow::Result<()> {
    let e = setup().await?;
    let k = SecretKey::from_random(KeyType::ED25519);
    e.add_agent_key(&k.public_key(), e.project.id(), &["record_deploy"]).await?;
    let agent_fc = Account::from_secret_key(e.guardian.id().clone(), k.clone(), &e.worker);

    let ok = agent_fc.call(e.project.id(), "record_deploy").args_json(json!({"note": "deployed v1"})).transact().await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    let notes: serde_json::Value = e.project.view("get_notes").await?.json()?;
    assert_eq!(notes[0]["note"], "deployed v1");
    assert_eq!(notes[0]["by"], e.guardian.id().to_string());

    // plain NEAR transfer is not allowed for a function-call key
    let t = agent_fc.transfer_near(e.stranger.id(), NearToken::from_near(1)).await;
    assert!(t.is_err() || t.unwrap().is_failure(), "FC key must not transfer");
    // a different method on the same receiver is not allowed
    let m = agent_fc.call(e.project.id(), "get_notes").transact().await;
    assert!(m.is_err() || m.unwrap().is_failure(), "method outside allow-list must fail");
    // a different receiver is not allowed
    let r = agent_fc.call(e.intents.id(), "has_public_key").args_json(json!({"account_id": "a.near", "public_key": k.public_key()})).transact().await;
    assert!(r.is_err() || r.unwrap().is_failure());
    // it cannot add keys either
    let a = agent_fc.batch(e.guardian.id()).add_key(SecretKey::from_random(KeyType::ED25519).public_key(), near_workspaces::types::AccessKey::full_access()).transact().await;
    assert!(a.is_err() || a.unwrap().is_failure(), "FC key must not add keys");
    // and the key permission on chain is a FunctionCall one
    let ak = e.worker.view_access_key(e.guardian.id(), &k.public_key()).await?;
    assert!(matches!(ak.permission, AccessKeyPermission::FunctionCall(_)));
    Ok(())
}
