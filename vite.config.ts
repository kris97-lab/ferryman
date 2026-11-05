import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Serves api/rpc/[chain].ts under `vite preview`, so the production build can
// be tested locally exactly as it runs on Vercel.
function rpcProxyPreview(): Plugin {
  return {
    name: 'rpc-proxy-preview',
    configurePreviewServer(server) {
      server.middlewares.use('/api/rpc', async (req, res) => {
        const { default: handler } = await import('./api/rpc/[chain].ts')
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const r = await handler(
          new Request(`http://localhost/api/rpc${req.url}`, {
            method: req.method,
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          }),
        )
        res.statusCode = r.status
        r.headers.forEach((v, k) => res.setHeader(k, v))
        res.end(Buffer.from(await r.arrayBuffer()))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), rpcProxyPreview()],
})
