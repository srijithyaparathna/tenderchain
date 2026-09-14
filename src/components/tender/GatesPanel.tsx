import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Countdown } from '../common/Countdown';
import { formatBlock } from '../../lib/blocks';
import { useApp } from '../../state/AppContext';

const GATE_ROWS: { key: keyof Tender['gates']; label: string; hint: string }[] = [
  { key: 'publishAt', label: 'Publish', hint: 'Tender becomes visible and the Q&A window opens.' },
  { key: 'questionsCloseAt', label: 'Questions close', hint: 'No new questions accepted after this block.' },
  { key: 'submissionCloseAt', label: 'Submission closes', hint: 'No new bids/commitments accepted after this block.' },
  { key: 'openingAt', label: 'Opening begins', hint: 'Sealed bids may start being revealed.' },
  { key: 'openingEndAt', label: 'Opening ends', hint: 'Reveal window closes; unrevealed commitments are forfeit.' },
];

export function GatesPanel({ tender }: { tender: Tender }) {
  const { currentBlock } = useApp();
  return (
    <Card>
      <CardHeader title="Gate schedule" subtitle="Enforced by block number — no administrator can move these once published." />
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-2 font-medium">Gate</th>
                <th className="pb-2 font-medium">Block</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {GATE_ROWS.map((row) => {
                const block = tender.gates[row.key] as number;
                const passed = currentBlock >= block;
                return (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-700">{row.label}</div>
                      <div className="text-[11px] text-slate-400">{row.hint}</div>
                    </td>
                    <td className="py-2 pr-3 mono text-xs text-slate-600">{formatBlock(block)}</td>
                    <td className="py-2">
                      {passed ? (
                        <span className="text-xs font-medium text-emerald-600">✓ Passed</span>
                      ) : (
                        <Countdown targetBlock={block} label="in" />
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-100">
                <td className="py-2 pr-3">
                  <div className="font-medium text-slate-700">Standstill period</div>
                  <div className="text-[11px] text-slate-400">Challenge window duration once award is approved.</div>
                </td>
                <td className="py-2 pr-3 mono text-xs text-slate-600">{tender.gates.standstillPeriod} blocks</td>
                <td className="py-2 text-xs text-slate-400">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
