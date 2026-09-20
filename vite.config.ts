import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The node's WebSocket is served at `/ws` on the page's own origin in both dev
// and production (nginx does the same in the deployed site), so the node's port
// is never baked into the bundle or exposed to the internet.
const NODE_WS = process.env.TENDERCHAIN_NODE_WS ?? 'ws://127.0.0.1:9955'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ws': {
        target: NODE_WS,
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
    },
  },
})
