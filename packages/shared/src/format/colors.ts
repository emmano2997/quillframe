// As 16 cores dos códigos § (documento 01, §6).

export const COLOR_CODES = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
] as const

export type ColorCode = (typeof COLOR_CODES)[number]

export interface ColorInfo {
  code: ColorCode
  /** Nome no jogo (ChatFormatting) */
  id: string
  /** Nome exibido na interface, em inglês */
  name: string
  hex: string
}

export const COLORS: Readonly<Record<ColorCode, ColorInfo>> = {
  '0': { code: '0', id: 'black', name: 'Black', hex: '#000000' },
  '1': { code: '1', id: 'dark_blue', name: 'Dark Blue', hex: '#0000AA' },
  '2': { code: '2', id: 'dark_green', name: 'Dark Green', hex: '#00AA00' },
  '3': { code: '3', id: 'dark_aqua', name: 'Dark Aqua', hex: '#00AAAA' },
  '4': { code: '4', id: 'dark_red', name: 'Dark Red', hex: '#AA0000' },
  '5': { code: '5', id: 'dark_purple', name: 'Dark Purple', hex: '#AA00AA' },
  '6': { code: '6', id: 'gold', name: 'Gold', hex: '#FFAA00' },
  '7': { code: '7', id: 'gray', name: 'Gray', hex: '#AAAAAA' },
  '8': { code: '8', id: 'dark_gray', name: 'Dark Gray', hex: '#555555' },
  '9': { code: '9', id: 'blue', name: 'Blue', hex: '#5555FF' },
  a: { code: 'a', id: 'green', name: 'Green', hex: '#55FF55' },
  b: { code: 'b', id: 'aqua', name: 'Aqua', hex: '#55FFFF' },
  c: { code: 'c', id: 'red', name: 'Red', hex: '#FF5555' },
  d: { code: 'd', id: 'light_purple', name: 'Light Purple', hex: '#FF55FF' },
  e: { code: 'e', id: 'yellow', name: 'Yellow', hex: '#FFFF55' },
  f: { code: 'f', id: 'white', name: 'White', hex: '#FFFFFF' },
}
