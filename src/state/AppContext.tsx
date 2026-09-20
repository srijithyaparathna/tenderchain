import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AccountRef, ChainConstants } from '../types';
import { chainApi, CHAIN_MODE } from '../services/api';
import { getStatus, subscribeStatus, resolveEndpoint, type ConnectionStatus } from '../services/chainConnection';

interface AppContextValue {
  accounts: AccountRef[];
  currentAccount: AccountRef | null;
  setCurrentAccount: (a: AccountRef | null) => void;
  currentBlock: number;
  /** Finalized height, which trails `currentBlock` by a few blocks. */
  finalizedBlock: number;
  constants: ChainConstants | null;
  /** 'mock' while the simulated chain is in use, otherwise the socket state. */
  connection: ConnectionStatus | 'mock';
  endpoint: string;
  /** Whether accounts came from a signing extension or the dev keyring. */
  accountSource: 'extension' | 'dev' | null;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountRef[]>(() => chainApi.listAccounts());
  const [currentAccount, setCurrentAccount] = useState<AccountRef | null>(null);
  const [currentBlock, setCurrentBlock] = useState(chainApi.getCurrentBlock());
  const [constants, setConstants] = useState<ChainConstants | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus | 'mock'>(
    CHAIN_MODE === 'mock' ? 'mock' : getStatus(),
  );

  const [finalizedBlock, setFinalizedBlock] = useState(chainApi.getFinalizedBlock());

  useEffect(
    () =>
      chainApi.subscribeBlock((b) => {
        setCurrentBlock(b);
        setFinalizedBlock(chainApi.getFinalizedBlock());
      }),
    [],
  );

  // Accounts resolve asynchronously against a real node (extension handshake,
  // or WASM crypto init for the dev keyring), so they are subscribed, not read
  // once at mount.
  useEffect(
    () =>
      chainApi.subscribeAccounts((next) => {
        setAccounts(next);
        setCurrentAccount((prev) => prev ?? next[0] ?? null);
      }),
    [],
  );

  useEffect(() => {
    if (CHAIN_MODE === 'mock') return;
    return subscribeStatus(setConnection);
  }, []);

  useEffect(() => {
    let alive = true;
    chainApi
      .getConstants()
      .then((c) => alive && setConstants(c))
      .catch(() => alive && setConstants(null));
    return () => {
      alive = false;
    };
  }, [connection]);

  const value: AppContextValue = {
    accounts,
    currentAccount,
    setCurrentAccount,
    currentBlock,
    finalizedBlock,
    constants,
    connection,
    endpoint: CHAIN_MODE === 'mock' ? 'simulated' : resolveEndpoint(),
    accountSource: chainApi.getAccountSource?.() ?? null,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
