import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildPixelFontTables,
  buildTtf,
  TTF_PIXEL_UNITS,
  TTF_UNITS_PER_EM,
  WEB_FONT_OPTIONS,
} from '../src/font/pixel-font-ttf.ts'
import { glyphAdvance, parsePixelFont } from '../src/index.ts'

const fontDir = path.resolve(import.meta.dirname, '../../../assets/pack/font')
const font = parsePixelFont(fs.readFileSync(path.join(fontDir, 'quillframe-font.txt'), 'utf8'))
const tables = buildPixelFontTables(font, { ...WEB_FONT_OPTIONS, advance: (cp) => glyphAdvance(cp) })
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength)

/** Lê o WOFF2: cabeçalho, diretório e as tabelas descomprimidas */
function readWoff2(data: Uint8Array): Map<string, Uint8Array> {
  const KNOWN = [
    'cmap',
    'head',
    'hhea',
    'hmtx',
    'maxp',
    'name',
    'OS/2',
    'post',
    'cvt ',
    'fpgm',
    'glyf',
    'loca',
  ]
  const v = view(data)
  expect(String.fromCharCode(...data.subarray(0, 4))).toBe('wOF2')
  expect(v.getUint32(8)).toBe(data.length)
  const count = v.getUint16(12)
  let pos = 48
  const entries: { tag: string; length: number }[] = []
  for (let i = 0; i < count; i++) {
    const flags = data[pos++] ?? 0
    let tag = KNOWN[flags & 63] ?? ''
    if ((flags & 63) === 63) {
      tag = String.fromCharCode(...data.subarray(pos, pos + 4))
      pos += 4
    }
    let length = 0
    for (let byte = 0x80; byte & 0x80;) {
      byte = data[pos++] ?? 0
      length = length * 128 + (byte & 0x7f)
    }
    entries.push({ tag, length })
  }
  const stream = zlib.brotliDecompressSync(data.subarray(pos, pos + v.getUint32(20)))
  const result = new Map<string, Uint8Array>()
  let offset = 0
  for (const { tag, length } of entries) {
    result.set(tag, new Uint8Array(stream.subarray(offset, offset + length)))
    offset += length
  }
  return result
}

describe('fonte da interface (assets/pack/font/quillframe.ttf e .woff2)', () => {
  it('cada pixel é um quadrado inteiro: unitsPerEm múltiplo de 8', () => {
    expect(TTF_UNITS_PER_EM % 8).toBe(0)
    expect(view(tables.get('head') ?? new Uint8Array()).getUint16(18)).toBe(TTF_UNITS_PER_EM)
  })

  it('o avanço de cada caractere é a largura do jogo', () => {
    // Ordem dos glifos: .notdef e depois os caracteres em ordem de code point
    const codePoints = [...new Set([...font.glyphs.keys(), 0x20])].sort((a, b) => a - b)
    const hmtx = view(tables.get('hmtx') ?? new Uint8Array())
    const wrong = codePoints.filter(
      (cp, i) => hmtx.getUint16((i + 1) * 4) !== glyphAdvance(cp) * TTF_PIXEL_UNITS,
    )
    expect(wrong.map((cp) => String.fromCodePoint(cp))).toEqual([])
  })

  it('os arquivos estão em dia com quillframe-font.txt (senão, rode pnpm font:web)', () => {
    const ttf = new Uint8Array(fs.readFileSync(path.join(fontDir, 'quillframe.ttf')))
    expect(ttf.length).toBe(buildTtf(tables).length)
    expect(Buffer.from(ttf).equals(Buffer.from(buildTtf(tables)))).toBe(true)

    const woff2 = readWoff2(new Uint8Array(fs.readFileSync(path.join(fontDir, 'quillframe.woff2'))))
    expect([...woff2.keys()]).toEqual([...tables.keys()])
    for (const [tag, data] of tables) {
      expect(Buffer.from(woff2.get(tag) ?? []).equals(Buffer.from(data)), tag).toBe(true)
    }
  })
})
