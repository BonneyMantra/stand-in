//! Parsing tests against RPC responses recorded from testnet (tests/fixtures).
use super::*;
use serde_json::json;

const TX: &str = include_str!("../tests/fixtures/tx_status.json");
const BLOCK: &str = include_str!("../tests/fixtures/block.json");
const KEY: &str = include_str!("../tests/fixtures/access_key.json");
const KEY_MISSING: &str = include_str!("../tests/fixtures/access_key_missing.json");

const DECOY: &str = "si-w2decoy-25769.testnet";
const ATTACKER: &str = "si-w2atk-25769.testnet";
const TX_HASH: &str = "44z4SzWkakUZkuWegpHheXCe9xAeHVr2V8NFgQ34bH54";
const DECOY_PK: &str = "ed25519:AvFxjYPySn11QTd6LrB314Ldd6oD6tp9qo4hGuQfJH54";

fn input() -> Input {
    Input {
        network: "testnet".into(),
        tx_hash: TX_HASH.into(),
        decoy_account_id: DECOY.into(),
        sender_id: DECOY.into(),
        admin_public_key: "ed25519:3Tpj9QDvxBn8ZjoCUUR6CLw1vvTmTCaF9j2PzPTHBDHP".into(),
    }
}

fn tx() -> Value {
    serde_json::from_str(TX).unwrap()
}

#[test]
fn accepts_recorded_drain() {
    let f = check_tx(&input(), &tx()).unwrap();
    assert_eq!(f.attacker_account, ATTACKER);
    assert_eq!(f.signer_public_key, DECOY_PK);
    assert_eq!(f.block_hash, "FRZtp9pU7YSjNqiGJaF5RuK8ZNvViS4TiaBw6CGMdkqz");
}

#[test]
fn rejects_wrong_signer() {
    let mut i = input();
    i.decoy_account_id = "someone-else.testnet".into();
    assert!(check_tx(&i, &tx()).unwrap_err().contains("not the decoy account"));
}

#[test]
fn rejects_admin_key() {
    let mut i = input();
    i.admin_public_key = DECOY_PK.into();
    assert!(check_tx(&i, &tx()).unwrap_err().contains("admin key"));
}

#[test]
fn rejects_hash_mismatch() {
    let mut i = input();
    i.tx_hash = "11111111111111111111111111111111".into();
    assert!(check_tx(&i, &tx()).unwrap_err().contains("hash mismatch"));
}

#[test]
fn rejects_failed_tx() {
    let mut t = tx();
    t["result"]["status"] = json!({"Failure": {"ActionError": {}}});
    assert!(check_tx(&input(), &t).unwrap_err().contains("did not succeed"));
}

#[test]
fn rejects_rpc_error() {
    let t = json!({"error": {"name": "UNKNOWN_TRANSACTION"}});
    assert!(check_tx(&input(), &t).unwrap_err().contains("rpc error"));
}

#[test]
fn rejects_transfer_to_self() {
    let mut t = tx();
    t["result"]["transaction"]["receiver_id"] = json!(DECOY);
    assert!(check_tx(&input(), &t).is_err());
}

#[test]
fn delete_account_names_beneficiary() {
    let mut t = tx();
    t["result"]["transaction"]["receiver_id"] = json!(DECOY);
    t["result"]["transaction"]["actions"] = json!([{"DeleteAccount": {"beneficiary_id": ATTACKER}}]);
    assert_eq!(check_tx(&input(), &t).unwrap().attacker_account, ATTACKER);
}

#[test]
fn block_and_key_parsing() {
    let (h, prev) = parse_block(&serde_json::from_str(BLOCK).unwrap()).unwrap();
    assert_eq!(h, 277547521);
    assert_eq!(prev, "6Feo9AKPJ6Qn7YBnXAmMutjRnPUW53YSgSxENzMwR22G");
    assert!(check_full_access(&serde_json::from_str(KEY).unwrap()).is_ok());
    assert!(check_full_access(&serde_json::from_str(KEY_MISSING).unwrap()).is_err());
    let fc = json!({"result": {"permission": {"FunctionCall": {"receiver_id": "x.testnet"}}}});
    assert!(check_full_access(&fc).is_err());
}

#[test]
fn verdict_message_is_canonical() {
    let f = check_tx(&input(), &tx()).unwrap();
    let v = build_verdict(&input(), &f, 277547521);
    let expected = format!(
        "standin-verdict:v1:{{\"attacker_account\":\"{ATTACKER}\",\"decoy_public_key\":\"{DECOY_PK}\",\"tx_hash\":\"{TX_HASH}\",\"block_height\":277547521,\"decoy_account_id\":\"{DECOY}\"}}"
    );
    assert_eq!(String::from_utf8(v.signed_message()).unwrap(), expected);
}

#[test]
fn rejects_unknown_network() {
    assert!(rpc_endpoint("devnet").is_err());
}
