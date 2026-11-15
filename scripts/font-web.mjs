// Gera a fonte da interface (documento 03, F5) a partir da fonte pixel do projeto:
// assets/pack/font/quillframe.ttf e quillframe.woff2. Cada pixel vira um quadrado; o avanço de cada
// caractere é a largura do jogo. Rode de novo depois de editar quillframe-font.txt.
//
// Uso: pnpm font:web
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { glyphAdvance, parsePixelFont } from '../packages/shared/src/index.ts'
import {
  buildPixelFontTables,
  buildTtf,
  buildWoff2,
  WEB_FONT_OPTIONS,
} from '../packages/shared/src/font/pixel-font-ttf.ts'

const DIR = path.resolve(import.meta.dirname, '../assets/pack/font')
const font = parsePixelFont(fs.readFileSync(path.join(DIR, 'quillframe-font.txt'), 'utf8'))
const tables = buildPixelFontTables(font, { ...WEB_FONT_OPTIONS, advance: (cp) => glyphAdvance(cp) })

const brotli = (data) =>
  zlib.brotliCompressSync(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_FONT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  })

for (const [file, data] of [
  ['quillframe.ttf', buildTtf(tables)],
  ['quillframe.woff2', buildWoff2(tables, brotli)],
]) {
  fs.writeFileSync(path.join(DIR, file), data)
  console.log(`${path.relative(process.cwd(), path.join(DIR, file))}: ${data.length} bytes`)
}
