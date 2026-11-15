# quillframe

Editor e leitor web de livros no estilo do livro e pena do Minecraft (com os recursos do mod Stendhal), onde cada página é um frame: ao virar as páginas, a arte ASCII vira uma animação que conta uma história.

- Editor com códigos `§` (cores e estilos), contador de caracteres e importação/exportação `.stendhal`
- Leitor com modo animação (páginas passando sozinhas)
- Biblioteca na nuvem e rede social básica (conta, favoritos, likes, comentários predefinidos, amizades)

## Documentação
- [01 — Referência: o livro do Minecraft e o mod Stendhal](docs/01-referencia-livro-minecraft-stendhal.md)
- [02 — Planejamento do back-end](docs/02-backend.md)
- [03 — Planejamento do front-end](docs/03-frontend.md)
- [04 — Motor de texto do livro](docs/04-motor-de-texto.md)
- [05 — Fonte pixel do projeto](docs/05-fonte-pixel.md)

## Como rodar

Requisitos: **Node.js 24**, **pnpm 10** (`corepack enable` ou `npm install -g pnpm@10`) e **Docker** (Postgres, Redis e Mailpit).

```sh
pnpm install          # instala as dependências e gera o cliente do Prisma
pnpm setup:env        # cria o .env e gera os segredos locais (nunca troca um valor que já existe)
docker compose up -d  # Postgres, Redis e Mailpit (e-mails em http://127.0.0.1:8025)
pnpm db:migrate       # cria as tabelas
pnpm db:seed          # opcional: contas de teste de cada papel e os livros de exemplo
pnpm dev:api          # API em http://127.0.0.1:3000
pnpm dev:web          # site em http://localhost:5173 (com proxy de /api para a API)
```

O seed mostra no terminal os e-mails das contas, a senha e o segredo 2FA das contas da equipe. Eles só valem no banco local.

Checagens (as mesmas do CI):

```sh
pnpm db:test:create   # uma vez: cria o banco quillframe_test usado pelos testes da API
pnpm test             # motor de texto, livros de exemplo, editor e API (integração com o Postgres)
pnpm lint             # ESLint
pnpm format:check     # Prettier
pnpm typecheck        # TypeScript
pnpm build            # build do site (apps/web/dist)
```

Testes de ponta a ponta (Playwright, no Chromium), com o Postgres e o Mailpit do `docker compose` no ar:

```sh
pnpm e2e:install      # uma vez: baixa o Chromium do Playwright
pnpm build            # os testes usam o site compilado, servido pela API na porta 3100
pnpm e2e              # cria e esvazia o banco quillframe_e2e, roda o seed e os testes
```

Para servir o site pela própria API, na mesma origem, como em produção: `pnpm build` e suba a API com `WEB_DIST=../web/dist`.

Outros comandos: `pnpm jobs` (jobs diários: limpeza, exclusão de contas, strikes, retenção) e `pnpm secret` (gera um segredo de 32 bytes).
Com o Minecraft Java instalado, dá para comparar o desenho do site com o do jogo:

```sh
pnpm reference-pack   # copia a fonte e a textura do livro para .reference-pack/ (fora do Git e do build)
pnpm dev:web          # Book Viewer → escolha um livro
pnpm font:metrics     # regenera a tabela de larguras dos caracteres (só números)
```

A fonte do livro é arte própria, num arquivo de texto editável (documento 05):

```sh
pnpm font:specimen    # gera docs/img/fonte-quillframe.png com todos os glifos
```

## Estrutura

```
apps/api/          API (Fastify + Prisma + PostgreSQL)
apps/web/          site (React + Vite)
packages/shared/   código dos dois lados: códigos §, larguras, quebra de linha, formato .stendhal
assets/pack/       arte própria do projeto (fonte pixel)
scripts/           ferramentas (amostra da fonte, leitura da instalação local do Minecraft)
docs/              planejamento e especificações
```

---
Não é um produto oficial do Minecraft. Não é aprovado nem associado à Mojang ou à Microsoft.
