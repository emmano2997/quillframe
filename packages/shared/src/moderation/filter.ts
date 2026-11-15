// Filtro automático de conteúdo (documento 02, §6.2): normaliza o texto e procura termos com
// Aho-Corasick, em tempo linear (nada de regex com backtracking, §5.10).
import { stripFormatting } from '../format/decompose.ts'

export type FilterSeverity = 'HIGH' | 'MEDIUM'

export interface FilterTerm {
  term: string
  severity: FilterSeverity
}

export interface FilterHit {
  term: string
  severity: FilterSeverity
}

const LEET: Readonly<Record<string, string>> = {
  '4': 'a',
  '@': 'a',
  '3': 'e',
  '1': 'i',
  '0': 'o',
  '5': 's',
  $: 's',
  '7': 't',
}

// Largura zero, direção de texto e hífen invisível
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g
const COMBINING = /[\u0300-\u036f]/g

/**
 * Passos 1 a 5 do documento: tira os códigos "§" e os caracteres invisíveis, passa para minúsculas
 * sem acentos, desfaz o leetspeak, junta letras soltas ("s e x o") e reduz letras repetidas.
 * O resultado são palavras separadas por um espaço, com um espaço em cada ponta.
 */
export function normalizeForFilter(text: string): string {
  const plain = stripFormatting(text)
    .replace(INVISIBLE, '')
    .normalize('NFKD')
    .replace(COMBINING, '')
    .toLowerCase()

  const words: string[] = []
  let word = ''
  let singles = ''
  const flushWord = () => {
    if (word === '') return
    if (word.length === 1) {
      // Letras soltas se juntam numa palavra só, também sem repetir a mesma letra
      if (!singles.endsWith(word)) singles += word
    } else {
      flushSingles()
      words.push(word)
    }
    word = ''
  }
  const flushSingles = () => {
    if (singles !== '') words.push(singles)
    singles = ''
  }

  for (const raw of plain) {
    const ch = LEET[raw] ?? raw
    const isWordChar = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
    if (!isWordChar) {
      flushWord()
      continue
    }
    // "seeexo" → "sexo": letras repetidas viram uma só
    if (word.endsWith(ch)) continue
    word += ch
  }
  flushWord()
  flushSingles()
  return words.length === 0 ? ' ' : ` ${words.join(' ')} `
}

/** Um termo passa pela mesma normalização do texto, para os dois se encontrarem. */
export function normalizeTerm(term: string): string {
  return normalizeForFilter(term).trim()
}

interface Node {
  next: Map<string, number>
  fail: number
  /** Índices dos termos que terminam aqui */
  out: number[]
}

/** Autômato de Aho-Corasick. Os termos casam com palavras inteiras (ou frases inteiras). */
export class ContentFilter {
  private readonly nodes: Node[] = [{ next: new Map(), fail: 0, out: [] }]
  private readonly terms: FilterTerm[] = []

  constructor(terms: readonly FilterTerm[]) {
    for (const { term, severity } of terms) {
      const normalized = normalizeTerm(term)
      if (normalized === '') continue
      const index = this.terms.push({ term: normalized, severity }) - 1
      let state = 0
      for (const ch of ` ${normalized} `) {
        let next = this.nodes[state]?.next.get(ch)
        if (next === undefined) {
          next = this.nodes.push({ next: new Map(), fail: 0, out: [] }) - 1
          this.nodes[state]?.next.set(ch, next)
        }
        state = next
      }
      this.nodes[state]?.out.push(index)
    }
    this.buildFailureLinks()
  }

  private buildFailureLinks(): void {
    const queue: number[] = [...(this.nodes[0]?.next.values() ?? [])]
    for (let head = 0; head < queue.length; head++) {
      const state = queue[head] as number
      const node = this.nodes[state] as Node
      for (const [ch, target] of node.next) {
        let fail = node.fail
        while (fail !== 0 && !this.nodes[fail]?.next.has(ch)) fail = this.nodes[fail]?.fail ?? 0
        const candidate = this.nodes[fail]?.next.get(ch)
        const targetNode = this.nodes[target] as Node
        targetNode.fail = candidate !== undefined && candidate !== target ? candidate : 0
        targetNode.out.push(...(this.nodes[targetNode.fail]?.out ?? []))
        queue.push(target)
      }
    }
  }

  /** Termos encontrados, sem repetição. */
  scan(text: string): FilterHit[] {
    const found = new Set<number>()
    let state = 0
    for (const ch of normalizeForFilter(text)) {
      while (state !== 0 && !this.nodes[state]?.next.has(ch)) state = this.nodes[state]?.fail ?? 0
      state = this.nodes[state]?.next.get(ch) ?? 0
      for (const index of this.nodes[state]?.out ?? []) found.add(index)
    }
    return [...found].map((index) => this.terms[index] as FilterTerm)
  }

  /** A gravidade mais alta encontrada, ou null se o texto passou. */
  worst(texts: readonly string[]): FilterSeverity | null {
    let worst: FilterSeverity | null = null
    for (const text of texts) {
      for (const hit of this.scan(text)) {
        if (hit.severity === 'HIGH') return 'HIGH'
        worst = 'MEDIUM'
      }
    }
    return worst
  }
}
