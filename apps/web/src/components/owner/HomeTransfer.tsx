import { useRef, useState } from "react";
import { Download, FolderOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyText, ExtLink } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import { exportCommand, exportFileName } from "@/lib/wallet/homeExport";
import { explorerTx } from "@/lib/wallet/near";
import type { ToolNote } from "./useHomeTools";

/** Export the browser's keys as a CLI --home, or bring a CLI home into this browser. */
export function HomeTransfer({ owner, canExport, working, note, onExport, onImport }: {
  owner: string; canExport: boolean; working: boolean; note: ToolNote;
  onExport: () => void; onImport: (files: FileList, replace: boolean) => Promise<boolean>;
}) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [replace, setReplace] = useState(false);
  const pick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const ok = await onImport(list, replace);
    if (ok) setReplace(false);
    if (files.current) files.current.value = "";
    if (folder.current) folder.current.value = "";
  };
  let cmd = "";
  try { cmd = exportCommand(owner); } catch { cmd = ""; }
  return (
    <div className="space-y-3 text-xs" data-testid="home-transfer">
      {canExport && (
        <div className="space-y-2">
          <p className="font-medium text-fg">Export to a CLI home</p>
          <p className="text-[11px] leading-relaxed text-fg-muted">
            Downloads <span className="font-mono">{exportFileName(owner)}</span>: <span className="font-mono">.standin/config.json</span> and both keys, the layout{" "}
            <code className="font-mono">standin adopt</code> writes. Then <code className="font-mono">standin dev up --home DIR</code> runs the same bait and watcher on your
            machine, always on. The file holds secret keys: low-value test keys, but keep it private and never use them for real funds.
          </p>
          <Button variant="line" size="sm" onClick={onExport} data-testid="home-export"><Download aria-hidden />Export to CLI home</Button>
          {cmd && (
            <div className="rounded-md border border-line bg-ink-900 px-2.5 py-2">
              <p className="mb-1 text-[11px] text-fg-faint">then, from a stand-in checkout</p>
              <CopyText value={cmd} display={<span className="font-mono text-[11px] whitespace-normal [overflow-wrap:anywhere]">{cmd}</span>} className="items-start" />
            </div>
          )}
        </div>
      )}
      <div className="space-y-2">
        <p className="font-medium text-fg">Import from a CLI home</p>
        <p className="text-[11px] leading-relaxed text-fg-muted">
          Pick the home's <span className="font-mono">.standin</span> folder (from <code className="font-mono">standin adopt --home DIR</code>, it is <span className="font-mono">DIR/.standin</span>), its
          <span className="font-mono"> config.json</span> and <span className="font-mono">keys/*.json</span>, or an export from another browser. Both keys are checked on chain before
          they are stored here. Nothing is uploaded: the files are read in this tab.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="line" size="sm" disabled={working} onClick={() => folder.current?.click()} data-testid="home-import-folder"><FolderOpen aria-hidden />Choose folder</Button>
          <Button variant="line" size="sm" disabled={working} onClick={() => files.current?.click()} data-testid="home-import-files"><Upload aria-hidden />Choose files</Button>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-[var(--color-trip)]" />
            Replace the keys this browser holds
          </label>
        </div>
        <input ref={files} type="file" multiple accept=".tar,.json,.key,application/x-tar,application/json" className="sr-only" tabIndex={-1} aria-hidden
          onChange={(e) => void pick(e.target.files)} data-testid="home-import-input" />
        {/* webkitdirectory: every browser this site supports lets the owner pick a whole folder */}
        <input ref={folder} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => void pick(e.target.files)} />
      </div>
      {note && (
        <p role="status" data-testid="home-note" className={note.tone === "error" ? "text-[11px] text-trip [overflow-wrap:anywhere]" : note.tone === "ok" ? "text-[11px] text-safe [overflow-wrap:anywhere]" : "text-[11px] text-fg-muted [overflow-wrap:anywhere]"}>
          {note.text}{note.hash ? <> <ExtLink href={explorerTx(note.hash)} className="text-[11px]">{shortKey(note.hash, 8, 6)}</ExtLink></> : null}
        </p>
      )}
    </div>
  );
}
