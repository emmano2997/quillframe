// Gera packages/shared/src/font/glyph-metrics.generated.ts a partir da instalação local do Minecraft.
// Grava só medidas (o avanço de cada caractere), nunca a arte do jogo (documento 01, D6).
//
// Uso: pnpm font:metrics [--minecraft-dir <pasta>] [--version 26.3] [--sample "texto"]
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  defaultMinecraftDir,
  KIND,
  loadDefaultFont,
  MISSING_ADVANCE,
  openGameAssets,
} from './lib/minecraft-font.mjs'

const MAX_CODEPOINT = 0x110000

const { values } = parseArgs({
  options: {
    'minecraft-dir': { type: 'string', default: defaultMinecraftDir() },
    version: { type: 'string', default: '26.3' },
    sample: { type: 'string' },
    out: {
      type: 'string',
      default: path.resolve(import.meta.dirname, '../packages/shared/src/font/glyph-metrics.generated.ts'),
    },
  },
})
const OUTPUT = path.resolve(values.out)

const assets = openGameAssets(values['minecraft-dir'], values.version)
const font = loadDefaultFont(assets)
const kindName = Object.fromEntries(Object.entries(KIND).map(([name, id]) => [id, name]))

if (values.sample) {
  for (const ch of values.sample) {
    const cp = ch.codePointAt(0)
    const hit = font.lookup(cp)
    const label = hit
      ? `${hit.provider.type}${hit.provider.file ? ` (${hit.provider.file})` : ''}`
      : 'missing'
    console.log(
      `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${ch}  avanço ${hit ? hit.glyph.advance : MISSING_ADVANCE}  ${label}`,
    )
  }
  process.exit(0)
}

// Uma posição por caractere: (tipo << 5) | avanço
const table = new Uint8Array(MAX_CODEPOINT)
const counts = { missing: 0, space: 0, bitmap: 0, unifont: 0 }
for (let cp = 0; cp < MAX_CODEPOINT; cp++) {
  const hit = font.lookup(cp)
  const kind = hit ? hit.glyph.kind : KIND.missing
  const advance = hit ? hit.glyph.advance : MISSING_ADVANCE
  if (advance < 0 || advance > 31)
    throw new Error(`Avanço fora do intervalo em U+${cp.toString(16)}: ${advance}`)
  table[cp] = (kind << 5) | advance
  counts[kindName[kind]]++
}

// Codificação por trechos repetidos (RLE): [valor][quantidade em varint]
const bytes = []
for (let start = 0; start < MAX_CODEPOINT;) {
  let end = start + 1
  while (end < MAX_CODEPOINT && table[end] === table[start]) end++
  bytes.push(table[start])
  for (let count = end - start; ;) {
    const low = count & 0x7f
    count >>>= 7
    if (count === 0) {
      bytes.push(low)
      break
    }
    bytes.push(low | 0x80)
  }
  start = end
}
const base64 = Buffer.from(bytes).toString('base64')
const chunks = base64.match(/.{1,100}/g) ?? []

const versionMeta = JSON.parse(
  fs.readFileSync(
    path.join(values['minecraft-dir'], 'versions', values.version, `${values.version}.json`),
    'utf8',
  ),
)
const sources = font.providers.map((p) =>
  p.type === 'space' ? 'space (font/include/space.json)' : `${p.type}: ${p.source}`,
)

const content = `// Gerado por scripts/extract-font-metrics.mjs. Não edite à mão: rode \`pnpm font:metrics\`.
//
// Avanço (largura em pixels) de cada caractere na fonte padrão do Minecraft Java ${values.version},
// medido a partir da instalação local do jogo. Contém só números, nenhuma arte (documento 01, D6).
//
// Cliente: ${values.version} (sha1 ${versionMeta.downloads.client.sha1})
// Provedores, na ordem do jogo:
${sources.map((s) => `//   - ${s}`).join('\n')}
// Caracteres por tipo: bitmap ${counts.bitmap}, unifont ${counts.unifont}, space ${counts.space}, sem glifo ${counts.missing}

export const GLYPH_METRICS_GAME_VERSION = '${values.version}'

// RLE em base64: pares [valor][quantidade em varint] cobrindo U+0000 a U+10FFFF.
// valor = (tipo << 5) | avanço; tipo: 0 sem glifo, 1 space, 2 bitmap, 3 unifont.
export const GLYPH_METRICS_RLE = [
${chunks.map((c) => `  '${c}',`).join('\n')}
].join('')
`
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
fs.writeFileSync(OUTPUT, content)
console.log(
  `Gerado ${path.relative(process.cwd(), OUTPUT)}: ${bytes.length} bytes de RLE (${base64.length} em base64)`,
)
console.log(counts)
