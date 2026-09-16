import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import {
  armyPower,
  armySize,
  buildingOfType,
  defense,
  idleCount,
  upkeepInfo,
  wageOf,
} from '@/game/derived';
import { orderEta, recruitCheck } from '@/game/sim/army';
import { dismissCheck } from '@/game/sim/upkeep';
import { cancelRecruit, dismissSoldiers, startRecruit } from '@/game/sim/actions';
import { UPKEEP_TEXT } from '@/game/data/upkeep';
import { Icon } from '@/ui/icons/Icon';

/**
 * Казармы: список бойцов по образцу Tribal Wars — иконка, цена, время, поле
 * количества и кнопка найма. Цена всегда полная: ресурсы, снаряжение, живой
 * человек и время учений.
 *
 * Тупика без объяснения быть не должно: если не хватает снаряжения, здесь
 * написано, чего именно, и рядом стоит кнопка перехода в кузницу.
 *
 * Здесь же цена, которой держится войско: жалованье в день против того, что даёт
 * казна, долг и терпение, — и «распустить» для тех, кого казна не тянет. Своей
 * арифметики у панели нет: всё считает `derived.upkeepInfo`.
 */
export function Barracks() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const act = useGame((g) => g.act);
  const [counts, setCounts] = useState<Partial<Record<TroopId, number>>>({});
  const [release, setRelease] = useState<Partial<Record<TroopId, number>>>({});
  const up = upkeepInfo(s);
  const smithy = buildingOfType(s, 'smithy');
  const palisade = buildingOfType(s, 'palisade');
  const free = idleCount(s);

  const setCount = (id: TroopId, n: number): void =>
    setCounts((c) => ({ ...c, [id]: Math.max(1, Math.min(99, n)) }));

  return (
    <>
      <h3>
        Дружина <span className="muted">бойцов: {armySize(s)}</span>
      </h3>
      <div className="mod total">
        <span className="ico">⚔️</span>
        <span className="name">Мощь армии</span>
        <span className="val pos">{Math.round(armyPower(s))}</span>
      </div>
      <div className="mod">
        <span className="ico">🛡️</span>
        <span className="name">Защита поселения</span>
        <span className="val">{defense(s).toFixed(0)}</span>
      </div>
      {/* Как дружина встретит набег, решают у стены: там раздел «Оборона» и вход в
          расстановку. Второго экрана здесь нет — только дверь туда. */}
      {palisade && (
        <button className="btn ghost wide" onClick={() => openBuilding(palisade.id)}>
          🛡️ Оборона — у частокола
        </button>
      )}
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">Свободных жителей</span>
        <span className={`val${free === 0 ? ' neg' : ''}`}>{free}</span>
      </div>

      <h3>Жалованье</h3>
      <div className="mod">
        <span className="ico">{UPKEEP_TEXT.icon}</span>
        <span className="name">
          Войску в день
          {up.amnestyDays > 0 && <em className="sub">платить начнут через {Math.ceil(up.amnestyDays)} дн.</em>}
        </span>
        <span className={`val${up.wages > up.income ? ' neg' : ''}`}>{Math.round(up.wages)}</span>
      </div>
      <div className="mod">
        <span className="ico"><Icon name="res-gold" glyph="💰" /></span>
        <span className="name">Казна даёт в день — налог и вера</span>
        <span className="val">{Math.round(up.income)}</span>
      </div>
      {up.debt > 0 && (
        <div className="mod">
          <span className="ico">📜</span>
          <span className="name">Долг войску</span>
          <span className="val neg">{Math.round(up.debt)}</span>
        </div>
      )}
      <div className="mod">
        <span className="ico">🗿</span>
        <span className="name">Терпит неуплату и голод — Статуя</span>
        <span className="val">{up.graceDays} дн.</span>
      </div>
      {up.why ? (
        <p className="note bad">
          Войску {UPKEEP_TEXT.why[up.why]}.{' '}
          {up.leavingPerDay > 0
            ? `Уходят — около ${Math.max(1, Math.round(up.leavingPerDay))} в день, равной долей каждого вида.`
            : `Уходить начнут через ${Math.max(1, Math.ceil(up.graceDays - up.lateDays))} дн.`}{' '}
          {up.why === 'pay'
            ? 'Уход встанет, как только казна покроет жалованье: подними налог или распусти лишних.'
            : 'Войско ест последним: уход встанет, когда амбару хватит на всех.'}
        </p>
      ) : up.treasuryDays !== null ? (
        <p className="note">Жалованье больше дохода: казны хватит на {Math.max(1, Math.ceil(up.treasuryDays))} дн.</p>
      ) : (
        <p className="note">Нечем платить или нечем кормить — войско терпит, потом уходит. Без тебя уход ждёт, долг копится.</p>
      )}

      {s.recruits.length > 0 && (
        <>
          <h3>Очередь найма</h3>
          {s.recruits.map((o, i) => {
            const def = TROOP_BY_ID[o.troop];
            // Срок — той же скоростью, какой идёт очередь: с видом бойца и конюшней.
            const eta = orderEta(s, o);
            const pct = Math.floor((o.work / def.work) * 100);
            return (
              <div className="card" key={o.id}>
                <div className="ico">
                  <Icon name={`troop-${def.id}`} glyph={def.icon} />
                </div>
                <div className="body">
                  <div className="title">
                    {def.name}
                    <span className="count">
                      {o.done}/{o.count} · {i === 0 ? (eta !== null ? `~${eta} с` : 'стоит') : 'ждёт'}
                    </span>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${i === 0 ? pct : 0}%` }} />
                  </div>
                </div>
                <button
                  className="btn ghost"
                  onClick={() => act((st) => cancelRecruit(st, o.id))}
                  aria-label="Отменить набор"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </>
      )}

      <h3>Нанять</h3>
      {TROOPS.map((def) => {
        const n = counts[def.id] ?? 1;
        const check = recruitCheck(s, def.id, n);
        const have = s.army[def.id] ?? 0;
        return (
          <div className="troop" key={def.id}>
            <div className="ico">
              <Icon name={`troop-${def.id}`} glyph={def.icon} />
            </div>
            <div className="body">
              <div className="title">
                {def.name}
                <span className="count">
                  в дружине: {have} · мощь {def.power} · 💰 {wageOf(s, def.id).toFixed(2)}/д
                </span>
              </div>
              <div className="desc">{def.description}</div>
              <div className="cost">
                {RESOURCE_IDS.filter((r) => def.cost[r]).map((r) => (
                  <span key={r} className={s.resources[r] >= (check.cost[r] ?? 0) ? '' : 'no'}>
                    <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} /> {check.cost[r]}
                  </span>
                ))}
                {Object.entries(check.gear).map(([id, need]) => {
                  const short = check.missing.some((m) => m.id === id);
                  return (
                    <span key={id} className={short ? 'no' : ''}>
                      <Icon name={`gear-${id}`} glyph={EQUIPMENT_BY_ID[id as keyof typeof EQUIPMENT_BY_ID].icon} /> {need}
                    </span>
                  );
                })}
                <span className={free >= n ? '' : 'no'}>👤 {n}</span>
                <span>⏳ {check.eta !== null ? `${check.eta} с` : `${check.work}`}</span>
              </div>
            </div>
            <div className="troop-buy">
              <div className="stepper">
                <button disabled={n <= 1} onClick={() => setCount(def.id, n - 1)}>
                  −
                </button>
                <span className="n">{n}</span>
                <button onClick={() => setCount(def.id, n + 1)}>+</button>
              </div>
              <button
                className="btn"
                data-tut={`recruit-${def.id}`}
                disabled={check.blocked !== null}
                onClick={() => act((st) => startRecruit(st, def.id, n))}
              >
                Нанять
              </button>
              <small className={check.blocked ? 'no' : ''}>
                {check.blocked ?? `свободных останется ${check.freeAfter}`}
              </small>
              {check.missing.length > 0 && smithy && (
                <button className="btn ghost wide" onClick={() => openBuilding(smithy.id)}>
                  ⚒️ В кузницу — ковать {check.missing.map((m) => EQUIPMENT_BY_ID[m.id].one).join(', ')}
                </button>
              )}
              {check.missing.length > 0 && !smithy && (
                <div className="note bad">Снаряжение делают в кузнице — её ещё нет.</div>
              )}
            </div>
          </div>
        );
      })}

      {armySize(s) > 0 && (
        <>
          <h3>Распустить по домам</h3>
          <p className="note">
            Люди вернутся в посёлок, снаряжение — на склад. Припас найма и время учений не вернуть.
          </p>
          {TROOPS.filter((def) => (s.army[def.id] ?? 0) > 0).map((def) => {
            const n = Math.max(1, release[def.id] ?? 1);
            const check = dismissCheck(s, def.id, n);
            const set = (v: number): void =>
              setRelease((c) => ({ ...c, [def.id]: Math.max(1, Math.min(Math.max(1, check.max), v)) }));
            return (
              <div className="slot pick" key={def.id}>
                <span className="ico">
                  <Icon name={`troop-${def.id}`} glyph={def.icon} />
                </span>
                <span className="who">
                  {def.name} <i className="talent">дома {check.max} · −{Math.round(check.saves)} зол./д</i>
                </span>
                <div className="stepper">
                  <button disabled={n <= 1} onClick={() => set(n - 1)}>
                    −
                  </button>
                  <span className="n">{n}</span>
                  <button disabled={n >= check.max} onClick={() => set(n + 1)}>
                    +
                  </button>
                </div>
                <button
                  className="mini text"
                  disabled={check.blocked !== null}
                  onClick={() => act((st) => dismissSoldiers(st, def.id, n))}
                >
                  распустить
                </button>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
