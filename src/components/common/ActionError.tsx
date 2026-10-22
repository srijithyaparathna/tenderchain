import type { ErrorView } from '../../lib/errors';

/**
 * Inline failure note for a chain action, rendered next to the button that
 * caused it rather than as a global banner — which action was refused matters
 * as much as the reason, and a page-level toast loses that.
 *
 * Shows the plain-language reason first, then what to do, then the runtime's
 * own error code so the failure can still be traced back to the pallet.
 */
export function ActionError({ error, onDismiss }: { error: ErrorView | string | null; onDismiss?: () => void }) {
  if (!error) return null;
  const view: ErrorView = typeof error === 'string' ? { title: error } : error;
  return (
    <div role="alert" className="mt-2 flex w-full items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2.5">
      <span aria-hidden className="text-sm leading-5 text-red-600">⚠</span>
      <div className="min-w-0 flex-1 break-words text-xs leading-snug">
        <p className="font-semibold text-red-800">{view.title}</p>
        {view.hint && <p className="mt-0.5 text-red-700">{view.hint}</p>}
        {view.docs && <p className="mt-0.5 text-red-600/80">Chain says: {view.docs}</p>}
        {view.code && view.code !== view.title && (
          <p className="mono mt-1 text-[10px] text-red-500">Error code: {view.code}</p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="text-xs leading-5 text-red-400 hover:text-red-600"
        >
          ✕
        </button>
      )}
    </div>
  );
}
