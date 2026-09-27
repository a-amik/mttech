import { useStore } from '../store'
import { forwardRef } from 'react'
import { Button, DropdownMenu, Select } from '@gravity-ui/uikit'
import { DAYS, DOW_SHORT, MONTHS_NOM, dowOf, isoOf, ruDay } from '../data'
import { IconChart, IconChevron, IconDots, IconKeyboard, IconMoon, IconPlay, IconFlask, IconReport, IconSearch, IconSliders, IconSun, IconUpload } from '../lib/icons'
import { usePhone, useTouch } from '../lib/media'
import { DURATIONS, HZ, MODES, useHorizons, useSim } from '../simState'
import Brand from './Brand'
import DatePick from './DatePick'
import { moveDay, setView } from '../actions'
import { useCtx } from '../store'
import { Key } from './Bits'

interface Props {
  onUpload: () => void
  onExport: () => void
  typed: string
}

const TopBar = forwardRef<HTMLElement, Props>(function TopBar({ onUpload, onExport, typed }, ref) {
  const st = useStore()
  const ctx = useCtx()
  const phone = usePhone()
  const touch = useTouch()
  const sim = useSim()
  const horizons = useHorizons()
  const inSim = st.horizon === 'day' && st.view === 'sim'
  const inReport = st.horizon === 'day' && st.view === 'stand'
  const simN = horizons?.[sim.mode]?.replay[sim.hz]?.dates.length ?? 0
  const runSim = () => {
    if (sim.playing) return sim.set({ playing: false })
    sim.set({ playing: true, pos: sim.pos >= simN - 1 ? 0 : sim.pos })
  }
  const { place, set } = useStore()
  const month = Number(isoOf(st.day).slice(5, 7))
  const title = st.horizon === 'day' ? `${DOW_SHORT[dowOf(st.day)]}, ${ruDay(st.day, false)}` : st.horizon === 'month' ? `${MONTHS_NOM[month - 1]} 2025` : '2025—2026'
  const step = st.horizon === 'month' ? 30 : 1
  const note = st.horizon === 'day' && st.sim ? 'эмуляция' : undefined


  return (
    <header className="b-top" ref={ref}>
      <Brand />
      {inSim ? (
        <div className="b-simctl">
          <Select size="m" value={[sim.hz]} onUpdate={([v]) => sim.set({ hz: v, pos: 0, playing: false })} title="Горизонт прогноза"
            options={HZ.map((h) => ({ value: h.key, content: h.label }))} />
          <Select size="m" value={[sim.mode]} onUpdate={([v]) => sim.set({ mode: v as typeof sim.mode })} title="Что модели знают о дне-цели"
            options={MODES.filter((m) => !horizons || horizons[m.key]).map((m) => ({ value: m.key, content: m.label }))} />
          <Select size="m" value={[String(sim.dur)]} onUpdate={([v]) => sim.set({ dur: Number(v) })} title="Длительность прогона"
            options={DURATIONS.map((d) => ({ value: String(d.value), content: d.label }))} />
        </div>
      ) : inReport ? null : st.horizon !== 'year' ? (
        <div className="b-daynav">
          <Button view="flat" size="m" onClick={() => moveDay(-step)} title="Назад" disabled={st.day === 0}>
            <span className="b-rot l"><IconChevron /></span>
          </Button>
          <DatePick ctx={ctx} label={title} note={note} />
          <Button view="flat" size="m" onClick={() => moveDay(step)} title="Вперёд" disabled={st.day === DAYS - 1}>
            <span className="b-rot r"><IconChevron /></span>
          </Button>
        </div>
      ) : <div className="b-daynav"><strong className="b-year">{title}<em>сценарии</em></strong></div>}
      {place ? (
        <span className="b-stand" title="Экран показывает маршруты одной площадки выпуска; выбор — в строке команд">
          площадка {place}
          <Button view="flat" size="xs" onClick={() => set({ place: '' })}>все</Button>
        </span>
      ) : null}
      <span className="sp" />
      {st.sim ? (
        <span className="b-stand" title="Экран показывает день, прожитый на стенде">
          эмуляция: {st.sim.label}
          <Button view="flat" size="xs" onClick={() => st.set({ sim: null })}>снять</Button>
        </span>
      ) : null}
      {inSim ? (
        <Button view={sim.playing ? 'outlined' : 'action'} size="m" onClick={runSim} disabled={!simN} className="b-simrun">
          <span className="b-btn">{sim.playing ? 'Пауза' : <><IconPlay />{sim.pos > 0 && sim.pos < simN - 1 ? 'Дальше' : 'Пуск'}</>}</span>
        </Button>
      ) : null}
      {inSim ? null : <button type="button" className="b-search" onClick={() => set({ palette: true })}>
        <IconSearch />
        <span>{typed ? <>маршрут <b>{typed}</b>, Enter</> : 'Маршрут, окно, команда'}</span>
        <Key k="mod+k" />
      </button>}
      <DropdownMenu
        size="m"
        renderSwitcher={(props) => (
          <Button {...props} view="flat" size="m" title="Тема, настройки, файлы, клавиши">
            <span className="b-btn"><IconDots /></span>
          </Button>
        )}
        items={[
          [
            { text: st.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема', iconStart: st.theme === 'dark' ? <IconSun /> : <IconMoon />, action: st.toggleTheme },
            { text: 'Настройки расчёта', iconStart: <IconSliders />, action: () => st.set({ settingsOpen: true }) },
          ],
          // на телефоне нижней колонки нет: имитация и отчёты живут здесь
          ...(phone ? [[
            { text: 'Имитация: прогон четырёх моделей', iconStart: <IconFlask />, action: () => setView('sim') },
            { text: 'Отчёты: решение, экран, модели, нагрузка, год', iconStart: <IconReport />, action: () => setView('stand') },
          ]] : []),
          [
            { text: 'Загрузить CSV валидаций', iconStart: <IconUpload />, action: onUpload },
            { text: 'Выгрузить прогноз дня, CSV', iconStart: <IconChart />, action: onExport },
          ],
          ...(phone || touch ? [] : [[{ text: 'Клавиши', iconStart: <IconKeyboard />, action: () => set({ keys: true }) }]]),
        ]}
      />
    </header>
  )
})

export default TopBar
