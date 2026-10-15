// Decodificador mínimo de PNG (sem entrelaçamento), suficiente para as folhas de fonte.
// Devolve, para cada pixel, o valor que o jogo usa para medir a tinta do glifo:
// o canal alfa quando existe; senão, a luminância (NativeImage.getLuminanceOrAlpha).
import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Não é um PNG')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let palette = null
  let transparency = null
  const idat = []
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('PNG entrelaçado não suportado')
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') transparency = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + length
  }

  const channels = CHANNELS[colorType]
  if (channels === undefined) throw new Error(`Tipo de cor ${colorType} não suportado`)
  const bitsPerPixel = channels * bitDepth
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3)
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bytesPerPixel ? out[i - bytesPerPixel] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bytesPerPixel ? prev[i - bytesPerPixel] : 0
      let value = src[i]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`Filtro PNG ${filter} inválido`)
      out[i] = value & 0xff
    }
  }

  const sample = (x, y, channel) => {
    if (bitDepth === 8) return pixels[y * stride + x * channels + channel]
    if (bitDepth === 16) return pixels[y * stride + (x * channels + channel) * 2]
    const bitIndex = x * bitsPerPixel
    const byte = pixels[y * stride + (bitIndex >> 3)]
    const shift = 8 - bitDepth - (bitIndex & 7)
    return (byte >> shift) & ((1 << bitDepth) - 1)
  }

  // Valor de "tinta" por pixel: alfa se existir, senão luminância
  const ink = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value
      if (colorType === 6) value = sample(x, y, 3)
      else if (colorType === 4) value = sample(x, y, 1)
      else if (colorType === 3) {
        // Paleta: só dá para medir a tinta se houver transparência (tRNS), como no jogo
        if (!transparency || !palette) throw new Error('PNG com paleta e sem transparência não é suportado')
        const index = sample(x, y, 0)
        value = index < transparency.length ? transparency[index] : 255
      } else value = sample(x, y, 0)
      ink[y * width + x] = value
    }
  }
  return { width, height, ink }
}
