//! Stand-in blocklist. An entry exists only if the OutLayer `standin-verdict` TEE app signed it:
//! `report` asks OutLayer to verify the drain transaction, the callback checks the ed25519
//! signature against the verdict public key pinned at init, and only then stores and emits.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::IterableMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};

pub const MESSAGE_PREFIX: &str = "standin-verdict:v1:";
const REQUEST_GAS: Gas = Gas::from_tgas(150);
const CALLBACK_GAS: Gas = Gas::from_tgas(40);

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Entries,
}

/// The statement the TEE signs (field order = canonical JSON order).
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Verdict {
    attacker_account: AccountId,
    decoy_public_key: String,
    tx_hash: String,
    block_height: u64,
    decoy_account_id: AccountId,
}

#[derive(Serialize, Clone)]
#[serde(crate = "near_sdk::serde")]
#[near(serializers = [borsh])]
pub struct Entry {
    pub attacker_account: AccountId,
    pub decoy_public_key: String,
    pub decoy_account_id: AccountId,
    pub tx_hash: String,
    pub block_height: u64,
    /// Who paid for the report. The OutLayer attestation for this entry is looked up by the
    /// NEAR transaction that called `report` (attestations are keyed by requesting tx).
    pub reporter: AccountId,
    pub attested_at_ns: U64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Check {
    pub verdict: String,
    pub reasons: Vec<String>,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Blocklist {
    owner: AccountId,
    outlayer: AccountId,
    project_id: String,
    network: String,
    verdict_public_key: [u8; 32],
    min_deposit: u128,
    report_fee: u128,
    entries: IterableMap<AccountId, Entry>,
}

#[near]
impl Blocklist {
    /// `verdict_public_key` is the hex ed25519 key of the OutLayer project signing path `verdict`.
    #[init]
    pub fn new(
        owner: AccountId,
        outlayer: AccountId,
        project_id: String,
        network: String,
        verdict_public_key: String,
        min_deposit: U128,
        report_fee: U128,
    ) -> Self {
        Self {
            owner,
            outlayer,
            project_id,
            network,
            verdict_public_key: parse_key(&verdict_public_key),
            min_deposit: min_deposit.0,
            report_fee: report_fee.0,
            entries: IterableMap::new(Key::Entries),
        }
    }

    pub fn set_verdict_public_key(&mut self, verdict_public_key: String) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        self.verdict_public_key = parse_key(&verdict_public_key);
    }

    /// Ask OutLayer to verify a decoy-drain transaction. Attach NEAR (>= min_deposit); OutLayer
    /// charges what the run used; the callback returns `deposit - report_fee` to the caller.
    #[payable]
    pub fn report(
        &mut self,
        tx_hash: String,
        decoy_account_id: AccountId,
        sender_id: AccountId,
        admin_public_key: String,
    ) -> Promise {
        let deposit = env::attached_deposit();
        require!(deposit.as_yoctonear() >= self.min_deposit, "attach more NEAR for the OutLayer run");
        require!(tx_hash.len() >= 32 && tx_hash.len() <= 64, "bad tx_hash");
        require!(admin_public_key.len() <= 100, "bad admin_public_key");
        let reporter = env::predecessor_account_id();
        let input = json!({
            "network": self.network, "tx_hash": tx_hash, "decoy_account_id": decoy_account_id,
            "sender_id": sender_id, "admin_public_key": admin_public_key,
        });
        let args = json!({
            "source": {"Project": {"project_id": self.project_id, "version_key": null}},
            "input_data": input.to_string(),
            "resource_limits": {"max_instructions": 2_000_000_000u64, "max_memory_mb": 128, "max_execution_seconds": 30},
            "response_format": "Json",
        });
        Promise::new(self.outlayer.clone())
            .function_call("request_execution".into(), args.to_string().into_bytes(), deposit, REQUEST_GAS)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_verdict(tx_hash, decoy_account_id, reporter, U128(deposit.as_yoctonear())),
            )
    }

    /// Resume point. Stores an entry only if the signature verifies against the pinned key.
    /// Never panics: whatever the outcome, the reporter gets `deposit - report_fee` back
    /// (OutLayer refunds its unused part to this contract), and a refusal is logged.
    #[private]
    pub fn on_verdict(
        &mut self,
        tx_hash: String,
        decoy_account_id: AccountId,
        reporter: AccountId,
        deposit: U128,
        #[callback_result] result: Result<Option<Value>, PromiseError>,
    ) -> Option<Entry> {
        let refund = deposit.0.saturating_sub(self.report_fee);
        if refund > 0 {
            Promise::new(reporter.clone()).transfer(NearToken::from_yoctonear(refund));
        }
        match self.accept(&tx_hash, &decoy_account_id, &reporter, result) {
            Ok(entry) => {
                env::log_str(&format!(
                    "EVENT_JSON:{}",
                    json!({"standard": "standin_blocklist", "version": "1.0.0", "event": "blocklist_add", "data": [&entry]})
                ));
                Some(entry)
            }
            Err(why) => {
                env::log_str(&format!(
                    "EVENT_JSON:{}",
                    json!({"standard": "standin_blocklist", "version": "1.0.0", "event": "report_refused",
                           "data": [{"tx_hash": tx_hash, "reporter": reporter, "reason": why}]})
                ));
                None
            }
        }
    }

    fn accept(
        &mut self,
        tx_hash: &str,
        decoy_account_id: &AccountId,
        reporter: &AccountId,
        result: Result<Option<Value>, PromiseError>,
    ) -> Result<Entry, String> {
        let out = match result {
            Ok(Some(v)) => v,
            _ => return Err("OutLayer returned no verdict (execution failed or timed out)".into()),
        };
        let message = out.get("message").and_then(Value::as_str).ok_or("no message")?;
        let sig = out.get("signature").and_then(Value::as_str).ok_or("no signature")?;
        if !self.check_sig(message, sig) {
            return Err("signature does not verify against the pinned verdict key".into());
        }
        let v: Verdict = serde_json::from_str(&message[MESSAGE_PREFIX.len()..]).map_err(|_| "malformed verdict")?;
        if v.tx_hash != tx_hash || &v.decoy_account_id != decoy_account_id {
            return Err("verdict is for another transaction".into());
        }
        if v.attacker_account == v.decoy_account_id {
            return Err("attacker equals decoy".into());
        }
        let entry = Entry {
            attacker_account: v.attacker_account.clone(),
            decoy_public_key: v.decoy_public_key,
            decoy_account_id: v.decoy_account_id,
            tx_hash: v.tx_hash,
            block_height: v.block_height,
            reporter: reporter.clone(),
            attested_at_ns: U64(env::block_timestamp()),
        };
        self.entries.insert(v.attacker_account, entry.clone());
        Ok(entry)
    }

    /// True when `signature` (hex) is the pinned verdict key's signature over the prefixed `message`.
    pub fn verify(&self, message: String, signature: String) -> bool {
        self.check_sig(&message, &signature)
    }

    fn check_sig(&self, message: &str, signature: &str) -> bool {
        if !message.starts_with(MESSAGE_PREFIX) {
            return false;
        }
        let Ok(sig) = hex::decode(signature) else { return false };
        let Ok(sig) = <[u8; 64]>::try_from(sig.as_slice()) else { return false };
        env::ed25519_verify(&sig, message.as_bytes(), &self.verdict_public_key)
    }

    pub fn check(&self, account_id: AccountId) -> Check {
        match self.entries.get(&account_id) {
            Some(e) => Check {
                verdict: "block".into(),
                reasons: vec![format!(
                    "{} received funds from a decoy key ({}) that drained {} in tx {} at block {}; attested by OutLayer project {}",
                    e.attacker_account, e.decoy_public_key, e.decoy_account_id, e.tx_hash, e.block_height, self.project_id
                )],
            },
            None => Check { verdict: "allow".into(), reasons: vec![] },
        }
    }

    pub fn list(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Entry> {
        let (from, limit) = (from.unwrap_or(0) as usize, limit.unwrap_or(50).min(100) as usize);
        self.entries.values().skip(from).take(limit).cloned().collect()
    }

    pub fn count(&self) -> u32 {
        self.entries.len()
    }

    pub fn config(&self) -> Value {
        json!({"owner": self.owner, "outlayer": self.outlayer, "project_id": self.project_id,
               "network": self.network, "verdict_public_key": hex::encode(self.verdict_public_key),
               "min_deposit": self.min_deposit.to_string(), "report_fee": self.report_fee.to_string()})
    }
}

fn parse_key(h: &str) -> [u8; 32] {
    hex::decode(h).ok().and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok())
        .unwrap_or_else(|| env::panic_str("verdict_public_key must be 32 bytes of hex"))
}

#[cfg(test)]
mod tests;
