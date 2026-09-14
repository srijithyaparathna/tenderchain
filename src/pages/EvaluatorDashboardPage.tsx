import { Link } from 'react-router-dom';
import { useTenders } from '../hooks/useTenders';
import { useApp } from '../state/AppContext';
import { Card, CardBody, CardHeader } from '../components/common/Card';
import { StatusBadge } from '../components/common/StatusBadge';

export function EvaluatorDashboardPage() {
  const { tenders, loading } = useTenders();
  const { currentAccount } = useApp();

  const isEvaluator = currentAccount?.role === 'Evaluator';
  const assigned = isEvaluator ? tenders.filter((t) => t.evaluators.includes(currentAccount!.address)) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Evaluator dashboard</h1>
      <p className="mb-5 text-sm text-slate-500">Your assigned tenders, conflict declarations and scoring status.</p>

      {!isEvaluator ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">Switch to an Evaluator account in the header to see your assigned tenders and scoring actions.</p>
          </CardBody>
        </Card>
      ) : loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : assigned.length === 0 ? (
        <Card><CardBody><p className="text-sm text-slate-400">No tenders assigned to {currentAccount!.name} yet.</p></CardBody></Card>
      ) : (
        <div className="space-y-3">
          {assigned.map((t) => {
            const declaration = t.conflictDeclarations.find((c) => c.evaluator === currentAccount!.address);
            const myScoreCount = t.scores.filter((s) => s.evaluator === currentAccount!.address).length;
            return (
              <Card key={t.id}>
                <CardHeader
                  title={<Link to={`/tenders/${t.id}`} className="hover:text-blue-600">{t.title}</Link>}
                  subtitle={`${t.entity} · ${t.id}`}
                  right={<StatusBadge state={t.state} />}
                />
                <CardBody className="flex flex-wrap items-center gap-4 text-sm">
                  <StatusPill
                    label="Conflict declaration"
                    ok={Boolean(declaration)}
                    text={!declaration ? 'Pending' : declaration.hasConflict ? 'Declared — recused' : 'No conflict'}
                    tone={!declaration ? 'amber' : declaration.hasConflict ? 'red' : 'emerald'}
                  />
                  <StatusPill
                    label="Bids scored"
                    ok={myScoreCount > 0}
                    text={`${myScoreCount} / ${t.revealedBids.length}`}
                    tone={myScoreCount >= t.revealedBids.length && t.revealedBids.length > 0 ? 'emerald' : 'amber'}
                  />
                  <Link to={`/tenders/${t.id}`} className="ml-auto text-xs font-medium text-blue-600 hover:underline">
                    Open tender →
                  </Link>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, text, tone }: { label: string; ok: boolean; text: string; tone: 'amber' | 'red' | 'emerald' }) {
  const toneClass = { amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700', emerald: 'bg-emerald-50 text-emerald-700' }[tone];
  return (
    <div>
      <div className="text-[11px] text-slate-400">{label}</div>
      <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>{text}</span>
    </div>
  );
}
