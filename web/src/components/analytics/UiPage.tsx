import { num } from '../../data'
import { Bars, Figure, Tiles } from './charts'
import { DECISIONS, KLM, REFERENCES } from './facts'
import { ArtScreen, IconCheck, IconEye, IconKeyboard, IconMapPin, IconPalette, IconWarning } from './art'

const SCALE = [
  { v: '--b-l0', label: 'до 40 %' }, { v: '--b-l1', label: '40—60' }, { v: '--b-l2', label: '60—80' },
  { v: '--b-l3', label: '80—100' }, { v: '--b-l4', label: '100+' },
]

export default function UiPage() {
  return (
    <article className="b-an">
      <header className="b-an-hero">
        <div className="b-an-art"><ArtScreen /></div>
        <p className="kick">Отчёты · экран</p>
        <h1>Три секунды до&nbsp;принятия рекомендации по&nbsp;модели нажатий</h1>
        <p className="lede">
          Диспетчеру нужно увидеть, где через час будет тесно, понять почему и&nbsp;добавить рейс. Экран собран
          по&nbsp;правилам высокоэффективного человеко-машинного интерфейса, в&nbsp;цветах навигации московского транспорта и&nbsp;на&nbsp;компонентах Gravity UI.
          Для&nbsp;решений оценивались число нажатий и&nbsp;время до&nbsp;принятого действия.
        </p>
        <Tiles items={[
          { value: `${num(KLM[2].value, 1)} с`, label: 'до принятой рекомендации', note: `против ${num(KLM[0].value, 1)} с без режима исключений` },
          { value: '4', label: 'уровня на одном экране', note: 'сеть, маршрут, окно, подробности' },
          { value: '3', label: 'горизонта', note: 'день по часам, месяц, год' },
          { value: '2', label: 'темы', note: 'тёмная — для зала с приглушённым светом' },
        ]} />
      </header>

      <section id="u-why">
        <h2><span className="ic"><IconEye /></span>Экран выделяет окна риска и&nbsp;помечает оценки</h2>
        <div className="b-an-cards c3">
          <div><h4><IconEye />Цвет выделяет отклонения</h4><p>Норма показана серым, цвет появляется только у&nbsp;исключения. Окно риска выделяется на&nbsp;фоне десяти маршрутов без&nbsp;отклонений.</p></div>
          <div><h4><IconWarning />Сначала исключения</h4><p>По&nbsp;умолчанию экран показывает только окна риска с&nbsp;тремя приоритетами. Окна с&nbsp;одной причиной свёрнуты в&nbsp;строку. Вся сеть открывается одной клавишей.</p></div>
          <div><h4><IconCheck />Оценка подписана</h4><p>Загрузка вагона и&nbsp;посадки по&nbsp;остановкам подписаны как оценки. Подпись можно снять после получения фактических данных.</p></div>
        </div>
      </section>

      <section id="u-speed">
        <h2><span className="ic"><IconKeyboard /></span>Режим исключений и&nbsp;клавиши сокращают время втрое</h2>
        <p>
          Задача смены: найти самое опасное окно ближайших часов и&nbsp;принять рекомендацию. По&nbsp;модели нажатий KLM время складывается из&nbsp;стандартных операций:
          нажатие 0,2&nbsp;с, наведение 1,1&nbsp;с, мысленная подготовка 1,35&nbsp;с. Режим исключений и&nbsp;клавиши сокращают путь втрое.
        </p>
        <Figure n={1} title="Время задачи по&nbsp;модели нажатий, секунды">
          <Bars max={12} fmt={(v) => `${num(v, 1)} с`}
            rows={KLM.map((k, i) => ({ label: k.label, value: k.value, note: k.note, strong: i === KLM.length - 1, color: i === KLM.length - 1 ? 'var(--b-accent)' : 'var(--b-l2)' }))} />
        </Figure>
      </section>

      <section id="u-color">
        <h2><span className="ic"><IconPalette /></span>Загрузка показана оттенками синего, порог отмечен знаком</h2>
        <p>
          Цвета взяты из&nbsp;навигации московского транспорта. Красный используется только в&nbsp;знаке: на&nbsp;карте Москвы красный означает метро, и&nbsp;красную
          остановку можно было&nbsp;бы принять за&nbsp;станцию. Синим наземного транспорта выделены маршрут, выбранный элемент и&nbsp;главное действие. Загрузку показывает
          насыщенность синего, а&nbsp;превышение порога отмечено отдельным знаком. Красно-зелёная шкала недоступна тем, кто не&nbsp;различает эти цвета;
          среди мужчин это каждый двенадцатый.
        </p>
        <Figure n={2} title="Палитра экрана: образцы используют цвета интерфейса и&nbsp;меняются вместе с&nbsp;темой">
          <div className="b-an-swatch">
            <div className="g">
              <span><i style={{ background: 'var(--b-brand)' }} />Знак</span>
              <span><i style={{ background: 'var(--b-accent)' }} />Маршрут, действие</span>
              <span><i style={{ background: 'var(--b-over)' }} />Выше порога</span>
              <span><i style={{ background: 'var(--b-warn)' }} />Внимание</span>
            </div>
            <div className="scale">
              {SCALE.map((s) => <span key={s.v}><i style={{ background: `var(${s.v})` }} />{s.label}</span>)}
              <span className="over"><i style={{ background: 'var(--b-l2)', boxShadow: 'inset 0 0 0 2px var(--b-over)' }} />порог</span>
            </div>
          </div>
        </Figure>
        <p className="b-muted">
          Если установлена Moscow Sans, используется она, иначе открытая Golos Text со&nbsp;сходной пластикой. Размер шрифта и&nbsp;межстрочный интервал 13/18, цифры табличные: столбцы
          сохраняют выравнивание при&nbsp;обновлении. Геометрия Gravity UI: поля и&nbsp;кнопки 36&nbsp;и&nbsp;28, скругление 8&nbsp;и&nbsp;6.
        </p>
      </section>

      <section id="u-dec">
        <h2><span className="ic"><IconCheck /></span>Одиннадцать решений для&nbsp;поиска риска и&nbsp;принятия рекомендации</h2>
        <p>Для&nbsp;каждого решения подобран референс, изменения проверены на&nbsp;рабочем макете.</p>
        <ol className="b-an-dec">
          {DECISIONS.map((d, i) => (
            <li key={d.title}><span className="n">{i + 1}</span><div><b>{d.title}</b><p>{d.text}</p></div></li>
          ))}
        </ol>
      </section>

      <section id="u-ref">
        <h2><span className="ic"><IconMapPin /></span>За&nbsp;основу взяты диспетчерские системы и&nbsp;модель KLM</h2>
        <p>
          Разобраны экраны промышленных систем планирования и&nbsp;диспетчеризации, городских диспетчерских, принципы высокоэффективного интерфейса
          для&nbsp;операторов и&nbsp;модель нажатий KLM. Выбраны приёмы, которые сокращают путь до&nbsp;решения.
        </p>
        <div className="b-an-chips">{REFERENCES.map((r) => <span key={r}>{r}</span>)}</div>
      </section>
    </article>
  )
}
