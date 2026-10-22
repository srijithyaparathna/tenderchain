import { useEffect, useState } from 'react';
import type { Tender } from '../types';
import { chainApi } from '../services/api';
import { explainError, type ErrorView } from '../lib/errors';

export function useTenders() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorView | null>(null);

  useEffect(() => {
    let alive = true;
    chainApi
      .listTenders()
      .then((t) => {
        if (!alive) return;
        setTenders(t);
        setError(null);
      })
      // A failed read must say so — otherwise the page sits on "Loading…".
      .catch((e) => alive && setError(explainError(e)))
      .finally(() => alive && setLoading(false));
    const unsub = chainApi.subscribeTenders((t) => {
      if (!alive) return;
      setTenders(t);
      setError(null);
      setLoading(false);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return { tenders, loading, error };
}

export function useTender(id: string | undefined) {
  const { tenders, loading, error } = useTenders();
  const tender = id ? tenders.find((t) => t.id === id) : undefined;
  return { tender, loading, error };
}
