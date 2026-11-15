// Gera o recorte da GNU Unifont usado pelo site (documento 05): os glifos que o jogo tira da Unifont
// (emojis, ✮, ☼, ❈...), baixados do projeto GNU, em assets/pack/font/unifont-{common,extra}.bin.
// A Unifont tem licença livre (SIL OFL 1.1 / GPL com exceção de fonte); a licença vai junto.
//
// Uso: pnpm font:unifont [--version 17.0.01] [--hex <unifont_all-*.hex(.gz) já baixado>]
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import zlib from 'node:zlib'
import { GLYPH_KIND, glyphAdvance, glyphKind } from '../packages/shared/src/index.ts'
import {
  encodeUnifontSubset,
  parseUnihex,
  unifontAdvance,
  unifontPart,
} from '../packages/shared/src/font/unifont.ts'

const { values } = parseArgs({
  options: {
    version: { type: 'string', default: '17.0.01' },
    hex: { type: 'string' },
  },
})
const VERSION = values.version
const OUT_DIR = path.resolve(import.meta.dirname, '../assets/pack/font')
const HEX_URL = `https://unifoundry.com/pub/unifont/unifont-${VERSION}/font-builds/unifont_all-${VERSION}.hex.gz`
const LICENSE_URL = 'https://unifoundry.com/LICENSE.txt'

async function download(url) {
  console.log(`Baixando ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const raw = values.hex ? fs.readFileSync(values.hex) : await download(HEX_URL)
const sha256 = crypto.createHash('sha256').update(raw).digest('hex')
const hexText = (raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('ascii')

const hexByCodePoint = new Map()
for (const line of hexText.split('\n')) {
  const colon = line.indexOf(':')
  if (colon > 0) hexByCodePoint.set(parseInt(line.slice(0, colon), 16), line.slice(colon + 1).trim())
}

// Só os caracteres que o jogo desenha com a Unifont, conferindo a largura com a tabela de métricas
const parts = { common: new Map(), extra: new Map() }
const problems = []
for (let cp = 0; cp < 0x110000; cp++) {
  if (glyphKind(cp) !== GLYPH_KIND.unifont) continue
  const label = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
  const hex = hexByCodePoint.get(cp)
  const glyph = hex ? parseUnihex(cp, hex) : null
  if (!glyph) {
    problems.push(`${label}: não está na Unifont ${VERSION}`)
    continue
  }
  if (unifontAdvance(glyph) !== glyphAdvance(cp)) {
    problems.push(`${label}: avanço ${unifontAdvance(glyph)}, a tabela do jogo diz ${glyphAdvance(cp)}`)
    continue
  }
  parts[unifontPart(cp)].set(cp, glyph)
}
if (problems.length > 0) {
  console.error(`${problems.length} problemas:\n${problems.slice(0, 50).join('\n')}`)
  process.exit(1)
}

for (const [part, glyphs] of Object.entries(parts)) {
  const file = path.join(OUT_DIR, `unifont-${part}.bin`)
  const data = zlib.gzipSync(encodeUnifontSubset(glyphs), { level: 9 })
  fs.writeFileSync(file, data)
  console.log(`${path.relative(process.cwd(), file)}: ${glyphs.size} glifos, ${data.length} bytes`)
}

const license = (await download(LICENSE_URL)).toString('utf8')
fs.writeFileSync(
  path.join(OUT_DIR, 'UNIFONT-LICENSE.txt'),
  `unifont-common.bin e unifont-extra.bin são um recorte da GNU Unifont ${VERSION}
(https://unifoundry.com/unifont/), feito por scripts/unifont-subset.mjs: só os glifos que o
Minecraft desenha com a Unifont, num formato binário compactado com gzip. Os desenhos não foram
alterados. Origem: ${values.hex ? path.basename(values.hex) : HEX_URL}
(sha256 ${sha256}).

A licença da Unifont, copiada de ${LICENSE_URL}, segue abaixo.

${license}`,
)
console.log(`Licença em ${path.relative(process.cwd(), path.join(OUT_DIR, 'UNIFONT-LICENSE.txt'))}`)
