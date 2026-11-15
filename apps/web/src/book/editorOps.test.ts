import { layoutPage, stripFormatting } from '@quillframe/shared'
import { describe, expect, it } from 'vitest'
import {
  applyFormat,
  caretPosition,
  clearFormatting,
  countInvalidCodes,
  fitChange,
  indexAtPoint,
  moveVertically,
  selectionRects,
  styleAt,
} from './editorOps.ts'

describe('styleAt', () => {
  it('lê a cor e os estilos ativos; uma cor apaga os estilos', () => {
    expect(styleAt('§lab', 3)).toMatchObject({ bold: true, color: '0' })
    expect(styleAt('§l§cab', 5)).toMatchObject({ bold: false, color: 'c' })
    expect(styleAt('§c§lab§rx', 9)).toMatchObject({ bold: false, color: '0' })
  })

  it('um código só vale depois do par completo', () => {
    expect(styleAt('§l', 1).bold).toBe(false)
    expect(styleAt('§l', 2).bold).toBe(true)
  })
})

describe('applyFormat sem seleção (documento 03, §5.4)', () => {
  it('insere o código no caret', () => {
    expect(applyFormat('ab', 1, 1, 'l')).toEqual({ text: 'a§lb', selectionStart: 3, selectionEnd: 3 })
    expect(applyFormat('ab', 2, 2, 'r').text).toBe('ab§r')
  })

  it('a cor vem antes dos estilos: negrito e depois vermelho grava §c§l, não §l§c', () => {
    const bold = applyFormat('', 0, 0, 'l')
    const red = applyFormat(bold.text, bold.selectionStart, bold.selectionEnd, 'c')
    expect(red.text).toBe('§c§l')
    expect(styleAt(red.text, red.selectionStart)).toMatchObject({ bold: true, color: 'c' })
  })

  it('mantém os estilos ativos ao trocar a cor no meio do texto', () => {
    const result = applyFormat('§l§ohello', 9, 9, '9')
    expect(result.text).toBe('§l§ohello§9§l§o')
    expect(styleAt(result.text, result.selectionStart)).toMatchObject({
      bold: true,
      italic: true,
      color: '9',
    })
  })
})

describe('applyFormat com seleção', () => {
  it('aplica no início e restaura o estado anterior no fim', () => {
    const result = applyFormat('one two three', 4, 7, 'l')
    expect(result.text).toBe('one §ltwo§r three')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('two')
    expect(stripFormatting(result.text)).toBe('one two three')
  })

  it('restaura a cor e os estilos que estavam ativos', () => {
    const result = applyFormat('§c§lone two', 8, 11, 'o')
    expect(result.text).toBe('§c§lone §otwo§r§c§l')
    expect(styleAt(result.text, result.text.length)).toMatchObject({ color: 'c', bold: true, italic: false })
  })

  it('um estilo sobre um trecho com cores volta depois de cada cor', () => {
    const result = applyFormat('a§cb§9c', 0, 7, 'l')
    // No fim, volta ao estado que valia ali: sem negrito, na cor §9
    expect(result.text).toBe('§la§c§lb§9§lc§r§9')
    const layout = layoutPage(result.text)
    expect(layout.lines[0]?.glyphs.every((glyph) => glyph.style.bold)).toBe(true)
  })

  it('preserva os códigos inválidos do trecho', () => {
    const result = applyFormat('§ x§§y', 0, 6, 'n')
    expect(result.text).toBe('§n§ x§§y§r')
  })
})

describe('clearFormatting (F12)', () => {
  it('remove só os códigos válidos; os inválidos ficam', () => {
    expect(clearFormatting('§c§lred§r§ §§x', 0, 0).text).toBe('red§ §§x')
  })

  it('com seleção, limpa só o trecho', () => {
    const result = clearFormatting('§cab§lcd', 2, 8)
    expect(result.text).toBe('§cabcd')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('abcd')
  })

  it('conta os códigos inválidos', () => {
    expect(countInvalidCodes('§c§ §§x§')).toBe(3)
    expect(countInvalidCodes('§a§l§r')).toBe(0)
  })
})

describe('fitChange (documento 03, §5.6)', () => {
  it('aceita o que cabe e limpa caracteres de controle', () => {
    expect(fitChange('ab', 'a\tb\r\nc', 6)).toMatchObject({ text: 'ab\nc', truncated: false })
  })

  it('não deixa digitar além de 1024 caracteres', () => {
    const full = 'a '.repeat(512)
    const result = fitChange(full, `${full}x`, 1025)
    expect(result).toMatchObject({ text: full, rejected: true })
  })

  it('não deixa passar de 14 linhas', () => {
    const lines = 'x\n'.repeat(13) + 'x'
    // A 15ª linha não entra; o "\n" final cabe, porque a linha vazia depois dele não conta
    expect(fitChange(lines, `${lines}\ny`, lines.length + 2)).toMatchObject({
      text: `${lines}\n`,
      truncated: true,
    })
    expect(fitChange(`${lines}\n`, `${lines}\ny`, lines.length + 2).rejected).toBe(true)
    expect(fitChange(lines, `${lines}y`, lines.length + 1).rejected).toBe(false)
  })

  it('colar além do limite cola o que cabe e avisa (F13)', () => {
    const result = fitChange('start ', `start ${'word '.repeat(400)}`, 2006)
    expect(result.truncated).toBe(true)
    expect(result.rejected).toBe(false)
    expect(result.text.startsWith('start word word')).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(1024)
    expect(layoutPage(result.text).lines.length).toBeLessThanOrEqual(14)
    expect(result.caret).toBe(result.text.length)
  })

  it('não corta um emoji ao meio', () => {
    const result = fitChange('', '💔'.repeat(600), 1200)
    expect(result.text.length % 2).toBe(0)
    expect(result.text.endsWith('💔')).toBe(true)
  })

  it('apagar sempre pode, mesmo numa página que já passa do limite', () => {
    const over = 'x\n'.repeat(20)
    expect(fitChange(over, over.slice(0, -2), 38)).toMatchObject({ rejected: false, truncated: false })
  })
})

describe('caret ↔ posição', () => {
  const text = 'ab\n§ccd'
  const layout = layoutPage(text)

  it('mapeia a posição no texto para linha e x', () => {
    expect(caretPosition(layout, 0)).toEqual({ line: 0, x: 0 })
    expect(caretPosition(layout, 2)).toEqual({ line: 0, x: 12 })
    expect(caretPosition(layout, 3)).toEqual({ line: 1, x: 0 })
    // Dentro do código §c o caret fica antes do próximo caractere visível
    expect(caretPosition(layout, 4)).toEqual({ line: 1, x: 0 })
    expect(caretPosition(layout, 7)).toEqual({ line: 1, x: 12 })
  })

  it('mapeia um clique para a posição mais próxima', () => {
    expect(indexAtPoint(layout, 0, 0)).toBe(0)
    expect(indexAtPoint(layout, 4, 0)).toBe(1)
    expect(indexAtPoint(layout, 100, 0)).toBe(2)
    expect(indexAtPoint(layout, 0, 9)).toBe(5)
    expect(indexAtPoint(layout, 100, 200)).toBe(7)
  })

  it('seta para cima e para baixo mantém o x', () => {
    expect(moveVertically('abc\nabc', 1, 1)).toBe(5)
    expect(moveVertically('abc\nabc', 5, -1)).toBe(1)
    expect(moveVertically('abc\nabc', 1, -1)).toBe(0)
    expect(moveVertically('abc\nabc', 5, 1)).toBe(7)
  })

  it('a seleção vira um retângulo por linha', () => {
    expect(selectionRects(layout, 1, 6)).toEqual([
      { x: 6, y: 0, width: 6 },
      { x: 0, y: 9, width: 6 },
    ])
    expect(selectionRects(layout, 2, 2)).toEqual([])
  })
})
