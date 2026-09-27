import { num } from '../../data'
import { Figure, LineChart, Tiles } from './charts'
import { ABUSE, BREAKS, BRUTE, OVERLOAD, STEPS, STREAM } from './facts'
import { ArtOps, IconApi, IconGauge, IconKey, IconSatellite, IconShield, IconWarning } from './art'

export default function OpsPage() {
  return (
    <article className="b-an">
      <header className="b-an-hero">
        <div className="b-an-art"><ArtOps /></div>
        <p className="kick">Отчёты · нагрузка и&nbsp;безопасность</p>
        <h1>Проверка сервиса: нагрузка, отказы, атаки</h1>
        <p className="lede">
          В&nbsp;отдельном контуре проверок на&nbsp;контейнере 2&nbsp;vCPU и&nbsp;2&nbsp;ГБ воспроизведены ступени нагрузки, приём полного дня валидаций, падение копии, поток
          координат 608&nbsp;вагонов, поломки потока данных, перебор паролей и&nbsp;злоупотребления. Каждая найденная ошибка исправлена и&nbsp;перепроверена
          тем&nbsp;же запросом.
        </p>
        <Tiles items={[
          { value: `${num(STEPS[STEPS.length - 1].p95, 1)} мс`, label: `p95 при ${num(STEPS[STEPS.length - 1].rps)} запросах в секунду`, note: 'ошибок нет' },
          { value: '≈ 1 млн', label: 'строк валидаций в секунду на приёме', note: '13,4 млн строк за 13 с под нагрузкой экрана' },
          { value: '0', label: 'ошибок из 27 001 запроса при падении копии', note: 'две копии за nginx' },
          { value: '4', label: 'ошибки найдены и исправлены', note: 'три при злоупотреблениях, одна в данных остановок' },
        ]} />
      </header>

      <section id="o-steps">
        <h2><span className="ic"><IconGauge /></span>Задержка ответа при&nbsp;росте нагрузки</h2>
        <p>
          Запросы приходят с&nbsp;заданной частотой независимо от&nbsp;скорости ответа сервиса. Это воспроизводит нагрузку от&nbsp;сотен экранов.
          Набор запросов соответствует работе экрана: день маршрута по&nbsp;часам, месяц, окна риска, пересчёт, выгрузка, остановки. До&nbsp;{num(STEPS[STEPS.length - 1].rps)}{' '}
          запросов в&nbsp;секунду медианная задержка снижается: прогноз лежит в&nbsp;памяти, прогретая машина отвечает быстрее.
        </p>
        <Figure n={1} title="Задержка ответа по&nbsp;ступеням нагрузки, миллисекунды"
          legend={[{ label: 'медиана', color: 'var(--b-l2)' }, { label: 'p95', color: 'var(--b-accent)' }, { label: 'p99', color: 'var(--b-text-3)', dashed: true }]}
          note={`На ${num(OVERLOAD.rps)} запросах в секунду копия отвечает на ${num(OVERLOAD.served)} в секунду, p95 — ${num(OVERLOAD.p95 / 1000, 1)} с, ошибок ${OVERLOAD.errors}: предел одной копии около 2 500 в секунду, для большей нагрузки нужна вторая копия.`}>
          <LineChart x={STEPS.map((s) => `${num(s.rps)}/с`)} lo={0} hi={18} ticks={[0, 5, 10, 15]} fmt={(v) => `${num(v, 1)} мс`} height={240}
            series={[
              { key: 'p50', label: 'медиана', color: 'var(--b-l2)', values: STEPS.map((s) => s.p50) },
              { key: 'p95', label: 'p95', color: 'var(--b-accent)', values: STEPS.map((s) => s.p95) },
              { key: 'p99', label: 'p99', color: 'var(--b-text-3)', values: STEPS.map((s) => s.p99), dashed: true },
            ]} />
        </Figure>
      </section>

      <section id="o-live">
        <h2><span className="ic"><IconSatellite /></span>Валидации и&nbsp;ГЛОНАСС: скорость обработки и&nbsp;отставание экрана</h2>
        <p>
          Эмулятор навигационной платформы ведёт 608&nbsp;вагонов 38&nbsp;маршрутов по&nbsp;реальным трассам и&nbsp;воспроизводит сбои терминалов: нули вместо
          координат, скачки на&nbsp;3&nbsp;км, время из&nbsp;будущего, повторы и&nbsp;опоздавшие отметки. При&nbsp;десяти отметках в&nbsp;секунду от&nbsp;вагона
          (5&nbsp;924&nbsp;в&nbsp;секунду суммарно) p95 времени обработки пачки составляет 5,1&nbsp;мс. Все сбойные отметки отброшены. Чем плотнее поток валидаций,
          тем меньше отставание экрана.
        </p>
        <div className="b-an-kv">
          {STREAM.map((s) => <div key={s.label}><b>{s.value}</b><span>отставание экрана, {s.label}</span><small>{s.note}</small></div>)}
        </div>
      </section>

      <section id="o-breaks">
        <h2><span className="ic"><IconWarning /></span>Сбои потока: пропуски исключаются из&nbsp;пересчёта</h2>
        <p>
          Пересчёт дня по&nbsp;факту проверен воспроизведением данных вторника 21&nbsp;октября 2025&nbsp;года с&nbsp;намеренными сбоями. Часы без&nbsp;связи
          исключаются из&nbsp;расчёта поправки, поэтому отсутствие данных не&nbsp;занижает прогноз.
        </p>
        <ol className="b-an-dec">
          {BREAKS.map((b, i) => <li key={b.what}><span className="n">{i + 1}</span><div><b>{b.what}</b><p>{b.got}</p></div></li>)}
        </ol>
      </section>

      <section id="o-sec">
        <h2><span className="ic"><IconShield /></span>Доступ ограничен ролями, приём данных защищён лимитами</h2>
        <div className="b-an-cards c3">
          <div><h4><IconKey />Роли и&nbsp;пароли</h4><p>Две роли: диспетчер читает прогноз, сервис приёма пишет факт; запрос к&nbsp;методу чужой роли возвращает 403. Паролей по&nbsp;умолчанию нет: без&nbsp;них образ
            не&nbsp;запускается. Пароль проверяется через bcrypt. После успешного входа хеш SHA-256 пары учётных данных хранится пять минут.</p></div>
          <div><h4><IconShield />Защита от&nbsp;перебора</h4><p>Если с&nbsp;адреса за&nbsp;минуту введено больше 20&nbsp;неверных паролей, он&nbsp;блокируется на&nbsp;5&nbsp;минут. Новых проверок bcrypt не&nbsp;больше 8&nbsp;в&nbsp;секунду
            на&nbsp;весь сервис. Адрес за&nbsp;балансировщиком берётся из&nbsp;X-Forwarded-For, который балансировщик перезаписывает.</p></div>
          <div><h4><IconApi />Ограничения входящих запросов</h4><p>Размер тела, адреса и&nbsp;заголовков ограничен. Повтор пачки отклоняется по&nbsp;X-Batch-Id, в&nbsp;памяти хранится не&nbsp;больше 20&nbsp;000&nbsp;бортов.
            Медленные соединения закрываются. Образ работает без&nbsp;интернета.</p></div>
        </div>
        <Figure n={2} title="Перебор паролей: задержка ответа диспетчерам во&nbsp;время атаки, p95">
          <div className="b-an-kv">
            {BRUTE.map((b) => <div key={b.label}><b>{b.value}</b><span>{b.label}</span><small>{b.note}</small></div>)}
          </div>
        </Figure>
        <Figure n={3} title="Ответы сервиса на&nbsp;злоупотребления; параллельно экран получает ответы на&nbsp;100&nbsp;запросов в&nbsp;секунду без&nbsp;ошибок">
          <div className="b-an-codes">
            {ABUSE.map((a) => <div key={a.what}><span>{a.what}</span><code>{a.code}</code></div>)}
          </div>
        </Figure>
        <p>
          По&nbsp;результатам проверки исправлены три ошибки: повтор маршрута в&nbsp;списке раздувал ответ до&nbsp;43&nbsp;МБ, а&nbsp;слишком длинное тело или строка обрывали
          соединение ошибкой 500 вместо отказа по&nbsp;лимиту. Четвёртая ошибка обнаружилась при&nbsp;проверке остановок: в&nbsp;ночной час без&nbsp;октябрьских долей посадки терялись;
          теперь сумма по&nbsp;остановкам сходится с&nbsp;маршрутом во&nbsp;всех 7&nbsp;625&nbsp;срезах.
        </p>
      </section>

      <section id="o-next">
        <h2><span className="ic"><IconKey /></span>Для&nbsp;пилота нужны TLS, журнал входов и&nbsp;лимиты пользователей</h2>
        <ol className="b-an-list">
          <li>TLS на&nbsp;входе и&nbsp;журнал входов по&nbsp;требованиям к&nbsp;объектам критической информационной инфраструктуры.</li>
          <li>Ограничение частоты запросов на&nbsp;пользователя: сейчас диспетчер с&nbsp;верным паролем сам может нагрузить копию.</li>
          <li>Приём координат по&nbsp;протоколу NDTP напрямую от&nbsp;бортовых терминалов. Сейчас сервис получает готовые отметки платформы.</li>
          <li>Сейчас перебор блокируется по&nbsp;адресу: диспетчеры за&nbsp;одним NAT с&nbsp;атакующим тоже получат паузу на&nbsp;пять минут.</li>
        </ol>
      </section>
    </article>
  )
}
