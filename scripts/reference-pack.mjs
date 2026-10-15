// Monta o "pacote de referência": a fonte e a textura do livro do jogo, copiadas da sua instalação
// local do Minecraft para .reference-pack/ (fora do Git). Serve só para comparar, no navegador, o
// desenho do site com o do jogo enquanto a arte própria não existe (documento 01, D6; documento 03, F15).
// Nada daqui vai para o repositório nem para o site publicado.
//
// Uso: pnpm reference-pack [--minecraft-dir <pasta>] [--version 26.3]
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { defaultMinecraftDir, loadDefaultFont, openGameAssets } from './lib/minecraft-font.mjs'
import { openZip } from './lib/zip.mjs'

const OUT = path.resolve(import.meta.dirname, '../.reference-pack')

const { values } = parseArgs({
  options: {
    'minecraft-dir': { type: 'string', default: defaultMinecraftDir() },
    version: { type: 'string', default: '26.3' },
  },
})

const assets = openGameAssets(values['minecraft-dir'], values.version)
const font = loadDefaultFont(assets)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'font'), { recursive: true })

const providers = []
for (const provider of font.providers) {
  if (provider.type === 'space') {
    providers.push({ type: 'space' })
  } else if (provider.type === 'bitmap') {
    const target = `font/${path.basename(provider.file)}`
    fs.writeFileSync(path.join(OUT, target), assets.read(`minecraft:textures/${provider.file}`).data)
    const glyphs = {}
    for (const [cp, glyph] of provider.glyphs) glyphs[cp] = [glyph.column, glyph.row]
    providers.push({
      type: 'bitmap',
      file: target,
      cellWidth: provider.cellWidth,
      cellHeight: provider.cellHeight,
      ascent: provider.ascent,
      scale: provider.scale,
      glyphs,
    })
  } else if (provider.type === 'unihex') {
    const zip = openZip(assets.read('minecraft:font/unifont.zip').data)
    fs.writeFileSync(path.join(OUT, 'font/unifont.hex'), zip.read(provider.hexName))
    fs.writeFileSync(path.join(OUT, 'font/UNIFONT-LICENSE.txt'), zip.read('LICENSE.txt'))
    // Larguras já ajustadas (size_overrides incluídos), para o navegador não recalcular
    const bounds = {}
    for (const [cp, glyph] of provider.glyphs) bounds[cp] = [glyph.left, glyph.right]
    providers.push({ type: 'unihex', file: 'font/unifont.hex', bounds })
  }
}

fs.writeFileSync(path.join(OUT, 'book.png'), assets.read('minecraft:textures/gui/book.png').data)
fs.writeFileSync(path.join(OUT, 'font.json'), JSON.stringify({ gameVersion: values.version, providers }))
console.log(`Pacote de referência criado em ${path.relative(process.cwd(), OUT)} (${values.version})`)
