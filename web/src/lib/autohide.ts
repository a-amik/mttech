import { useEffect, type RefObject } from 'react'

// Шапка на телефоне уходит по ходу вниз и возвращается от движения вверх.
// Ход копится и обнуляется на смене направления; у верха страницы шапка стоит всегда;
// прыжок прокрутки (якорь, восстановление позиции) жестом чтения не считается.

const PHONE = '(max-width: 760px)'
const DOWN = 8
const UP = 40
const TOP = 50
const JUMP = 400

export function useAutoHide(ref: RefObject<HTMLElement | null>, frozen: boolean) {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const media = window.matchMedia(PHONE)
    let last = window.scrollY
    let acc = 0
    let hidden = false
    const show = (on: boolean) => {
      if (hidden === !on) return
      hidden = !on
      node.classList.toggle('hid', hidden)
    }
    const onScroll = () => {
      const y = window.scrollY
      const dy = y - last
      last = y
      if (!media.matches || frozen) return
      if (y < TOP) { acc = 0; show(true); return }
      if (Math.abs(dy) > JUMP) { acc = 0; return }
      if (Math.sign(dy) !== Math.sign(acc)) acc = 0
      acc += dy
      if (acc > DOWN) show(false)
      else if (acc < -UP) show(true)
    }
    const onFocus = () => show(true)
    window.addEventListener('scroll', onScroll, { passive: true })
    node.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('scroll', onScroll)
      node.removeEventListener('focusin', onFocus)
      node.classList.remove('hid')
    }
  }, [ref, frozen])
}
