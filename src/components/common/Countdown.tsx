import { useApp } from '../../state/AppContext';
import { blocksToDuration, formatBlock } from '../../lib/blocks';

/**
 * Shows a countdown to a target block, derived purely from the current
 * block number — never wall-clock time — matching the pallet's own
 * deadline enforcement.
 */
export function Countdown({ targetBlock, label }: { targetBlock: number; label: string }) {
  const { currentBlock, constants } = useApp();
  const remaining = targetBlock - currentBlock;
  const avg = constants?.avgBlockTimeSeconds ?? 6;

  if (remaining <= 0) {
    return (
      <span className="text-xs text-slate-500">
        {label} <span className="font-medium text-slate-700">passed</span> at {formatBlock(targetBlock)}
      </span>
    );
  }

  return (
    <span className="text-xs text-slate-500">
      {label} in{' '}
      <span className="font-medium text-slate-800">{blocksToDuration(remaining, avg)}</span>{' '}
      <span className="mono text-slate-400">({formatBlock(targetBlock)} · {remaining.toLocaleString()} blocks)</span>
    </span>
  );
}
