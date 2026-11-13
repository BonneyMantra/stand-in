//! OutLayer WASI entry: stdin JSON in, one JSON object out. Any failed check prints `{"error":..}` and exits 1.
use serde_json::{json, Value};
use standin_verdict::*;
use std::io::Read;

#[allow(warnings)]
mod bindings {
    wit_bindgen::generate!({ world: "signing-keys-host", path: "wit" });
}
use bindings::outlayer::signing_keys::api as keys;

#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] =
    *include_bytes!("../manifest.json");

fn rpc(url: &str, method: &str, params: Value) -> Result<Value, String> {
    let body = json!({"jsonrpc":"2.0","id":"standin","method":method,"params":params}).to_string();
    let resp = wasi_http_client::Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .body(body.as_bytes())
        .send()
        .map_err(|e| format!("rpc request failed: {e}"))?;
    let bytes = resp.body().map_err(|e| format!("rpc body: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("rpc json: {e}"))
}

fn run(raw: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(raw).map_err(|e| format!("bad input: {e}"))?;
    if v.get("op").and_then(Value::as_str) == Some("public_key") {
        let pk = keys::public_key("verdict", None)?;
        return Ok(json!({"public_key": hex::encode(pk)}));
    }
    let input: Input = serde_json::from_value(v).map_err(|e| format!("bad input: {e}"))?;
    let url = rpc_endpoint(&input.network)?;
    let tx = rpc(
        url,
        "EXPERIMENTAL_tx_status",
        json!({"tx_hash": input.tx_hash, "sender_account_id": input.sender_id, "wait_until": "FINAL"}),
    )?;
    let facts = check_tx(&input, &tx)?;
    let blk = rpc(url, "block", json!({"block_id": facts.block_hash}))?;
    let (height, parent) = parse_block(&blk)?;
    let key = rpc(
        url,
        "query",
        json!({"request_type":"view_access_key","block_id":parent,
               "account_id":input.decoy_account_id,"public_key":facts.signer_public_key}),
    )?;
    check_full_access(&key)?;
    let verdict = build_verdict(&input, &facts, height);
    let msg = verdict.signed_message();
    let sig = keys::sign("verdict", None, &msg)?;
    let pk = keys::public_key("verdict", None)?;
    Ok(json!({
        "verdict": verdict,
        "message": String::from_utf8(msg).map_err(|e| e.to_string())?,
        "signature": hex::encode(sig),
        "public_key": hex::encode(pk),
    }))
}

fn main() {
    let mut raw = String::new();
    let _ = std::io::stdin().read_to_string(&mut raw);
    match run(&raw) {
        Ok(out) => print!("{out}"),
        Err(e) => {
            print!("{}", json!({"error": e}));
            std::process::exit(1);
        }
    }
}
