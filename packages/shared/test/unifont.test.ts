import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  decodeUnifontSubset,
  encodeUnifontSubset,
  GLYPH_KIND,
  glyphAdvance,
  glyphKind,
  parseUnihex,
  unifontAdvance,
  unifontPart,
  type UnifontGlyph,
} from '../src/index.ts'

const root = path.resolve(import.meta.dirname, '../../..')
const fontDir = path.join(root, 'assets/pack/font')
const load = (part: string) =>
  decodeUnifontSubset(zlib.gunzipSync(fs.readFileSync(path.join(fontDir, `unifont-${part}.bin`))))
const parts = { common: load('common'), extra: load('extra') }

const name = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`

describe('recorte da Unifont (assets/pack/font/unifont-*.bin)', () => {
  it('tem todo caractere que o jogo desenha com a Unifont, no arquivo certo, com a largura do jogo', () => {
    const wrong: string[] = []
    for (let cp = 0; cp < 0x110000; cp++) {
      if (glyphKind(cp) !== GLYPH_KIND.unifont) continue
      const glyph = parts[unifontPart(cp)].get(cp)
      if (!glyph) wrong.push(`${name(cp)}: falta no arquivo ${unifontPart(cp)}`)
      else if (unifontAdvance(glyph) !== glyphAdvance(cp))
        wrong.push(
          `${name(cp)}: left ${glyph.left}, right ${glyph.right} → avanço ${unifontAdvance(glyph)}, esperado ${glyphAdvance(cp)}`,
        )
    }
    expect(wrong).toEqual([])
  })

  it('não tem glifos que o jogo não tira da Unifont', () => {
    const extra = [...parts.common.keys(), ...parts.extra.keys()].filter(
      (cp) => glyphKind(cp) !== GLYPH_KIND.unifont,
    )
    expect(extra.map(name)).toEqual([])
  })

  it('tem os emojis e símbolos dos livros (✮ ☼ ❈ 💔 💋)', () => {
    for (const ch of '✮☼❈💔💋') {
      const glyph = parts.common.get(ch.codePointAt(0) ?? 0)
      expect(
        glyph?.rows.some((row) => row !== 0),
        ch,
      ).toBe(true)
    }
  })

  // O pacote de referência local (pnpm reference-pack) traz a Unifont que o jogo usa
  const referenceHex = path.join(root, '.reference-pack/font/unifont.hex')
  it.skipIf(!fs.existsSync(referenceHex))('desenha igual à Unifont do jogo', () => {
    const wrong: string[] = []
    for (const line of fs.readFileSync(referenceHex, 'ascii').split('\n')) {
      const colon = line.indexOf(':')
      if (colon < 0) continue
      const cp = parseInt(line.slice(0, colon), 16)
      if (glyphKind(cp) !== GLYPH_KIND.unifont) continue
      const expected = parseUnihex(cp, line.slice(colon + 1).trim())
      const glyph = parts[unifontPart(cp)].get(cp)
      if (!expected || !glyph) continue
      // Só as colunas left..right aparecem na tela
      const visible = (g: UnifontGlyph) =>
        [...g.rows].map((row) => {
          const width = g.right - g.left + 1
          return width >= 32 ? row >>> g.left : ((row << g.left) >>> (32 - width)) >>> 0
        })
      if (visible(glyph).join() !== visible(expected).join()) wrong.push(name(cp))
    }
    expect(wrong).toEqual([])
  })
})

describe('encodeUnifontSubset / decodeUnifontSubset', () => {
  it('ida e volta, cortando as colunas fora de left..right', () => {
    const glyphs = new Map<number, UnifontGlyph>()
    for (const [cp, hex] of [
      [0x41, '0000000018242442427E424242420000'],
      [0x42, '0000000000000000000000000000000000000000000000000000000000000000'],
      [0x43, '00000000000000000000000000000000'],
      [0x1f494, '00000000000000001E78318C4182408240C2208211040A08061001200040000000'.slice(0, 64)],
    ] as const) {
      const glyph = parseUnihex(cp, hex)
      if (glyph) glyphs.set(cp, glyph)
    }
    const decoded = decodeUnifontSubset(encodeUnifontSubset(glyphs))
    expect([...decoded.keys()]).toEqual([0x41, 0x42, 0x43, 0x1f494])
    for (const [cp, glyph] of glyphs) {
      const back = decoded.get(cp)
      expect(back?.left).toBe(glyph.left)
      expect(back?.right).toBe(glyph.right)
      expect([...(back?.rows ?? [])]).toEqual([...glyph.rows])
    }
  })

  it('mede como o jogo: glifo vazio vai de 0 à largura; size_overrides valem por bloco', () => {
    expect(parseUnihex(0x43, '00000000000000000000000000000000')).toMatchObject({ left: 0, right: 8 })
    expect(parseUnihex(0x41, '0000000018242442427E424242420000')).toMatchObject({ left: 1, right: 6 })
    expect(parseUnihex(0xac00, '0'.repeat(64))).toMatchObject({ left: 1, right: 15 })
  })
})
