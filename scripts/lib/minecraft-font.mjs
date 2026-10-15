// Lê a fonte padrão do jogo a partir de uma instalação local do Minecraft (Java Edition)
// e reproduz como o jogo escolhe o glifo e calcula o avanço de cada caractere.
//
// Regras confirmadas no código do jogo 26.3 (documento 04):
// - provedores na ordem de font/default.json; o primeiro que tiver o caractere vence;
// - bitmap: avanço = trunc(0,5 + tinta × escala) + 1; negrito +1;
// - space: avanço do JSON; negrito +1;
// - unihex (GNU Unifont): avanço = trunc((right − left + 1) / 2) + 1; negrito +0,5;
// - caractere sem glifo: caixa 5×8, avanço 6; negrito +1.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decodePng } from './png.mjs'
import { openZip } from './zip.mjs'

export const KIND = { missing: 0, space: 1, bitmap: 2, unifont: 3 }
export const MISSING_ADVANCE = 6

// Opções de fonte padrão do jogo: "Force Unicode Font" e "Japanese Glyph Variants" desligadas
const DEFAULT_OPTIONS = { uniform: false, jp: false }

export function defaultMinecraftDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? '', '.minecraft')
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft')
  return path.join(os.homedir(), '.minecraft')
}

export function openGameAssets(minecraftDir, version) {
  const versionDir = path.join(minecraftDir, 'versions', version)
  const jarPath = path.join(versionDir, `${version}.jar`)
  const metaPath = path.join(versionDir, `${version}.json`)
  if (!fs.existsSync(jarPath))
    throw new Error(`Não achei ${jarPath}. Abra a versão ${version} no launcher uma vez.`)
  const jar = openZip(jarPath)
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  const indexPath = path.join(minecraftDir, 'assets', 'indexes', `${meta.assetIndex.id}.json`)
  const objects = JSON.parse(fs.readFileSync(indexPath, 'utf8')).objects

  // Recurso "minecraft:font/x.json": o índice de assets tem prioridade sobre o .jar
  const read = (id) => {
    const [namespace, rest] = id.includes(':') ? id.split(':') : ['minecraft', id]
    const key = `${namespace}/${rest}`
    const object = objects[key]
    if (object) {
      const file = path.join(minecraftDir, 'assets', 'objects', object.hash.slice(0, 2), object.hash)
      return { data: fs.readFileSync(file), source: `assets/${key} (${object.hash})` }
    }
    const entry = `assets/${namespace}/${rest}`
    if (jar.has(entry)) return { data: jar.read(entry), source: `${version}.jar/${entry}` }
    throw new Error(`Recurso não encontrado: ${id}`)
  }
  return { version, read }
}

function codepointsOf(text) {
  return [...text].map((ch) => ch.codePointAt(0))
}

function filterMatches(filter) {
  if (!filter) return true
  return Object.entries(filter).every(([option, value]) => DEFAULT_OPTIONS[option] === value)
}

function loadBitmap(assets, def) {
  const file = def.file.replace(/^minecraft:/, '')
  const { data, source } = assets.read(`minecraft:textures/${file}`)
  const image = decodePng(data)
  const grid = def.chars.map(codepointsOf)
  const columns = grid[0].length
  const cellWidth = image.width / columns
  const cellHeight = image.height / grid.length
  const height = def.height ?? 8
  const scale = Math.fround(height / cellHeight)
  const glyphs = new Map()
  grid.forEach((row, rowIndex) => {
    row.forEach((cp, columnIndex) => {
      if (cp === 0) return
      // Tinta: a coluna mais à direita com algum pixel não transparente
      let ink = 0
      for (let x = cellWidth - 1; x >= 0 && ink === 0; x--) {
        for (let y = 0; y < cellHeight; y++) {
          if (image.ink[(rowIndex * cellHeight + y) * image.width + columnIndex * cellWidth + x] !== 0) {
            ink = x + 1
            break
          }
        }
      }
      const advance = Math.trunc(0.5 + Math.fround(ink * scale)) + 1
      if (!glyphs.has(cp)) {
        glyphs.set(cp, { kind: KIND.bitmap, advance, column: columnIndex, row: rowIndex })
      }
    })
  })
  return {
    type: 'bitmap',
    source,
    file,
    image: { width: image.width, height: image.height },
    cellWidth,
    cellHeight,
    height,
    ascent: def.ascent,
    scale,
    glyphs,
  }
}

function loadSpace(def) {
  const glyphs = new Map()
  for (const [ch, advance] of Object.entries(def.advances)) {
    if (!Number.isInteger(advance)) throw new Error(`Avanço fracionário não suportado: ${ch} = ${advance}`)
    glyphs.set(ch.codePointAt(0), { kind: KIND.space, advance })
  }
  return { type: 'space', glyphs }
}

// Uma linha do .hex: "CODEPOINT:BITS", com 8, 16, 24 ou 32 pixels de largura e 16 de altura
export function parseUnihexGlyph(hex) {
  const bitWidth = hex.length / 4
  if (![8, 16, 24, 32].includes(bitWidth)) return null
  const digitsPerRow = bitWidth / 4
  const rows = []
  let mask = 0
  for (let r = 0; r < 16; r++) {
    const value = parseInt(hex.slice(r * digitsPerRow, (r + 1) * digitsPerRow), 16)
    // Linha alinhada à esquerda num inteiro de 32 bits, como no jogo
    const aligned = (value << (32 - bitWidth)) >>> 0
    rows.push(aligned)
    mask = (mask | aligned) >>> 0
  }
  // left = zeros à esquerda; right = 31 − zeros à direita (glifo vazio: 0 e bitWidth, como no jogo)
  const left = mask === 0 ? 0 : Math.clz32(mask)
  const right = mask === 0 ? bitWidth : Math.clz32(mask & -mask)
  return { bitWidth, rows, left, right }
}

function loadUnihex(assets, def) {
  const { data, source } = assets.read(def.hex_file)
  const archive = openZip(data)
  const hexName = archive.names().find((n) => n.endsWith('.hex'))
  const text = archive.read(hexName).toString('ascii')
  const glyphs = new Map()
  const rawGlyphs = new Map()
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const cp = parseInt(line.slice(0, colon), 16)
    const glyph = parseUnihexGlyph(line.slice(colon + 1).trim())
    if (glyph) rawGlyphs.set(cp, glyph)
  }
  // size_overrides valem só para caracteres que existem no arquivo
  for (const override of def.size_overrides ?? []) {
    const from = override.from.codePointAt(0)
    const to = override.to.codePointAt(0)
    for (let cp = from; cp <= to; cp++) {
      const glyph = rawGlyphs.get(cp)
      if (glyph) {
        rawGlyphs.delete(cp)
        glyphs.set(cp, { ...glyph, left: override.left, right: override.right })
      }
    }
  }
  for (const [cp, glyph] of rawGlyphs) glyphs.set(cp, glyph)
  for (const glyph of glyphs.values()) {
    glyph.kind = KIND.unifont
    glyph.advance = Math.trunc((glyph.right - glyph.left + 1) / 2) + 1
  }
  return { type: 'unihex', source, hexName, glyphs }
}

// Monta a lista de provedores da fonte "minecraft:default", na ordem do jogo
export function loadDefaultFont(assets) {
  const providers = []
  const visit = (fontId, filter) => {
    const { data } = assets.read(`minecraft:font/${fontId}.json`)
    for (const def of JSON.parse(data.toString('utf8')).providers) {
      const combined = { ...filter, ...def.filter }
      if (!filterMatches(combined)) continue
      if (def.type === 'reference') visit(def.id.replace(/^minecraft:/, ''), combined)
      else if (def.type === 'bitmap') providers.push(loadBitmap(assets, def))
      else if (def.type === 'space') providers.push(loadSpace(def))
      else if (def.type === 'unihex') providers.push(loadUnihex(assets, def))
      else throw new Error(`Tipo de provedor desconhecido: ${def.type}`)
    }
  }
  visit('default', undefined)

  const lookup = (cp) => {
    for (const provider of providers) {
      const glyph = provider.glyphs.get(cp)
      if (glyph) return { provider, glyph }
    }
    return null
  }
  return { providers, lookup }
}
