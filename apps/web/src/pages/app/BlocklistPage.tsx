import { ShieldBan } from "lucide-react";
import { useStandin } from "@/data/useStandin";
import type { BlocklistEntry } from "@/data/types";
import { accountUrl, fmtDate, shortHash, shortKey, txUrl } from "@/data/derive";
import { DataTable, type Column } from "@/components/app/DataTable";
import { CheckAccount } from "@/components/app/CheckAccount";
import { CopyText, EmptyState, ExtLink, PageHeader, PreviewTag, Tag } from "@/components/app/common";

export default function BlocklistPage() {
  const { data } = useStandin();
  if (!data) return null;
  const registry = data.recorded?.accounts.registry;
  const cols: Column<BlocklistEntry>[] = [
    { id: "acct", header: "Account", className: "w-[48%] @xl:w-[28%]", cell: (b) => <ExtLink href={accountUrl(b.account_id)} className="text-trip">{b.account_id}</ExtLink>, sort: (b) => b.account_id },
    { id: "tx", header: "Evidence tx", hide: "sm", cell: (b) => <ExtLink href={txUrl(b.evidence_tx)}>{shortHash(b.evidence_tx)}</ExtLink> },
    { id: "key", header: "Decoy key", hide: "md", cell: (b) => <CopyText value={b.decoy_public_key} display={shortKey(b.decoy_public_key)} /> },
    {
      id: "att", header: "Attestation", className: "w-[52%] @xl:w-[36%]",
      cell: (b) => b.attested_at && !b.preview
        ? <span className="inline-flex items-center gap-2"><Tag tone="safe">attested</Tag><span className="hidden truncate font-mono text-[11px] text-fg-faint xl:inline">{fmtDate(b.attested_at)}</span></span>
        : <span className="inline-flex items-center gap-2"><Tag>pending</Tag><PreviewTag title="Real attacker and evidence tx; the registry report and OutLayer attestation have not run yet" /></span>,
      sort: (b) => b.attested_at,
    },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Blocklist"
        sub={<>Thieves posted with an OutLayer TEE-attested verdict{registry ? <> to <span className="font-mono text-fg">{registry}</span></> : null}. Other agents check it before paying.</>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <DataTable
          caption="Blocklisted accounts"
          rows={data.blocklist}
          columns={cols}
          rowKey={(b) => b.account_id + b.evidence_tx}
          empty={<EmptyState icon={ShieldBan} title="Blocklist is empty">After a trip the watcher reports the thief; once OutLayer attests the verdict, the account lands here.</EmptyState>}
        />
        <CheckAccount state={data} />
      </div>
    </div>
  );
}
