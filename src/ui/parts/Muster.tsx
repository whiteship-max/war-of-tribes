// Передача бойцов между гарнизоном и отрядом полководца — в самой «Дружине» (docs/retinue.md; UI-4, docs/ui_v2.md, 5.3).
// Две колонки: слева гарнизон, справа отряд; по каждому виду бойцов — шаг, внизу итог мощи и жалованья «было → станет» и
// одна кнопка «Подтвердить». Раскладка постоянная: часть полководца держится, пока бойцы живы, ходит с ним и с ним
// возвращается; новые нанятые встают в гарнизон, к полководцу их переводят здесь.
//
// Блок один на всю игру и стоит в «Дружине» (`panels/ArmyPanel`). Статуя и карточка своего замка ведут сюда строкой
// (`MusterLink`), а не держат вторую копию: две копии одного решения разошлись бы молча. Держит это тест по исходнику
// (`Muster.test.ts`): `setGarrison` мира зовёт ровно этот файл.
//
// Своей правды здесь нет. Можно ли менять раскладку, почему нет и мгновенно ли — словами мира (`FigureView.regroup`, та
// же проверка, что примет приказ): дома и не в осаде перевод мгновенный (docs/retinue.md, раздел 7). В городе отряд —
// гарнизон и во время сбора (`world/muster.inTown`, правило владельца 15.10.2026: полководец и его отряд, пока внутри
// города, в оборонительных боях считаются гарнизоном) — окно говорит это строкой полководца. Мощь — `troopPower`,
// жалованье — `wageOf` (правило 18); срок сбора там, где он есть, — `musterMs` с чертами полководца, как у мира; сколько
// бойцов вида можно держать — `roomOf`, тем же правилом, каким отказывает мир. Потолка у отряда нет: войско держит цена
// (`data/upkeep.ts`), а не Статуя.
import './muster.css';
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import { armySize, buildingOfType, defense, homeArmy, homeTroops, wageOf } from '@/game/derived';
import { personName, seated, traitNumbers } from '@/game/sim/agents';
import { troopPower } from '@/game/battle/price';
import { secondsLeft } from '@/world/geo';
import { awayOf, inTown, musterMs, ownOf, plus, postureOf, roomOf, standingTroops, type Posture } from '@/world/muster';
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import type { GameState, TroopId } from '@/game/types';
import type { FigureView, MarchView } from '@/world/types';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { Icon } from '@/ui/icons/Icon';
import { Btn } from '@/ui/kit/Btn';
import { Num } from '@/ui/kit/Num';
import { Row } from '@/ui/kit/Row';
import { Table, type Col } from '@/ui/kit/Table';
import { breakdown } from '@/ui/kit/breakdown';
import { fmtInt, fmtRate } from '@/ui/next/hudTips';
import type { TipContent } from '@/ui/next/tip';
import { realSpanText } from './wait';
import { Steps } from './Steps';

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
 * Сбор в городе обороны не меняет вовсе (`muster.inTown`): окно спрашивает эту функцию только вне города.
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

/**
 * Где полководец и его отряд — одной строкой: за разницу между «в городе» и «в поле» игрок платит обороной. В городе
 * отряд «защищает стены», и во время сбора тоже (`muster.inTown`).
 */
export function postureLine(general: FigureView | undefined, now = worldNow()): string {
  if (!general) return 'Где полководец, пока неизвестно';
  if (general.gone) return 'Полководца нет';
  const n = troopTotal(general.troops);
  if (general.phase === 'down') return n > 0 ? 'Полководец вне строя' : 'Полководец вне строя, отряда нет';
  const left = secondsLeft(general.readyAt, now);
  const gathering = general.readyAt > 0 && left > 0 ? ` · сбор ещё ${realSpanText(left)}` : '';
  if (inTown(general)) return n > 0 ? `В городе — защищает стены${gathering}` : 'В городе, отряда нет';
  if (postureOf(general) === 'gathering') return `Сбор ещё ${realSpanText(left)}, город не защищает`;
  return n > 0 ? 'В походе — город не защищает' : 'В походе, отряда нет';
}

/**
 * Строка-вход в Статуе и в карточке своего замка: сколько бойцов с полководцем и где они; касание ведёт в «Дружину», где
 * стоит передача. Своего окна у строки нет.
 */
export function MusterLink() {
  const s = useGame((g) => g.s);
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const closeMap = useGame((g) => g.closeMap);
  const openTab = useGame((g) => g.openTab);
  const general = useWorld((g) => g.figures.find((f) => f.id === 'general'));
  if (!seated(s, 'general')) return null;
  const go = (): void => {
    // Шторки живут над городом: из карты «Дружина» открывается в городе, как и с нижнего места.
    if (mapOpen) closeMap();
    if (!(sheet?.kind === 'tab' && sheet.tab === 'army')) openTab('army');
  };
  return (
    <Row
      icon={{ name: 'fig-general', glyph: '🎖️' }}
      label="Гарнизон и отряд"
      sub={postureLine(general)}
      value={`отряд ${fmtInt(troopTotal(general?.troops ?? {}))}`}
      go={go}
      goLabel="В «Дружину»"
    />
  );
}

/** Мощь и жалованье одной колонки — функциями игры. */
export interface Side {
  power: number;
  wages: number;
}

export const sideOf = (s: GameState, t: TroopStack): Side => ({
  power: troopPower(t),
  wages: TROOP_IDS.reduce((n, id) => n + Math.max(0, t[id] ?? 0) * wageOf(s, id), 0),
});

/**
 * Итог двух колонок до приказа и после: `all` — сколько бойцов вида делят гарнизон и отряд (всё войско, что не ушло
 * отрядами, `roomOf`), `held` — отряд сейчас, `want` — каким станет. Гарнизон — всё минус отряд.
 */
export function transferSums(s: GameState, all: TroopStack, held: TroopStack, want: TroopStack) {
  return {
    garrison: { was: sideOf(s, troopsAfter(all, held)), will: sideOf(s, troopsAfter(all, want)) },
    retinue: { was: sideOf(s, held), will: sideOf(s, want) },
  };
}

const powerFmt = (n: number): string => fmtInt(Math.round(n));

/** Разбор мощи или жалованья колонки по видам: строки — функциями игры, итог — то число, что на экране. */
export function sideTip(s: GameState, title: string, stack: TroopStack, key: keyof Side, was: number): TipContent {
  const total = sideOf(s, stack)[key];
  const fmt = key === 'power' ? powerFmt : fmtRate;
  return breakdown({
    title,
    body: fmt(was) !== fmt(total) ? `До приказа: ${fmt(was)}.` : undefined,
    total,
    parts: TROOP_IDS.filter((id) => (stack[id] ?? 0) > 0).map((id) => ({
      label: `${TROOP_BY_ID[id].name} ${fmtInt(stack[id] ?? 0)}`,
      value: sideOf(s, { [id]: stack[id] })[key],
      icon: { name: `troop-${id}`, glyph: TROOP_BY_ID[id].icon },
    })),
    fmt,
    sumLabel: key === 'power' ? 'Мощь' : 'В день',
  });
}

/**
 * Кто в обороне — гарнизон и отряд полководца в городе, правилом места (`world/muster`), тем же, что у моста. Итог — число
 * племени (`derived.homeArmy`); разошёлся с миром — строка «Прочее» покажет это, а не спрячет.
 */
export function inWallsTip(s: GameState, marches: readonly MarchView[], figures: readonly FigureView[]): TipContent {
  const where = awayOf(marches, figures);
  const home = homeArmy(s);
  return breakdown({
    title: `В обороне · ${fmtInt(home)}`,
    body: 'Пока полководец в городе, его отряд стоит у стен с гарнизоном.',
    total: home,
    parts: [
      { label: 'Гарнизон', value: troopTotal(ownOf(s.army, where)), icon: { name: 'ui-home', glyph: '🏠' } },
      { label: 'Отряд в городе', value: troopTotal(standingTroops(s.army, where)), icon: { name: 'fig-general', glyph: '🎖️' } },
    ],
    fmt: (n) => fmtInt(n),
    sumLabel: 'Бойцов',
  });
}

/** Не в обороне — по видам: всё войско минус те, кто дома (`derived.homeTroops`): отряды в пути и отряд полководца вне города. */
export function outWallsTip(s: GameState): TipContent {
  const home = homeTroops(s);
  const away = armySize(s) - homeArmy(s);
  return breakdown({
    title: `Не в обороне · ${fmtInt(away)}`,
    body: 'Отряды в пути и отряд полководца вне города стен не защищают.',
    total: away,
    parts: TROOP_IDS.map((id) => ({
      label: TROOP_BY_ID[id].name,
      value: Math.max(0, s.army[id] ?? 0) - (home[id] ?? 0),
      icon: { name: `troop-${id}`, glyph: TROOP_BY_ID[id].icon },
    })),
    fmt: (n) => fmtInt(n),
    sumLabel: 'Бойцов',
  });
}

/** «было → станет»; не меняется — одно число. */
export const shift = (was: number, will: number, fmt: (n: number) => string): string =>
  fmt(was) === fmt(will) ? fmt(will) : `${fmt(was)} → ${fmt(will)}`;

/** Ширина колонки шага: −10 − [n] + +10 — четыре кнопки по 44 и число (`muster.css`). */
const STEPS_W = '240px';

/** Подписи колонок: слева гарнизон, справа отряд. */
const KEY_HOME = (
  <span className="ms-key">
    <Icon name="ui-home" glyph="🏠" /> Гарнизон
  </span>
);
const KEY_GEN = (
  <span className="ms-key gen">
    <Icon name="fig-general" glyph="🎖️" /> Отряд
  </span>
);

/**
 * Передача. `onCard` — карточка вида: касание вида в строке открывает её (та же, что прежде открывал список «Состав»).
 * Сверху — строка полководца: в городе ли он и защищает ли отряд стены.
 */
export function Muster({ onCard }: { onCard: (t: TroopId) => void }) {
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
  const total: TroopStack = Object.fromEntries(rows.map((t) => [t, all(t)]));
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
  const town = general ? inTown(general) : false;
  // Срок сбора — той же функцией, что у мира, с чертами полководца так, как их складывает слепок. Дома и не в осаде
  // сбора нет: перевод мгновенный (`Regroup.instant`).
  const wait = moved > 0 && !regroup.instant ? musterMs(moved, traitNumbers(s).muster ?? 1) : 0;
  const why = !here ? null : (regroup.block ?? (grows ? regroup.grow : null) ?? (moved === 0 ? 'Раскладка та же' : null));
  const sums = transferSums(s, total, held, want);
  const garrisonWill = troopsAfter(total, want);
  // Сбор вне города (в поле у своих ворот) выводит бойцов из обороны — это видно числом; в городе оборона та же.
  const outside = wait > 0 && !town ? musterDefense(s, held, want, posture, general?.phase === 'home') : null;

  const apply = async (): Promise<void> => {
    setBusy(true);
    const err = await setGarrison(want);
    setBusy(false);
    showToast(err ?? (wait > 0 ? `Отряд собирается. Сбор ${realSpanText(wait / 1000)}` : moved > 0 ? 'Раскладка новая.' : 'Раскладка та же.'));
  };

  const cols: Col[] = [
    { key: 'kind', title: KEY_HOME },
    { key: 'steps', title: KEY_GEN, align: 'center', w: STEPS_W },
  ];
  const sumCols: Col[] = [
    { key: 'k', title: 'Итог' },
    { key: 'g', title: KEY_HOME, align: 'right', w: '104px' },
    { key: 'o', title: KEY_GEN, align: 'right', w: '104px' },
  ];

  return (
    <div className="ms">
      <Row
        icon={{ name: 'fig-general', glyph: '🎖️' }}
        label={here ? personName(s, 'general') : 'Полководца нет'}
        sub={here ? postureLine(general) : 'Отряд некому вести'}
        tip={() => ({
          title: town ? 'В городе — защищает стены' : 'Отряд вне города',
          body: !town
            ? 'Отряд вне города стен не защищает. Вернётся полководец — отряд снова встанет с гарнизоном.'
            : troopTotal(held) > 0
              ? 'Пока полководец в городе, его отряд — гарнизон: стоит у стен, ест за стеной, выходит на вылазку. Оборону ведёт он сам.'
              : 'Оборону полководец ведёт со своим отрядом. Дай ему бойцов: в городе они встанут у стен с гарнизоном.',
        })}
        go={!here && statue ? () => openBuilding(statue.id) : undefined}
        goLabel="В Статую"
      />
      {/* Почему раскладку сейчас не поменять — словами мира; идущий сбор строка полководца уже назвала. */}
      {here && regroup.block && !(general && general.readyAt > 0) && rows.length > 0 && <p className="nx-bwarn">{regroup.block}</p>}

      {rows.length === 0 ? (
        <Row
          icon={{ name: 'bld-barracks', glyph: '🛡️' }}
          label="Бойцов нет"
          sub="Нанятые встают в гарнизон"
          go={barracks ? () => openBuilding(barracks.id) : undefined}
          goLabel="Нанять"
        />
      ) : (
        <>
          <Table
            label="Гарнизон и отряд"
            cols={cols}
            rows={rows.map((t) => {
              const d = TROOP_BY_ID[t];
              const n = want[t] ?? 0;
              return {
                key: t,
                cells: {
                  kind: (
                    <button type="button" className="ms-kind" onClick={() => onCard(t)} aria-label={`${d.name}: карточка вида`}>
                      <Icon name={`troop-${t}`} glyph={d.icon} />
                      <span>
                        <small className="one-line">{d.name}</small>
                        <b>{fmtInt(all(t) - n)}</b>
                      </span>
                    </button>
                  ),
                  steps: can ? (
                    <span className="ms-steps">
                      <Steps
                        value={n}
                        max={top(t)}
                        spare={top(t) - n}
                        step={10}
                        names={{ less: 'В гарнизон', more: 'К полководцу' }}
                        onChange={(delta) => set(t, n + delta)}
                      />
                    </span>
                  ) : (
                    <b className="ms-n">{fmtInt(n)}</b>
                  ),
                },
              };
            })}
          />
          {can && (
            <div className="ms-all">
              <Btn kind="link" why={troopTotal(want) === 0 ? 'Все в гарнизоне' : null} onClick={() => setWant({})}>
                Всех в гарнизон
              </Btn>
              <Btn
                kind="link"
                why={regroup.grow ?? (rows.every((t) => (want[t] ?? 0) >= all(t)) ? 'Все в отряде' : null)}
                onClick={() => setWant({ ...total })}
              >
                Всех в отряд
              </Btn>
            </div>
          )}
        </>
      )}

      {rows.length > 0 && (
        <div className={can ? 'nx-obar ms-bar' : 'ms-bar'}>
          <Table
            label="Итог передачи"
            cols={sumCols}
            rows={[
              {
                key: 'power',
                cells: {
                  k: 'Мощь',
                  g: (
                    <Num label="Мощь гарнизона" tip={() => sideTip(s, 'Мощь гарнизона', garrisonWill, 'power', sums.garrison.was.power)}>
                      {shift(sums.garrison.was.power, sums.garrison.will.power, powerFmt)}
                    </Num>
                  ),
                  o: (
                    <Num label="Мощь отряда" tip={() => sideTip(s, 'Мощь отряда', want, 'power', sums.retinue.was.power)}>
                      {shift(sums.retinue.was.power, sums.retinue.will.power, powerFmt)}
                    </Num>
                  ),
                },
              },
              {
                key: 'wages',
                cells: {
                  k: 'Жалованье в день',
                  g: (
                    <Num label="Жалованье гарнизона" tip={() => sideTip(s, 'Жалованье гарнизона', garrisonWill, 'wages', sums.garrison.was.wages)}>
                      {shift(sums.garrison.was.wages, sums.garrison.will.wages, fmtRate)}
                    </Num>
                  ),
                  o: (
                    <Num label="Жалованье отряда" tip={() => sideTip(s, 'Жалованье отряда', want, 'wages', sums.retinue.was.wages)}>
                      {shift(sums.retinue.was.wages, sums.retinue.will.wages, fmtRate)}
                    </Num>
                  ),
                },
              },
            ]}
          />
          {outside && (
            <small className="ms-note">Пока идёт сбор, оборона {fmtInt(Math.round(outside.during))}: эти бойцы вне города и не в строю.</small>
          )}
          {can && (
            <Btn
              kind="main"
              wide
              why={busy ? 'Отряд расставляется' : why}
              sub={wait > 0 ? `сбор ${realSpanText(wait / 1000)}` : undefined}
              onClick={() => void apply()}
            >
              Подтвердить
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}
