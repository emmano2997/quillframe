# 01 — Referência: o livro do Minecraft e o mod Stendhal

> Documento de referência do projeto. Descreve como o livro funciona no Minecraft (Java Edition) e no mod Stendhal, para que o site reproduza esse comportamento fielmente.
>
> Legenda de confiança:
> - **[confirmado]**: verificado em fonte (wiki oficial, constantes do código do jogo ou os arquivos do autor).
> - **[inferido]**: deduzido dos arquivos `.stendhal` do autor.
> - **[a validar]**: conhecido de memória ou de fonte secundária. Precisa ser testado no jogo antes de virar regra.

---

## 1. Os dois itens

| Item | ID | O que é |
|---|---|---|
| Livro e Pena | `writable_book` | Livro editável. Abre a tela de edição. |
| Livro Escrito | `written_book` | Livro assinado, somente leitura. Abre a tela de leitura. |

O fluxo no jogo é: **Livro e Pena → (Assinar) → Livro Escrito**. Depois de assinado, o livro não pode mais ser editado. **[confirmado]**

### Assinatura
- O jogador escolhe um **título** na tela de assinatura. O **autor** é o nome do jogador (no Java não dá para mudar). **[confirmado]**
- Limite do título na tela de assinatura (Java): **15 caracteres**. Via comando/componente (1.20.5+), o título aceita até **32**. **[confirmado / fontes divergem → a validar]**
- A tela avisa que, depois de assinado, o livro não poderá mais ser editado. **[confirmado]**

### Gerações (cópias)
| Valor | Nome |
|---|---|
| 0 | Original |
| 1 | Cópia do original |
| 2 | Cópia da cópia |
| 3 | Esfarrapado (não usado no jogo normal) |

Copiar = Livro e Pena + Livro Escrito na bancada. O original não é consumido. Só dá para copiar as gerações 0 e 1. **[confirmado]**

> 💡 Isso pode virar uma mecânica social no site: "fazer cópia" de um livro de outra pessoa, com geração exibida.

---

## 2. Limites (Java Edition)

| Limite | Valor | Fonte |
|---|---|---|
| Páginas por livro (Livro e Pena) | **100** (era 50 até a 1.14) | [confirmado] |
| Caracteres por página | **1023/1024** | [confirmado] |
| Linhas visíveis por página | **14** | [confirmado] |
| Largura útil da linha | **114 px** | [confirmado: `MAX_TEXT_WIDTH = 114`] |
| Altura útil do texto | **128 px** (128 ÷ 9 = 14 linhas) | [confirmado: `MAX_TEXT_HEIGHT = 128`] |
| Altura da linha | **9 px** (glifo de 8 + 1 de espaçamento) | [a validar] |
| Páginas do Livro Escrito | sem limite desde a 1.20.5 | [confirmado] |

Para comparação, o **Bedrock** usa 50 páginas, 256 caracteres por página e 121 px de largura. **Este projeto segue o Java**: os livros do autor usam `§n` (sublinhado), que só existe no Java, e foram escritos para 114 px.

> ⚠️ O Stendhal mostra um contador de caracteres pensando no limite antigo de **256**. Precisamos decidir qual limite o site aplica (ver §8).

---

## 3. A tela do livro (geometria)

Constantes do código do jogo (`BookScreen` / `BookEditScreen`, Yarn 1.21.4): **[confirmado]**

| Constante | Valor | Significado |
|---|---|---|
| `WIDTH` × `HEIGHT` | 192 × 192 | Tamanho da imagem do livro |
| textura | 256 × 256 | Arquivo da textura (o livro ocupa 192×192) |
| `MAX_TEXT_WIDTH` | 114 | Largura do texto |
| `MAX_TEXT_HEIGHT` | 128 | Altura do texto |
| offset X do texto | 36 | Distância da borda esquerda do livro até o texto |
| offset Y do texto | 30 | Distância do topo do livro até a 1ª linha |
| offset Y do indicador | 16 | Posição vertical de "Página X de Y" |

```
 ┌──────────────── 192 px ────────────────┐
 │                       Página 3 de 50   │ ← y=16, alinhado à direita
 │                                        │
 │    ┌──────── 114 px ────────┐          │ ← y=30
 │ 36 │ linha 1                │          │
 │ px │ ...      (14 linhas)   │ 128 px   │
 │    │ linha 14               │          │
 │    └────────────────────────┘          │
 │       ◄                    ►           │ ← botões de virar página
 └────────────────────────────────────────┘
```

- O texto da página é **preto**, **sem sombra**. **[a validar]**
- Indicador: `book.pageIndicator` = "Page %1$s of %2$s" (pt-BR: "Página %1$s de %2$s"). **[a validar o texto pt-BR]**
- Os botões de virar página ficam embaixo (◄ à esquerda, ► à direita). Posições aproximadas: x=43 e x=116, y≈157. **[a validar]**
- Na leitura, o botão ◄ some na primeira página e o ► some na última. Na edição, o ► na última página **cria uma página nova**. **[a validar]**
- Teclado: PageUp/PageDown viram páginas. **[a validar]**
- Virar a página toca um som (`item.book.page_turn`). **[confirmado]**
- Tela de edição: botões **"Assinar"** e **"Concluído"**. Tela de assinatura: campo do título, "por \<autor\>", **"Assinar e fechar"** e **"Cancelar"**. **[a validar textos]**

O livro é desenhado em pixel art e escalado pela escala da GUI (1×, 2×, 3×…). No site, renderizar em **pixels inteiros** (por exemplo, canvas 192×192 escalado ×2/×3 com `image-rendering: pixelated`) garante que a arte ASCII fique idêntica.

---

## 4. A fonte, a parte crítica

A arte ASCII do autor depende da **largura exata de cada caractere**. A fonte padrão do Minecraft é bitmap e tem **largura variável**.

### Regras **[confirmado]**
- Altura do glifo: **8 px** (ascent 7, descida 1).
- **Avanço = largura da tinta + 1 px de espaçamento.** A largura é medida pela parte desenhada do glifo.
- **Espaço = 4 px.**
- **Negrito (`§l`)**: desenha o glifo duas vezes, a segunda deslocada 1 px para a direita, e o avanço ganha **+1 px**.
- `§` tem largura **0**.

### Tabela de larguras (tinta → avanço)
Fonte: tabela completa dos glifos do pacote padrão (1.19.3), com mais de 1000 entradas, em
<https://gist.github.com/aerulion/9c5aac21c3efa5aa03b6f875dbe808de>. Vamos importá-la como dado do projeto.

| Caracteres | Tinta | Avanço |
|---|---|---|
| `! ' , . : ; \|` `i` | 1 | **2** |
| `` ` `` `l` | 2 | **3** |
| `" ( ) * [ ] I t` espaço | 3 | **4** |
| `< > f k` | 4 | **5** |
| a maioria das letras e dígitos (`a b A M 0-9`…) | 5 | **6** |
| `@ ~` | 6 | **7** |

Exemplo: a linha `i i i i` (4 × 2 + 3 × 4 = 20 px) ocupa bem menos que `M M M M` (4 × 6 + 3 × 4 = 36 px). Por isso uma fonte monoespaçada **quebra** a arte.

### Caracteres fora da fonte bitmap → GNU Unifont **[confirmado]**
Símbolos que não existem na fonte principal, como `☼ ✮ ☄ ❈ ★ ☺` e emojis (`💔 📞 💋 🌍 💍 ✋ ⛔`), caem para a **GNU Unifont** (atualizada para a 16.0/17.0 nas versões 1.21.x).
- São desenhados em **8 px de altura** (a Unifont tem 16 px, então fica em meia escala). **[a validar]**
- São **monocromáticos e pintados com a cor do texto**. Por isso `§4💔` aparece vermelho-escuro no jogo. **No site, os emojis NÃO podem aparecer coloridos como no celular.** **[confirmado: o jogo não suporta modificadores nem apresentação de emoji]**
- Modificadores (tom de pele, ZWJ) não funcionam.

---

## 5. Quebra de linha

Como o jogo distribui o texto nas 14 linhas:

1. `\n` (Enter) força uma quebra. **[confirmado]**
2. O texto é medido em pixels, somando os avanços, até passar de **114 px**. **[confirmado]**
3. Ao estourar, a linha é cortada **no último espaço** que coube, e esse espaço é consumido. Se a palavra sozinha for maior que a linha, ela é cortada no meio. **[a validar]**
4. Linhas além da 14ª não aparecem. Na edição, o jogo impede digitar além disso. **[a validar]**

**Isso explica a técnica do autor.** Em `"You can say that we    are nothing"`, os espaços extras completam a linha até 114 px para que "are" vá para a linha de baixo exatamente onde ele quer. O mesmo vale para `"Fará com que buracos negros"` e para os desenhos que continuam em linhas longas (`o sol e a lua`, página 1). **O motor de quebra do site precisa ser idêntico ao do jogo**, senão esses livros desmontam.

> ✅ Os 4 livros do autor (162 páginas no total) servem como **casos de teste**: cada página renderizada no site deve bater com um print do jogo.

---

## 6. Códigos de formatação `§`

### Cores (Java) **[confirmado]**
| Código | Nome | Cor |
|---|---|---|
| `§0` | black | `#000000` |
| `§1` | dark_blue | `#0000AA` |
| `§2` | dark_green | `#00AA00` |
| `§3` | dark_aqua | `#00AAAA` |
| `§4` | dark_red | `#AA0000` |
| `§5` | dark_purple | `#AA00AA` |
| `§6` | gold | `#FFAA00` |
| `§7` | gray | `#AAAAAA` |
| `§8` | dark_gray | `#555555` |
| `§9` | blue | `#5555FF` |
| `§a` | green | `#55FF55` |
| `§b` | aqua | `#55FFFF` |
| `§c` | red | `#FF5555` |
| `§d` | light_purple | `#FF55FF` |
| `§e` | yellow | `#FFFF55` |
| `§f` | white | `#FFFFFF` |

### Estilos **[confirmado]**
| Código | Efeito |
|---|---|
| `§k` | Ofuscado: troca o caractere a cada frame por outro aleatório **da mesma largura** |
| `§l` | Negrito (+1 px por caractere) |
| `§m` | Riscado |
| `§n` | Sublinhado |
| `§o` | Itálico |
| `§r` | Reset: volta ao estilo padrão da página (**preto**, sem estilos) |

### Regras de interpretação (Java)
- **Uma cor apaga os estilos ativos.** Em `§l§cX`, o X fica vermelho **sem** negrito. Já `§c§lX` fica vermelho **e** negrito. Para combinar cor e estilo, a cor vem primeiro. No Bedrock é diferente: os estilos continuam depois da cor. **[confirmado]**
- Os códigos **não ocupam espaço** e não contam para a largura. Contam, porém, para o limite de caracteres. **[confirmado]**
- **Código inválido** (`§` seguido de caractere que não é código): o `§` **e** o caractere seguinte somem da tela. **[a validar]** Isso aparece nos livros do autor:

| Ocorrência | Onde | Efeito esperado |
|---|---|---|
| `§ ` (§ + espaço), 28× | good_luck, palhaço, sol e lua | esconde 1 espaço, o que muda o alinhamento |
| `§§` | good_luck (globo, cama) | esconde o par |
| `§/`, `§,` | good_luck (globo) | esconde o caractere |
| `§i` | candles (título) | esconde o "i" no Java (no Bedrock é uma cor) |

O site deve reproduzir isso exatamente, ou a arte desses frames fica 1 caractere deslocada.

### No jogo atual
- O Minecraft vanilla **não deixa digitar** `§` no Livro e Pena (desde a 1.14, e a 1.21.6 também bloqueou colar). É exatamente o que o Stendhal resolve. **[confirmado / fontes divergem sobre a versão]**

---

## 7. O mod Stendhal

- Mod **client-side para Fabric**, de código fechado. Licença **CC-BY-NC-ND-4.0**. Suporta da 1.16.5 até as versões atuais (26.x). **[confirmado]**
- Não vamos usar código nem arte do mod. Reproduzimos apenas o **comportamento** e a **compatibilidade com o formato de arquivo**.

### Funcionalidades do Stendhal que o editor do site deve ter **[confirmado]**
**Livro e Pena (edição)**
- Barra de formatação com as **16 cores** e os **estilos** (`§k §l §m §n §o §r`).
- **Remover a formatação** da página com um clique.
- Copiar, colar e limpar a **página**.
- Copiar, colar e limpar o **livro inteiro**.
- **Adicionar e remover páginas** com um clique.
- **Contador de caracteres** no rodapé de cada página.
- **Seletor de Unicode/emotes**: os caracteres suportados pela fonte do jogo, mais de 70 favoritos.
- **Importar e exportar** livros como arquivos.

**Livro Escrito (leitura)**
- **Índice de páginas** (pular para qualquer página).
- **Busca** de texto no livro.
- **Exportar** um livro assinado para reutilizar o conteúdo num Livro e Pena.

### Formato `.stendhal` **[inferido dos arquivos do autor]**
O formato não tem documentação pública. Esta especificação foi deduzida dos 4 arquivos:

```
title: <título>
author: <autor>
pages:
#- <conteúdo da página 1, linha 1>
<linha 2>
...
#- <conteúdo da página 2>
...
#- 
```

- Codificação **UTF-8**.
- Cabeçalho com 3 linhas fixas: `title:`, `author:` e `pages:`.
- Cada página começa numa linha iniciada por **`#- `** (cerquilha, hífen, espaço). O conteúdo começa logo depois do prefixo e continua nas linhas seguintes até o próximo `#-`.
- As quebras de linha dentro da página são `\n` reais.
- Os códigos de formatação ficam embutidos no texto com `§`.
- `#- ` seguido de linha vazia representa uma página que começa com quebra de linha ou uma página vazia. Todos os arquivos terminam com uma página vazia `#- `.
- **[a validar]**: se a quebra de linha antes do próximo `#-` faz parte da página ou é só separador, e se o espaço depois de `#-` é obrigatório. Isso se testa exportando no jogo uma página com `\n` no final e outra que começa com espaço.

---

## 8. Decisões

| # | Decisão | Status | Definição |
|---|---|---|---|
| D1 | Regras de qual edição | ✅ decidido | **Java Edition** |
| D2 | Caracteres por página | ✅ decidido | **1024** (limite atual do Java). O contador mostra `n/1024` |
| D3 | Páginas por livro | ✅ decidido | Padrão de **100**, mas o escritor **pode passar**. Ao passar, aparece o aviso: *"Este livro tem mais de 100 páginas e não poderá ser importado no jogo"* |
| D4 | Título e autor | ✅ decidido | O título pode ser **maior que no jogo** (proposta: até 64). O **autor é sempre o nome da conta** do usuário e aparece junto ao título ("*Título* por *conta*"), como no jogo. Acima de 15 caracteres, aparece o aviso de que o título será cortado na assinatura dentro do jogo |
| D5 | Fonte | ✅ decidido | **Fonte própria em pixel art**, com **as mesmas larguras e métricas** do Minecraft (avanço, espaço de 4 px, altura 8, linha 9). Os caracteres fora dela usam a **GNU Unifont** (licença livre), igual ao jogo |
| D6 | Textura do livro, botões e som | ✅ decidido | **Arte própria inspirada no original**: mesmas dimensões (192×192, área de texto 114×128), mesmo estilo pixel art e mesma sensação, mas desenhada pelo projeto |
| D7 | Assinar = travar edição? | ✅ decidido | **Trava**, igual ao jogo. Depois de assinado, o livro vira somente leitura |

### Assets: recriados, com o original como referência (D5/D6)
- **Nada da Mojang entra no repositório nem no site.** O original serve só como **referência visual** durante o desenho.
- Para consulta, o `.jar` da versão instalada (`%APPDATA%\.minecraft\versions\1.21.11\1.21.11.jar`) contém `assets/minecraft/textures/gui/book.png` e `textures/font/`.
- **O que precisa ser idêntico:** dimensões, posições (seção 3) e **larguras dos caracteres** (seção 4). Essas são medidas, e são o que mantém a arte ASCII dos livros alinhada.
- **O que é recriado:** o desenho do pergaminho, as setas, os glifos da fonte e o som de virar a página.
- Todo o visual fica numa pasta de **pacote de recursos** (`assets/pack/`), para facilitar ajustes e temas futuros.
- O nome do projeto é **quillframe**, sem "Minecraft". O site exibe o aviso: *"Não é um produto oficial do Minecraft. Não é aprovado nem associado à Mojang ou à Microsoft."*

### Livros existentes do autor
A pasta do Stendhal fica em `%APPDATA%\.minecraft\config\stendhal\books\` e hoje tem **11 livros**: candles, good_luck, links, magnolia, magnolia_pt-br, novo_vem_comigo, o_sol_e_a_lua, palhaco, partitura, two_birds e vem_comigo. Eles serão o **acervo inicial e o conjunto de testes** do importador.

---

## 9. Recursos do site que vão além do jogo (registro)
- **Modo animação (play)**: virar as páginas automaticamente com velocidade configurável, porque o livro é uma animação quadro a quadro.
- **Biblioteca na nuvem + exportar `.stendhal`**, para que nenhum livro se perca.
- **Social**: conta, favoritos, likes, comentários predefinidos e amizades. Será detalhado no documento 02.

---

## Fontes
- Minecraft Wiki: [Book and Quill](https://minecraft.wiki/w/Book_and_Quill), [Written Book](https://minecraft.wiki/w/Written_Book), [Formatting codes](https://minecraft.wiki/w/Formatting_codes), [Font](https://minecraft.wiki/w/Font)
- Constantes do código: [Yarn 1.21.4, Constant Field Values](https://maven.fabricmc.net/docs/yarn-1.21.4+build.5/constant-values.html) (`BookScreen`, `BookEditScreen`)
- Larguras dos glifos: [gist aerulion/BitmapGlyphInfo](https://gist.github.com/aerulion/9c5aac21c3efa5aa03b6f875dbe808de) (via [fórum PaperMC](https://forums.papermc.io/threads/minecraft-default-bitmap-font-glyph-widths.624))
- Stendhal: [Modrinth](https://modrinth.com/mod/stendhal)
- Bug do `§` no Livro e Pena: [MC-159666](https://bugs.mojang.com/browse/MC-159666)
- Arquivos do autor: `good_luck`, `o_sol_e_a_lua`, `palhaco` e `candles` (`.stendhal`)
