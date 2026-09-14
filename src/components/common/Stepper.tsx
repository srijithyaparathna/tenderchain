import { TENDER_STATE_ORDER, type TenderState } from '../../types';

const SHORT_LABEL: Record<TenderState, string> = {
  Draft: 'Draft',
  Published: 'Published',
  Submission: 'Submission',
  Closed: 'Closed',
  Opening: 'Opening',
  Evaluation: 'Evaluation',
  Awarded: 'Award',
  Standstill: 'Standstill',
  Contracted: 'Contracted',
  Cancelled: 'Cancelled',
};

export function Stepper({ state }: { state: TenderState }) {
  if (state === 'Cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
        <span className="h-2 w-2 rounded-full bg-neutral-500" />
        This tender was cancelled before completing its lifecycle.
      </div>
    );
  }

  const currentIdx = TENDER_STATE_ORDER.indexOf(state);

  return (
    <div className="w-full overflow-x-auto pb-1">
      <ol className="flex min-w-max items-center">
        {TENDER_STATE_ORDER.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <li key={s} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5" style={{ width: 96 }}>
                <div
                  className={
                    'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ' +
                    (done
                      ? 'bg-emerald-600 text-white'
                      : active
                        ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                        : 'bg-slate-200 text-slate-500')
                  }
                >
                  {done ? '✓' : i + 1}
                </div>
                <span
                  className={
                    'text-center text-[11px] leading-tight ' +
                    (active ? 'font-semibold text-slate-900' : done ? 'text-slate-600' : 'text-slate-400')
                  }
                >
                  {SHORT_LABEL[s]}
                </span>
              </div>
              {i < TENDER_STATE_ORDER.length - 1 && (
                <div className={`h-0.5 flex-1 ${i < currentIdx ? 'bg-emerald-500' : 'bg-slate-200'}`} style={{ minWidth: 24 }} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
