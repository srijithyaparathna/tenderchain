// The one place the implementation is chosen. Everything else imports
// `chainApi` from here and never names an implementation.
//
// Set `VITE_CHAIN_MODE=mock` to go back to the fully simulated chain (useful
// when no node is running); the default talks to a real node.

import type { ChainApi } from './chainApi';
import { MockChainApi } from './mockChainApi';
import { LiveChainApi } from './liveChainApi';

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

export const CHAIN_MODE: 'live' | 'mock' = viteEnv?.VITE_CHAIN_MODE === 'mock' ? 'mock' : 'live';

export const chainApi: ChainApi =
  CHAIN_MODE === 'mock' ? new MockChainApi() : new LiveChainApi();
