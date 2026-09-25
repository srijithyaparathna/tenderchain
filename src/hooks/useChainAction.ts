import { useCallback, useState } from 'react';
import { describeChainError } from '../lib/errors';

/**
 * The single place a rejected `chainApi` call becomes visible.
 *
 * Panels used to wrap these calls in `try/finally` with no `catch`, so a
 * runtime rejection — `NotInEvaluation`, a bad origin, a dropped transaction —
 * surfaced only as an unhandled promise rejection in the console. On screen it
 * was indistinguishable from a button that does nothing, which is the worst
 * possible reading of a procurement action: the officer cannot tell "refused"
 * from "not wired up".
 *
 * `run` resolves `true` on success and `false` on failure, so a caller can
 * decide whether to clear its form; the error itself is already captured.
 */
export function useChainAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(describeChainError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, clearError, run };
}
