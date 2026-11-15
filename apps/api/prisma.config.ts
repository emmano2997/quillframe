// Configuração do Prisma CLI. As migrations usam DATABASE_MIGRATION_URL (usuário com DDL) quando
// existe; a API usa sempre DATABASE_URL (documento 02, §5.13).
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env['DATABASE_MIGRATION_URL'] ??
      process.env['DATABASE_URL'] ??
      'postgresql://quillframe:quillframe_dev_only@127.0.0.1:5432/quillframe',
  },
})
