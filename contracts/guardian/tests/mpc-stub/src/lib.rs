//! TEST-ONLY stub of the NEAR MPC signer (v1.signer-prod.testnet): records the last sign() request and
//! returns a fixed Secp256k1 response shape. It does not sign anything. Not deployed anywhere.
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, require, NearToken};

#[near(contract_state)]
#[derive(Default)]
pub struct Stub {
    last: Option<String>,
    deposit: String,
}

#[near]
impl Stub {
    #[payable]
    pub fn sign(&mut self, request: Value) -> Value {
        require!(env::attached_deposit() >= NearToken::from_yoctonear(1), "deposit of at least 1 yoctonear required");
        self.deposit = env::attached_deposit().as_yoctonear().to_string();
        let mut r = request;
        r["predecessor"] = json!(env::predecessor_account_id());
        self.last = Some(r.to_string());
        json!({"scheme":"Secp256k1","big_r":{"affine_point":"02".to_string() + &"11".repeat(32)},"s":{"scalar":"22".repeat(32)},"recovery_id":0})
    }
    pub fn last_request(&self) -> Value {
        serde_json::from_str(self.last.as_deref().unwrap_or("null")).unwrap()
    }
    pub fn last_deposit(&self) -> String {
        self.deposit.clone()
    }
}
