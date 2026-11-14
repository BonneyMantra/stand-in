//! Stand-in guardian factory. Creates `<name>.<factory>` with the embedded guardian wasm and
//! `new_owned(owner = caller)`, adding NO access keys: the new account has no key at all, so only
//! the contract's own logic (owner = the caller) can act on it. For owners whose account cannot
//! host a contract, e.g. an Ethereum-wallet 0x account.
//! Build the guardian first: `cd contracts/guardian && cargo near build non-reproducible-wasm --no-abi`.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};

const GUARDIAN_WASM: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/near/standin_guardian.wasm"));
/// Left in the guardian above its storage, for state growth (keys, freeze log) and withdrawal.
const MARGIN: NearToken = NearToken::from_millinear(300);
/// Account record plus guardian state at init, in bytes.
const OVERHEAD_BYTES: u128 = 1_000;
const GAS_INIT: Gas = Gas::from_tgas(20);
const GAS_CB: Gas = Gas::from_tgas(15);
const MAX_ID_LEN: usize = 64;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    by_owner: LookupMap<AccountId, Vec<AccountId>>,
}

/// Lowercase single sub-account label: [a-z0-9] runs joined by single `-` or `_`, no dots
/// (a factory can only create direct children).
fn valid_label(name: &str) -> bool {
    let b = name.as_bytes();
    if b.is_empty() || !b[0].is_ascii_alphanumeric() || !b[b.len() - 1].is_ascii_alphanumeric() {
        return false;
    }
    let mut prev_sep = false;
    for &c in b {
        let sep = c == b'-' || c == b'_';
        if !(c.is_ascii_lowercase() || c.is_ascii_digit() || sep) || (sep && prev_sep) {
            return false;
        }
        prev_sep = sep;
    }
    true
}

#[near]
impl Factory {
    #[init]
    pub fn new() -> Self {
        Self { by_owner: LookupMap::new(b"o") }
    }

    /// Minimum deposit in yoctoNEAR: guardian storage (from the embedded wasm size) plus margin.
    pub fn required_deposit(&self) -> U128 {
        let bytes = GUARDIAN_WASM.len() as u128 + OVERHEAD_BYTES;
        U128(bytes * env::storage_byte_cost().as_yoctonear() + MARGIN.as_yoctonear())
    }

    pub fn guardians_of(&self, owner: AccountId) -> Vec<AccountId> {
        self.by_owner.get(&owner).cloned().unwrap_or_default()
    }

    /// Create `<name>.<this factory>`; owner = the caller. The whole deposit goes to the guardian
    /// account (its withdrawable balance is deposit minus storage). Resolves to the guardian id,
    /// or refunds the deposit to the caller and resolves to null if creation fails.
    #[payable]
    pub fn create_guardian(
        &mut self,
        name: String,
        watcher: AccountId,
        intents_contract: AccountId,
    ) -> Promise {
        require!(valid_label(&name), "name must be lowercase a-z, 0-9, '-' or '_' (no dots, no edge or doubled separators)");
        let deposit = env::attached_deposit();
        require!(
            deposit.as_yoctonear() >= self.required_deposit().0,
            "attached deposit is below required_deposit()"
        );
        let me = env::current_account_id();
        let id = format!("{name}.{me}");
        require!(id.len() <= MAX_ID_LEN, "account id longer than 64 characters");
        let guardian: AccountId = id.parse().unwrap_or_else(|_| env::panic_str("invalid account id"));
        let owner = env::predecessor_account_id();
        let init = near_sdk::serde_json::json!({
            "owner": owner, "watcher": watcher, "intents_contract": intents_contract
        });
        Promise::new(guardian.clone())
            .create_account()
            .transfer(deposit)
            .deploy_contract(GUARDIAN_WASM.to_vec())
            .function_call("new_owned".into(), init.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_INIT)
            .then(
                Self::ext(me)
                    .with_static_gas(GAS_CB)
                    .on_created(owner, guardian, U128(deposit.as_yoctonear())),
            )
    }

    #[private]
    pub fn on_created(
        &mut self,
        owner: AccountId,
        guardian: AccountId,
        deposit: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> Option<AccountId> {
        if result.is_ok() {
            let mut list = self.by_owner.get(&owner).cloned().unwrap_or_default();
            list.push(guardian.clone());
            self.by_owner.insert(owner, list);
            Some(guardian)
        } else {
            Promise::new(owner).transfer(NearToken::from_yoctonear(deposit.0));
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(pred: AccountId, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("guard.testnet".parse().unwrap())
            .predecessor_account_id(pred)
            .attached_deposit(deposit)
            .build());
    }
    fn fresh() -> Factory {
        ctx(accounts(0), NearToken::from_near(0));
        Factory::new()
    }
    fn dep(f: &Factory) -> NearToken {
        NearToken::from_yoctonear(f.required_deposit().0)
    }

    #[test]
    fn label_grammar() {
        for ok in ["a", "my-agent", "a_b-c9", "0x1"] {
            assert!(valid_label(ok), "{ok}");
        }
        for bad in ["", "-a", "a-", "a--b", "a_-b", "A", "a.b", "a b", "é"] {
            assert!(!valid_label(bad), "{bad}");
        }
    }

    #[test]
    fn deposit_covers_the_wasm() {
        let f = fresh();
        let storage = GUARDIAN_WASM.len() as u128 * env::storage_byte_cost().as_yoctonear();
        assert!(f.required_deposit().0 > storage + MARGIN.as_yoctonear() / 2);
        assert!(GUARDIAN_WASM.len() > 100_000);
    }

    #[test]
    fn create_accepts_and_callback_records() {
        let mut f = fresh();
        let d = dep(&f);
        ctx(accounts(5), d);
        let _ = f.create_guardian("alice".into(), accounts(1), accounts(2));
        let g: AccountId = "alice.guard.testnet".parse().unwrap();
        ctx(accounts(0), NearToken::from_near(0));
        // success path (callback_result Ok) records the owner mapping
        let r = f.on_created(accounts(5), g.clone(), U128(d.as_yoctonear()), Ok(()));
        assert_eq!(r, Some(g.clone()));
        assert_eq!(f.guardians_of(accounts(5)), vec![g]);
        assert!(f.guardians_of(accounts(4)).is_empty());
    }

    #[test]
    fn failed_creation_records_nothing_and_refunds() {
        let mut f = fresh();
        let g: AccountId = "alice.guard.testnet".parse().unwrap();
        let r = f.on_created(accounts(5), g, U128(5), Err(PromiseError::Failed));
        assert_eq!(r, None);
        assert!(f.guardians_of(accounts(5)).is_empty());
        let refunds = near_sdk::test_utils::get_created_receipts();
        assert!(refunds.iter().any(|r| r.receiver_id == accounts(5)), "refund receipt to owner");
    }

    #[test]
    #[should_panic(expected = "below required_deposit")]
    fn short_deposit_refused() {
        let mut f = fresh();
        ctx(accounts(5), NearToken::from_near(1));
        let _ = f.create_guardian("alice".into(), accounts(1), accounts(2));
    }

    #[test]
    #[should_panic(expected = "name must be lowercase")]
    fn bad_name_refused() {
        let mut f = fresh();
        let d = dep(&f);
        ctx(accounts(5), d);
        let _ = f.create_guardian("Bad.Name".into(), accounts(1), accounts(2));
    }

    #[test]
    #[should_panic(expected = "longer than 64")]
    fn long_id_refused() {
        let mut f = fresh();
        let d = dep(&f);
        ctx(accounts(5), d);
        let _ = f.create_guardian("a".repeat(60), accounts(1), accounts(2));
    }
}
