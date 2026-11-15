// Serve a SPA compilada na mesma origem da API (documento 02, B2). Em desenvolvimento quem serve o
// site é o Vite, com proxy de /api para cá, e WEB_DIST fica vazio.
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import type { Config } from '../config.ts'
import { PROBLEMS } from './problem.ts'

export async function registerStatic(app: FastifyInstance, config: Config): Promise<void> {
  const notFoundJson = {
    type: 'about:blank',
    title: 'NOT_FOUND',
    status: 404,
    detail: PROBLEMS.NOT_FOUND.detail,
    code: 'NOT_FOUND',
  }
  const root = config.WEB_DIST ? path.resolve(config.WEB_DIST) : null
  if (!root || !fs.existsSync(path.join(root, 'index.html'))) {
    app.setNotFoundHandler((_request, reply) => {
      void reply.code(404).type('application/problem+json').send(notFoundJson)
    })
    return
  }

  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    // Os arquivos de /assets têm hash no nome: podem ficar em cache para sempre
    setHeaders(res, filePath) {
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`)
      void res.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    },
  })

  // Qualquer outra rota de página devolve o index.html, e o React Router decide a tela
  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?')[0] ?? '/'
    const isPage = request.method === 'GET' && !url.startsWith('/api/') && !path.extname(url)
    if (!isPage) {
      void reply.code(404).type('application/problem+json').send(notFoundJson)
      return
    }
    void reply.header('Cache-Control', 'no-cache').sendFile('index.html')
  })
}
