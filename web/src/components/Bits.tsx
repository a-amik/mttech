import { Hotkey } from '@gravity-ui/uikit'
import type { Priority } from '../model'

const PRIO_TITLE = ['', 'первый приоритет', 'второй приоритет', 'третий приоритет: внимание']

/** Знак приоритета: три столбика, закрашено по важности. Цвет — только у первого. */
export function Pri({ p }: { p: Priority | 0 }) {
  return (
    <span className={`b-pri p${p}`} role="img" aria-label={PRIO_TITLE[p] || 'ниже порога внимания'} title={PRIO_TITLE[p]}>
      <i /><i /><i />
    </span>
  )
}

export const RNum = ({ id, off }: { id: string; off?: boolean }) => <span className={`b-rnum${off ? ' off' : ''}`}>{id}</span>

/** Подсказка клавиши прямо на кнопке. */
export const Key = ({ k }: { k: string }) => <Hotkey value={k} className="b-key" />
