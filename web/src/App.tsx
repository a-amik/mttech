import { useEffect, useRef } from 'react'
import { ThemeProvider } from '@gravity-ui/uikit'
import { loadDataset } from './data'
import { exportForecast, openValidations } from './files'
import type { Ctx } from './model'
import { useCtx, useStore } from './store'
import { useScreen, type Screen } from './screen'
import { useKeys } from './lib/keys'
import { useAutoHide } from './lib/autohide'
import { usePhone } from './lib/media'
import { PhoneDay, PhoneNav, PhoneSheet } from './components/Phone'
import TopBar from './components/TopBar'
import Rail from './components/Rail'
import SidePanel from './components/SidePanel'
import HeatGrid, { CenterBar, GridLegend } from './components/HeatGrid'
import LineBlock from './components/LineScheme'
import WindowTable from './components/WindowTable'
import { templateToggle } from './components/WindowCard'
import MonthView, { MonthPanel } from './components/MonthView'
import MapView from './components/MapView'
import LiveView from './components/LiveView'
import { AnalyticsMain, AnalyticsSide } from './components/analytics/AnalyticsView'
import SettingsDrawer from './components/SettingsDrawer'
import SimView from './components/SimView'
import { KeysHelp, Palette, UndoToast } from './components/Overlays'
import { Slider } from '@gravity-ui/uikit'
import { hh } from './data'
import { IconChevron } from './lib/icons'

/** Карта сети целиком, как Map Hub у Optibus: маршруты, флажки, час смены под рукой. */
function MapHub({ ctx }: { ctx: Ctx }) {
  const { hour, set } = useStore()
  return (
    <main className="b-main b-hub">
      <div className="b-map-full"><MapView ctx={ctx} /></div>
      <div className="b-hub-hour">
        <b>{hh(hour)}</b>
        <Slider size="s" min={5} max={23} step={1} value={hour} onUpdate={(v) => set({ hour: v as number, extra: null })} tooltipDisplay="off" aria-label="Час на карте" />
      </div>
    </main>
  )
}

function DayMain({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const view = useStore((s) => s.view)
  if (view === 'map') return <MapHub ctx={ctx} />
  if (view === 'table') {
    return (
      <main className="b-main">
        <CenterBar title="Окна риска, таблица" />
        <WindowTable ctx={ctx} sc={sc} />
        <LineBlock ctx={ctx} sc={sc} />
      </main>
    )
  }
  return (
    <main className="b-main">
      <CenterBar title="Прогноз загрузки, маршрут × час" />
      <GridLegend ctx={ctx} />
      <HeatGrid ctx={ctx} sc={sc} />
      <LineBlock ctx={ctx} sc={sc} />
    </main>
  )
}

function Ready({ ctx, onUpload, onExport, onScreen }: { ctx: Ctx; onUpload: () => void; onExport: () => void; onScreen: (sc: Screen) => void }) {
  const sc = useScreen(ctx)
  const { horizon, view, sideOpen, set } = useStore()
  const phone = usePhone()
  onScreen(sc)
  const hasSide = !(horizon === 'day' && view === 'sim') && !(phone && view === 'stand')
  return (
    <>
      <div className={`b-body${hasSide && sideOpen ? '' : ' noside'}`}>
        {phone ? <PhoneNav /> : <Rail />}
        {hasSide ? (
          <button type="button" className={`b-side-tg${sideOpen ? '' : ' shut'}`} onClick={() => set({ sideOpen: !sideOpen })}
            title={sideOpen ? 'Скрыть панель' : 'Показать панель'} aria-label={sideOpen ? 'Скрыть панель' : 'Показать панель'} aria-expanded={sideOpen}>
            <IconChevron />
          </button>
        ) : null}
        {horizon === 'month' ? (
          <>
            <MonthPanel ctx={ctx} />
            <main className="b-main b-month-main"><MonthView ctx={ctx} /></main>
          </>
        ) : view === 'live' ? (
          <LiveView ctx={ctx} />
        ) : view === 'stand' ? (
          <>
            {phone ? null : <AnalyticsSide />}
            <AnalyticsMain ctx={ctx} />
          </>
        ) : view === 'sim' ? (
          <SimView ctx={ctx} />
        ) : phone && view === 'map' ? (
          <MapHub ctx={ctx} />
        ) : phone ? (
          <PhoneDay ctx={ctx} sc={sc} />
        ) : (
          <>
            <SidePanel ctx={ctx} sc={sc} />
            <DayMain ctx={ctx} sc={sc} />
          </>
        )}
      </div>
      {phone ? <PhoneSheet ctx={ctx} sc={sc} /> : null}
      <Palette ctx={ctx} sc={sc} onUpload={onUpload} onExport={onExport} />
    </>
  )
}

export default function App() {
  const st = useStore()
  const ctx = useCtx()
  const file = useRef<HTMLInputElement>(null)
  const top = useRef<HTMLElement>(null)
  const screen = useRef<Screen | null>(null)
  const typed = useKeys(screen)
  const overlay = st.palette || st.keys || st.settingsOpen
  useAutoHide(top, overlay)

  useEffect(() => {
    loadDataset().then(st.setDs).catch((e) => st.notify(`Данные не загрузились: ${String(e)}`))
    // Шаблон из адреса включается один раз при открытии.
    const s = useStore.getState()
    if (s.template) s.setAdj(templateToggle(s.template, s.adj, s.route, s.hour, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = st.theme
  }, [st.theme])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) openValidations(f)
  }
  const onUpload = () => file.current?.click()
  const onExport = () => ctx && exportForecast(ctx, st.day)

  return (
    <ThemeProvider theme={st.theme}>
      <div className="b-app">
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
        <TopBar ref={top} onUpload={onUpload} onExport={onExport} typed={typed} />
        {ctx ? <Ready ctx={ctx} onUpload={onUpload} onExport={onExport} onScreen={(sc) => { screen.current = sc }} /> : (
          <div className="b-body">
            <nav className="b-rail" />
            <div className="b-side b-wait">{Array.from({ length: 8 }, (_, i) => <div key={i} className="b-skeleton" />)}</div>
            <div className="b-main" />
          </div>
        )}
        {st.settingsOpen ? <SettingsDrawer /> : null}
        <KeysHelp />
        <UndoToast />
        {st.toast ? <div className="b-toast" role="status">{st.toast}</div> : null}
      </div>
    </ThemeProvider>
  )
}
