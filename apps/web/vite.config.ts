import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const referencePackDir = path.resolve(import.meta.dirname, '../../.reference-pack')

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.hex': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

// Serve o pacote de referência local (pnpm reference-pack) em /reference-pack/.
// Só existe no servidor de desenvolvimento: nada do jogo entra no build (documento 01, D6).
function referencePack(): Plugin {
  return {
    name: 'quillframe:reference-pack',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/reference-pack', (req, res) => {
        const relative = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
        const file = path.resolve(referencePackDir, `.${relative}`)
        const inside = file.startsWith(referencePackDir + path.sep)
        if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), referencePack()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: {
    sourcemap: false,
  },
})
