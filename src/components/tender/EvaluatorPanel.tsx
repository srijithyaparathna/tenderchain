import { useState } from 'react';
import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { RoleGatedButton } from '../common/RoleGatedButton';
import { useApp } from '../../state/AppContext';
import { requireOfficer } from '../../lib/permissions';
import { chainApi } from '../../services/mockChainApi';
import { computeRankings } from '../../lib/scoring';
import { formatBlock } from '../../lib/blocks';

export function EvaluatorPanel({ tender }: { tender: Tender }) {
  const { accounts, currentAccount, constants } = useApp();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  const evaluatorPool = accounts.filter((a) => a.role === 'Evaluator' && !tender.evaluators.includes(a.address));
  const nameFor = (addr: string) => accounts.find((a) => a.address === addr)?.name ?? addr;

  const appoint = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await chainApi.appointEvaluator(tender.id, pick);
      setPick('');
    } finally {
      setBusy(false);
    }
  };

  const rankings = computeRankings(tender);
  const enoughEvaluators = tender.evaluators.length >= (constants?.minEvaluators ?? 3);

  return (
    <Card>
      <CardHeader
        title={`Evaluator panel (${tender.evaluators.length})`}
        subtitle={
          constants
            ? `Requires MinEvaluators = ${constants.minEvaluators}${enoughEvaluators ? '' : ' — not yet met'}`
            : undefined
        }
      />
      <CardBody>
        {tender.evaluators.length === 0 ? (
          <p className="mb-3 text-sm text-slate-400">No evaluators appointed yet.</p>
        ) : (
          <ul className="mb-3 divide-y divide-slate-100">
            {tender.evaluators.map((addr) => {
              const decl = tender.conflictDeclarations.find((c) => c.evaluator === addr);
              return (
                <li key={addr} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-slate-700">{nameFor(addr)}</span>
                  {decl ? (
                    decl.hasConflict ? (
                      <span title={decl.notes} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
                        Conflict declared
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        No conflict · declared {formatBlock(decl.declaredAtBlock)}
                      </span>
                    )
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Declaration pending</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!enoughEvaluators && (tender.state === 'Draft' || tender.state === 'Published' || tender.state === 'Submission') && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2.5">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
            >
              <option value="">Select an evaluator to appoint…</option>
              {evaluatorPool.map((a) => (
                <option key={a.address} value={a.address}>{a.name}</option>
              ))}
            </select>
            <RoleGatedButton variant="secondary" disabledReason={requireOfficer(currentAccount, tender) || (!pick ? 'Choose an evaluator first.' : undefined)} disabled={busy} onClick={appoint}>
              Appoint
            </RoleGatedButton>
          </div>
        )}

        {rankings.length > 0 && (
          <div className="mt-2 border-t border-slate-100 pt-3">
            <h4 className="mb-2 text-xs font-semibold text-slate-500">Scoring progress by bid</h4>
            <ul className="space-y-2">
              {rankings.map((r) => (
                <li key={r.bidId} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{r.bidderName}</span>
                  <span className="text-xs text-slate-500">{r.evaluatorCount}/{tender.evaluators.length} evaluators scored · weighted {r.weightedScore.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
