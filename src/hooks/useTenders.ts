import { useEffect, useState } from 'react';
import type { Tender } from '../types';
import { chainApi } from '../services/mockChainApi';

export function useTenders() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    chainApi.listTenders().then((t) => {
      if (alive) {
        setTenders(t);
        setLoading(false);
      }
    });
    const unsub = chainApi.subscribeTenders((t) => alive && setTenders(t));
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return { tenders, loading };
}

export function useTender(id: string | undefined) {
  const { tenders, loading } = useTenders();
  const tender = id ? tenders.find((t) => t.id === id) : undefined;
  return { tender, loading };
}
