import { useCallback, useState } from "react";
import { buildHomeTar, exportFileName, parseHomeFiles } from "@/lib/wallet/homeExport";
import { loadHomeRecord, recordHomeTx, saveHome, updateHome, type HomeRecord, type WatcherScope } from "@/lib/wallet/homeStore";
import { generateKeyPair } from "@/lib/wallet/keys";
import { sendLocalTx } from "@/lib/wallet/localSigner";
import { viewAccessKey } from "@/lib/wallet/near";

export type ToolNote = { tone: "ok" | "error" | "info"; text: string; hash?: string } | null;

async function readFiles(list: FileList | File[]): Promise<{ path: string; bytes: Uint8Array }[]> {
  const files = Array.from(list);
  return Promise.all(files.map(async (f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

/** What a key may do, as the chain shows it; null when the key is not on the account. */
async function scopeOnChain(accountId: string, publicKey: string): Promise<WatcherScope | null> {
  const k = await viewAccessKey(accountId, publicKey);
  if (!k) return null;
  if (k.permission === "FullAccess") return { kind: "full-access" };
  return { kind: "function-call", receiver_id: k.permission.FunctionCall.receiver_id, method_names: k.permission.FunctionCall.method_names };
}

/**
 * The browser home's own tools: add a decoy key to the bait (signed here by the bait's key, no wallet), export the keys as a
 * CLI --home, import a CLI home. `guardiansWatched`: the owner's guardians whose watcher is watch.<owner>.
 */
export function useHomeTools(owner: string | null, guardiansWatched: string[], onChanged: () => void) {
  const [note, setNote] = useState<ToolNote>(null);
  const [working, setWorking] = useState<"decoy" | "import" | null>(null);

  const addDecoy = useCallback(async () => {
    const home = owner ? loadHomeRecord(owner) : null;
    if (!home || !owner) return;
    setWorking("decoy");
    const d = generateKeyPair();
    // Saved before it is sent: if the key lands, its secret must already be here.
    if (!updateHome(owner, (h) => ({ ...h, decoys: [...h.decoys, { ...d, added_at: new Date().toISOString(), label: "added in this browser" }] }))) {
      setNote({ tone: "error", text: "This browser refused to store the decoy's key, so nothing was sent." });
      setWorking(null);
      return;
    }
    try {
      const r = await sendLocalTx({ signerId: home.bait.account_id, secretKey: home.bait.secret_key, receiverId: home.bait.account_id, actions: [{ type: "AddKey", publicKey: d.public_key, permission: "FullAccess" }] });
      if (r.failure) throw new Error(r.failure);
      updateHome(owner, (h) => ({ ...h, decoys: h.decoys.map((x) => (x.public_key === d.public_key ? { ...x, tx_hash: r.hash } : x)) }));
      recordHomeTx(owner, { hash: r.hash, label: "decoy key added to the bait", at: Date.now() });
      setNote({ tone: "ok", text: "Decoy added: a new key on your bait, signed in this browser by the bait's own key.", hash: r.hash });
    } catch (e) {
      updateHome(owner, (h) => ({ ...h, decoys: h.decoys.filter((x) => x.public_key !== d.public_key) }));
      setNote({ tone: "error", text: `The decoy was not added: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setWorking(null);
      onChanged();
    }
  }, [owner, onChanged]);

  const exportHome = useCallback(() => {
    const home = owner ? loadHomeRecord(owner) : null;
    if (!home || !owner) return;
    try {
      const tar = buildHomeTar(home, home.guardians[0] ?? guardiansWatched[0] ?? owner);
      const url = URL.createObjectURL(new Blob([tar as BlobPart], { type: "application/x-tar" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(owner);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNote({ tone: "info", text: `Saved ${exportFileName(owner)}: your bait and watcher keys as a CLI home. Run the command below from a stand-in checkout.` });
    } catch (e) {
      setNote({ tone: "error", text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [owner, guardiansWatched]);

  /** Reads a CLI home (its .standin folder, the files in it, or our export), checks both keys on chain, then stores it. */
  const importHome = useCallback(async (list: FileList | File[], replace: boolean) => {
    if (!owner) return false;
    setWorking("import");
    try {
      const parsed = parseHomeFiles(await readFiles(list), owner);
      if (!parsed.ok) { setNote({ tone: "error", text: `Not imported: ${parsed.problems.join("; ")}` }); return false; }
      const p = parsed.home;
      const [baitScope, watcherScope] = await Promise.all([scopeOnChain(p.bait.account_id, p.bait.public_key), scopeOnChain(p.watcher.account_id, p.watcher.public_key)]);
      const problems: string[] = [];
      if (baitScope?.kind !== "full-access") problems.push(`${p.bait.account_id} has no full-access key matching the file`);
      if (!watcherScope) problems.push(`the watcher key in the file is not on ${p.watcher.account_id}`);
      else if (watcherScope.kind === "function-call" && !watcherScope.method_names.includes("freeze")) problems.push(`the watcher key on ${p.watcher.account_id} cannot call freeze`);
      if (problems.length) { setNote({ tone: "error", text: `Not imported: ${problems.join("; ")}.` }); return false; }
      const current = loadHomeRecord(owner);
      if (current && !replace && (current.bait.public_key !== p.bait.public_key || current.watcher.public_key !== p.watcher.public_key)) {
        setNote({ tone: "error", text: "This browser already holds other keys for your bait or watcher. Export them first if you still need them, then import again with Replace." });
        return false;
      }
      const scope = watcherScope!;
      const guardians = scope.kind === "function-call" ? [scope.receiver_id] : [...new Set([...(p.guardian ? [p.guardian] : []), ...guardiansWatched])];
      const rec: HomeRecord = {
        version: 1, owner, network: "testnet", source: "cli-import", created_at: new Date().toISOString(),
        bait: p.bait, watcher: { ...p.watcher, scope }, guardians,
        decoys: current?.bait.public_key === p.bait.public_key ? current.decoys : [], txs: current?.txs ?? [],
      };
      if (!saveHome(rec)) { setNote({ tone: "error", text: "This browser refused to store the keys (storage blocked)." }); return false; }
      setNote({ tone: "ok", text: `Imported ${p.bait.account_id} and ${p.watcher.account_id} (${scope.kind === "full-access" ? "full-access watcher key" : `freeze-only watcher key on ${scope.receiver_id}`}); both keys checked on chain.` });
      return true;
    } catch (e) {
      setNote({ tone: "error", text: `Not imported: ${e instanceof Error ? e.message : String(e)}` });
      return false;
    } finally {
      setWorking(null);
      onChanged();
    }
  }, [owner, guardiansWatched, onChanged]);

  return { note, setNote, working, addDecoy, exportHome, importHome };
}
