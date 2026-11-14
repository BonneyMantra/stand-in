//! Unit tests for the externally-owned guardian (`new_owned`, `withdraw`).
//! accounts(0)=guardian, 1=watcher, 2=intents, 3=receiver, 4=stranger, 5=external owner.
use near_sdk::json_types::U128;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken, PublicKey};
use standin_guardian::Guardian;

fn ctx(pred: AccountId) {
    testing_env!(VMContextBuilder::new().current_account_id(accounts(0)).predecessor_account_id(pred).build());
}
fn pk(s: &str) -> PublicKey {
    s.parse().unwrap()
}
const K1: &str = "ed25519:HNSF4vhZpsSbCGhwVpVnNrZ4ZX8JUthRemqCUKnKKWTx";

// accounts(0)=guardian, 1=watcher, 2=intents, 3=receiver, 4=stranger; external owner = accounts(5)
fn owned() -> Guardian {
    ctx(accounts(0));
    Guardian::new_owned(accounts(5), accounts(1), accounts(2))
}
fn ctx_bal(pred: AccountId) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(accounts(0))
        .predecessor_account_id(pred)
        .account_balance(NearToken::from_near(10))
        .build());
}

#[test]
fn external_owner_full_flow() {
    let mut g = owned();
    assert_eq!(g.get_state().owner, accounts(5));
    ctx(accounts(5));
    let _ = g.add_agent_key(pk(K1), accounts(3), vec![], U128(0));
    assert_eq!(g.get_state().agent_keys.len(), 1);
    let _ = g.sign_evm("ab".repeat(32), "p".into());
    g.freeze("owner freeze".into(), None, None);
    let _ = g.withdraw(U128(1)); // allowed while frozen
    g.unfreeze();
    assert!(!g.get_state().frozen);
    ctx_bal(accounts(5));
    let _ = g.withdraw(U128(1_000_000_000_000_000_000_000_000));
}

#[test]
#[should_panic(expected = "exceeds balance above the storage reserve")]
fn withdraw_cannot_dip_into_storage_reserve() {
    let mut g = owned();
    ctx_bal(accounts(5));
    let _ = g.withdraw(U128(NearToken::from_near(10).as_yoctonear()));
}

#[test]
#[should_panic(expected = "owner only")]
fn self_is_not_owner_when_external() {
    let mut g = owned();
    ctx(accounts(0));
    let _ = g.add_agent_key(pk(K1), accounts(3), vec![], U128(0));
}

#[test]
#[should_panic(expected = "owner only")]
fn self_cannot_withdraw_or_unfreeze_when_external() {
    let mut g = owned();
    ctx(accounts(0));
    let _ = g.withdraw(U128(1));
}

#[test]
#[should_panic(expected = "owner only")]
fn watcher_cannot_withdraw() {
    let mut g = owned();
    ctx(accounts(1));
    let _ = g.withdraw(U128(1));
}

#[test]
#[should_panic(expected = "sign_evm: caller not authorized")]
fn self_cannot_sign_when_external() {
    let mut g = owned();
    ctx(accounts(0));
    let _ = g.sign_evm("ab".repeat(32), "p".into());
}

#[test]
fn watcher_can_freeze_external_owned_but_not_unfreeze() {
    let mut g = owned();
    ctx(accounts(1));
    g.freeze("decoy".into(), None, None);
    assert!(g.get_state().frozen);
}

#[test]
#[should_panic(expected = "owner must be an external account")]
fn new_owned_rejects_self_owner() {
    ctx(accounts(0));
    Guardian::new_owned(accounts(0), accounts(1), accounts(2));
}

