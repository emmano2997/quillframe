# 03 — Planejamento do front-end

> Planejamento da interface web do quillframe: identidade visual, telas, editor, leitor, rede social, diretrizes da comunidade, segurança no navegador, acessibilidade e testes. Usa as regras do livro do [documento 01](01-referencia-livro-minecraft-stendhal.md) e a API do [documento 02](02-backend.md).
>
> **Idioma:** a interface do site é **100% em inglês**: telas, botões, menus, mensagens, e-mails e páginas. Este documento é escrito em português. Todo texto que aparece na tela vem entre aspas, em inglês, do jeito que vai ficar no site.
>
> Legenda:
> - **[confirmado]**: verificado em fonte.
> - **[proposta]**: escolha deste planejamento. Pode mudar sem afetar o resto.
> - **[a validar]**: depende de conferir algo antes de virar regra.

---

## Resumo

- **React + Vite + TypeScript**, uma SPA servida pelo Fastify na mesma origem da API.
- **Cara de menu do Minecraft**, com tudo desenhado pelo projeto (fonte, botões, texturas, sons) e nenhum asset da Mojang.
- **O editor é o coração do site:** o livro é desenhado num canvas com as medidas exatas do jogo, com uma barra no estilo do Stendhal (16 cores, negrito, itálico, sublinhado, riscado, ofuscado, reset) e salvamento automático no perfil.
- **Assinar com opção de publicar:** "Keep private", "Share with friends" ou "Publish to Community".
- **Leitor com modo Play** (as páginas viram animação), likes, favoritos, comentários predefinidos, cópias e denúncia.
- **Seguro no navegador:** a sessão fica só num cookie `HttpOnly`, e nenhum conteúdo de usuário vira HTML.

---

## 1. Stack e organização

### 1.1 Bibliotecas [proposta]

| Função | Escolha | Por quê |
|---|---|---|
| Build e servidor de desenvolvimento | Vite | rápido e simples |
| UI | React 19 + TypeScript (`strict`) | decidido |
| Rotas | React Router | padrão do ecossistema |
| Dados do servidor | TanStack Query | cache, novas tentativas, atualização otimista |
| Estado do editor | Zustand | leve, fora da árvore de componentes |
| Formulários | react-hook-form + schemas zod do `packages/shared` | mesma validação do back |
| Estilos | CSS Modules + variáveis CSS | não injeta `<style>` em tempo de execução, então a CSP fica estrita |
| Medidor de senha | zxcvbn-ts (carregado sob demanda) | |
| QR do 2FA | `qrcode` (gerado no navegador) | o segredo nunca vai para serviço externo |
| Fila offline | IndexedDB (via `idb-keyval`) | |
| Testes | Vitest, Testing Library, Playwright, axe-core | |
| Qualidade | ESLint (`typescript-eslint`, `react`, `jsx-a11y`) + Prettier | |

### 1.2 Pastas

```
apps/web/src/
├── app/          rotas, providers, guardas (logado, papel, 2FA)
├── screens/      uma pasta por tela (TitleScreen, LibraryScreen, EditorScreen...)
├── book/         renderer em canvas, editor (entrada, caret, seleção), leitor
├── ui/           componentes no estilo do jogo: Button, TextField, Slider, Checkbox,
│                 CycleButton, Tooltip, Toast, Panel, List, Dialog
├── api/          cliente HTTP, hooks do TanStack Query, tratamento de erros
├── stores/       Zustand (editor, preferências)
├── strings/      en.ts: todo texto visível do site
├── styles/       tokens.css, global.css
└── assets/       vindos de assets/pack (documento 01, D6)
```

### 1.3 Textos
Todo texto visível fica em `src/strings/en.ts`, e os componentes usam `t('editor.sign')`. Uma regra de lint proíbe texto solto nos componentes **[proposta]**. Isso mantém o inglês consistente e deixa o site pronto para outros idiomas no futuro, sem custo agora.

---

## 2. Identidade visual

### 2.1 Regras
- **Inspirado, nunca copiado.** Nenhuma textura, fonte, som, logo ou nome do Minecraft (documento 01, D5 e D6). Toda a arte é do projeto e fica em `assets/pack/`.
- O nome é sempre "quillframe". O rodapé de toda tela traz: "Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft."
- A sensação é a do jogo: pixels nítidos, menus centralizados, botões de pedra, painéis escuros, som de clique e de página.

### 2.2 Elementos

| Elemento | No quillframe |
|---|---|
| Fonte | Fonte pixel própria, com as métricas do jogo (documento 01, §4). Sai em dois formatos: **atlas PNG** para o livro (canvas, medida exata) e **WOFF2** para a interface, sempre em múltiplos de 8 px e sem suavização |
| Botões | Retângulo de pedra cinza com bisel (claro em cima e à esquerda, escuro embaixo e à direita). Borda branca no hover e no foco. Desabilitado: mais escuro, com texto cinza. Texto branco com sombra |
| Campos de texto | Fundo preto, borda cinza, texto branco e cursor piscando |
| Sliders, checkboxes e botões de ciclo | No estilo das opções do jogo ("Sounds: ON") |
| Fundos | Panorama próprio em pixel art (uma biblioteca) na tela inicial; textura escura em mosaico nos menus; listas em painel preto translúcido |
| Tooltip | Caixa escura com borda colorida, como a dos itens, mostrando título, autor e geração ("Copy of original") |
| Toasts | No estilo de conquista, no canto superior direito ("Book signed!") |
| Logo e splash text | Logo "QUILLFRAME" em blocos (arte própria). Ao lado, uma frase amarela, inclinada e pulsando, que muda a cada visita |
| Sons | Clique e virar de página próprios. Volume em Options → "Music & Sounds..." |

Splash texts **[proposta]**: "Every page is a frame!", "Now with 1024 characters!", "100% handwritten!", "Turn the page!", "Ink not included!", "Sign here!", "Made with pixels!", "Also try paper!".

### 2.3 Escala da interface (GUI Scale)
Como no jogo, tudo é desenhado em "pixels de GUI" e multiplicado por um inteiro (1× a 4×). A opção "GUI Scale: Auto" escolhe o maior inteiro que cabe na tela. No CSS, a variável `--gui` guarda o tamanho de um pixel de GUI e todas as medidas são múltiplos dela. Texturas usam `image-rendering: pixelated`. Assim a fonte e a arte ASCII ficam nítidas e idênticas em qualquer tela.

### 2.4 Tokens

| Token | Valor | Uso |
|---|---|---|
| `--gui` | 1 a 4 px | tamanho de um pixel de GUI |
| `--text` | `#FFFFFF` | texto da interface |
| `--text-shadow` | `#3F3F3F` | sombra do texto (1 pixel de GUI) |
| `--text-muted` | `#A0A0A0` | texto secundário e desabilitado |
| `--splash` | `#FFFF55` | splash text |
| `--panel` | `rgba(0, 0, 0, 0.5)` | listas e painéis |
| `--page-ink` | `#000000` | texto padrão da página do livro |
| `--mc-0` a `--mc-f` | as 16 cores do documento 01, §6 | barra de cores e renderer |

A interface tem um só tema, escuro como os menus do jogo. A página do livro é o pergaminho da textura própria.

### 2.5 Telas principais (rascunhos)

**Title Screen** (logado):
```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                 Q U I L L F R A M E     Every page is    │
│                                         a frame!         │
│             ┌──────────────────────────┐                 │
│             │         My Books         │                 │
│             └──────────────────────────┘                 │
│             ┌──────────────────────────┐                 │
│             │        Community         │                 │
│             └──────────────────────────┘                 │
│             ┌──────────────────────────┐                 │
│             │         Friends          │                 │
│             └──────────────────────────┘                 │
│             ┌────────────┐ ┌───────────┐                 │
│             │ Options... │ │  Log Out  │                 │
│             └────────────┘ └───────────┘                 │
│                                                          │
│ quillframe 0.1     Not an official Minecraft product...  │
└──────────────────────────────────────────────────────────┘
```
Sem login, os botões viram "Sign In", "Create Account" e "Explore Community".

**My Books** (como a tela de escolher mundo):
```
┌──────────────────────────────────────────────────────────┐
│                         My Books                         │
│      [ Drafts ]  [ Signed ]  [ Copies ]  [ Favorites ]   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ [#] Two Birds                              Draft   │  │
│  │     Edited 2 hours ago · 23 pages                  │  │
│  │ [#] Good Luck                              Public  │  │
│  │     Signed Oct 3, 2026 · 50 pages · 12 likes       │  │
│  │ [#] Candles                                Private │  │
│  │     Signed Sep 28, 2026 · 12 pages                 │  │
│  └────────────────────────────────────────────────────┘  │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│   │ Open Book  │  │ Create New │  │   Import   │         │
│   └────────────┘  └────────────┘  └────────────┘         │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│   │   Export   │  │   Delete   │  │    Back    │         │
│   └────────────┘  └────────────┘  └────────────┘         │
└──────────────────────────────────────────────────────────┘
```

O editor, a tela de assinatura e o leitor estão nas seções 5 e 6.

---

## 3. Mapa de telas

| Rota | Tela | Acesso | Conteúdo |
|---|---|---|---|
| `/` | Title Screen | todos | menu principal (varia com o login) |
| `/login` | Sign In | visitante | e-mail, senha, Google, Discord; depois, o código 2FA |
| `/register` | Create Account | visitante | formulário da seção 4.1 |
| `/welcome` | Welcome | após OAuth | username, data de nascimento e termos de quem entrou pelo Google/Discord |
| `/verify-email` | Verify Email | todos | confirma o token do link |
| `/forgot-password` | Forgot Password | visitante | pede o link de redefinição |
| `/reset-password` | Reset Password | visitante | nova senha |
| `/library` | My Books | logado | Drafts, Signed, Copies, Favorites |
| `/editor/:id` | Book and Quill | dono do rascunho | editor (seção 5) |
| `/book/:id` | Written Book | conforme a visibilidade | leitor (seção 6) |
| `/u/:username` | Profile | conforme a privacidade | perfil (seção 7.1) |
| `/friends` | Friends | logado | Friends, Requests, Blocked |
| `/community` | Community | todos | New, Trending, Friends, busca |
| `/notifications` | Notifications | logado | lista completa |
| `/settings/*` | Options... | logado | seção 8 |
| `/guidelines` | Community Guidelines | todos | seção 9 |
| `/terms`, `/privacy` | Terms of Use, Privacy Policy | todos | em inglês, com link para a versão em português |
| `/report-concern` | Report a Concern | todos (sem conta) | canal público do ECA Digital (documento 02, §6.9) |
| `/mod/*` | Moderation | moderador com 2FA | seção 10.5 |
| `*` | Not Found | todos | "This page doesn't exist." + "Back to Title Screen" |

**Comportamentos de todas as telas**
- `Esc` volta, como no jogo. Fora da Title Screen há uma barra fina com "Back", o nome da tela, o sino de notificações e o menu do avatar (Profile, Options..., Log Out).
- Estados previstos em toda tela: carregando ("Loading..."), vazio (ex.: "No books yet. Create your first one!"), erro ("Something went wrong. Please try again." + "Retry") e offline (faixa no topo).
- O título da aba muda com a tela ("My Books · quillframe").

---

## 4. Autenticação

### 4.1 Create Account

| Campo | Regras na tela |
|---|---|
| "Username" | 3 a 16 caracteres, só letras, números e `_`. Checagem ao vivo: "This username is taken." Dica: "This is your author name. It can't be changed." |
| "Email" | `type="email"`, `autocomplete="email"` |
| "Password" | `autocomplete="new-password"`, botão de mostrar/ocultar, medidor de força. Dica: "Use at least 15 characters. A short sentence is easy to remember." |
| "Date of birth" | menores de 16 bloqueados: "You must be at least 16 years old to use quillframe." Não dá para tentar de novo com outra data no mesmo navegador **[proposta]** |
| Termos | "I agree to the Terms of Use and Privacy Policy" (obrigatório) |
| Diretrizes | "I agree to follow the Community Guidelines" (obrigatório) |
| Turnstile | sempre no cadastro |

- Sem campo "confirmar senha": o botão de mostrar/ocultar resolve o erro de digitação **[proposta]**.
- Botões "Continue with Google" e "Continue with Discord".
- Ao enviar, a resposta é sempre "Check your email to continue.", exista ou não uma conta com o e-mail (documento 02, §5.5).
- Se a API acusar senha vazada: "This password has appeared in a data breach. Please choose a different one."

### 4.2 Sign In
- "Email", "Password" (`autocomplete="current-password"`), "Forgot password?", "Sign In", botões do Google e do Discord e o link "Create Account".
- Erro sempre genérico: "Invalid email or password."
- Muitas tentativas: "Too many attempts. Try again in {minutes} minutes." Se a API pedir, aparece o Turnstile.
- **2FA:** "Enter the 6-digit code from your authenticator app" (`inputmode="numeric"`, `autocomplete="one-time-code"`), com o link "Use a recovery code instead".
- Conta suspensa: "Your account is suspended until {date}." com o motivo e o link de recurso.

### 4.3 Outras telas
- **Welcome (`/welcome`):** quem entra pela primeira vez pelo Google ou Discord escolhe o username, informa a data de nascimento e aceita os termos. Só então a conta existe.
- **Verify Email e Reset Password:** o token chega no fragmento (`#token=...`). A página lê, apaga da barra de endereço (`history.replaceState`) e envia por POST.
- **Forgot Password:** e-mail + Turnstile. Resposta sempre igual: "If an account exists for this email, we've sent a link."
- **Confirm it's you (modal de step-up):** aparece quando a API responde `REAUTH_REQUIRED`. Pede a senha ou o código 2FA ("For your security, enter your password to continue.") e repete a ação.
- **Sessão expirada:** toast "Your session has expired. Please sign in again." e volta para a Title Screen.

---

## 5. Editor (Book and Quill)

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ < Back   Untitled book                        Saved          ? Shortcuts │
├────────────────┬────────────────────────────────────┬────────────────────┤
│ COLORS         │                     Page 3 of 50   │ PAGE               │
│ [0][1][2][3]   │    ┌──────────────────────────┐    │ [ Add Page    ]    │
│ [4][5][6][7]   │    │                          │    │ [ Remove Page ]    │
│ [8][9][a][b]   │    │   página no canvas       │    │ [ Copy ][ Paste ]  │
│ [c][d][e][f]   │    │   (192×192 × escala)     │    │ [ Clear Page  ]    │
│                │    │                          │    │                    │
│ STYLES         │    │                          │    │ BOOK               │
│ [B][I][U][S]   │    └──────────────────────────┘    │ [ Copy ][ Paste ]  │
│ [Obfuscated]   │       <                    >       │ [ Clear Book  ]    │
│ [Reset]        │           412/1024 · 13/14 lines   │ [ Import ][Export] │
│ [Clear Format] │       [ Visual | Raw ]             │                    │
│ [Symbols...]   │                                    │                    │
├────────────────┴────────────────────────────────────┴────────────────────┤
│                       [     Sign     ]   [     Done     ]                │
└──────────────────────────────────────────────────────────────────────────┘
```

"Sign" e "Done" ficam embaixo, como no jogo. "Done" volta para My Books (o livro já está salvo).

### 5.2 Como funciona por dentro

```
 teclado / mouse / toque
        │
        ▼
 textarea oculta (texto bruto da página, com os códigos §)   ◄── caret e seleção
        │  input, keydown, composition (acentos)
        ▼
 operações do editor: inserir, apagar, aplicar formato, colar, desfazer
        │
        ▼
 store (Zustand): páginas, página atual, seleção, histórico, estado de salvamento
        │                                 │
        ▼                                 ▼
 motor de layout (packages/shared)     fila de autosave → API
        │                              (IndexedDB se estiver offline)
        ▼
 renderer no canvas (atlas de glifos) → livro na tela
```

- **A entrada real é uma `<textarea>` oculta**, posicionada sob o caret. Isso dá ao editor teclado, colar, desfazer do sistema, leitores de tela e a composição de acentos do teclado ABNT2 (`´` + `e` = `é`, pelos eventos `composition*`).
- O motor de layout do `packages/shared` (o mesmo do servidor) transforma o texto bruto em linhas e posições. Com isso, o editor mapeia um clique no canvas para uma posição no texto e o caret para um ponto na tela.
- O renderer desenha os glifos do atlas com cor, negrito (+1 px, documento 01, §4), itálico, sublinhado, riscado e ofuscado (`§k` troca o caractere por outro da mesma largura a cada frame).
- A seleção aparece como um bloco realçado sobre o texto.

### 5.3 Barra de formatação

| Controle | Código | Comportamento |
|---|---|---|
| 16 cores | `§0` a `§f` | tooltip com o nome em inglês ("Dark Red", "Gold"...) |
| "Bold" | `§l` | |
| "Italic" | `§o` | |
| "Underline" | `§n` | |
| "Strikethrough" | `§m` | |
| "Obfuscated" | `§k` | a prévia anima (estática com movimento reduzido) |
| "Reset" | `§r` | volta ao preto sem estilos |
| "Clear Formatting" | — | remove os códigos válidos da seleção ou da página |
| "Symbols..." | — | abre o seletor de símbolos (5.8) |

### 5.4 Regras de formatação (iguais ao Java)
- **Sem seleção:** o código entra na posição do caret e vale para o que vier depois, como no jogo.
- **Com seleção:** o editor insere o código no início e, no fim, restaura o estado anterior. Como não existe código para "desligar negrito", a restauração é `§r` seguido da cor e dos estilos que estavam ativos.
- **A cor vem antes dos estilos.** No Java, uma cor apaga os estilos ativos (documento 01, §6). Se o usuário liga negrito e depois escolhe vermelho, o editor grava `§c§l`, não `§l§c`. Senão o negrito sumiria.
- **Códigos inválidos são preservados.** Sequências como `§ ` e `§§` fazem parte da técnica de alinhamento do autor (documento 01, §6). "Clear Formatting" remove só os códigos válidos; os inválidos só saem à mão, no modo Raw **[proposta]**.
- "Optimize codes" (opcional) remove códigos repetidos ou sem efeito, para economizar caracteres do limite de 1024 **[proposta]**.

### 5.5 Visual e Raw
- **Visual:** como no jogo, os códigos ficam invisíveis e o texto aparece formatado.
- **Raw:** abre ao lado do livro um painel de texto com o conteúdo bruto, mostrando os códigos (`§c`) e destacando em amarelo os inválidos. O livro ao lado continua como prévia ao vivo.

### 5.6 Limites e avisos
- Contador "412/1024" (os códigos `§` contam, documento 01, §6). Fica amarelo acima de 90% e vermelho no limite. Ao lado, "13/14 lines".
- Como no jogo, não dá para digitar além de 1024 caracteres ou de 14 linhas.
- **Colar além do limite:** cola o que cabe e avisa "Some text didn't fit on this page." **[proposta]**.
- Mais de 100 páginas: faixa "This book has more than 100 pages and can't be imported into the game." (D3).
- **Desfazer e refazer** (`Ctrl+Z`, `Ctrl+Y`) com histórico por página.

### 5.7 Ferramentas de página e livro
- "Add Page" e "Remove Page". Remover uma página que não está vazia pede confirmação.
- "Copy Page" e "Paste Page": copiam o texto bruto (com os `§`) para a área de transferência. Colar substitui a página atual, com confirmação se ela não estiver vazia.
- "Copy Book" e "Paste Book": usam o texto no formato `.stendhal`. Colar substitui o livro inteiro, com confirmação.
- "Clear Page" e "Clear Book": com confirmação e com desfazer.

### 5.8 Seletor de símbolos
- Grade com os caracteres que a fonte renderiza (a fonte principal mais o subconjunto da Unifont), em três abas: "Favorites" (mais de 70, como no Stendhal), "Recent" e "All" (com busca pelo nome).
- Clicar insere na posição do caret.
- Os emojis aparecem **monocromáticos, na cor do texto**, como no jogo (documento 01, §4).

### 5.9 Importar e exportar
- "Import": aceita `.stendhal` e `.txt`. O navegador faz o parse com o `packages/shared` e mostra uma prévia (título, número de páginas, avisos) antes de enviar para a API.
- "Export": baixa o `.stendhal` gerado pela API.

### 5.10 Salvamento automático

| Estado | Texto | Quando |
|---|---|---|
| Salvando | "Saving..." | envio em andamento |
| Salvo | "Saved" | a API confirmou |
| Offline | "Offline — changes are kept on this device" | sem conexão; as alterações vão para o IndexedDB |
| Conflito | "This book was changed in another tab or device." | a API respondeu `VERSION_CONFLICT` |
| Erro | "Couldn't save. Retrying..." | falha temporária; novas tentativas com espera crescente |

- Envia a página cerca de 1,5 s depois da última tecla, ao trocar de página e ao sair da tela.
- Ao fechar a aba com algo pendente, envia com `fetch(..., { keepalive: true })`. Se não houver conexão, o pendente fica no IndexedDB e é reenviado na próxima visita.
- **Conflito:** o diálogo oferece "Use this version" (envia a sua por cima) e "Load the other version" (descarta a sua).
- O texto "Saved" é anunciado a leitores de tela (`aria-live="polite"`).

### 5.11 Atalhos [proposta]

| Atalho | Ação |
|---|---|
| `Ctrl+B` | negrito (`§l`) |
| `Ctrl+I` | itálico (`§o`) |
| `Ctrl+U` | sublinhado (`§n`) |
| `Ctrl+Shift+X` | riscado (`§m`) |
| `Ctrl+Shift+K` | ofuscado (`§k`) |
| `Ctrl+\` | "Clear Formatting" |
| `Ctrl+Z` / `Ctrl+Y` | desfazer / refazer |
| `PageUp` / `PageDown` | página anterior / próxima |
| `Ctrl+Enter` | nova página depois da atual |
| `Esc` | "Done" |

No Mac, `Cmd` no lugar de `Ctrl`. A lista completa fica em "? Shortcuts" e em Options → "Controls...".

### 5.12 Assinar

```
┌──────────────────────────────────────────┐
│            Enter Book Title:             │
│        ┌──────────────────────┐          │
│        │ Two Birds_           │  9/64    │
│        └──────────────────────┘          │
│              by quill_writer             │
│                                          │
│   Note: once signed, this book can no    │
│   longer be edited.                      │
│                                          │
│   ( ) Keep private                       │
│   ( ) Share with friends                 │
│   (•) Publish to Community               │
│                                          │
│   [x] This book follows the              │
│       Community Guidelines               │
│                                          │
│    [ Sign and Close ]     [ Cancel ]     │
└──────────────────────────────────────────┘
```

- Título de 1 a 64 caracteres. Acima de 15, aviso: "Titles longer than 15 characters are cut when the book is signed in the game." (D4).
- O autor é sempre o username da conta (D4).
- "Keep private" vem marcado por padrão. A caixa das diretrizes só aparece, e só é obrigatória, quando o livro for compartilhado ou publicado.
- Publicar exige e-mail verificado. Sem ele: "Verify your email to share books." com o botão "Resend email".
- Depois de assinar, abre o livro no leitor com o toast "Book signed!". Se o filtro segurou o livro: "Your book is under review before appearing in the Community."

### 5.13 Editor no celular
Modo básico: o livro ocupa a largura, a barra de cores e estilos vira uma gaveta inferior e as ferramentas de página e livro ficam num menu. Uma faixa sugere: "For ASCII art, a computer works best." **[proposta]**

---

## 6. Leitor (Written Book)

```
┌──────────────────────────────────────────────────────────────┐
│ < Back      Good Luck   by quill_writer           Report     │
├──────────────────────────────────────────────────────────────┤
│                                          Page 3 of 50        │
│                ┌──────────────────────────┐                  │
│                │                          │                  │
│                │    página no canvas      │                  │
│                │                          │                  │
│                └──────────────────────────┘                  │
│                   <                      >                   │
│  [ Play ]  Speed: 4 pages/s  [ Loop ]  [ Pages ]  [ Search ] │
├──────────────────────────────────────────────────────────────┤
│ [ Like 12 ] [ Favorite ] [ Make a Copy ] [ Export ] [ Share ] │
│  Comments: [Great animation! 7] [Amazing! 4] [Made me cry 1] │
└──────────────────────────────────────────────────────────────┘
```

| Recurso | Como funciona |
|---|---|
| Virar página | botões `<` e `>` (somem na primeira e na última página, como no jogo), setas, `PageUp`/`PageDown`, `Home`/`End` e deslizar no toque. Som de página |
| Play | vira as páginas sozinho: velocidade de 1 a 20 páginas por segundo (padrão 4), "Loop", pausa ao interagir. No Play o som de página fica desligado. `Space` liga e desliga |
| "Pages" | grade de miniaturas; clicar pula para a página (como o índice do Stendhal) |
| "Search" | busca no texto ignorando os códigos `§`; lista "Page 7: ...trecho..." e destaca o resultado |
| Informações | título, "by {author}" (link para o perfil), geração ("Original", "Copy of original", "Copy of a copy"), data, páginas, likes, favoritos |
| "Like" e "Favorite" | alternam na hora (atualização otimista) |
| "Make a Copy" | só se o autor permitir e a geração for 0 ou 1; a cópia vai para My Books → Copies |
| "Export" | baixa o `.stendhal`, se permitido (documento 02, B13) |
| "Share" | copia o link; no celular, usa o menu de compartilhar do sistema |
| "Report" | modal da seção 10.1, com a página atual já preenchida |
| "Text view" | mostra o texto da página, sem os códigos, como texto de verdade, para leitores de tela |

**Comentários predefinidos [a decidir, F8]:** "Amazing!", "Beautiful art!", "Great animation!", "Love the story!", "Made me smile", "Made me cry", "So creative!", "Spooky!", "Can't stop watching", "More, please!", "Inspiring", "Masterpiece!". Aparecem como etiquetas com contagem. Clicar marca ou desmarca o seu, e passar o mouse mostra quem marcou.

**Visão do dono:** seletor de visibilidade ("Private", "Friends", "Public"), "Allow copies", "Allow comments", "Delete Book" e números do livro.

**Estados especiais**
- Em revisão (só o dono vê): "Your book is under review before appearing in the Community."
- Oculto ou removido (só o dono vê): o motivo, a regra e o botão "Appeal".
- Para os outros: "This book is no longer available."
- Visitante sem conta lê livros públicos; as ações mostram "Sign in to like this book".

---

## 7. Social

### 7.1 Perfil (`/u/:username`)
- Avatar (cabeças em pixel art, arte própria), username, "Member since {date}", bio e número de livros.
- Botão conforme a relação: "Add Friend", "Request Sent", "Accept Request" ou "Friends" (com "Remove Friend"). Menu "...": "Block" e "Report User".
- Abas: "Books" (públicos, mais os de amigos se forem amigos), "Favorites" (se o dono permitir) e "Copies".
- Perfis de 16 e 17 anos seguem as proteções do documento 02, §7.3.

### 7.2 Amigos (`/friends`)
- Abas "Friends", "Requests" (recebidos e enviados) e "Blocked".
- Campo "Add friend by username".
- Não há indicador de "online": isso protege a privacidade.

### 7.3 Comunidade (`/community`)
- Abas "New", "Trending" e "Friends", e uma busca de livros e usuários.
- Lista no estilo da lista de servidores: ícone do livro, título, "by {author}", páginas e likes. Passar o mouse mostra o tooltip do livro.
- Botão "Load more" no fim, em vez de rolagem infinita: melhor para teclado e deixa o rodapé alcançável.

### 7.4 Notificações
- Sino na barra com contador. A lista mostra pedidos de amizade, aceites, likes e comentários (agrupados), decisões de moderação e alertas de segurança.
- "Mark all as read".
- Consulta a API a cada 60 s e pausa quando a aba não está visível (Page Visibility API).

---

## 8. Options...

| Seção | Itens |
|---|---|
| "Account" | avatar, bio, e-mail (troca com confirmação), username (só leitura) |
| "Security" | "Change Password", "Two-Factor Authentication", "Recovery Codes", "Active Sessions" (com "Sign out everywhere"), "Connected Accounts" (Google, Discord), "Recent Security Activity" |
| "Privacy" | quem pode enviar pedidos de amizade, mostrar favoritos no perfil, aparecer na busca. Travadas para 16–17 anos, com explicação |
| "Notifications" | quais eventos notificam no site. Os e-mails de segurança sempre ficam ligados |
| "Video Settings..." | "GUI Scale" |
| "Accessibility..." | "Readable Font", "Reduce Motion", "Page Turn Animation" |
| "Music & Sounds..." | "Master Volume", "Interface", "Book" |
| "Controls..." | lista de atalhos do editor e do leitor |
| "Data" | "Export My Data", "Delete Account" |
| "Moderation History" | avisos, strikes (com a data em que expiram), recursos |

**Ativar o 2FA:**
1. Confirmar que é você (step-up).
2. O QR code é **gerado no navegador** a partir da URI `otpauth://`; o segredo nunca vai para um serviço externo de QR. Abaixo, o segredo em texto para digitar à mão.
3. Digitar o código do app para confirmar.
4. Os 10 códigos de recuperação aparecem **uma única vez**, com "Download" e "Copy". Só dá para concluir marcando "I saved my recovery codes".

---

## 9. Community Guidelines (texto da página `/guidelines`)

> Rascunho do texto que vai para o site, por isso em inglês. As penalidades seguem o documento 02, §6.6.

---

### quillframe Community Guidelines

quillframe is a place to write, animate and share books. These rules keep it safe and welcoming for everyone. They apply to everything you publish: books (text and ASCII art), titles, usernames and bios.

**You must be 16 or older to use quillframe.**

#### 1. No sexual content
- No sexually explicit or suggestive content, in text or in ASCII art.
- No nudity, sexual acts, sexual roleplay or fetish content.
- No references or directions to sexual content elsewhere.

#### 2. Zero tolerance for anything that sexualizes minors
Any content that sexualizes, exploits or endangers children or teenagers is removed immediately. The account is permanently banned and the case is reported to the authorities.

#### 3. Be respectful
- No hate speech or attacks based on race, ethnicity, nationality, religion, sex, gender identity, sexual orientation, disability or any similar characteristic.
- No harassment, bullying or threats, including books or titles made to target someone.

#### 4. Keep it safe
- No content that encourages or glorifies self-harm, suicide or eating disorders. Stories can deal with hard topics, but must not promote them.
- No graphic gore and no content that promotes violence, terrorism or dangerous challenges.
- No content that promotes illegal activities, drugs or weapons.

If you are going through a hard time, please reach out. In Brazil, call CVV at 188 or visit cvv.org.br. Elsewhere, contact your local emergency services.

#### 5. Protect privacy
- Don't share personal information, yours or anyone else's: full names, addresses, phone numbers, emails, schools, passwords or social media accounts.
- Don't share private conversations about other people.

#### 6. Be honest
- No spam, scams, advertising or misleading titles.
- Don't pretend to be another person, creator, moderator or the quillframe team.
- Don't create another account to get around a suspension or ban.

#### 7. Respect creators
- Publish your own work. Don't upload other people's books or art without permission.
- "Make a Copy" always keeps the original author. Never present a copy as your own.

#### 8. quillframe is not Minecraft
quillframe is a fan project. Don't claim it is made, approved or endorsed by Mojang or Microsoft.

#### Reporting
Use **Report** on any book or profile. Choose a reason and, if you can, the page. Reports are confidential: the person you report never sees who reported them. Reporting in bad faith, to harass someone or to remove content you simply don't like, also breaks these rules.

If you are a victim, a parent or guardian, or an organization reporting content that violates the rights of a child or teenager, you can use the **Report a Concern** form. No account needed.

#### What happens when rules are broken

| Situation | Consequence |
|---|---|
| First minor violation | Warning |
| Violation | Content removed + 1 strike (strikes expire after 90 days) |
| 2 active strikes | 3-day suspension |
| 3 active strikes | 30-day suspension |
| 4 active strikes | Permanent ban |
| Sexual content involving minors, real threats, spam bots, ban evasion | Immediate permanent ban |

A book may be hidden while it is reviewed. When we act on your content, we tell you which rule it broke, whether the decision was automated or made by a moderator, and how to appeal.

#### Appeals
You can appeal any decision within 30 days, from your notifications or from **Options → Moderation History**. A moderator will review it, usually within 7 days.

---

## 10. Denúncias e moderação na interface

### 10.1 Denunciar um livro

```
┌──────────────────────────────────────┐
│           Report this book           │
│   Why are you reporting it?          │
│   ( ) Sexual content                 │
│   ( ) Child safety                   │
│   ( ) Hate speech                    │
│   ( ) Harassment or bullying         │
│   ( ) Violence or threats            │
│   ( ) Self-harm or suicide           │
│   ( ) Personal information           │
│   ( ) Spam or scam                   │
│   ( ) Stolen work                    │
│   ( ) Something else                 │
│   Page: [ 3 ]                        │
│   Details (optional):                │
│   [______________________________]   │
│      [ Send Report ]   [ Cancel ]    │
└──────────────────────────────────────┘
```

- A página vem preenchida com a página aberta no leitor. "Details" aceita até 500 caracteres.
- Depois de enviar: "Thanks for your report. Our moderators will review it."
- Denunciar um usuário (pelo perfil) acrescenta "Impersonation" e "User under 16".
- O resultado chega como notificação. As minhas denúncias ficam em Options → "Moderation History".

### 10.2 Report a Concern (`/report-concern`)
Formulário público do ECA Digital (documento 02, §6.9): "Your name", "Email", "Your relationship to this case" (victim, parent or guardian, public prosecutor, child protection organization, other), "Link to the content", "What happened" e Turnstile. Explica que a notificação não é anônima e que um e-mail de confirmação será enviado.

### 10.3 Decisões e recursos
- A notificação de uma decisão mostra o que foi afetado, a regra, se foi "Automated review" ou "Reviewed by a moderator", e o botão "Appeal" (até 30 dias).
- O recurso tem um campo de texto de até 1000 caracteres e mostra a situação ("Pending", "Decision upheld", "Decision reversed").

### 10.4 Livro oculto ou em revisão
Faixas no leitor e em My Books, sempre dizendo o motivo e o próximo passo. Nada some sem explicação para o autor.

### 10.5 Painel de moderação (`/mod`)
- Só abre para moderadores **com 2FA ativo**. O código do painel é carregado à parte, mas a proteção de verdade é o servidor.
- **"Queue":** lista por prioridade e idade (motivo, alvo, quantidade de denúncias, tempo de espera), com filtros.
- **Detalhe:** o livro aberto no leitor, na página denunciada; todas as denúncias do alvo com os detalhes; o histórico do autor (ações anteriores, strikes).
- **Ações:** os botões da tabela 6.5 do documento 02. Motivo e regra são obrigatórios. "Ban" pede step-up.
- Abas "Appeals" e "Concerns" (canal público). Para admins, "Audit Log" e papéis de usuários.

---

## 11. Segurança no front-end

| Risco | Medida |
|---|---|
| Roubo de sessão por XSS | A sessão fica só no cookie `HttpOnly`; o JavaScript nunca vê o token. Nada sensível em `localStorage` ou `sessionStorage`. O estado de login vem de `GET /api/me` |
| XSS | Proibido `dangerouslySetInnerHTML` (regra `react/no-danger`), `eval` e `new Function`. Conteúdo de usuário só como texto (o React escapa) ou no canvas. Nenhuma URL de usuário vira `href` ou `src` |
| CSP | Nenhum script ou estilo inline no `index.html`; CSS Modules em vez de CSS-in-JS; fontes servidas pelo próprio site. Avaliar Trusted Types (`require-trusted-types-for 'script'`) **[proposta]** |
| CSRF | O cliente HTTP lê o cookie `__Host-qf_csrf` e envia `X-CSRF-Token` em toda mutação, sempre com JSON |
| Senhas | `autocomplete` correto; colar e gerenciadores permitidos; mostrar/ocultar; medidor como guia (quem decide é o servidor) |
| 2FA | QR gerado no navegador; segredo e códigos mostrados uma única vez |
| Tokens de e-mail | Lidos do fragmento da URL e apagados da barra de endereço logo em seguida |
| Open redirect | `returnTo` só aceita caminhos internos (começa com `/`, nunca `//`) |
| Dados no aparelho | Ao sair (ou quando a sessão cai), apaga o cache do TanStack Query, os stores e o IndexedDB. Se houver alterações não salvas: "You have unsaved changes on this device. Log out anyway?" |
| Ações sensíveis | Modal de step-up quando a API pede `REAUTH_REQUIRED` |
| Bots | Turnstile quando a API pede (`CAPTCHA_REQUIRED`) e sempre no cadastro e no "Forgot password?" |
| Rastreamento | Nenhum analytics ou script de terceiros. A única exceção é o Turnstile, e só nas telas que precisam dele |
| Links externos | Só os do rodapé, com `rel="noopener noreferrer"` |
| Erros | Mensagens genéricas, nunca stack trace. Sentry no front com dados pessoais removidos |
| Código publicado | Sem source maps públicos em produção |
| Dependências | Poucas, com lockfile e `pnpm audit` no CI (documento 02, §5.14) |

---

## 12. Acessibilidade

Meta: **WCAG 2.2 nível AA** para a interface. O conteúdo dos livros é a arte do autor, mas tem alternativa em texto.

| Necessidade | Solução |
|---|---|
| Ler a fonte pixel | Escala inteira e grande, e a opção "Readable Font", que troca a fonte da interface pela do sistema. O livro continua com a fonte pixel, porque a arte depende dela |
| Teclado | Tudo alcançável com `Tab`, foco sempre visível (borda branca, como o hover do jogo), `Esc` volta, atalhos documentados, link "Skip to content" |
| Leitor de tela | No editor, a `textarea` oculta tem rótulo e é a entrada real. No leitor, "Text view" e anúncio "Page 3 of 50" por `aria-live`. "Saved" e os toasts também são anunciados |
| Movimento | `prefers-reduced-motion` e "Reduce Motion" desligam o splash pulsando, a animação de virar página e o `§k` animado (fica estático). O Play nunca começa sozinho |
| Som | Nada toca antes da primeira interação; volume e mudo em Options |
| Cor | A interface nunca depende só de cor; contraste de no mínimo 4,5:1 nos textos da interface |
| Alvos de toque | No mínimo 24×24 px CSS (WCAG 2.2, critério 2.5.8). Na escala 2×, um botão tem 40 px de altura |
| Idioma | `<html lang="en">` e títulos de página por rota |

---

## 13. Celular e telas pequenas

| Largura | Comportamento |
|---|---|
| ≥ 1024 px | layout completo (painéis laterais do editor) |
| 600–1023 px | os painéis do editor viram barras acima e abaixo do livro |
| < 600 px | leitor compacto; editor básico (5.13) |

- **Leitor compacto [proposta]:** o livro inteiro (192 px) na escala 1× fica pequeno demais, e na 2× (384 px) não cabe numa tela de 360 px. Por isso, no celular, o leitor mostra só a área de texto (114×128) na escala **3×** (342×384 px), sem a moldura do livro. A escala continua inteira e a arte, nítida.
- Deslizar vira a página; os controles ficam numa barra inferior.
- Tooltips viram toque (tocar mostra, tocar fora fecha).

---

## 14. Performance

| Item | Meta ou técnica |
|---|---|
| JavaScript inicial | até ~200 KB gzip na Title Screen **[proposta]** |
| Divisão de código | editor, leitor, painel de moderação e zxcvbn carregados sob demanda |
| Fontes e atlas | servidos pelo próprio site, com `preload` |
| Canvas | Atlas pintado nas 16 cores uma vez, em canvases fora da tela. Páginas renderizadas ficam em cache (`ImageBitmap`); no Play, as próximas 10 são preparadas antes |
| Animação | `requestAnimationFrame`; o `§k` só anima a página visível |
| Dados | `staleTime` por recurso, pré-carregamento ao passar o mouse sobre um livro, atualização otimista em like e favorito |
| Lighthouse | 90 ou mais em Performance, Accessibility e Best Practices no leitor |

---

## 15. Testes

| Tipo | Ferramenta | O que cobre |
|---|---|---|
| Unidade | Vitest | operações do editor (aplicar cor e estilo, cor antes de estilo, preservar códigos inválidos, colar com limite), mapeamento caret ↔ posição, contagem |
| Componentes | Testing Library | formulários (validação, mensagens), tela de assinatura, modais |
| E2E | Playwright | cadastro → verificação (e-mail no Mailpit) → escrever → autosave → recarregar → assinar → publicar → like → denunciar → moderador remove → notificação → recurso. Também: 2FA, step-up, sair limpa os dados |
| Regressão visual | Playwright | todas as páginas dos 11 livros do autor (documento 01, §8), começando pelas 162 páginas dos 4 já analisados |
| Acessibilidade | axe-core no Playwright | telas principais sem violações sérias |
| Segurança | Playwright | nenhuma violação de CSP no console; cookies inacessíveis ao JavaScript; nada sensível no storage depois do login |

**Regressão visual [proposta]:** a fonte do projeto tem as mesmas métricas do jogo, mas desenhos próprios (D5). Por isso, comparar pixel a pixel com prints do jogo não funciona no CI. A solução tem duas partes:
- **No CI:** compara a **geometria**: em que linha cada caractere caiu e a posição x de cada um, contra valores de referência gravados.
- **Localmente (opcional):** com o atlas lido do `.jar` do jogo instalado na máquina (nunca commitado, documento 01, D6), a renderização tem que bater pixel a pixel com o print do jogo.

---

## 16. Fluxos principais

**Escrever e publicar**
1. Title Screen → "My Books" → "Create New".
2. Escreve e formata; o livro é salvo sozinho ("Saved").
3. "Sign" → título → "Publish to Community" → marca as diretrizes → "Sign and Close".
4. Abre no leitor com "Book signed!". Aparece em "New" (ou fica em revisão, se o filtro acusar).

**Denunciar**
1. No leitor, "Report" → motivo → página → "Send Report".
2. O moderador decide no painel.
3. Quem denunciou é avisado do resultado; o autor recebe a decisão com o motivo e pode recorrer.

**Proteger a conta**
1. Options → "Security" → "Two-Factor Authentication".
2. Confirma a senha, escaneia o QR, digita o código, guarda os códigos de recuperação.
3. Em "Active Sessions", confere os aparelhos e usa "Sign out everywhere" se algo parecer estranho.

---

## 17. Textos principais da interface

| Situação | Texto |
|---|---|
| Login falhou | "Invalid email or password." |
| Muitas tentativas | "Too many attempts. Try again in {minutes} minutes." |
| Senha curta | "Use at least 15 characters. A short sentence is easy to remember." |
| Senha vazada | "This password has appeared in a data breach. Please choose a different one." |
| Menor de 16 | "You must be at least 16 years old to use quillframe." |
| Cadastro enviado | "Check your email to continue." |
| Sessão expirada | "Your session has expired. Please sign in again." |
| Step-up | "Confirm it's you" / "For your security, enter your password to continue." |
| Assinar | "Note: once signed, this book can no longer be edited." |
| Título longo | "Titles longer than 15 characters are cut when the book is signed in the game." |
| Mais de 100 páginas | "This book has more than 100 pages and can't be imported into the game." |
| Não coube | "Some text didn't fit on this page." |
| Em revisão | "Your book is under review before appearing in the Community." |
| Indisponível | "This book is no longer available." |
| Denúncia enviada | "Thanks for your report. Our moderators will review it." |
| Offline | "You're offline. Your changes will be saved when you reconnect." |
| Erro genérico | "Something went wrong. Please try again." |

---

## 18. Roadmap

Alinhado às fases do documento 02, §9.

| Fase | Front-end |
|---|---|
| Fase 0 · Fundação | componentes `ui/`, pipeline da fonte (atlas + WOFF2), renderer do livro só para leitura, validado com os livros do autor |
| Fase 1 · Contas | Title Screen, cadastro, login, verificação, reset de senha, Options básico |
| Fase 2 · Livros | editor completo, My Books, assinatura, importar/exportar, autosave e modo offline |
| Fase 3 · Social | leitor completo (Play, índice, busca), Community, perfis, amigos, notificações |
| Fase 4 · Moderação | denúncias, página de diretrizes, Report a Concern, painel `/mod` |
| Fase 5 · Segurança avançada | 2FA, Google, Discord, sessões, step-up, Options → Security |
| Fase 6 · Lançamento | revisão de acessibilidade e performance, páginas legais (inglês + português), E2E completo |

---

## 19. Decisões

| # | Decisão | Status | Definição |
|---|---|---|---|
| F1 | Stack | ✅ decidido | **React + Vite + TypeScript**, React Router, TanStack Query, Zustand |
| F2 | Idioma da interface | ✅ decidido | **Inglês**, com os textos em `strings/en.ts` |
| F3 | Entrega | ✅ decidido | SPA servida pelo Fastify, na mesma origem da API |
| F4 | Estilos | proposta | CSS Modules + variáveis CSS (sem CSS-in-JS, por causa da CSP) |
| F5 | Fonte da interface | proposta | Fonte pixel própria em WOFF2 + opção "Readable Font" |
| F6 | Leitura sem conta | proposta | Livros públicos abertos para visitantes |
| F7 | Celular | proposta | Leitor compacto (só a área de texto, 3×); editor básico |
| F8 | Comentários predefinidos | a decidir | Lista da seção 6 |
| F9 | Atalhos | proposta | Tabela da seção 5.11 |
| F10 | Rastreadores | proposta | Nenhum analytics de terceiros |
| F11 | Som | proposta | Ligado em 50%; nada toca antes da primeira interação; Play sem som de página |
| F12 | "Clear Formatting" | proposta | Remove só os códigos válidos; os inválidos ficam |
| F13 | Colar além do limite | proposta | Cola o que cabe e avisa |
| F14 | Campo "confirmar senha" | proposta | Não usar; botão de mostrar/ocultar |
| F15 | Regressão visual | proposta | Geometria no CI; pixel a pixel local, com o atlas do jogo |

---

## Fontes
- [React](https://react.dev/), [Vite](https://vite.dev/), [React Router](https://reactrouter.com/), [TanStack Query](https://tanstack.com/query/latest), [Zustand](https://zustand.docs.pmnd.rs/), [React Hook Form](https://react-hook-form.com/), [zod](https://zod.dev/)
- [zxcvbn-ts](https://zxcvbn-ts.github.io/zxcvbn/) (medidor de força de senha)
- [Playwright](https://playwright.dev/) e [axe-core](https://github.com/dequelabs/axe-core)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- MDN: [image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering), [atributo autocomplete](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete), [Trusted Types](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API), [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- OWASP: [XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
- [CVV (Centro de Valorização da Vida)](https://cvv.org.br/)
