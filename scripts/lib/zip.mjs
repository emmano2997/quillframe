// Leitor mínimo de arquivos ZIP (o .jar do jogo e o unifont.zip), sem dependências.
import fs from 'node:fs'
import zlib from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

// `source`: caminho do arquivo ou o conteúdo já carregado (Buffer)
export function openZip(source) {
  const buf = Buffer.isBuffer(source) ? source : fs.readFileSync(source)
  const filePath = Buffer.isBuffer(source) ? '(buffer)' : source
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`ZIP inválido: ${filePath}`)

  const count = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || pos === 0xffffffff) throw new Error(`ZIP64 não suportado: ${filePath}`)

  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== CENTRAL_SIGNATURE)
      throw new Error(`Diretório central inválido em ${filePath}`)
    const method = buf.readUInt16LE(pos + 10)
    const compressedSize = buf.readUInt32LE(pos + 20)
    const nameLength = buf.readUInt16LE(pos + 28)
    const extraLength = buf.readUInt16LE(pos + 30)
    const commentLength = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLength)
    entries.set(name, { method, compressedSize, localOffset })
    pos += 46 + nameLength + extraLength + commentLength
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const entry = entries.get(name)
      if (!entry) throw new Error(`Arquivo ${name} não existe em ${filePath}`)
      const local = entry.localOffset
      if (buf.readUInt32LE(local) !== LOCAL_SIGNATURE) throw new Error(`Cabeçalho local inválido: ${name}`)
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + entry.compressedSize)
      if (entry.method === 0) return Buffer.from(data)
      if (entry.method === 8) return zlib.inflateRawSync(data)
      throw new Error(`Compressão ${entry.method} não suportada: ${name}`)
    },
  }
}
