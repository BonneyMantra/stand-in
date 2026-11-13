import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { standinHome } from "./config.ts";

/** The agent's legitimate scoped function-call key, provisioned by `standin adopt` (guardian add_agent_key). */
const scopedSchema = z.object({
  account_id: z.string(), // the agent account (guardian lives here)
  public_key: z.string(),
  secret_key: z.string(),
  receiver_id: z.string(),
  method_names: z.array(z.string()),
  created_at: z.string(),
});
export type ScopedKey = z.infer<typeof scopedSchema>;

export const scopedKeyPath = (home = standinHome()) => path.join(home, "agent-scoped-key.json");

export function saveScopedKey(k: ScopedKey, home = standinHome()): void {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(scopedKeyPath(home), JSON.stringify(scopedSchema.parse(k), null, 2), { mode: 0o600 });
}
export function loadScopedKey(home = standinHome()): ScopedKey | null {
  try {
    return scopedSchema.parse(JSON.parse(fs.readFileSync(scopedKeyPath(home), "utf8")));
  } catch {
    return null;
  }
}
