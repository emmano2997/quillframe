import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const app = buildApp(config)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal}: encerrando`)
    void app.close().then(() => process.exit(0))
  })
}

await app.listen({ host: config.API_HOST, port: config.API_PORT })
