import { useState } from 'react'
import { Button, NumberInput, SegmentedRadioGroup, Select, Switch } from '@gravity-ui/uikit'
import { DEFAULTS, SCHEMA, type Field, type Settings } from '../settings'
import { useStore } from '../store'
import { IconClose } from '../lib/icons'

export default function SettingsDrawer() {
  const st = useStore()
  const [draft, setDraft] = useState<Settings>(st.settings)
  const [tab, setTab] = useState<'work' | 'model' | 'factors'>('work')
  if (!st.settingsOpen) return null

  const close = () => st.set({ settingsOpen: false })
  const changed = Object.keys(DEFAULTS).filter((k) => draft[k] !== DEFAULTS[k]).length
  const update = (f: Field, v: unknown) => setDraft({ ...draft, [f.key]: v as never })

  const control = (f: Field) => {
    const v = draft[f.key]
    if (f.type === 'bool') return <Switch size="m" checked={Boolean(v)} onUpdate={(x) => update(f, x)} content={f.label} />
    if (f.type === 'choice')
      return (
        <SegmentedRadioGroup size="m" width="max" value={String(v)} onUpdate={(x) => update(f, x)}
          options={(f.choices ?? []).map((c) => ({ value: c.value, content: c.label }))} />
      )
    return (
      <NumberInput size="m" value={Number(v)} min={f.min} max={f.max} step={f.step}
        allowDecimal={!Number.isInteger(f.step ?? 1)}
        endContent={f.unit ? <span className="b-set-unit">{f.unit}</span> : undefined}
        onUpdate={(x) => x !== null && update(f, x)} />
    )
  }

  const row = (f: Field) => {
    const isChanged = draft[f.key] !== DEFAULTS[f.key]
    return (
      <div key={f.key} className="b-set-row">
        {f.type === 'bool' ? null : (
          <label className="b-set-label">
            {f.label}
            {isChanged ? (
              <button type="button" className="b-set-reset" onClick={() => update(f, DEFAULTS[f.key])}>вернуть {String(DEFAULTS[f.key])}</button>
            ) : null}
          </label>
        )}
        {control(f)}
        {f.hint ? <small className="b-set-hint">{f.hint}</small> : null}
      </div>
    )
  }

  return (
    <div className="b-drawer">
      <div className="b-drawer-veil" onClick={close} aria-hidden="true" />
      <aside role="dialog" aria-label="Настройки расчёта" className="b-set" style={{ width: 460 }}>
        <div className="b-set-head">
          <div className="min-w-0 flex-1">
            <h2>Настройки расчёта</h2>
            <p>{changed ? `Изменено полей: ${changed}. Остальное — по допущениям модели.` : 'Все числа — по допущениям модели. У каждого указан источник.'}</p>
            <div style={{ marginTop: 10 }}>
              <SegmentedRadioGroup size="m" value={tab} onUpdate={(v) => setTab(v as 'work' | 'model' | 'factors')}
                options={[{ value: 'work', content: 'Порог и выпуск' }, { value: 'model', content: 'Модель' }, { value: 'factors', content: 'Факторы' }]} />
            </div>
          </div>
          <Button view="flat" size="m" onClick={close} title="Закрыть"><IconClose /></Button>
        </div>
        <div className="b-set-body">
          {tab === 'work' ? (
            <section className="b-set-group">
              <h3>Экран</h3>
              <div className="b-set-row">
                <span className="b-set-label">Тема</span>
                <SegmentedRadioGroup size="m" width="max" value={st.theme} onUpdate={(v) => v !== st.theme && st.toggleTheme()}
                  options={[{ value: 'dark', content: 'Тёмная' }, { value: 'light', content: 'Светлая' }]} />
                <small className="b-set-hint">Тёмная — по умолчанию: диспетчер весь день у экрана, эксперты заказчика советовали тёмную подложку. Меняется сразу, без пересчёта.</small>
              </div>
              <div className="b-set-row">
                <span className="b-set-label">Час смены для показа</span>
                <Select size="m" width="max" value={[String(st.now)]} onUpdate={([v]) => st.set({ now: Number(v) })}
                  options={Array.from({ length: 19 }, (_, i) => ({ value: String(i + 5), content: `${String(i + 5).padStart(2, '0')}:00` }))} />
                <small className="b-set-hint">На смене это текущее время: окна раньше него — прошедшие. Выбор нужен только для показа прошлых и будущих дней.</small>
              </div>
            </section>
          ) : null}
          {tab === 'factors' ? (
            <p className="b-set-hint" style={{ margin: '0 0 12px' }}>
              Тумблер стоит у фактора с известной величиной; в подсказке — чем она измерена: историей января—октября, попыткой на лидерборде или только гипотезой. Гипотезы по умолчанию выключены. Всё, что дают факторы, — оценка.
            </p>
          ) : null}
          {SCHEMA.filter((g) => (g.factors ? tab === 'factors' : tab !== 'factors' && Boolean(g.tech) === (tab === 'model'))).map((g) => (
            <section key={g.key} className="b-set-group">
              <h3>{g.title}</h3>
              {g.key === 'fleet' ? (
                <>
                  <div className="b-set-pair">{g.fields.map(row)}</div>
                  <small className="b-set-hint" style={{ display: 'block' }}>
                    Сцепка из двух вагонов вдвое поднимает вместимость рейса. В сырых валидациях сентября—октября сцепок не видно: два бортовых номера под одним выходом одновременно — у 3 % выходов, и это смена вагона, а не состав. Поэтому по умолчанию один вагон; два — сценарий для планирования.
                  </small>
                </>
              ) : g.key === 'intervals' ? (
                <>
                  <div className="b-set-pair">{g.fields.filter((f) => f.key.startsWith('interval_')).map(row)}</div>
                  <small className="b-set-hint" style={{ display: 'block', marginBottom: 12 }}>
                    Интервалы — допущение, подобранное под пик посадок каждого маршрута. Заменятся расписанием по выходам, когда оно будет.
                  </small>
                  {g.fields.filter((f) => !f.key.startsWith('interval_')).map(row)}
                </>
              ) : g.fields.map(row)}
            </section>
          ))}
        </div>
        <div className="b-set-foot">
          <Button view="action" size="l" onClick={() => { st.setSettings(draft); close() }}>Пересчитать</Button>
          <Button view="outlined" size="l" onClick={() => setDraft({ ...DEFAULTS })} disabled={!changed}>Сбросить всё</Button>
        </div>
      </aside>
    </div>
  )
}
