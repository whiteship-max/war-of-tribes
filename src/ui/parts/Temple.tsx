// Храм: насколько крепко верит деревня — набожность, обряд, святыня, служители.
// Во что она верит и что эта вера даёт державе — `RealmFaith` ниже, вкладка
// «Религия» меню державы.
//
// Панель ничего не считает сама. Набожность и её слагаемые приходят из
// `pietyBreakdown`, наклон веры — из `faithTilt`, цена и запрет обряда — из
// `riteInfo`, цена крещения — из `baptismInfo`. Своей арифметики здесь быть не
// должно ни одной строки: посчитанное второй раз расходится с игрой при первой
// же правке чисел, и учиться игрок будет неправде.
//
// Цена везде показана той же формой, что у стройки, ковки и события (`Cost`):
// «нужно столько, а есть столько», и по той же нехватке гаснет кнопка рядом.
import type { FaithId, ObservanceId } from '@/game/types';
import { useGame } from '@/game/store';
import { DAY_LENGTH, PIETY_HERESY, RITE_DAYS } from '@/game/constants';
import { FAITH_BY_ID, OBSERVANCES } from '@/game/data/faiths';
import { SEASON_META } from '@/game/data/seasons';
import {
  faithDef,
  faithTilt,
  jobCounts,
  observanceOf,
  pietyBreakdown,
  population,
  seasonOf,
  templeLevel,
  type PietyLine,
} from '@/game/derived';
import { baptismInfo, baptize, holdRite, riteInfo, setObservance, strainDaysLeft } from '@/game/sim/faith';
import { Cost } from './Cost';
import { useRealm } from '@/ui/realm/open';
import { waitDays, waitDaysBoth } from './wait';

const sign = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}`;
const days = (sec: number): number => Math.ceil(sec / DAY_LENGTH);

function Lines({ lines }: { lines: PietyLine[] }) {
  if (lines.length === 0) return <div className="note">Ничего.</div>;
  return (
    <div className="mod-list">
      {lines.map((l) => (
        <div className="mod" key={l.id}>
          <span className="ico">{l.icon}</span>
          <span className="name">
            {l.name}
            <em className="sub">{l.hint}</em>
          </span>
          <span className={`val ${l.value > 0 ? 'pos' : l.value < 0 ? 'neg' : ''}`}>{sign(l.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Вера ещё не названа: мир не сказал, где стоит замок. Одни слова на храм и меню. */
function NoFaith() {
  return (
    <>
      <h3>Вера</h3>
      <div className="note">
        Грамоты из округи ещё не пришли: вера у деревни та же, что у земли вокруг, а
        где эта земля — знает карта. Загляни сюда, открыв карту мира хотя бы раз.
      </div>
    </>
  );
}

export function Temple() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const showRealm = useRealm((r) => r.show);
  const def = faithDef(s);

  // Мир ещё не сказал, где стоит замок. Подставить веру «пока что» нельзя:
  // деревня под Вильнюсом на минуту оказалась бы католической и сменила бы веру
  // молча. Честнее сказать прямо — тем более что ждать тут секунды.
  if (!def) return <NoFaith />;

  const b = pietyBreakdown(s);
  const value = Math.round(b.value);
  const rite = riteInfo(s);
  const heretical = value < PIETY_HERESY;
  const priests = jobCounts(s).priest;

  const up = b.lines.filter((l) => l.value >= 0).sort((a, c) => c.value - a.value);
  const down = b.lines.filter((l) => l.value < 0).sort((a, c) => a.value - c.value);

  return (
    <>
      {/* Вера страны — какая она, что даёт, устав и крещение — живёт в меню державы,
          вкладка «Религия»: это решения о державе, а не о здании. Здесь то, что
          делают у храма: набожность прихода, обряд, святыня и служители. */}
      <div className="card">
        <div className="ico">{def.icon}</div>
        <div className="body">
          <div className="title">
            {def.name}
            <span className="count">{def.temple.toLowerCase()} {templeLevel(s)} ур.</span>
          </div>
        </div>
      </div>
      <button className="btn ghost wide" onClick={() => showRealm('faith')}>
        ⛪ Вера державы: наклон, устав, крещение
      </button>

      <h3>
        Набожность <span className="muted">{value} из 100</span>
      </h3>
      <div className={`progress ${heretical ? '' : 'good'}`} style={{ marginBottom: 10 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      {heretical ? (
        <div className="note">
          🔥 В приходе раскол. Ниже {PIETY_HERESY} вера трещит: люди спорят вместо работы, и
          настроение падает тем сильнее, чем меньше в деревне веры. Помогает обряд, строгий
          устав и уровень {def.temple.toLowerCase()}а.
        </div>
      ) : (
        <div className="note">
          Пока набожность выше {PIETY_HERESY}, приход держится. Провалится ниже — начнётся
          раскол, и он ударит по настроению всей деревни.
        </div>
      )}

      <h3>Что добавляет</h3>
      <Lines lines={up} />
      <h3>Что отнимает</h3>
      <Lines lines={down} />
      {s.faith.strain > 0 && strainDaysLeft(s) > 0 && (
        <div className="note">
          Надлом затянется за {waitDays(Math.ceil(strainDaysLeft(s)))} — сам, без нашего участия.
        </div>
      )}

      <h3>
        Обряд <span className="muted">{SEASON_META[seasonOf(s.time)].name.toLowerCase()}</span>
      </h3>
      {rite.feast && (
        <div className="card">
          <div className="ico">{rite.feast.icon}</div>
          <div className="body">
            <div className="title">
              {rite.feast.name}
              <span className="count">{rite.left > 0 ? `идёт ещё ${waitDays(days(rite.left))}` : 'раз в сезон'}</span>
            </div>
            <div className="desc">{rite.feast.text}</div>
          </div>
        </div>
      )}
      <Cost cost={{ food: rite.food, gold: rite.gold }} />
      <button className="btn wide" disabled={rite.blocked !== null} onClick={() => act((st) => holdRite(st))}>
        Справить — набожность и настроение на {waitDaysBoth(RITE_DAYS)}
      </button>
      {rite.blocked && <div className="hint">{rite.blocked}</div>}

      <h3>Святыня</h3>
      {s.faith.relic ? (
        <div className="mod total">
          <span className="ico">📿</span>
          <span className="name">
            {FAITH_BY_ID[s.faith.relic].relic}
            <em className="sub">пока она в храме, приход крепче</em>
          </span>
          <span className="val pos">+8</span>
        </div>
      ) : (
        <div className="note">
          Своей святыни у прихода нет. Их не покупают и не куют — они приходят сами, с
          купцом или из похода. Уносят их тоже: прорвавшийся набег вынесет реликвию вместе
          со складом.
        </div>
      )}

      <h3>
        {def.priests} <span className="muted">{priests} чел.</span>
      </h3>
      <div className="note">
        Служители держат набожность и настроение разом. Ставят их сюда же, рядовым числом —
        ряд рабочих выше.
      </div>
    </>
  );
}

/**
 * Вера державы — вкладка «Религия» меню державы: какой веры деревня, что эта
 * вера даёт и чего просит, устав прихода и крещение. Правило деления с храмом:
 * сюда то, что решается раз на всю державу и меняет её целиком; у здания —
 * то, что делают у храма руками и что держит приход (набожность, обряд,
 * святыня, служители).
 */
export function RealmFaith() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const def = faithDef(s);

  if (!def) return <NoFaith />;

  const tilt = faithTilt(s);
  const level = templeLevel(s);
  const obs = observanceOf(s);
  const bapt = baptismInfo(s);

  return (
    <>
      <h3>Вера деревни</h3>
      <div className="card">
        <div className="ico">{def.icon}</div>
        <div className="body">
          <div className="title">
            {def.name}
            <span className="count">{def.temple.toLowerCase()} {level} ур.</span>
          </div>
          <div className="desc">{def.creed}</div>
        </div>
      </div>
      {s.faith.converted && (
        <div className="note">
          Деревня приняла крещение и живёт по новому обряду. Обратной дороги нет — так это
          и было: решение принимали раз.
        </div>
      )}

      <h3>Наклон веры</h3>
      <div className="note">
        Уровень {def.temple.toLowerCase()}а не прибавляет силы — он растит наклон целиком,
        вместе с ценой. Сейчас {level} из 10, поэтому и дар, и цена идут в {level} десятых
        от полного.
      </div>
      <div className="mod">
        <span className="ico">🎁</span>
        <span className="name">
          Что даёт
          <em className="sub">{tilt.boon}</em>
        </span>
      </div>
      <div className="mod">
        <span className="ico">⚖️</span>
        <span className="name">
          Чего просит
          <em className="sub">{tilt.burden}</em>
        </span>
      </div>
      <TiltRow
        show={Math.abs(tilt.goldPerPop) > 0.001}
        icon="💰"
        name={tilt.goldPerPop > 0 ? 'Десятина в казну' : 'Закят из казны'}
        hint={`${Math.abs(tilt.goldPerPop).toFixed(2)} с человека в день · ${population(s)} чел.`}
        value={`${sign(tilt.goldPerPop * population(s))} в день`}
        good={tilt.goldPerPop > 0}
      />
      <TiltRow
        show={Math.abs(tilt.morale) > 0.001}
        icon="😊"
        name="Настроение деревни"
        hint="слагаемое целевой морали"
        value={sign(tilt.morale)}
        good={tilt.morale > 0}
      />
      <TiltRow
        show={Math.abs(tilt.output - 1) > 0.001}
        icon="⛏️"
        name="Выработка всех профессий"
        hint="служб и постов в году много"
        value={`×${tilt.output.toFixed(2)}`}
        good={tilt.output > 1}
      />
      <TiltRow
        show={Math.abs(tilt.steadfast) > 0.001}
        icon="🛡️"
        name="Оборона деревни"
        hint="община держит тех, кто на стене"
        value={`×${(1 + tilt.steadfast).toFixed(2)}`}
        good
      />
      <TiltRow
        show={Math.abs(tilt.learning - 1) > 0.001}
        icon="📖"
        name="Изучение округи в Дозоре"
        hint="медресе учит счёту и письму"
        value={`×${tilt.learning.toFixed(2)}`}
        good={tilt.learning > 1}
      />
      <TiltRow
        show={Math.abs(tilt.growth) > 0.001}
        icon="👥"
        name="Прирост населения"
        hint="закят держит бедных на ногах"
        value={`×${(1 + tilt.growth).toFixed(2)}`}
        good
      />
      <TiltRow
        show={tilt.fervour > 0.001}
        icon="⚔️"
        name="Стойкость дружины в обряд"
        hint="ровно та же против кого угодно"
        value={`+${tilt.fervour.toFixed(1)}`}
        good
      />

      <h3>Устав прихода</h3>
      <div className="note">
        Устав ничего не добавляет от себя: он множит наклон целиком — и дар, и цену. Платят
        за строгость набожностью в другую сторону.
      </div>
      <div className="choice">
        {OBSERVANCES.map((o) => (
          <button
            key={o.id}
            className={`choice-opt${obs === o.id ? ' on' : ''}`}
            onClick={() => act((st) => setObservance(st, o.id as ObservanceId))}
          >
            <span className="ico">{o.icon}</span>
            <b>{o.name}</b>
            <small>{o.effect}</small>
          </button>
        ))}
      </div>

      {bapt.options.length > 0 && (
        <>
          <h3>Крещение</h3>
          <div className="note">
            Принять крест — решение вождя, а не обряд. Соседи иной веры перестанут смотреть
            на нас как на чужих, и посольства пойдут проще. Цена: дары и посольство, старая
            святыня из храма и надлом, от которого вера в деревне затрещит на несколько
            дней. Обратной дороги нет.
          </div>
          <Cost cost={{ gold: bapt.gold }} />
          <div className="choice">
            {bapt.options.map((id) => (
              <button
                key={id}
                className="choice-opt"
                disabled={bapt.blocked !== null}
                onClick={() => act((st) => baptize(st, id as FaithId))}
              >
                <span className="ico">{FAITH_BY_ID[id].icon}</span>
                <b>{FAITH_BY_ID[id].name}</b>
                <small>{FAITH_BY_ID[id].tilt.boon}</small>
              </button>
            ))}
          </div>
          {bapt.blocked && <div className="hint">{bapt.blocked}</div>}
        </>
      )}
    </>
  );
}

/** Строка наклона. Прячется, когда вера этого числа не трогает: ноль — шум. */
function TiltRow({
  show,
  icon,
  name,
  hint,
  value,
  good,
}: {
  show: boolean;
  icon: string;
  name: string;
  hint: string;
  value: string;
  good?: boolean;
}) {
  if (!show) return null;
  return (
    <div className="mod">
      <span className="ico">{icon}</span>
      <span className="name">
        {name}
        <em className="sub">{hint}</em>
      </span>
      <span className={`val ${good ? 'pos' : 'neg'}`}>{value}</span>
    </div>
  );
}
