import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { HashTag } from '../common/HashTag';
import { formatBlock } from '../../lib/blocks';
import { useApp } from '../../state/AppContext';

const POST_OPENING_STATES: Tender['state'][] = ['Opening', 'Evaluation', 'Awarded', 'Standstill', 'Contracted'];

export function BiddersPanel({ tender }: { tender: Tender }) {
  const { accounts } = useApp();
  const nameFor = (addr: string) => accounts.find((a) => a.address === addr)?.name ?? addr;
  const postOpening = POST_OPENING_STATES.includes(tender.state);

  if (tender.bidMode === 'Sealed' && !postOpening) {
    const active = tender.commitments.filter((c) => !c.withdrawn);
    return (
      <Card>
        <CardHeader
          title={`Participation (${active.length})`}
          subtitle="Sealed bidding: contents stay hidden until the Opening window. Only commitment participation is visible now."
        />
        <CardBody>
          {active.length === 0 ? (
            <p className="text-sm text-slate-400">No bids committed yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {active.map((c) => (
                <li key={c.bidder} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-slate-700">{nameFor(c.bidder)}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-slate-400">committed {formatBlock(c.committedAtBlock)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.bondPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {c.bondPaid ? 'Bond paid' : 'Bond pending'}
                    </span>
                    <HashTag hash={c.commitmentHash} explain="Sealed commitment hash — blake2_256(bidder ‖ documents ‖ price ‖ salt). Proves a bid was locked in before the deadline without revealing its contents." />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    );
  }

  const bids = [...tender.revealedBids].sort((a, b) => a.totalPrice - b.totalPrice);
  const unrevealed = tender.commitments.filter((c) => !c.withdrawn && !tender.revealedBids.some((r) => r.bidder === c.bidder));

  return (
    <Card>
      <CardHeader title={`Bids (${bids.length})`} subtitle={tender.bidMode === 'Sealed' ? 'Revealed sealed bids, lowest price first.' : 'Open bids, lowest price first.'} />
      <CardBody>
        {bids.length === 0 ? (
          <p className="text-sm text-slate-400">No bids revealed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-2 font-medium">Bidder</th>
                  <th className="pb-2 font-medium">Total price</th>
                  <th className="pb-2 font-medium">Documents</th>
                  <th className="pb-2 font-medium">Revealed</th>
                </tr>
              </thead>
              <tbody>
                {bids.map((bid, i) => (
                  <tr key={bid.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3">
                      <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">{i + 1}</span>
                      {bid.bidderName}
                      {bid.disqualified && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">Disqualified</span>}
                    </td>
                    <td className="py-2 pr-3 font-medium text-slate-800">{bid.totalPrice.toLocaleString()}</td>
                    <td className="py-2 pr-3"><HashTag hash={bid.documentsHash} explain="Hash of the bidder's submitted documents/price schedule — matched against the sealed commitment at reveal time." /></td>
                    <td className="py-2 text-xs text-slate-400">{bid.revealedAtBlock ? formatBlock(bid.revealedAtBlock) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unrevealed.length > 0 && (
          <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ⚠ {unrevealed.length} committed bid{unrevealed.length > 1 ? 's were' : ' was'} never revealed and will be treated as forfeit once the Opening window ends.
          </div>
        )}
      </CardBody>
    </Card>
  );
}
