// ZIP mínimo, sem compressão (método "stored"), para a exportação de dados (documento 02, §7.4).
// Os arquivos são texto pequeno; escrever o formato à mão evita mais uma dependência.
import { crc32 } from 'node:zlib'

export interface ZipEntry {
  /** Caminho dentro do ZIP, só com caracteres seguros */
  name: string
  data: Buffer
}

export function zip(entries: readonly ZipEntry[], date: Date = new Date()): Buffer {
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1)
  const dosDate = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versão necessária
    local.writeUInt16LE(0x0800, 6) // nomes em UTF-8
    local.writeUInt16LE(0, 8) // sem compressão
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, entry.data)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(dosTime, 12)
    header.writeUInt16LE(dosDate, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(entry.data.length, 20)
    header.writeUInt32LE(entry.data.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)
    offset += local.length + name.length + entry.data.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}
