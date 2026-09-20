// Single shared connection to the TenderChain node. Everything that needs
// chain state goes through `connect()`; there is never more than one socket.

import { ApiPromise, WsProvider } from '@polkadot/api';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * Both `vite dev` and the nginx deploy expose the node's WebSocket at `/ws` on
 * the page's own origin, so the node's port never has to be baked into the
 * bundle or opened in the firewall. `VITE_WS_ENDPOINT` overrides it — set it to
 * e.g. `ws://127.0.0.1:9955` to talk to a node directly.
 */
export function resolveEndpoint(): string {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const override = viteEnv?.VITE_WS_ENDPOINT ?? nodeEnv?.VITE_WS_ENDPOINT;
  if (override) return override;

  // Outside a browser (scripts, tests) there is no same-origin to derive from.
  if (typeof window === 'undefined') return 'ws://127.0.0.1/ws';

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

let status: ConnectionStatus = 'connecting';
const statusSubs = new Set<(s: ConnectionStatus) => void>();

function setStatus(next: ConnectionStatus) {
  if (next === status) return;
  status = next;
  statusSubs.forEach((cb) => cb(next));
}

export function getStatus(): ConnectionStatus {
  return status;
}

export function subscribeStatus(cb: (s: ConnectionStatus) => void): () => void {
  statusSubs.add(cb);
  cb(status);
  return () => {
    statusSubs.delete(cb);
  };
}

let apiPromise: Promise<ApiPromise> | null = null;

export function connect(): Promise<ApiPromise> {
  if (apiPromise) return apiPromise;

  // WsProvider retries on its own, so a node that starts later still gets
  // picked up without a page reload.
  const provider = new WsProvider(resolveEndpoint());
  provider.on('connected', () => setStatus('connected'));
  provider.on('disconnected', () => setStatus('disconnected'));
  provider.on('error', () => setStatus('disconnected'));

  apiPromise = ApiPromise.create({ provider, throwOnConnect: false }).then((api) => {
    api.on('connected', () => setStatus('connected'));
    api.on('disconnected', () => setStatus('disconnected'));
    api.on('ready', () => setStatus('connected'));
    if (api.isConnected) setStatus('connected');
    return api;
  });

  return apiPromise;
}
