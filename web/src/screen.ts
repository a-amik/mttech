import { useStore, decisionKey, type Decision } from './store'
import { useMemo } from 'react'
import { wapeScore } from './data'
import { bandDay, decidedLoad, FIRST_HOUR, riskWindows, routeDay, WIDE_BAND, type Ctx, type RiskWindow, type RouteDay } from './model'

// Всё, что экран показывает о дне, собрано один раз: панели читают отсюда
// и потому показывают одно и то же.

export const H_FROM = FIRST_HOUR
export const H_TO = 24
export const HOURS = Array.from({ length: H_TO - H_FROM }, (_, i) => H_FROM + i)

export interface Screen {
  day: number
  days: Record<string, RouteDay>
  wins: RiskWindow[]
  /** Загрузка после принятых решений. */
  after: Record<string, number[]>
  extra: Record<string, number[]>
  wide: Record<string, boolean[]>
  decided: (w: RiskWindow) => Decision | undefined
  winAt: (route: string, h: number) => RiskWindow | undefined
}

export interface Recast {
  /** Маршрутов с пересчётом. */
  routes: number
  /** Множитель по сети на остаток дня. */
  k: number
  /** Точность остатка дня по факту: с пересчётом и без него. */
  score: number
  plain: number
}

/** Пересчёт по факту на экране: сколько маршрутов затронул и что дал остатку дня с часа смены. */
export function recastOf(sc: Screen, now: number): Recast | null {
  const list = Object.values(sc.days).filter((d) => d.fact && d.nowcast)
  if (!list.length) return null
  const fact = list.flatMap((d) => d.fact!.slice(now))
  const fc = list.flatMap((d) => d.fc.slice(now))
  const plain = list.flatMap((d) => d.plain.slice(now))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  return { routes: list.length, k: sum(plain) ? sum(fc) / sum(plain) : 1, score: wapeScore(fact, fc), plain: wapeScore(fact, plain) }
}

export function useScreen(ctx: Ctx): Screen {
  const day = useStore((s) => s.day)
  const decisions = useStore((s) => s.decisions)
  const { ds, s, adj, model, sim, now } = ctx
  return useMemo(() => {
    const c: Ctx = { ds, s, adj, model, sim, now }
    const list = ds.routes.map((r) => routeDay(c, r.id, day))
    const days = Object.fromEntries(list.map((d) => [d.route, d]))
    const extra: Record<string, number[]> = {}
    const after: Record<string, number[]> = {}
    const wide: Record<string, boolean[]> = {}
    for (const d of list) {
      extra[d.route] = Array(24).fill(0)
      const band = bandDay(c, d.route, day, d.fc)
      wide[d.route] = d.fc.map((v, h) => v > 0 && (band[h][1] - band[h][0]) / v >= WIDE_BAND)
    }
    for (const dec of Object.values(decisions)) {
      if (dec.day !== day || !extra[dec.route]) continue
      for (let h = dec.from; h < dec.to; h++) extra[dec.route][h] += dec.trips
    }
    for (const d of list) after[d.route] = d.load.map((v, h) => decidedLoad(c, d.route, h, v, extra[d.route][h], d.plan))
    const wins = riskWindows(c, day, list)
    return {
      day, days, wins, after, extra, wide,
      decided: (w) => decisions[decisionKey(day, w.key)],
      winAt: (route, h) => wins.find((w) => w.route === route && h >= w.from && h < w.to),
    }
  }, [ds, s, adj, model, sim, now, day, decisions])
}
