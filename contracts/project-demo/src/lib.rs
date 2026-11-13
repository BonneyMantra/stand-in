//! Tiny contract the agent legitimately calls with its scoped function-call key.
use near_sdk::json_types::U64;
use near_sdk::{env, near, AccountId, PanicOnDefault};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Note {
    pub by: AccountId,
    pub at_block: U64,
    pub note: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ProjectDemo {
    notes: Vec<Note>,
}

#[near]
impl ProjectDemo {
    #[init]
    pub fn new() -> Self {
        Self { notes: Vec::new() }
    }

    /// Record a deploy note. `by` is the predecessor (the agent account when called via its FC key).
    pub fn record_deploy(&mut self, note: String) {
        assert!(note.len() <= 280, "note too long (max 280 bytes)");
        self.notes.push(Note {
            by: env::predecessor_account_id(),
            at_block: U64(env::block_height()),
            note,
        });
    }

    pub fn get_notes(&self) -> Vec<Note> {
        self.notes.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_lists() {
        let mut c = ProjectDemo::new();
        c.record_deploy("shipped v1".into());
        let n = c.get_notes();
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].note, "shipped v1");
    }
}
