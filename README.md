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

## Como rodar

Requisitos: **Node.js 24** e **pnpm 10** (`npm install -g pnpm@10`). Docker só a partir da Fase 1 (banco de dados).

```sh
pnpm install          # instala as dependências
pnpm test             # testes (motor de texto, livros de exemplo, API)
pnpm dev:web          # site em http://localhost:5173
pnpm dev:api          # API em http://127.0.0.1:3000 (copie .env.example para .env antes)
pnpm lint             # ESLint
pnpm typecheck        # TypeScript
```

Com o Minecraft Java instalado, dá para comparar o desenho do site com o do jogo:

```sh
pnpm reference-pack   # copia a fonte e a textura do livro para .reference-pack/ (fora do Git e do build)
pnpm dev:web          # Book Viewer → escolha um livro
pnpm font:metrics     # regenera a tabela de larguras dos caracteres (só números)
```

## Estrutura

```
apps/api/          API (Fastify)
apps/web/          site (React + Vite)
packages/shared/   código dos dois lados: códigos §, larguras, quebra de linha, formato .stendhal
scripts/           ferramentas que leem a instalação local do Minecraft
docs/              planejamento e especificações
```

---
Não é um produto oficial do Minecraft. Não é aprovado nem associado à Mojang ou à Microsoft.
