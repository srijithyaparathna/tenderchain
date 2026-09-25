/**
 * Inline failure note for a chain action, rendered next to the button that
 * caused it rather than as a global banner — which action was refused matters
 * as much as the reason, and a page-level toast loses that.
 */
export function ActionError({ error, onDismiss }: { error: string | null; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5">
      <span aria-hidden className="text-xs leading-5 text-red-500">⚠</span>
      <p className="flex-1 break-words text-xs leading-snug text-red-700">{error}</p>
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
