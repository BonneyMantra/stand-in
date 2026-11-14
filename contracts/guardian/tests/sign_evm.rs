//! sign_evm sandbox tests. The NEAR MPC signer cannot run in the sandbox, so a TEST-ONLY stub
//! (tests/mpc-stub, records the request, returns a fixed response, signs nothing) is patched in at
//! the real signer account id. Build first: (cd tests/mpc-stub && cargo near build non-reproducible-wasm --no-abi),
//! the three sibling contracts and this crate. Run: cargo +stable test --test sign_evm -- --test-threads=1
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Worker};
use serde_json::json;

const SIGNER: &str = "v1.signer-prod.testnet";
const PAYLOAD: &str = "521da91dc9bddb625bd0679d9e735def558761a34653624f5954f44bce6443a9";

fn wasm(rel: &str) -> Vec<u8> {
    let p = format!("{}/{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}: build the wasm first"))
}

struct Env {
    worker: Worker<near_workspaces::network::Sandbox>,
    agent: Account,
    watcher: Account,
    stranger: Account,
    signer: AccountId,
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let agent = root.create_subaccount("agent").initial_balance(NearToken::from_near(30)).transact().await?.into_result()?;
    let watcher = root.create_subaccount("watch").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let stranger = root.create_subaccount("stranger").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let intents = root.create_subaccount("intents").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let intents = intents.deploy(&wasm("../intents-replica/target/near/standin_intents_replica.wasm")).await?.into_result()?;
    intents.call("new").transact().await?.into_result()?;
    let g = agent.deploy(&wasm("target/near/standin_guardian.wasm")).await?.into_result()?;
    g.call("new").args_json(json!({"watcher": watcher.id(), "intents_contract": intents.id()})).transact().await?.into_result()?;
    let signer: AccountId = SIGNER.parse()?;
    worker
        .patch(&signer)
        .account(near_workspaces::AccountDetailsPatch::default().balance(NearToken::from_near(10)))
        .code(&wasm("tests/mpc-stub/target/near/mpc_stub.wasm"))
        .transact()
        .await?;
    Ok(Env { worker, agent, watcher, stranger, signer })
}

impl Env {
    async fn agent_fc(&self) -> anyhow::Result<Account> {
        let k = SecretKey::from_random(KeyType::ED25519);
        self.agent
            .call(self.agent.id(), "add_agent_key")
            .args_json(json!({"public_key": k.public_key(), "receiver_id": self.agent.id(), "method_names": ["sign_evm"], "allowance": "1000000000000000000000000"}))
            .transact()
            .await?
            .into_result()?;
        Ok(Account::from_secret_key(self.agent.id().clone(), k, &self.worker))
    }
}

fn args() -> serde_json::Value {
    json!({"payload_hex": PAYLOAD, "path": "standin-evm-1"})
}

#[tokio::test]
async fn agent_fc_key_signs_through_guardian_with_correct_mpc_request() -> anyhow::Result<()> {
    let e = setup().await?;
    let fc = e.agent_fc().await?;
    let r = fc.call(e.agent.id(), "sign_evm").args_json(args()).gas(near_workspaces::types::Gas::from_tgas(150)).transact().await?;
    assert!(r.is_success(), "{:?}", r.failures());
    let out: serde_json::Value = r.json()?;
    assert_eq!(out["scheme"], "Secp256k1");
    let last: serde_json::Value = e.worker.view(&e.signer, "last_request").await?.json()?;
    assert_eq!(last["path"], "standin-evm-1");
    assert_eq!(last["payload_v2"]["Ecdsa"], PAYLOAD);
    assert_eq!(last["domain_id"], 0);
    assert_eq!(last["predecessor"], e.agent.id().to_string(), "the guardian account is the MPC predecessor");
    let dep: String = e.worker.view(&e.signer, "last_deposit").await?.json()?;
    assert_eq!(dep, "1");
    Ok(())
}

#[tokio::test]
async fn sign_evm_refused_when_frozen_even_for_owner_and_deleted_key_is_dead() -> anyhow::Result<()> {
    let e = setup().await?;
    let fc = e.agent_fc().await?;
    e.watcher.call(e.agent.id(), "freeze").args_json(json!({"reason": "decoy tripped"})).transact().await?.into_result()?;
    // owner (full-access key) is refused with the frozen message
    let o = e.agent.call(e.agent.id(), "sign_evm").args_json(args()).max_gas().transact().await?;
    assert!(o.is_failure());
    assert!(format!("{:?}", o.failures()).contains("frozen: sign_evm refused"), "{:?}", o.failures());
    // the agent function-call key was deleted by the freeze: the transaction itself is rejected
    let d = fc.call(e.agent.id(), "sign_evm").args_json(args()).max_gas().transact().await;
    assert!(d.is_err() || d.unwrap().is_failure(), "deleted FC key must not sign");
    // the MPC stub was never reached
    let last: serde_json::Value = e.worker.view(&e.signer, "last_request").await?.json()?;
    assert!(last.is_null());
    // unfreeze restores owner signing
    e.agent.call(e.agent.id(), "unfreeze").transact().await?.into_result()?;
    assert!(e.agent.call(e.agent.id(), "sign_evm").args_json(args()).max_gas().transact().await?.is_success());
    Ok(())
}

#[tokio::test]
async fn sign_evm_refused_for_non_owner_non_agent_callers_and_bad_input() -> anyhow::Result<()> {
    let e = setup().await?;
    for who in [&e.stranger, &e.watcher] {
        let r = who.call(e.agent.id(), "sign_evm").args_json(args()).max_gas().transact().await?;
        assert!(r.is_failure());
        assert!(format!("{:?}", r.failures()).contains("sign_evm: caller not authorized"), "{:?}", r.failures());
    }
    for bad in [json!({"payload_hex": "abcd", "path": "p"}), json!({"payload_hex": PAYLOAD, "path": ""})] {
        let r = e.agent.call(e.agent.id(), "sign_evm").args_json(bad).max_gas().transact().await?;
        assert!(r.is_failure(), "bad input must be refused");
    }
    let last: serde_json::Value = e.worker.view(&e.signer, "last_request").await?.json()?;
    assert!(last.is_null());
    Ok(())
}
