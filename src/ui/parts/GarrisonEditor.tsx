// Состав дружины полководца — один компонент на два места: карточка своего замка на
// карте и Статуя Героя в деревне. Состояние у мира одно (`world/store.setGarrison`),
// отказы — его же словами, и своих слов о том, почему состав не поменять, здесь нет:
// в пути, укрылся, дружина в дороге, осада — всё это говорит мир. Потолка у дружины нет:
// войско держит цена (`data/upkeep.ts`), а не Статуя.
// Прецедент показа в двух местах — настройки (`Settings`). Держит это тест по
// исходнику (`GarrisonEditor.test.ts`): `setGarrison` зовёт ровно этот файл.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { defense } from '@/game/derived';
import { secondsLeft } from '@/world/geo';
import { realLeft } from '@/ui/parts/wait';
import { plus, postureOf, roomOf, type Posture } from '@/world/muster';
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import type { GameState } from '@/game/types';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { Icon } from '@/ui/icons/Icon';

/**
 * Какой будет оборона, пока идёт сбор, и когда дружина встанет дома. Считает та же
 * `defense`, что и всегда, — на племени, у которого не дома ровно те, кого сбор
 * касается, **по видам**: латник, ушедший в сбор, уносит мощь латника.
 *
 * Не в обороне сверх дружины — отряды в пути: дружина, стоящая дома, в `s.away` не
 * входит, в сборе и в поле — входит вся. В сборе числятся все, кого он касается, —
 * те же `max(было, станет)` по видам, что кладёт в дружину сам мир (`setGarrison`).
 */
export function musterDefense(s: GameState, held: TroopStack, want: TroopStack, posture: Posture): { during: number; after: number } {
  const marches = troopsAfter(s.away, posture === 'stands' ? {} : held);
  const onRoad: TroopStack = {};
  for (const t of TROOP_IDS) onRoad[t] = Math.max(held[t] ?? 0, want[t] ?? 0);
  return {
    during: defense({ ...s, away: plus(marches, onRoad) }),
    after: defense({ ...s, away: marches }),
  };
}

/**
 * Что полководец держит при себе. Правится только вплотную к своей деревне: в
 * поле состав войска не меняется, и это правило игры, а не ограничение панели.
 */
export function GarrisonEditor() {
  const s = useGame((g) => g.s);
  const showToast = useGame((g) => g.showToast);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const setGarrison = useWorld((g) => g.setGarrison);
  const general = figures.find((f) => f.id === 'general');
  const held: TroopStack = general?.troops ?? {};
  // Сколько можно держать при себе — всё войско, что не ушло отрядами: дома
  // дружина уже в гарнизоне, и складывать её с ним второй раз нельзя. Тем же
  // правилом отказывает мир (`world/muster.roomOf`).
  const pool = roomOf(s.army, marches);
  const [want, setWant] = useState<TroopStack>(held);
  const [busy, setBusy] = useState(false);

  // Пришёл новый состав из мира — начинаем от него, а не от прошлого выбора.
  const key = TROOP_IDS.map((t) => held[t] ?? 0).join(',');
  useEffect(() => setWant({ ...held }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!general) return null;
  const rows = TROOP_IDS.filter((t) => (pool[t] ?? 0) + (held[t] ?? 0) > 0);
  const total = troopTotal(want);
  const gathering = general.readyAt > worldNow();
  const posture = postureOf(general);
  // Три состояния дружины, и за разницу между ними игрок платит: собранная и
  // стоящая у своих ворот — часть гарнизона; пока идёт сбор, эти
  // люди не защищают никого; в поле — не защищают тоже (`world/muster`). Игрок
  // обязан видеть обе цены до того, как отдаст приказ: сколько обороны стоит сам
  // сбор и какой она станет, когда дружина соберётся. Считает та же `defense`,
  // что и всегда, — только для выбранной дружины, а не своей арифметикой рядом.
  const def = defense(s);
  // Ничего не меняется — сбора нет.
  let moved = 0;
  for (const t of TROOP_IDS) moved += Math.abs((held[t] ?? 0) - (want[t] ?? 0));
  const { during, after } = musterDefense(s, held, want, posture);
  const apply = async (next: TroopStack | null): Promise<void> => {
    setBusy(true);
    const err = await setGarrison(next);
    setBusy(false);
    showToast(err ?? (troopTotal(next ?? {}) > 0 ? 'Отряд отдан полководцу.' : 'Отряд идёт в гарнизон.'));
  };

  return (
    <>
      <h3>
        Отряд полководца{' '}
        <small>{total}</small>
      </h3>
      {gathering ? (
        <p className="note bad">
          Сбор ещё {realLeft(secondsLeft(general.readyAt, worldNow()))}. Пока он идёт, отряд не держит оборону и в бой
          не годится.
        </p>
      ) : posture === 'stands' ? (
        <p className="note">Отряд стоит дома и держит оборону с гарнизоном.</p>
      ) : posture === 'engaged' ? (
        <p className="note bad">Отряд в поле и город не защищает.</p>
      ) : null}
      {rows.length === 0 ? (
        <div className="desc">Бойцов нет. Найми их в казармах.</div>
      ) : (
        rows.map((t) => {
          // Шаг вверх упирается в тех, кто дома, а не в ошибку после нажатия.
          const all = pool[t] ?? 0;
          const max = all;
          const n = want[t] ?? 0;
          const set = (v: number): void => setWant((w) => ({ ...w, [t]: Math.max(0, Math.min(max, v)) }));
          return (
            <div className="slot pick" key={t}>
              <span className="ico">
                <Icon name={`troop-${t}`} glyph={TROOP_BY_ID[t].icon} />
              </span>
              <span className="who">
                {TROOP_BY_ID[t].name}{' '}
                <i className="talent">
                  всего {all}
                </i>
              </span>
              <div className="stepper">
                <button disabled={n <= 0} onClick={() => set(n - 1)}>
                  −
                </button>
                <span className="n">{n}</span>
                <button disabled={n >= max} onClick={() => set(n + 1)}>
                  +
                </button>
              </div>
              <button className="mini text" disabled={n >= max} onClick={() => set(max)}>
                все
              </button>
            </div>
          );
        })
      )}
      <div className="mod-list">
        {moved > 0 && (
          <div className="mod">
            <span className="ico">⏳</span>
            <span className="name">Оборона на время сбора</span>
            <span className={`val ${during < def * 0.5 ? 'neg' : ''}`}>
              {Math.round(def)} → {Math.round(during)}
            </span>
          </div>
        )}
        <div className="mod total">
          <span className="ico"><Icon name="ui-home" glyph="🏠" /></span>
          <span className="name">Оборона после сбора</span>
          <span className="val">{Math.round(after)}</span>
        </div>
      </div>
      <div className="wm-actions">
        <button className="btn wide" disabled={busy || gathering} onClick={() => void apply(want)}>
          <Icon name="fig-general" glyph="🎖️" /> Отдать {total}
        </button>
        <button
          className="btn ghost wide"
          disabled={busy || gathering || troopTotal(held) === 0}
          onClick={() => void apply(null)}
        >
          <Icon name="ui-home" glyph="🏠" /> Вернуть всех
        </button>
      </div>
      <p className="note">Уйдёт полководец в поле, и отряд покинет гарнизон.</p>
    </>
  );
}
