// Раскладка дружины — окно в «Дружине» (docs/retinue.md): по видам и числу, кто стоит в гарнизоне, а кто с
// полководцем. Раскладка постоянная: часть полководца держится, пока бойцы живы, ходит с ним и с ним возвращается; новые
// нанятые встают в гарнизон, к полководцу их переводят здесь.
//
// Окно одно на всю игру. Статуя и карточка своего замка ведут в него строкой (`MusterLink`), а не держат вторую копию:
// две копии одного решения разошлись бы молча. Держит это тест по исходнику (`Muster.test.ts`): `setGarrison` мира
// зовёт ровно этот файл.
//
// Своей правды здесь нет. Можно ли менять раскладку, почему нет и мгновенно ли — словами мира (`FigureView.regroup`, та
// же проверка, что примет приказ): дома и не в осаде перевод мгновенный (docs/retinue.md, раздел 7); оборона —
// `defense`, срок сбора там, где он есть, — `musterMs` с чертами полководца, как у мира; сколько бойцов
// вида можно держать — `roomOf`, тем же правилом, каким отказывает мир. Потолка у отряда нет: войско держит цена
// (`data/upkeep.ts`), а не Статуя.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { buildingOfType, defense } from '@/game/derived';
import { personName, seated, traitNumbers } from '@/game/sim/agents';
import { secondsLeft } from '@/world/geo';
import { musterMs, plus, postureOf, roomOf, type Posture } from '@/world/muster';
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import type { GameState, TroopId } from '@/game/types';
import type { FigureView } from '@/world/types';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { Icon } from '@/ui/icons/Icon';
import { tipAt } from '@/ui/next/tip';
import { realSpanText } from './wait';
import { useArmyView } from './armyView';

/**
 * Какой будет оборона, пока идёт сбор, и когда он кончится. Считает та же
 * `defense`, что и всегда, — на племени, у которого не дома ровно те, кого сбор
 * касается, **по видам**: латник, ушедший в сбор, уносит мощь латника.
 *
 * Не в обороне сверх отряда — отряды в пути: отряд, стоящий дома, в `s.away` не
 * входит, в сборе и в поле — входит весь. В сборе числятся все, кого он касается, —
 * те же `max(было, станет)` по видам, что кладёт в отряд сам мир (`setGarrison`).
 * После сбора отряд дома (`home`) стоит с гарнизоном, а в поле у ворот — нет: сбор
 * дома остался только в осаде, остальной — в поле у своих ворот (docs/retinue.md, раздел 7).
 */
export function musterDefense(
  s: GameState,
  held: TroopStack,
  want: TroopStack,
  posture: Posture,
  home = true,
): { during: number; after: number } {
  const marches = troopsAfter(s.away, posture === 'stands' ? {} : held);
  const onRoad: TroopStack = {};
  for (const t of TROOP_IDS) onRoad[t] = Math.max(held[t] ?? 0, want[t] ?? 0);
  return {
    during: defense({ ...s, away: plus(marches, onRoad) }),
    after: defense({ ...s, away: home ? marches : plus(marches, want) }),
  };
}

/** Где отряд полководца — одной строкой: за разницу между «дома» и «в поле» игрок платит обороной. */
export function postureLine(general: FigureView | undefined): string {
  if (!general) return 'Где полководец, пока неизвестно';
  if (general.gone) return 'Полководца нет';
  const n = troopTotal(general.troops);
  const posture = postureOf(general);
  if (posture === 'gathering') return `Сбор ещё ${realSpanText(secondsLeft(general.readyAt, worldNow()))}, город не защищает`;
  if (general.phase === 'down') return n > 0 ? 'Полководец вне строя' : 'Полководец вне строя, отряда нет';
  if (n === 0) return 'Отряда нет, все в гарнизоне';
  return posture === 'stands' ? 'Дома, стоит с гарнизоном' : 'В походе, город не защищает';
}

/**
 * Строка «Раскладка» — дверь в окно: сколько бойцов с полководцем и где они. В «Дружине» она открывает окно на месте,
 * из Статуи и карточки своего замка — ведёт в «Дружину» (`MusterLink`).
 */
function MusterRow({ onOpen }: { onOpen: () => void }) {
  const general = useWorld((g) => g.figures.find((f) => f.id === 'general'));
  const n = troopTotal(general?.troops ?? {});
  const posture = general ? postureOf(general) : 'none';
  return (
    <button className="card as-row" onClick={onOpen}>
      <div className="ico">
        <Icon name="fig-general" glyph="🎖️" />
      </div>
      <div className="body">
        <div className="title">
          Раскладка
          <span className={`count${posture === 'stands' || posture === 'none' ? '' : ' neg'}`}>с полководцем {n}</span>
        </div>
        <div className="desc">{postureLine(general)}</div>
      </div>
      <div className="chev">›</div>
    </button>
  );
}

/** Строка раскладки внутри «Дружины»: окно открывается на месте. */
export function MusterOpen() {
  const s = useGame((g) => g.s);
  const show = useArmyView((v) => v.show);
  if (!seated(s, 'general')) return null;
  return <MusterRow onOpen={() => show(true)} />;
}

/** Строка раскладки в Статуе и в карточке своего замка: ведёт в «Дружину», сразу в окно. */
export function MusterLink() {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const closeMap = useGame((g) => g.closeMap);
  const openTab = useGame((g) => g.openTab);
  const show = useArmyView((v) => v.show);
  if (!seated(s, 'general')) return null;
  const go = (): void => {
    show(true);
    // Шторки живут над городом: из карты «Дружина» открывается в городе, как и с нижнего места.
    if (mapOpen) closeMap();
    if (!(sheet?.kind === 'tab' && sheet.tab === 'army')) openTab('army');
  };
  return <MusterRow onOpen={go} />;
}

/** Окно раскладки. `onBack` — к списку дружины. */
export function Muster({ onBack }: { onBack: () => void }) {
  const s = useGame((g) => g.s);
  const showToast = useGame((g) => g.showToast);
  const openBuilding = useGame((g) => g.openBuilding);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const setGarrison = useWorld((g) => g.setGarrison);
  const general = figures.find((f) => f.id === 'general');
  const held: TroopStack = general?.troops ?? {};
  // Сколько бойцов вида можно держать — всё войско, что не ушло отрядами: дома отряд уже в гарнизоне, и складывать
  // его с ним второй раз нельзя. Тем же правилом отказывает мир (`world/muster.roomOf`).
  const pool = roomOf(s.army, marches);
  const [want, setWant] = useState<TroopStack>(held);
  const [busy, setBusy] = useState(false);

  // Пришёл новый состав из мира — начинаем от него, а не от прошлого выбора.
  const key = TROOP_IDS.map((t) => held[t] ?? 0).join(',');
  useEffect(() => setWant({ ...held }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const statue = buildingOfType(s, 'statue');
  const barracks = buildingOfType(s, 'barracks');
  const here = seated(s, 'general');
  const regroup = general?.regroup ?? { block: 'Где полководец, пока неизвестно.', grow: null, instant: false };
  const can = here && regroup.block === null;
  const all = (t: TroopId): number => Math.max(pool[t] ?? 0, held[t] ?? 0);
  const rows = TROOP_IDS.filter((t) => all(t) > 0);
  const set = (t: TroopId, v: number): void => setWant((w) => ({ ...w, [t]: Math.max(0, Math.min(all(t), v)) }));
  // Добавить нельзя (осада) — шаг вверх упирается в то, что у него уже есть, а не в отказ после нажатия.
  const top = (t: TroopId): number => (regroup.grow ? Math.min(all(t), held[t] ?? 0) : all(t));

  let moved = 0;
  let grows = false;
  for (const t of TROOP_IDS) {
    moved += Math.abs((held[t] ?? 0) - (want[t] ?? 0));
    if ((want[t] ?? 0) > (held[t] ?? 0)) grows = true;
  }
  const posture = general ? postureOf(general) : 'none';
  // Обе цены — до приказа: сколько обороны стоит сам сбор и какой она станет, когда отряд встанет (`world/muster`).
  const def = defense(s);
  const { during, after } = musterDefense(s, held, want, posture, general?.phase === 'home');
  // Срок сбора — той же функцией, что у мира, с чертами полководца так, как их складывает слепок. Дома и не в осаде
  // сбора нет: перевод мгновенный (`Regroup.instant`).
  const wait = moved > 0 && !regroup.instant ? musterMs(moved, traitNumbers(s).muster ?? 1) : 0;
  const why = !here ? null : (regroup.block ?? (grows ? regroup.grow : null) ?? (moved === 0 ? 'Раскладка та же' : null));
  const total = troopTotal(want);
  const garrison = rows.reduce((n, t) => n + all(t) - (want[t] ?? 0), 0);

  const apply = async (): Promise<void> => {
    setBusy(true);
    const err = await setGarrison(want);
    setBusy(false);
    showToast(err ?? (wait > 0 ? `Отряд собирается. Сбор ${realSpanText(wait / 1000)}` : moved > 0 ? 'Раскладка новая.' : 'Раскладка та же.'));
  };

  return (
    <div className="panel nx-rk">
      <div className="nx-rktop">
        <button className="nx-link" onClick={onBack}>
          ‹ Дружина
        </button>
        <b>Раскладка</b>
        <small>
          <Icon name="ui-home" glyph="🏠" /> {garrison} · <Icon name="fig-general" glyph="🎖️" /> {total}
        </small>
      </div>

      <div className="nx-rkwho">
        <Icon name="fig-general" glyph="🎖️" />
        <span>
          <b>{here ? personName(s, 'general') : 'Полководца нет'}</b>
          <small>{here ? postureLine(general) : 'Отряд некому вести'}</small>
        </span>
        {!here && statue && (
          <button className="nx-link" onClick={() => openBuilding(statue.id)}>
            В Статую ›
          </button>
        )}
      </div>
      {/* Почему раскладку сейчас не поменять — словами мира; идущий сбор строка полководца уже назвала. */}
      {here && regroup.block && posture !== 'gathering' && rows.length > 0 && <p className="nx-bwarn">{regroup.block}</p>}

      {rows.length === 0 ? (
        <div className="nx-rkwho">
          <span>
            <b>Бойцов нет</b>
            <small>Нанятые встают в гарнизон</small>
          </span>
          {barracks && (
            <button className="nx-link" onClick={() => openBuilding(barracks.id)}>
              Нанять ›
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="nx-rkkey">
            <span>
              <Icon name="ui-home" glyph="🏠" /> гарнизон
            </span>
            <span>
              <Icon name="fig-general" glyph="🎖️" /> отряд
            </span>
            {can && (
              <>
                <button className="nx-link" disabled={total === 0} onClick={() => setWant({})}>
                  Всех в оборону
                </button>
                <button
                  className="nx-link"
                  disabled={regroup.grow !== null || rows.every((t) => (want[t] ?? 0) >= all(t))}
                  onClick={() => setWant(Object.fromEntries(rows.map((t) => [t, all(t)])))}
                >
                  Всех к нему
                </button>
              </>
            )}
          </div>
          {rows.map((t) => {
            const d = TROOP_BY_ID[t];
            const n = want[t] ?? 0;
            const home = all(t) - n;
            const head = (
              <>
                <button
                  className="nx-wico"
                  onClick={(e) =>
                    tipAt(e.currentTarget, { title: d.name, body: `Всего ${all(t)}: в гарнизоне ${home}, с полководцем ${n}.` })
                  }
                  aria-label={`${d.name}: сколько где`}
                >
                  <Icon name={`troop-${t}`} glyph={d.icon} />
                </button>
                <b className="nx-rkname">{d.name}</b>
                <span className="nx-rknum">
                  <Icon name="ui-home" glyph="🏠" /> {home}
                </span>
              </>
            );
            if (!can) {
              return (
                <div className="nx-rkrow one" key={t}>
                  {head}
                  <span className="nx-rknum gen">
                    <Icon name="fig-general" glyph="🎖️" /> {n}
                  </span>
                </div>
              );
            }
            return (
              <div className="nx-rkrow" key={t}>
                <div className="nx-rkhead">{head}</div>
                <div className="stepper wide-steps nx-rksteps">
                  <button disabled={n <= 0} onClick={() => set(t, n - 10)} aria-label="В гарнизон 10">
                    −10
                  </button>
                  <button disabled={n <= 0} onClick={() => set(t, n - 1)} aria-label="В гарнизон">
                    −
                  </button>
                  <span className="n">
                    <Icon name="fig-general" glyph="🎖️" /> {n}
                  </span>
                  <button disabled={n >= top(t)} onClick={() => set(t, Math.min(top(t), n + 1))} aria-label="К полководцу">
                    +
                  </button>
                  <button disabled={n >= top(t)} onClick={() => set(t, Math.min(top(t), n + 10))} aria-label="К полководцу 10">
                    +10
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {can && rows.length > 0 && (
        <div className="nx-obar">
          {/*
            Обе цены до приказа одной строкой-справкой: оборона после сбора и сколько он идёт. Дома и не в осаде сбора
            нет — перевод мгновенный, и строка называет только оборону.
          */}
          <button
            className="nx-rksum"
            onClick={(e) =>
              tipAt(e.currentTarget, {
                title: regroup.instant ? 'Оборона' : 'Оборона и сбор',
                body: regroup.instant
                  ? 'Полководец дома: перевод мгновенный, отряд стоит с гарнизоном, и оборона та же. Уйдёт полководец, уйдёт и отряд.'
                  : moved > 0
                    ? `Пока идёт сбор, оборона ${Math.round(during)}: эти бойцы не в гарнизоне и не в отряде.`
                    : 'Отряд дома стоит с гарнизоном. Уйдёт полководец, уйдёт и отряд.',
              })
            }
          >
            <span>
              Оборона{' '}
              <b className={wait > 0 && during < def * 0.5 ? 'bad' : ''}>{wait > 0 ? `${Math.round(def)} → ${Math.round(after)}` : Math.round(def)}</b>
            </span>
            {!regroup.instant && (
              <span>
                Сбор <b>{moved > 0 ? realSpanText(wait / 1000) : '—'}</b>
              </span>
            )}
          </button>
          <div className="nx-ostep">
            <button className="nx-go" disabled={busy || why !== null} onClick={() => void apply()}>
              Расставить
            </button>
          </div>
          {why && <small className="nx-why">{why}</small>}
        </div>
      )}
    </div>
  );
}
