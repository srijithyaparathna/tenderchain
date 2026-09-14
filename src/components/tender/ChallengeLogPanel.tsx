import { useState } from 'react';
import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { RoleGatedButton } from '../common/RoleGatedButton';
import { useApp } from '../../state/AppContext';
import { requireBidder, requireOfficer } from '../../lib/permissions';
import { chainApi } from '../../services/mockChainApi';
import { formatBlock } from '../../lib/blocks';

const STATUS_STYLE: Record<Tender['challenges'][number]['status'], string> = {
  Open: 'bg-amber-50 text-amber-700',
  Upheld: 'bg-red-50 text-red-700',
  Dismissed: 'bg-slate-100 text-slate-600',
};

export function ChallengeLogPanel({ tender }: { tender: Tender }) {
  const { accounts, currentAccount } = useApp();
  const [grounds, setGrounds] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);

  const nameFor = (addr: string) => accounts.find((a) => a.address === addr)?.name ?? addr;

  const lodgeDisabled =
    requireBidder(currentAccount) ||
    (tender.state !== 'Standstill' ? 'Challenges can only be lodged during the standstill window.' : undefined);

  const lodge = async () => {
    if (!currentAccount || !grounds.trim()) return;
    setBusy(true);
    try {
      await chainApi.lodgeChallenge(tender.id, currentAccount.address, grounds.trim());
      setGrounds('');
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (challengeId: string, status: 'Upheld' | 'Dismissed') => {
    if (!rationale.trim()) return;
    setBusy(true);
    try {
      await chainApi.resolveChallenge(tender.id, challengeId, status, rationale.trim());
      setResolving(null);
      setRationale('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title={`Challenge log (${tender.challenges.length})`} subtitle="Lodged publicly during standstill; every resolution requires a written rationale." />
      <CardBody>
        {tender.challenges.length === 0 ? (
          <p className="mb-3 text-sm text-slate-400">No challenges lodged.</p>
        ) : (
          <ul className="mb-3 space-y-3">
            {tender.challenges.map((c) => (
              <li key={c.id} className="rounded-md border border-slate-100 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{nameFor(c.lodgedBy)} · {formatBlock(c.lodgedAtBlock)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                </div>
                <p className="text-sm text-slate-800">{c.grounds}</p>
                {c.resolutionRationale && (
                  <div className="mt-2 rounded-md bg-slate-50 p-2.5">
                    <div className="text-[11px] font-medium text-slate-500">Resolution · {formatBlock(c.resolvedAtBlock!)}</div>
                    <p className="mt-0.5 text-sm text-slate-700">{c.resolutionRationale}</p>
                  </div>
                )}
                {c.status === 'Open' && (
                  resolving === c.id ? (
                    <div className="mt-2 space-y-1.5">
                      <textarea
                        value={rationale}
                        onChange={(e) => setRationale(e.target.value)}
                        placeholder="Resolution rationale (required)…"
                        rows={2}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
                      />
                      <div className="flex gap-2">
                        <button disabled={busy || !rationale.trim()} onClick={() => resolve(c.id, 'Upheld')} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                          Uphold challenge
                        </button>
                        <button disabled={busy || !rationale.trim()} onClick={() => resolve(c.id, 'Dismissed')} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                          Dismiss challenge
                        </button>
                        <button onClick={() => setResolving(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <RoleGatedButton variant="secondary" disabledReason={requireOfficer(currentAccount, tender)} onClick={() => setResolving(c.id)}>
                        Resolve
                      </RoleGatedButton>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        )}

        {tender.state === 'Standstill' && (
          <div className="border-t border-slate-100 pt-3">
            <textarea
              value={grounds}
              onChange={(e) => setGrounds(e.target.value)}
              placeholder="Grounds for challenge…"
              rows={2}
              className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
            <RoleGatedButton variant="danger" disabledReason={lodgeDisabled} disabled={busy} onClick={lodge}>
              Lodge challenge
            </RoleGatedButton>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
