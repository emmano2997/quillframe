export { BOOK, javaLength, LIMITS } from './constants.ts'
export { COLOR_CODES, COLORS, type ColorCode, type ColorInfo } from './format/colors.ts'
export {
  iterateFormatted,
  REPLACEMENT_CHARACTER,
  SECTION_SIGN,
  stripFormatting,
  type FormattedCharSink,
} from './format/decompose.ts'
export {
  applyFormatCode,
  EMPTY_STYLE,
  isColorCode,
  PAGE_STYLE,
  sameStyle,
  toFormatCode,
  type FormatCode,
  type StyleCode,
  type TextStyle,
} from './format/style.ts'
export { GLYPH_METRICS_GAME_VERSION } from './font/glyph-metrics.generated.ts'
export { GLYPH_KIND, glyphAdvance, glyphKind, type GlyphKind } from './font/metrics.ts'
export {
  editorLines,
  fitsInGamePage,
  readerLines,
  splitLines,
  type SplitOptions,
  type TextLine,
} from './layout/lines.ts'
export { layoutPage, type PageLayout, type PageLine, type PlacedGlyph } from './layout/page.ts'
export {
  parseStendhal,
  serializeStendhal,
  StendhalFormatError,
  stendhalIssues,
  type StendhalBook,
} from './stendhal/stendhal.ts'
