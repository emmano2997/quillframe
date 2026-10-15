# 04 — Motor de texto do livro

> Como o quillframe reproduz o texto do livro do Minecraft: códigos `§`, larguras, quebra de linha e desenho. É a especificação do que está implementado em `packages/shared` (motor) e em `apps/web/src/book` (desenho). Complementa o [documento 01](01-referencia-livro-minecraft-stendhal.md), que listava vários pontos como **[a validar]**: a maioria foi confirmada aqui.
>
> Legenda:
> - **[confirmado]**: conferido no código do jogo (Java Edition 26.3, ou 1.21.4 quando indicado).
> - **[inferido]**: deduzido dos livros do autor.
> - **[a validar]**: precisa ser visto dentro do jogo.

---

## Como as regras foram conferidas

- A partir das versões 26.x, o Java Edition não é mais ofuscado: as classes têm nomes legíveis. As classes de texto, fonte e livro do 26.3 foram lidas com um leitor de bytecode escrito para isso (fora do repositório). Para o editor antigo, a classe da 1.21.4 foi achada pela chave de tradução `book.editTitle`.
- **Nenhum código do jogo foi copiado.** O motor reimplementa o comportamento, como o documento 01 já fazia com as constantes.
- As larguras foram **medidas** nos arquivos da instalação local (`pnpm font:metrics`). O repositório guarda só os números (`glyph-metrics.generated.ts`), nunca a arte. A 1.21.11 e a 26.3 dão larguras idênticas para todos os 1.114.112 caracteres.

---

## 1. O caminho do texto

```
texto bruto da página (com §)
   │  §2 códigos: esconde os códigos e dá um estilo a cada caractere
   ▼
caracteres com estilo
   │  §3 larguras: avanço de cada glifo (negrito soma)
   ▼
   │  §5 quebra de linha: até 114 px por linha
   ▼
linhas
   │  §6 desenho: posição de cada glifo, cor e efeitos
   ▼
página na tela (no máximo 14 linhas)
```

---

## 2. Códigos `§` (`StringDecomposer.iterateFormatted`)

| Situação | O que acontece | Status |
|---|---|---|
| `§` + código válido | muda o estilo; o `§` e o código não aparecem | [confirmado] |
| `§` + qualquer outro caractere | **os dois somem**, inclusive espaço (`§ `), outro `§` (`§§`), letras (`§i`) e quebra de linha (`§\n`) | [confirmado] |
| `§` no fim do texto | some | [confirmado] |
| Código em maiúscula (`§L`, `§A`) | funciona igual ao minúsculo (o jogo usa `Character.toLowerCase`) | [confirmado] |
| Metade de emoji sem par (surrogate solto) | vira U+FFFD | [confirmado] |
| `§` + emoji | some o `§` e a primeira metade do emoji; a segunda metade vira U+FFFD | [confirmado] |

Atenção ao `§\n`: ele **esconde a quebra de linha**. Os livros do autor usam isso (por exemplo, `two_birds` e `magnolia`).

Códigos de estilo (`Style.applyLegacyFormat`) **[confirmado]**:
- `§k §l §m §n §o` ligam ofuscado, negrito, riscado, sublinhado e itálico.
- **Uma cor apaga todos os estilos**: em `§l§c`, o texto fica vermelho e sem negrito.
- `§r` volta ao "estilo de reset", que depende de onde o texto está (§5 e §6).

---

## 3. Larguras

A fonte padrão é formada por **provedores**, na ordem de `font/default.json`. O primeiro que tem o caractere vence **[confirmado]**:

| Ordem | Provedor | Avanço | Negrito soma |
|---|---|---|---|
| 1 | `space`: espaço = 4, ZWNJ (U+200C) = 0 | do JSON | 1 |
| 2 | bitmap `nonlatin_european.png` | `trunc(0,5 + tinta × escala) + 1` | 1 |
| 3 | bitmap `accented.png` | idem | 1 |
| 4 | bitmap `ascii.png` | idem | 1 |
| 5 | GNU Unifont 17.0.01 (`unifont.zip` dos assets) | `trunc((right − left + 1) ÷ 2) + 1` | **0,5** |
| — | caractere sem glifo | caixa 5×8, avanço 6 | 1 |

- **Tinta** de um glifo bitmap: a coluna mais à direita com algum pixel visível (canal alfa ≠ 0). Glifo vazio tem avanço 1.
- **Unifont**: `left`/`right` são a primeira e a última coluna com pixel; glifo vazio usa `left = 0` e `right = largura do bitmap`. Faixas CJK e coreanas têm `left`/`right` fixos (`size_overrides`).
- Como o negrito da Unifont soma 0,5, uma linha pode ter largura fracionária. A soma é feita como no jogo.
- Os códigos `§` não ocupam espaço, mas contam no limite de caracteres.

Exemplos (batem com o documento 01, §4): `i` = 2, `l` = 3, `I`/`t`/espaço = 4, `f`/`k` = 5, `a`/`M`/`0` = 6, `@`/`~` = 7, `★` = 8, `💔` = 7, `🌍` = 9. Em negrito: `a` = 7, espaço = 5, `💔` = 7,5.

---

## 4. Limites da página

| Regra | Editor da 1.21.x (onde os livros foram escritos) | Editor do 26.x |
|---|---|---|
| Caracteres | até **1023** (`length < 1024`) | até **1024** |
| Linhas | até 14, **sem contar** a linha vazia depois de um `\n` final (9 × linhas ≤ 128) | até 14, **contando** essa linha |
| Fonte | [confirmado] (1.21.4) | [confirmado] (26.3) |

- O site usa **1024 caracteres** (documento 01, D2) e a regra de linhas da 1.21.x: senão rejeitaria 94 páginas dos livros do autor, que têm 14 linhas e terminam com `\n`. As duas versões **mostram** essas páginas do mesmo jeito.
- Os caracteres são contados como o Java conta (`String.length`, unidades UTF-16): um emoji conta 2 **[confirmado]**.
- O jogo deixa uma página com mais de 14 linhas existir (por exemplo, colada pelo Stendhal), mas só mostra as 14 primeiras.

---

## 5. Quebra de linha (`StringSplitter.splitLines` + `LineBreakFinder`)

Para cada linha, a partir do estilo em que ela começa **[confirmado]**:

1. Soma a largura de cada caractere visível.
2. `\n` encerra a linha na hora.
3. Ao passar por um espaço, guarda a posição dele como "último espaço" **antes** de somar a largura.
4. Se a soma **passar** de 114 (igualar não quebra) e já houver algum caractere com largura na linha:
   - quebra no último espaço, se houver;
   - senão, quebra no caractere que não coube (a palavra é cortada no meio).
5. Se a quebra cair num espaço ou num `\n`, esse caractere **é consumido** e não aparece em nenhuma linha.
6. A linha seguinte começa com o estilo ativo no ponto da quebra.

Detalhes:
- O primeiro caractere com largura de uma linha nunca causa quebra, mesmo que sozinho passe de 114.
- Na medição, o `§r` volta ao estilo vazio (sem negrito), em qualquer tela.
- Na tela de leitura, um `\n` final gera uma linha vazia extra; no editor do 26.x também (e um `§\n` final também conta lá). Isso só muda a contagem do limite, não o que aparece.

---

## 6. Desenho (tela de leitura)

Geometria (`BookViewScreen`) **[confirmado]**:

| Item | Valor |
|---|---|
| Livro | 192×192, textura 256×256 |
| Área de texto | x = 36, y = 30, 114 × 128 |
| Linhas | altura 9; mostra `min(14, linhas)` |
| Indicador "Page X of Y" | alinhado à direita em x = 148, y = 16 |
| Botões de página | y = 157; x = 43 (voltar) e 116 (avançar) |
| Estilo base | preto, sem sombra (`PAGE_TEXT_STYLE`) |

Glifos e efeitos (`GlyphBitmap`, `Font.PreparedTextBuilder`) **[confirmado]**:
- Glifo bitmap: topo em `y + 7 − ascent`, ou seja, os acentuados sobem acima da linha. Glifo da Unifont: topo em `y`, em **meia escala** (16 px de altura viram 8).
- **Negrito**: o glifo é desenhado duas vezes, a segunda 1 px à direita (0,5 px na Unifont).
- **Itálico**: inclinação de 0,25 px por pixel de altura, com o topo do glifo 1 px à direita.
- **Riscado**: faixa de 1 px entre y + 3,5 e y + 4,5. **Sublinhado**: entre y + 8 e y + 9. Os dois vão de 1 px antes do glifo até o fim do avanço.
- **Ofuscado (`§k`)**: troca o glifo, a cada quadro, por outro de mesma largura. O site sorteia entre os glifos bitmap de mesmo avanço **[inferido]**.
- **Emojis** são desenhados com a cor do texto, como qualquer glifo da Unifont (sem cores próprias).

Estilo de cada linha:
- A **cor e os estilos continuam** depois de uma quebra de linha **[confirmado]**.
- Numa linha que continuou, o **`§r` volta ao estilo com que aquela linha começou**, não ao preto. É uma peculiaridade do jogo, e o site a reproduz **[confirmado]**.
- Se a quebra acontece depois de um `§r` e antes de uma nova cor, a linha seguinte começa **sem cor**. O 26.3 desenha texto sem cor com a cor padrão do desenho de texto, que é **branco com sombra**; o site usa preto por enquanto **[a validar no jogo]**.
- No **editor** do 26.x, cada linha é desenhada a partir do preto (a cor não continua depois de uma quebra). O editor do site mostra a página como ela será lida, não como o editor do jogo mostra **[confirmado]**.

---

## 7. Formato `.stendhal`

Complementa o documento 01, §7 **[inferido dos 10 livros]**:
- UTF-8, LF, sem BOM.
- As páginas são unidas por `\n` e o arquivo não termina com `\n` extra. Ou seja: o `\n` antes de `#- ` é só separador, e um `\n` no fim do arquivo pertence à última página. Com essa regra, ler e escrever os 10 livros devolve os arquivos **idênticos byte a byte** (teste automático).
- Toda página começa com `#- ` (com espaço). Uma página não pode conter uma linha começando com `#- `: o formato não tem como guardar isso, e o site avisa.
- 65% das páginas terminam com `\n`, cheias ou não (é hábito de escrita, não detalhe do formato).

---

## 8. Como validar

**Automático** (`pnpm test`):
- Regras de §2 a §5 com casos de borda.
- Os 10 livros: leitura e escrita byte a byte, e o cruzamento com o editor do jogo. **131 páginas têm exatamente 14 linhas e só 1 passa disso.** Se as larguras ou a quebra estivessem erradas, várias passariam de 14 (larguras maiores) ou nenhuma chegaria a 14 (menores).
- "Retratos" da quebra de linha de cada livro em `packages/shared/test/__snapshots__/*.lines.txt`: abra no editor e compare com o livro no jogo.

**Visual** (na sua máquina, com o Minecraft instalado):
1. `pnpm reference-pack` copia a fonte e a textura do livro do jogo para `.reference-pack/` (fora do Git e do build).
2. `pnpm dev:web` → "Book Viewer" → escolha um livro. O desenho deve bater com o jogo, pixel a pixel.

**No jogo** (pendências **[a validar]**):
1. `candles`, página 31: a página deve terminar em "determinação". As linhas "crescendo a cada" e "passo. O som do piano" ficam escondidas (a página tem 16 linhas; provavelmente foi colada pelo Stendhal).
2. Cor depois de `§r` numa linha que continuou: num Livro e Pena, escreva `§cvermelho §r` seguido de texto sem cor até quebrar a linha; assine ou ponha num atril e veja a cor da segunda linha (preta ou branca com sombra?).
3. Abrir `two_birds` no jogo e conferir uma página com `§\n` (a quebra escondida).

---

## 9. Arquivos

| Arquivo | O que faz |
|---|---|
| `packages/shared/src/format/decompose.ts` | códigos `§` (§2) |
| `packages/shared/src/format/style.ts` | estilos e cores (§2) |
| `packages/shared/src/font/metrics.ts` | larguras (§3) |
| `packages/shared/src/font/glyph-metrics.generated.ts` | tabela de larguras gerada |
| `packages/shared/src/layout/lines.ts` | quebra de linha e limites (§4 e §5) |
| `packages/shared/src/layout/page.ts` | posição de cada glifo (§6) |
| `packages/shared/src/stendhal/stendhal.ts` | formato `.stendhal` (§7) |
| `apps/web/src/book/render.ts` | desenho no canvas (§6) |
| `scripts/extract-font-metrics.mjs` | gera a tabela de larguras a partir do jogo instalado |
| `scripts/reference-pack.mjs` | monta o pacote de referência local |
