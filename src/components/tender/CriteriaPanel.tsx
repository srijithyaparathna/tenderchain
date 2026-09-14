import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { weightSum } from '../../lib/gates';

export function CriteriaPanel({ tender }: { tender: Tender }) {
  const total = weightSum(tender.criteria);
  return (
    <Card>
      <CardHeader
        title="Evaluation criteria & weights"
        subtitle="Locked before bidding opened — cannot be changed post-publication."
        right={
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${total === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {total}% total
          </span>
        }
      />
      <CardBody>
        <div className="space-y-2.5">
          {tender.criteria.map((c) => (
            <div key={c.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800">{c.name}</div>
                <div className="text-xs text-slate-500">{c.description}</div>
              </div>
              <div className="w-28 shrink-0">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${c.weight}%` }} />
                </div>
              </div>
              <div className="w-14 shrink-0 text-right text-sm font-semibold text-slate-700">{c.weight}%</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          🔒 Max score per criterion: <span className="font-medium text-slate-700">{tender.criteria[0]?.maxScore ?? 100}</span> — locked at criteria publication, matching the chain's MaxScore constant.
        </div>
      </CardBody>
    </Card>
  );
}
