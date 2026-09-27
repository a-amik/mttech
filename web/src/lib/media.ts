// Ступени вёрстки: 1100 и 760.

import { useEffect, useState, type RefObject } from 'react'

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Телефон: одна колонка, карта сверху, лист под ней. */
export const usePhone = () => useMedia('(max-width: 760px)')

/** Планшет и уже: правая колонка уходит панелью поверх карты. */
export const useNarrow = () => useMedia('(max-width: 1100px)')

/** Ширина узла вживую: сколько места осталось, решает сам узел, а не окно. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/** Сенсорное устройство без мыши: планшет или телефон. Подсказки клавиш там не нужны. */
export const useTouch = () => useMedia('(hover: none) and (pointer: coarse)')
