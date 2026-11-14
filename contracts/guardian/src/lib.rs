//! Stand-in guardian. Lives on the agent account itself.
//! - Owner methods require predecessor == the account itself (i.e. its full-access key).
//! - `freeze` is callable by the watcher account (via its function-call key) or the owner.
//! - Function-call keys it hands to agents are added/deleted via Promise actions on its own account.
//! - A contract cannot list its own access keys, so every key it adds is recorded in state.
use near_sdk::json_types::{U128, U64};
use near_sdk::{
    env, near, require, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise, PublicKey,
};

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_REMOVE: Gas = Gas::from_tgas(8);
const GAS_ADD: Gas = Gas::from_tgas(8);
const GAS_CB: Gas = Gas::from_tgas(8);
const MAX_LOG: usize = 50;
/// Testnet MPC signer. Mainnet is v1.signer; a deployment on another network must change this.
const MPC_SIGNER: &str = "v1.signer-prod.testnet";
const GAS_SIGN: Gas = Gas::from_tgas(100);
const SIGN_DEPOSIT: NearToken = NearToken::from_yoctonear(1);
const MAX_KEYS: usize = 32;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct FreezeRecord {
    pub at_block: U64,
    pub reason: String,
    pub decoy_public_key: Option<String>,
    pub tx_hash: Option<String>,
    pub by: AccountId,
    pub deleted_keys: Vec<PublicKey>,
    pub intents_keys_removed: Vec<PublicKey>,
}

#[near(serializers = [json])]
pub struct GuardianState {
    pub owner: AccountId,
    pub watcher: AccountId,
    pub intents_contract: AccountId,
    pub agent_keys: Vec<PublicKey>,
    pub intents_keys: Vec<PublicKey>,
    pub frozen: bool,
    pub freeze_log: Vec<FreezeRecord>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Guardian {
    owner: AccountId,
    watcher: AccountId,
    intents_contract: AccountId,
    agent_keys: Vec<PublicKey>,
    intents_keys: Vec<PublicKey>,
    frozen: bool,
    freeze_log: Vec<FreezeRecord>,
}

fn event(name: &str, data: &str) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"standin","version":"1.0.0","event":"{name}","data":[{data}]}}"#
    ));
}

fn keys_json(keys: &[PublicKey]) -> String {
    let v: Vec<String> = keys.iter().map(|k| format!("\"{}\"", String::from(k))).collect();
    format!("[{}]", v.join(","))
}

#[near]
impl Guardian {
    /// Owner is the account itself: owner-only calls need its full-access key.
    #[init]
    pub fn new(watcher: AccountId, intents_contract: AccountId) -> Self {
        Self {
            owner: env::current_account_id(),
            watcher,
            intents_contract,
            agent_keys: Vec::new(),
            intents_keys: Vec::new(),
            frozen: false,
            freeze_log: Vec::new(),
        }
    }

    /// Owner is an external account (e.g. an Ethereum-wallet 0x account) that cannot host a
    /// contract. This account then holds no full-access key, so the owner calls through its own
    /// account and `withdraw` is the only way to move this account's NEAR out.
    #[init]
    pub fn new_owned(owner: AccountId, watcher: AccountId, intents_contract: AccountId) -> Self {
        require!(owner != env::current_account_id(), "owner must be an external account");
        Self { owner, ..Self::new(watcher, intents_contract) }
    }

    /// Owner only. Transfers `amount` yoctoNEAR to the owner, never below the storage reserve.
    /// Allowed while frozen: a freeze only cuts agent access, and an owner reacting to a compromise
    /// must still be able to pull funds out (the agent keys are gone and cannot call this).
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        require!(amount.0 > 0, "amount must be positive");
        let reserve = env::storage_byte_cost().as_yoctonear() * u128::from(env::storage_usage());
        let free = env::account_balance().as_yoctonear().saturating_sub(reserve);
        require!(amount.0 <= free, "amount exceeds balance above the storage reserve");
        event("withdraw", &format!(r#"{{"to":"{}","amount":"{}"}}"#, self.owner, amount.0));
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    /// Add a scoped function-call key to this account. `allowance` in yoctoNEAR; "0" = unlimited.
    /// `method_names` empty = any method on `receiver_id`.
    pub fn add_agent_key(
        &mut self,
        public_key: PublicKey,
        receiver_id: AccountId,
        method_names: Vec<String>,
        allowance: U128,
    ) -> Promise {
        self.assert_owner();
        require!(!self.frozen, "frozen: call unfreeze first");
        require!(self.agent_keys.len() < MAX_KEYS, "too many agent keys");
        require!(!self.agent_keys.contains(&public_key), "key already registered");
        let allowance = match allowance.0 {
            0 => Allowance::Unlimited,
            n => Allowance::limited(NearToken::from_yoctonear(n)).unwrap(),
        };
        self.agent_keys.push(public_key.clone());
        event("agent_key_added", &format!(r#"{{"public_key":"{}","receiver_id":"{receiver_id}"}}"#, String::from(&public_key)));
        Promise::new(env::current_account_id()).add_access_key_allowance(
            public_key,
            allowance,
            receiver_id,
            method_names.join(","),
        )
    }

    /// Chain Signatures: request an ECDSA (secp256k1, domain 0) signature over a 32-byte payload hash
    /// from the NEAR MPC signer. The MPC derives the key from (this account, `path`), so the signing
    /// authority is this account's. The caller needs only a function-call key on this method (its
    /// predecessor is this account); the guardian attaches the required 1 yoctoNEAR itself. Refused
    /// while frozen, so a freeze cuts cross-chain signing even for the owner key until `unfreeze`.
    /// `payload_hex`: 64 hex chars. Request shape per the near/mpc contract README:
    /// `sign({request:{payload_v2:{Ecdsa:hex}, path, domain_id:0}})`. Returns the MPC response.
    pub fn sign_evm(&mut self, payload_hex: String, path: String) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "sign_evm: caller not authorized");
        require!(!self.frozen, "frozen: sign_evm refused until unfreeze");
        require!(
            payload_hex.len() == 64 && payload_hex.bytes().all(|b| b.is_ascii_hexdigit()),
            "payload_hex must be 64 hex chars (32 bytes)"
        );
        require!(!path.is_empty() && path.len() <= 128, "path must be 1..128 bytes");
        let payload = payload_hex.to_lowercase();
        event(
            "sign_evm",
            &format!(
                r#"{{"path":{},"payload":"{payload}"}}"#,
                near_sdk::serde_json::to_string(&path).unwrap()
            ),
        );
        let args = near_sdk::serde_json::json!({
            "request": { "payload_v2": { "Ecdsa": payload }, "path": path, "domain_id": 0 }
        });
        Promise::new(MPC_SIGNER.parse().unwrap()).function_call(
            "sign".into(),
            args.to_string().into_bytes(),
            SIGN_DEPOSIT,
            GAS_SIGN,
        )
    }

    /// Register `public_key` on the intents contract as this account (1 yoctoNEAR).
    pub fn add_intents_key(&mut self, public_key: PublicKey) -> Promise {
        self.assert_owner();
        require!(!self.frozen, "frozen: call unfreeze first");
        Promise::new(self.intents_contract.clone())
            .function_call(
                "add_public_key".into(),
                format!(r#"{{"public_key":"{}"}}"#, String::from(&public_key)).into_bytes(),
                ONE_YOCTO,
                GAS_ADD,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CB)
                    .on_intents_key_added(public_key),
            )
    }

    #[private]
    pub fn on_intents_key_added(&mut self, public_key: PublicKey) -> bool {
        if near_sdk::is_promise_success() {
            if !self.intents_keys.contains(&public_key) {
                self.intents_keys.push(public_key);
            }
            true
        } else {
            false
        }
    }

    /// Delete every agent key on this account and remove every intents key. Watcher or owner.
    pub fn freeze(
        &mut self,
        reason: String,
        decoy_public_key: Option<String>,
        tx_hash: Option<String>,
    ) {
        let caller = env::predecessor_account_id();
        require!(caller == self.watcher || caller == self.owner, "only watcher or owner may freeze");
        require!(!self.frozen, "already frozen");
        require!(reason.len() <= 500, "reason too long");
        self.frozen = true;
        let deleted = std::mem::take(&mut self.agent_keys);
        let removed = std::mem::take(&mut self.intents_keys);
        let me = env::current_account_id();
        // One independent receipt per key so one failure cannot block the others.
        for k in &deleted {
            Promise::new(me.clone()).delete_key(k.clone());
        }
        for k in &removed {
            Promise::new(self.intents_contract.clone()).function_call(
                "remove_public_key".into(),
                format!(r#"{{"public_key":"{}"}}"#, String::from(k)).into_bytes(),
                ONE_YOCTO,
                GAS_REMOVE,
            );
        }
        event(
            "freeze",
            &format!(
                r#"{{"by":"{caller}","reason":{},"decoy_public_key":{},"tx_hash":{},"deleted_keys":{},"intents_keys_removed":{}}}"#,
                near_sdk::serde_json::to_string(&reason).unwrap(),
                near_sdk::serde_json::to_string(&decoy_public_key).unwrap(),
                near_sdk::serde_json::to_string(&tx_hash).unwrap(),
                keys_json(&deleted),
                keys_json(&removed)
            ),
        );
        if self.freeze_log.len() >= MAX_LOG {
            self.freeze_log.remove(0);
        }
        self.freeze_log.push(FreezeRecord {
            at_block: U64(env::block_height()),
            reason,
            decoy_public_key,
            tx_hash,
            by: caller,
            deleted_keys: deleted,
            intents_keys_removed: removed,
        });
    }

    /// Owner only (full-access key). Re-enables add_agent_key / add_intents_key.
    pub fn unfreeze(&mut self) {
        self.assert_owner();
        require!(self.frozen, "not frozen");
        self.frozen = false;
        event("unfreeze", &format!(r#"{{"by":"{}"}}"#, env::predecessor_account_id()));
    }

    pub fn get_state(&self) -> GuardianState {
        GuardianState {
            owner: self.owner.clone(),
            watcher: self.watcher.clone(),
            intents_contract: self.intents_contract.clone(),
            agent_keys: self.agent_keys.clone(),
            intents_keys: self.intents_keys.clone(),
            frozen: self.frozen,
            freeze_log: self.freeze_log.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(pred: AccountId) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(pred)
            .build());
    }
    fn pk(s: &str) -> PublicKey {
        s.parse().unwrap()
    }
    const K1: &str = "ed25519:HNSF4vhZpsSbCGhwVpVnNrZ4ZX8JUthRemqCUKnKKWTx";

    fn fresh() -> Guardian {
        ctx(accounts(0));
        Guardian::new(accounts(1), accounts(2))
    }

    #[test]
    fn owner_adds_then_watcher_freezes() {
        let mut g = fresh();
        let _ = g.add_agent_key(pk(K1), accounts(3), vec!["record_deploy".into()], U128(0));
        assert_eq!(g.get_state().agent_keys.len(), 1);
        ctx(accounts(1));
        g.freeze("decoy tripped".into(), Some("ed25519:x".into()), Some("abc".into()));
        let s = g.get_state();
        assert!(s.frozen && s.agent_keys.is_empty() && s.freeze_log.len() == 1);
        assert_eq!(s.freeze_log[0].deleted_keys.len(), 1);
    }

    #[test]
    #[should_panic(expected = "only watcher or owner may freeze")]
    fn stranger_cannot_freeze() {
        let mut g = fresh();
        ctx(accounts(4));
        g.freeze("x".into(), None, None);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn watcher_cannot_add_keys() {
        let mut g = fresh();
        ctx(accounts(1));
        let _ = g.add_agent_key(pk(K1), accounts(3), vec![], U128(0));
    }

    #[test]
    #[should_panic(expected = "frozen")]
    fn no_add_while_frozen() {
        let mut g = fresh();
        g.freeze("x".into(), None, None);
        let _ = g.add_agent_key(pk(K1), accounts(3), vec![], U128(0));
    }
}
