import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AccountRef, ChainConstants } from '../types';
import { chainApi } from '../services/mockChainApi';

interface AppContextValue {
  accounts: AccountRef[];
  currentAccount: AccountRef | null;
  setCurrentAccount: (a: AccountRef | null) => void;
  currentBlock: number;
  constants: ChainConstants | null;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const accounts = useMemo(() => chainApi.listAccounts(), []);
  const [currentAccount, setCurrentAccount] = useState<AccountRef | null>(accounts[0] ?? null);
  const [currentBlock, setCurrentBlock] = useState(chainApi.getCurrentBlock());
  const [constants, setConstants] = useState<ChainConstants | null>(null);

  useEffect(() => {
    const unsub = chainApi.subscribeBlock(setCurrentBlock);
    return unsub;
  }, []);

  useEffect(() => {
    chainApi.getConstants().then(setConstants);
  }, []);

  const value: AppContextValue = {
    accounts,
    currentAccount,
    setCurrentAccount,
    currentBlock,
    constants,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
