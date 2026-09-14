import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { HashTag } from '../common/HashTag';
import { formatBlock } from '../../lib/blocks';

export function DocumentsPanel({ tender }: { tender: Tender }) {
  return (
    <Card>
      <CardHeader title="Tender documents" subtitle="Stored off-chain; only content hashes are committed on-chain." />
      <CardBody>
        {tender.documents.length === 0 ? (
          <p className="text-sm text-slate-400">No documents published yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tender.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">📄</span>
                  <span className="text-sm text-slate-700">{d.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-400">uploaded {formatBlock(d.uploadedAtBlock)}</span>
                  <HashTag hash={d.hash} explain="Document content hash — proves this exact file was the one published; any later substitution would not match." />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
