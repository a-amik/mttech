import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { loadHorizons, type Horizons, type HzModeKey } from './data'

// Управление имитацией живёт в шапке, прогон рисует раздел: общее состояние — здесь.

export const HZ = [
  { key: '1h', label: 'Через час', days: 0 },
  { key: '1d', label: 'Завтра', days: 1 },
  { key: '2d', label: 'Через 2 дня', days: 2 },
  { key: '3d', label: 'Через 3 дня', days: 3 },
  { key: '7d', label: 'Через 7 дней', days: 7 },
  { key: '14d', label: 'Через 14 дней', days: 14 },
  { key: '28d', label: 'Через 28 дней', days: 28 },
]

export const MODES: { key: HzModeKey; label: string }[] = [
  { key: 'known', label: 'Только известное' },
  { key: 'weather', label: 'С погодой' },
  { key: 'events', label: 'С событиями' },
  { key: 'synthetic', label: 'Синтетика' },
]

export const DURATIONS = [{ value: 30, label: 'Прогон за 30 с' }, { value: 60, label: 'За 1 мин' }, { value: 120, label: 'За 2 мин' }]

interface SimUi {
  hz: string
  mode: HzModeKey
  dur: number
  pos: number
  playing: boolean
  set: (p: Partial<Omit<SimUi, 'set'>>) => void
}

const P = new URLSearchParams(location.search)

export const useSim = create<SimUi>((set) => ({
  hz: HZ.some((h) => h.key === P.get('hz')) ? P.get('hz')! : '1d',
  mode: MODES.some((m) => m.key === P.get('mode_in')) ? (P.get('mode_in') as HzModeKey) : 'known',
  dur: 30,
  pos: Number(P.get('pos') ?? 0) || 0,
  playing: false,
  set: (p) => set(p),
}))

/** Файл прогона: один на шапку и раздел. undefined — ещё грузится, null — файла нет. */
export function useHorizons() {
  const [data, setData] = useState<Horizons | null | undefined>(undefined)
  useEffect(() => { loadHorizons().then(setData) }, [])
  return data
}
