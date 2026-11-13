//! Minimal, source-faithful replica of the near/intents (defuse) account key registry.
//! Mirrors: add_public_key / remove_public_key (assert_one_yocto, predecessor auth),
//! public_keys_of / has_public_key, and the execute_signed_intent key check that returns
//! `PublicKeyNotExist` when the signing key is not registered for the signer at execution time.
//! See contracts/README.md for upstream file and line citations.
use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::Base64VecU8;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    assert_one_yocto, env, near, AccountId, BorshStorageKey, CurveType, PanicOnDefault, PublicKey,
};

#[derive(BorshStorageKey, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
enum Prefix {
    Keys,
    KeySet(AccountId),
    Nonces,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct IntentsReplica {
    accounts: LookupMap<AccountId, IterableSet<PublicKey>>,
    used_nonces: LookupMap<(AccountId, [u8; 32]), ()>,
    executed: u64,
}

fn emit(event: &str, account_id: &AccountId, field: &str, value: &str) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"dip4","version":"0.3.0","event":"{event}","data":[{{"account_id":"{account_id}","{field}":"{value}"}}]}}"#
    ));
}

fn not_exist(account_id: &AccountId, public_key: &PublicKey) -> ! {
    env::panic_str(&format!(
        "PublicKeyNotExist: public key '{}' doesn't exist for account '{account_id}'",
        String::from(public_key)
    ))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[near]
impl IntentsReplica {
    #[init]
    pub fn new() -> Self {
        Self {
            accounts: LookupMap::new(Prefix::Keys),
            used_nonces: LookupMap::new(Prefix::Nonces),
            executed: 0,
        }
    }

    pub fn has_public_key(&self, account_id: AccountId, public_key: PublicKey) -> bool {
        self.accounts.get(&account_id).is_some_and(|s| s.contains(&public_key))
    }

    pub fn public_keys_of(&self, account_id: AccountId) -> Vec<PublicKey> {
        self.accounts.get(&account_id).map_or_else(Vec::new, |s| s.iter().cloned().collect())
    }

    pub fn executed_count(&self) -> u64 {
        self.executed
    }

    /// Registers `public_key` for the predecessor account (upstream: ensure_auth_predecessor_id).
    #[payable]
    pub fn add_public_key(&mut self, public_key: PublicKey) {
        assert_one_yocto();
        let account_id = env::predecessor_account_id();
        if !self.accounts.contains_key(&account_id) {
            let set = IterableSet::new(Prefix::KeySet(account_id.clone()));
            self.accounts.insert(account_id.clone(), set);
        }
        let set = self.accounts.get_mut(&account_id).unwrap();
        if !set.insert(public_key.clone()) {
            env::panic_str(&format!(
                "PublicKeyExists: public key '{}' already exists for account '{account_id}'",
                String::from(&public_key)
            ));
        }
        emit("public_key_added", &account_id, "public_key", &String::from(&public_key));
    }

    /// Removes `public_key` from the predecessor account. Fails with PublicKeyNotExist if absent.
    #[payable]
    pub fn remove_public_key(&mut self, public_key: PublicKey) {
        assert_one_yocto();
        let account_id = env::predecessor_account_id();
        let removed = self.accounts.get_mut(&account_id).is_some_and(|s| s.remove(&public_key));
        if !removed {
            not_exist(&account_id, &public_key);
        }
        emit("public_key_removed", &account_id, "public_key", &String::from(&public_key));
    }

    /// Execute a signed intent. `signature` is base64 of the 64-byte ed25519 signature over the
    /// UTF-8 bytes of `payload`. Order of checks follows upstream execute_signed_intent:
    /// verify signature -> public key must exist for signer_id *now* -> commit nonce -> execute.
    /// Returns the hex sha256 of the payload (the intent hash).
    pub fn execute_signed(
        &mut self,
        signer_id: AccountId,
        public_key: PublicKey,
        payload: String,
        signature: Base64VecU8,
    ) -> String {
        if public_key.curve_type() != CurveType::ED25519 {
            env::panic_str("InvalidSignature: only ed25519 supported");
        }
        let sig: [u8; 64] = signature
            .0
            .try_into()
            .unwrap_or_else(|_| env::panic_str("InvalidSignature: bad signature length"));
        let pk: [u8; 32] = public_key.as_bytes()[1..]
            .try_into()
            .unwrap_or_else(|_| env::panic_str("InvalidSignature: bad key length"));
        if !env::ed25519_verify(&sig, payload.as_bytes(), &pk) {
            env::panic_str("InvalidSignature");
        }
        if !self.has_public_key(signer_id.clone(), public_key.clone()) {
            not_exist(&signer_id, &public_key);
        }
        let hash = env::sha256_array(payload.as_bytes());
        let nonce_key = (signer_id.clone(), hash);
        assert!(!self.used_nonces.contains_key(&nonce_key), "InvalidNonce: intent already executed");
        self.used_nonces.insert(nonce_key, ());
        self.executed += 1;
        emit("intent_executed", &signer_id, "hash", &hex(&hash));
        hex(&hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, NearToken};

    fn ctx(pred: usize, deposit: u128) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(pred))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build());
    }
    fn pk() -> PublicKey {
        "ed25519:HNSF4vhZpsSbCGhwVpVnNrZ4ZX8JUthRemqCUKnKKWTx".parse().unwrap()
    }

    #[test]
    fn add_remove_roundtrip() {
        let mut c = IntentsReplica::new();
        ctx(1, 1);
        c.add_public_key(pk());
        assert!(c.has_public_key(accounts(1), pk()));
        assert_eq!(c.public_keys_of(accounts(1)).len(), 1);
        c.remove_public_key(pk());
        assert!(!c.has_public_key(accounts(1), pk()));
    }

    #[test]
    #[should_panic(expected = "PublicKeyNotExist")]
    fn remove_missing_fails() {
        let mut c = IntentsReplica::new();
        ctx(1, 1);
        c.remove_public_key(pk());
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn needs_one_yocto() {
        let mut c = IntentsReplica::new();
        ctx(1, 0);
        c.add_public_key(pk());
    }
}
