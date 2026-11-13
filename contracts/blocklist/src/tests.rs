use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

// Recorded from a real OutLayer testnet execution (tx J9MZ3kQZ...): message, signature, TEE key.
const REAL_KEY: &str = "50789ef6011db348993eec4852fb4406599085970d507f1f2f05b550682130a1";
const REAL_SIG: &str = "8f7960cd171747ce4a44d449eaa74f5322a0132931f2736729aec3d50d02d7c03169de8a8c60a45a29a2e955c730286d961c6c011736b103a016960007445006";
const REAL_MSG: &str = "standin-verdict:v1:{\"attacker_account\":\"si-w2atk-25769.testnet\",\"decoy_public_key\":\"ed25519:AvFxjYPySn11QTd6LrB314Ldd6oD6tp9qo4hGuQfJH54\",\"tx_hash\":\"44z4SzWkakUZkuWegpHheXCe9xAeHVr2V8NFgQ34bH54\",\"block_height\":277547521,\"decoy_account_id\":\"si-w2decoy-25769.testnet\"}";
const DEPOSIT: u128 = 10_000_000_000_000_000_000_000;
const TX: &str = "44z4SzWkakUZkuWegpHheXCe9xAeHVr2V8NFgQ34bH54";

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn contract(key_hex: &str) -> Blocklist {
    testing_env!(VMContextBuilder::new().current_account_id(acct("registry.testnet")).build());
    Blocklist::new(acct("owner.testnet"), acct("outlayer.testnet"), "o.testnet/standin-verdict".into(),
        "testnet".into(), key_hex.into(), U128(10_000_000_000_000_000_000_000), U128(1_500_000_000_000_000_000_000))
}

/// Runs `on_verdict` as the contract itself with `output` as the OutLayer promise result.
fn resume(c: &mut Blocklist, output: Value, tx: &str) -> Option<Entry> {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acct("registry.testnet"))
            .predecessor_account_id(acct("registry.testnet"))
            .block_timestamp(1_700_000_000_000_000_000)
            .build(),
        near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(),
        vec![PromiseResult::Successful(output.to_string().into_bytes())]
    );
    c.on_verdict(tx.into(), acct("si-w2decoy-25769.testnet"), acct("reporter.testnet"), U128(DEPOSIT), Ok(Some(output)))
}

/// A refusal stores nothing, logs `report_refused` with the reason, and still schedules the refund.
fn refused(c: &Blocklist, r: Option<Entry>, reason: &str) {
    assert!(r.is_none());
    assert_eq!(c.count(), 0);
    let logs = get_logs().join("\n");
    assert!(logs.contains("report_refused") && logs.contains(reason), "{logs}");
    assert_eq!(near_sdk::test_utils::get_created_receipts().iter().filter(|r| r.actions.iter().any(|a| format!("{a:?}").contains("Transfer"))).count(), 1);
}

fn real_output() -> Value {
    json!({"message": REAL_MSG, "signature": REAL_SIG, "public_key": REAL_KEY})
}

#[test]
fn real_tee_signature_is_stored_and_event_emitted() {
    let mut c = contract(REAL_KEY);
    let e = resume(&mut c, real_output(), TX).expect("stored");
    assert_eq!(e.attacker_account, acct("si-w2atk-25769.testnet"));
    assert_eq!(c.count(), 1);
    let chk = c.check(acct("si-w2atk-25769.testnet"));
    assert_eq!(chk.verdict, "block");
    assert!(chk.reasons[0].contains("44z4SzWkakUZkuWegpHheXCe9xAeHVr2V8NFgQ34bH54"));
    assert_eq!(c.check(acct("innocent.testnet")).verdict, "allow");
    assert_eq!(c.list(Some(0), Some(10)).len(), 1);
    let logs = get_logs().join("\n");
    assert!(logs.contains("\"event\":\"blocklist_add\"") && logs.contains("standin_blocklist"));
}

#[test]
fn forged_signature_from_another_key_is_refused() {
    let mut c = contract(REAL_KEY);
    // Attacker signs a verdict naming a victim with their own key.
    let sk = SigningKey::from_bytes(&[7u8; 32]);
    let msg = REAL_MSG.replace("si-w2atk-25769.testnet", "victim.testnet");
    let sig = hex::encode(sk.sign(msg.as_bytes()).to_bytes());
    let r = resume(&mut c, json!({"message": msg, "signature": sig, "public_key": hex::encode(sk.verifying_key().to_bytes())}), TX);
    refused(&c, r, "signature does not verify");
}

#[test]
fn tampered_message_with_real_signature_is_refused() {
    let mut c = contract(REAL_KEY);
    let msg = REAL_MSG.replace("si-w2atk-25769.testnet", "victim.testnet");
    let r = resume(&mut c, json!({"message": msg, "signature": REAL_SIG}), TX);
    refused(&c, r, "signature does not verify");
}

#[test]
fn message_without_prefix_is_refused_even_if_signed() {
    let sk = SigningKey::from_bytes(&[9u8; 32]);
    let mut c = contract(&hex::encode(sk.verifying_key().to_bytes()));
    let msg = REAL_MSG.trim_start_matches(MESSAGE_PREFIX).to_string();
    let sig = hex::encode(sk.sign(msg.as_bytes()).to_bytes());
    let r = resume(&mut c, json!({"message": msg, "signature": sig}), TX);
    refused(&c, r, "signature does not verify");
}

#[test]
fn valid_verdict_for_a_different_report_is_refused() {
    let mut c = contract(REAL_KEY);
    let r = resume(&mut c, real_output(), "9999999999999999999999999999999999999999999");
    refused(&c, r, "another transaction");
}

#[test]
fn failed_execution_stores_nothing_and_refunds() {
    let mut c = contract(REAL_KEY);
    testing_env!(VMContextBuilder::new().current_account_id(acct("registry.testnet"))
        .predecessor_account_id(acct("registry.testnet")).build());
    let r = c.on_verdict(TX.into(), acct("si-w2decoy-25769.testnet"), acct("r.testnet"), U128(DEPOSIT), Ok(None));
    refused(&c, r, "no verdict");
}

#[test]
fn locally_signed_valid_verdict_is_stored() {
    let sk = SigningKey::from_bytes(&[3u8; 32]);
    let mut c = contract(&hex::encode(sk.verifying_key().to_bytes()));
    let sig = hex::encode(sk.sign(REAL_MSG.as_bytes()).to_bytes());
    resume(&mut c, json!({"message": REAL_MSG, "signature": sig}), TX);
    assert_eq!(c.count(), 1);
}

#[test]
#[should_panic(expected = "attach more NEAR")]
fn report_requires_deposit() {
    let mut c = contract(REAL_KEY);
    testing_env!(VMContextBuilder::new().current_account_id(acct("registry.testnet"))
        .predecessor_account_id(acct("w.testnet")).attached_deposit(NearToken::from_millinear(1)).build());
    c.report(TX.into(), acct("si-w2decoy-25769.testnet"), acct("si-w2decoy-25769.testnet"), "ed25519:x".into());
}

#[test]
fn only_owner_rotates_key() {
    let mut c = contract(REAL_KEY);
    testing_env!(VMContextBuilder::new().predecessor_account_id(acct("owner.testnet")).build());
    c.set_verdict_public_key(hex::encode([1u8; 32]));
    assert!(!c.verify(REAL_MSG.into(), REAL_SIG.into()));
}
