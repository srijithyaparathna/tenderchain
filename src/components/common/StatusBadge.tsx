import type { TenderState } from '../../types';
import { STATUS_THEME } from '../../lib/status';

export function StatusBadge({ state, className = '' }: { state: TenderState; className?: string }) {
  const theme = STATUS_THEME[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${theme.border} ${theme.bg} ${theme.text} px-2.5 py-1 text-xs font-medium whitespace-nowrap ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />
      {theme.label}
    </span>
  );
}
