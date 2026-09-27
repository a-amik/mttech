// Шкала загрузки одним тоном: пять ступеней, превышение порога — обводкой.
export const STEPS = [40, 60, 80, 100]
export const STEP_LABELS = ['до 40', '40—60', '60—80', '80—100', '100+']

export const stepOf = (pct: number) => STEPS.filter((s) => pct >= s).length

export const stepVar = (pct: number) => `var(--b-l${stepOf(pct)})`

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
