//! Pure verdict logic: parse NEAR RPC responses and decide. No I/O, so it is unit-tested on the host.
//!
//! Signed message = `MESSAGE_PREFIX` ++ canonical JSON bytes of [`Verdict`] (struct field order, no whitespace).
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MESSAGE_PREFIX: &str = "standin-verdict:v1:";

#[derive(Debug, Deserialize)]
pub struct Input {
    pub network: String,
    pub tx_hash: String,
    pub decoy_account_id: String,
    pub sender_id: String,
    pub admin_public_key: String,
}

/// The attested statement. Field order is the canonical order.
#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
pub struct Verdict {
    pub attacker_account: String,
    pub decoy_public_key: String,
    pub tx_hash: String,
    pub block_height: u64,
    pub decoy_account_id: String,
}

impl Verdict {
    pub fn canonical_json(&self) -> String {
        serde_json::to_string(self).expect("verdict serializes")
    }
    pub fn signed_message(&self) -> Vec<u8> {
        format!("{}{}", MESSAGE_PREFIX, self.canonical_json()).into_bytes()
    }
}

/// Facts read from the transaction itself.
#[derive(Debug, PartialEq)]
pub struct TxFacts {
    pub block_hash: String,
    pub signer_public_key: String,
    pub attacker_account: String,
}

pub fn rpc_endpoint(network: &str) -> Result<&'static str, String> {
    match network {
        "testnet" => Ok("https://test.rpc.fastnear.com"),
        "mainnet" => Ok("https://free.rpc.fastnear.com"),
        other => Err(format!("unsupported network: {other}")),
    }
}

fn rpc_result(resp: &Value) -> Result<&Value, String> {
    if let Some(e) = resp.get("error") {
        return Err(format!("rpc error: {e}"));
    }
    resp.get("result").ok_or_else(|| "rpc response has no result".to_string())
}

/// Checks on the `EXPERIMENTAL_tx_status` response.
pub fn check_tx(input: &Input, resp: &Value) -> Result<TxFacts, String> {
    let r = rpc_result(resp)?;
    let tx = r.get("transaction").ok_or("no transaction in response")?;
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
    let signer = s(tx, "signer_id").ok_or("no signer_id")?;
    let receiver = s(tx, "receiver_id").ok_or("no receiver_id")?;
    let pk = s(tx, "public_key").ok_or("no public_key")?;
    let hash = s(tx, "hash").ok_or("no tx hash")?;
    if hash != input.tx_hash {
        return Err(format!("tx hash mismatch: {hash}"));
    }
    if signer != input.decoy_account_id {
        return Err(format!("signer {signer} is not the decoy account"));
    }
    if pk == input.admin_public_key {
        return Err("signed with the admin key, not a decoy key".into());
    }
    let status = r.get("status").ok_or("no status")?;
    if status.get("SuccessValue").is_none() {
        return Err(format!("transaction did not succeed: {status}"));
    }
    let block_hash = r
        .get("transaction_outcome")
        .and_then(|o| o.get("block_hash"))
        .and_then(Value::as_str)
        .ok_or("no transaction_outcome.block_hash")?
        .to_owned();
    let actions = tx.get("actions").and_then(Value::as_array).ok_or("no actions")?;
    let mut attacker = None;
    for a in actions {
        if a.get("Transfer").is_some() && receiver != signer {
            attacker = Some(receiver.clone());
        } else if let Some(d) = a.get("DeleteAccount") {
            if let Some(b) = d.get("beneficiary_id").and_then(Value::as_str) {
                attacker = Some(b.to_owned());
            }
        }
    }
    let attacker_account =
        attacker.ok_or("no Transfer to another account or DeleteAccount beneficiary")?;
    if attacker_account == input.decoy_account_id {
        return Err("value did not leave the decoy account".into());
    }
    Ok(TxFacts { block_hash, signer_public_key: pk, attacker_account })
}

/// `block` response -> (height, parent hash). The key is checked at the parent: the state the tx was validated against.
pub fn parse_block(resp: &Value) -> Result<(u64, String), String> {
    let h = rpc_result(resp)?.get("header").ok_or("no header")?;
    let height = h.get("height").and_then(Value::as_u64).ok_or("no height")?;
    let prev = h.get("prev_hash").and_then(Value::as_str).ok_or("no prev_hash")?;
    Ok((height, prev.to_owned()))
}

/// `view_access_key` response at the parent block: the key must exist with full access.
pub fn check_full_access(resp: &Value) -> Result<(), String> {
    let r = rpc_result(resp)?;
    if let Some(e) = r.get("error") {
        return Err(format!("signing key not found on decoy account: {e}"));
    }
    match r.get("permission") {
        Some(Value::String(p)) if p == "FullAccess" => Ok(()),
        other => Err(format!("signing key is not full access: {other:?}")),
    }
}

pub fn build_verdict(input: &Input, facts: &TxFacts, height: u64) -> Verdict {
    Verdict {
        attacker_account: facts.attacker_account.clone(),
        decoy_public_key: facts.signer_public_key.clone(),
        tx_hash: input.tx_hash.clone(),
        block_height: height,
        decoy_account_id: input.decoy_account_id.clone(),
    }
}

#[cfg(test)]
mod tests;
