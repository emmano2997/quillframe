// Seletor de símbolos (documento 03, §5.8): os caracteres que a fonte do livro desenha.
import { parsePixelFont } from '@quillframe/shared'
import { useMemo, useState } from 'react'
import packFontText from '../../../../assets/pack/font/quillframe-font.txt?raw'
import { en } from '../strings/en.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog, Field, Tabs, ui } from '../ui/kit.tsx'
import styles from './EditorScreen.module.css'

/** Os mais usados em arte ASCII e nos livros do autor. O "§" entra aqui porque nem todo teclado o tem. */
const FAVORITES = [
  ...'§♥♦♣♠★☆✮☼☀☁☂♪♫☺☻✔✘❤→←↑↓░▒▓█▄▀▌▐■□▪▫▲▼◄►●○◆◇║═╔╗╚╝╠╣╦╩╬│─┌┐└┘├┤┬┴┼«»•·°±×÷∞≈≠≤≥',
]

const RECENT_KEY = 'qf.recentSymbols'
const RECENT_MAX = 32

function loadRecent(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

type Tab = 'favorites' | 'recent' | 'all'

export function SymbolPicker({ onPick, onClose }: { onPick: (symbol: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('favorites')
  const [search, setSearch] = useState('')
  const [recent, setRecent] = useState(loadRecent)
  const all = useMemo(
    () =>
      [...parsePixelFont(packFontText).glyphs.keys()]
        .filter((codePoint) => codePoint > 0x20)
        .sort((a, b) => a - b)
        .map((codePoint) => String.fromCodePoint(codePoint)),
    [],
  )

  const pick = (symbol: string) => {
    const next = [symbol, ...recent.filter((item) => item !== symbol)].slice(0, RECENT_MAX)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      // Sem armazenamento: os recentes valem só nesta visita
    }
    onPick(symbol)
  }

  // Busca pelo próprio caractere ou pelo código (ex.: "2665" ou "U+2665")
  const query = search.trim().toLowerCase().replace(/^u\+/, '')
  const source = tab === 'favorites' ? FAVORITES : tab === 'recent' ? recent : all
  const symbols =
    query === ''
      ? source
      : source.filter(
          (symbol) => symbol.toLowerCase() === query || (symbol.codePointAt(0) ?? 0).toString(16).padStart(4, '0').includes(query),
        )

  return (
    <Dialog title={en.symbols.title} onClose={onClose}>
      <Tabs
        label={en.symbols.title}
        tabs={[
          { id: 'favorites', label: en.symbols.favorites },
          { id: 'recent', label: en.symbols.recent },
          { id: 'all', label: en.symbols.all },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Field label={en.symbols.search} value={search} onChange={(event) => setSearch(event.target.value)} />
      {symbols.length === 0 ? (
        <p className={`${ui.muted} ${ui.center}`}>{en.common.nothing}</p>
      ) : (
        <div className={styles.symbols}>
          {symbols.map((symbol) => (
            <button
              key={symbol}
              type="button"
              className={styles.symbol}
              title={`U+${(symbol.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`}
              onClick={() => pick(symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
      )}
      <div className={ui.row}>
        <Button onClick={onClose}>{en.common.close}</Button>
      </div>
    </Dialog>
  )
}
