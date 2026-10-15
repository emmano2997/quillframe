// Medidas e limites do livro, confirmados no código do Minecraft Java 26.3 (documento 04).

/** Geometria da tela do livro, em pixels de GUI (BookViewScreen). */
export const BOOK = {
  imageWidth: 192,
  imageHeight: 192,
  textX: 36,
  textY: 30,
  textWidth: 114,
  textHeight: 128,
  lineHeight: 9,
  maxLines: 14,
  pageIndicatorRightX: 148,
  pageIndicatorY: 16,
  pageButtonY: 157,
  pageBackButtonX: 43,
  pageForwardButtonX: 116,
} as const

export const LIMITS = {
  /** Caracteres por página, contados como String.length do Java (unidades UTF-16) */
  pageChars: 1024,
  /** Páginas de um Livro e Pena no jogo; o site deixa passar com aviso (documento 01, D3) */
  gamePages: 100,
  /** Limite rígido do site (documento 02, B14) */
  sitePages: 1000,
  /** Título no site (documento 01, D4) */
  titleChars: 64,
  /** Título na tela de assinatura do jogo; acima disso é cortado */
  gameTitleChars: 15,
} as const

/** Tamanho de um texto do jeito que o jogo conta: unidades UTF-16, como o JavaScript. */
export function javaLength(text: string): number {
  return text.length
}
