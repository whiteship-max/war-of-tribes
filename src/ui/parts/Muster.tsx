// Состав отряда полководца в окне дела (К-2, docs/AGENTS.md, раздел 18; ДР-6, docs/siege_v2.md, «Решения ДР-6»): по каждому
// виду — «остаётся в городе | уходит с полководцем», итог мощи уходящих и оборона остающихся, и «Отправить» — дело с
// выбранным составом одним приказом мира (`ErrandOrder.troops`). Раскладки «Гарнизон | Отряд» в «Дружине» больше нет (ДР-6):
// в своём городе отряда у полководца не бывает — он ведёт оборону всем гарнизоном, состав берёт на дело здесь, а вернувшись,
// его отряд снова встаёт гарнизоном (`LocalWorld.homecoming`).
//
// Окно одно на все дела полководца (`map/ArmySend`): к нему ведут кольцо над целью, кнопки похода карточки места и «На
// выручку». Держит это тест по исходнику (`Muster.test.ts`): окна игры не зовут приказ раскладки мира вовсе.
//
// Своей правды здесь нет. Можно ли дать состав, почему нет — словами мира (`FigureView.regroup`, та же проверка, что примет
// приказ): в городе перевод мгновенный, и в осаде (`Regroup.instant`; добавить бойцов в осаде нельзя — `grow`); вне города
// полководец уходит с тем отрядом, что при нём. Мощь — `troopPower`; оборона остающихся — `defense` без уходящих
// (правило 18); сколько бойцов вида можно взять — `roomOf`, тем же правилом, каким отказывает мир.
import './muster.css';
import { useEffect, useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { armySize, buildingOfType, defense, homeArmy, homeTroops, troopWage } from '@/game/derived';
import { personName, seated } from '@/game/sim/agents';
import { troopPower } from '@/game/battle/price';
import { awayOf, inTown, ownOf, plus, postureOf, roomOf, standingTroops, type Posture } from '@/world/muster';
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import type { GameState, TroopId } from '@/game/types';
import type { ErrandOrder, FigureView, MarchView } from '@/world/types';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { Icon } from '@/ui/icons/Icon';
import { Btn } from '@/ui/kit/Btn';
import { Num } from '@/ui/kit/Num';
import { Row } from '@/ui/kit/Row';
import { Table, type Col } from '@/ui/kit/Table';
import { breakdown } from '@/ui/kit/breakdown';
import { fmtInt, fmtRate } from '@/ui/next/hudTips';
import type { TipContent } from '@/ui/next/tip';
import { Steps } from './Steps';
import { postureLine } from './MusterLink';
import { iconName } from '@/ui/icons/registry';

/**
 * Какой будет оборона, пока идёт сбор, и когда он кончится. Считает та же
 * `defense`, что и всегда, — на племени, у которого не дома ровно те, кого сбор
 * касается, **по видам**: латник, ушедший в сбор, уносит мощь латника.
 *
 * Не в обороне сверх отряда — отряды в пути: отряд, стоящий дома, в `s.away` не
 * входит, в сборе и в поле — входит весь. В сборе числятся все, кого он касается, —
 * те же `max(было, станет)` по видам, что кладёт в отряд сам мир (`setGarrison`).
 * После сбора отряд дома (`home`) стоит с гарнизоном, а в поле у ворот — нет. Окно дела спрашивает её об уходе
 * (`home` = false): `after` — оборона того, что остаётся.
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

/** Мощь и жалованье одной колонки — функциями игры. */
export interface Side {
  power: number;
  wages: number;
}

export const sideOf = (s: GameState, t: TroopStack): Side => ({
  power: troopPower(t),
  wages: TROOP_IDS.reduce((n, id) => n + Math.max(0, t[id] ?? 0) * troopWage(s, id), 0),
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
      icon: iconName('troop', id),
    })),
    fmt,
    sumLabel: key === 'power' ? 'Мощь' : 'В день',
  });
}

/**
 * Кто в обороне — гарнизон и отряд полководца в городе, правилом места (`world/muster`), тем же, что у моста. Итог — число
 * племени (`derived.homeArmy`); разошёлся с миром — строка «Прочее» покажет это, а не спрячет. Отряда в городе с ДР-6 не
 * бывает (вернувшись, он встаёт гарнизоном); строка держит сохранение, где он ещё стоит.
 */
export function inWallsTip(s: GameState, marches: readonly MarchView[], figures: readonly FigureView[]): TipContent {
  const where = awayOf(marches, figures);
  const home = homeArmy(s);
  return breakdown({
    title: `Бойцов в городе · ${fmtInt(home)}`,
    body: 'Они и держат оборону. Пока полководец в городе, он ведёт её всем гарнизоном.',
    total: home,
    parts: [
      { label: 'Гарнизон', value: troopTotal(ownOf(s.army, where)), icon: 'ui-home' },
      { label: 'Отряд в городе', value: troopTotal(standingTroops(s.army, where)), icon: 'fig-general' },
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
    title: `Бойцов в походе · ${fmtInt(away)}`,
    body: 'Отряды в пути и отряд полководца вне города стен не защищают.',
    total: away,
    parts: TROOP_IDS.map((id) => ({
      label: TROOP_BY_ID[id].name,
      value: Math.max(0, s.army[id] ?? 0) - (home[id] ?? 0),
      icon: iconName('troop', id),
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

/** Подсказки окна (отзыв тестеров 18.10): что делает шаг; вне города — почему шага нет. */
export const SEND_HINT = '«+» — уходит с полководцем, «−» — остаётся в городе. Затем «Отправить».';
export const SEND_AS_IS = 'Полководец не в городе: уйдёт с тем отрядом, что при нём. Поменять отряд можно дома.';

/**
 * Уход полководца делом с выбранным составом (ДР-6): одним приказом мира — дело и состав (`ErrandOrder.troops`); мир ставит
 * состав тем же переводом, что раскладка, а отказ дела возвращает всех в гарнизон. `want` null — вне города: уходит тот
 * отряд, что при нём. Одна дверь на окно дела и тест «уходит ровно с выбранным».
 */
export function departWith(
  w: { errand: (o: ErrandOrder) => Promise<string | null> },
  want: TroopStack | null,
  order: ErrandOrder,
): Promise<string | null> {
  return w.errand(want ? { ...order, troops: { ...want } } : order);
}

/** Дело, с которым уходит отряд окна. */
export interface MusterSend {
  /** Приказ дела; участь удара и осады выбрана выше, в окне дела. */
  order: ErrandOrder;
  /** Почему дело с этим отрядом не начать — словами мира (`ErrandOption.reason`); null — можно. */
  block: (want: TroopStack) => string | null;
  /** Строка над кнопкой: дорога, риск — от окна дела. */
  extra?: ReactNode;
  /** Блок после состава — по тем, кто уходит (режим марша окна дела, ДР-7: убыль и вывоз по выбранному составу). */
  after?: (going: TroopStack) => ReactNode;
  /** Ушёл (null) или отказ словами. */
  done: (err: string | null) => void;
}

/** Подписи колонок: кто уходит, кто остаётся. */
const KEY_STAY = (
  <span className="ms-key">
    <Icon name="ui-home" /> Остаётся
  </span>
);
const KEY_GO = (
  <span className="ms-key gen">
    <Icon name="fig-general" /> Уходит с полководцем
  </span>
);

/** Состав в окне дела. Сверху — строка полководца: в городе ли он, защищает ли стены. */
export function Muster({ send }: { send: MusterSend }) {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const marches = useWorld((g) => g.marches);
  const figures = useWorld((g) => g.figures);
  const general = figures.find((f) => f.id === 'general');
  const held: TroopStack = general?.troops ?? {};
  // Сколько бойцов вида можно взять — всё войско, что не ушло отрядами: тем же правилом отказывает мир (`world/muster.roomOf`).
  const pool = roomOf(s.army, marches);
  const [want, setWant] = useState<TroopStack>(held);
  const [busy, setBusy] = useState(false);

  // Пришёл новый состав из мира — начинаем от него, а не от прошлого выбора.
  const key = TROOP_IDS.map((t) => held[t] ?? 0).join(',');
  useEffect(() => setWant({ ...held }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const openHall = useGame((g) => g.openTownHall);
  const barracks = buildingOfType(s, 'barracks');
  const here = seated(s, 'general');
  const regroup = general?.regroup ?? { block: 'Где полководец, пока неизвестно.', grow: null, instant: false };
  // Состав дают только там, где перевод мгновенный (в городе, и в осаде); вне города полководец уходит с тем отрядом,
  // что при нём.
  const can = here && regroup.block === null && regroup.instant;
  const going = can ? want : held;
  const all = (t: TroopId): number => Math.max(pool[t] ?? 0, held[t] ?? 0);
  const rows = TROOP_IDS.filter((t) => all(t) > 0);
  const total: TroopStack = Object.fromEntries(rows.map((t) => [t, all(t)]));
  const set = (t: TroopId, v: number): void => setWant((w) => ({ ...w, [t]: Math.max(0, Math.min(all(t), v)) }));
  // Добавить нельзя (осада) — шаг вверх упирается в то, что у него уже есть, а не в отказ после нажатия.
  const top = (t: TroopId): number => (regroup.grow ? Math.min(all(t), held[t] ?? 0) : all(t));

  const posture = general ? postureOf(general) : 'none';
  const town = general ? inTown(general) : false;
  const sums = transferSums(s, total, held, going);
  const staysTroops = troopsAfter(total, going);
  // Оборона того, что остаётся: та же `defense`, на племени без уходящих (`musterDefense`, уход — не домой).
  const stays = musterDefense(s, held, going, posture, false).after;

  const depart = async (): Promise<void> => {
    setBusy(true);
    const err = await departWith(useWorld.getState(), can ? want : null, send.order);
    setBusy(false);
    send.done(err);
  };

  const sendBtn = (
    <>
      {send.extra}
      <Btn kind="main" wide why={busy ? 'Отряд выходит' : send.block(going)} onClick={() => void depart()}>
        Отправить
      </Btn>
    </>
  );

  const cols: Col[] = [
    { key: 'kind', title: KEY_STAY },
    { key: 'steps', title: KEY_GO, align: 'center', w: STEPS_W },
  ];
  const sumCols: Col[] = [
    { key: 'k', title: 'Итог' },
    { key: 'g', title: 'Остаётся', align: 'right', w: '104px' },
    { key: 'o', title: 'Уходит', align: 'right', w: '104px' },
  ];

  return (
    <div className="ms">
      <Row
        icon={'fig-general'}
        label={here ? personName(s, 'general') : 'Полководца нет'}
        sub={here ? postureLine(general) : 'Отряд некому вести'}
        tip={() => ({
          title: town ? 'В городе — защищает стены' : 'Отряд вне города',
          body: town
            ? 'Пока полководец в городе, он ведёт оборону всем гарнизоном. Отряд на дело берёт здесь, вернувшись — отряд снова гарнизон.'
            : 'Отряд вне города стен не защищает. Вернётся полководец — отряд снова встанет гарнизоном.',
        })}
        go={here ? undefined : () => openHall('agents')}
        goLabel="Нанять в Ратуше"
      />
      {/* В городе, а состав не дать — почему, словами мира; вне города об этом говорит строка «уйдёт с тем отрядом». */}
      {here && town && regroup.block && rows.length > 0 && <p className="nx-bwarn">{regroup.block}</p>}

      {rows.length === 0 ? (
        <Row
          icon={'bld-barracks'}
          label="Бойцов нет"
          sub="Нанятые встают в гарнизон"
          go={barracks ? () => openBuilding(barracks.id) : undefined}
          goLabel="Нанять"
        />
      ) : (
        <>
          {(can || (here && !town)) && <p className="nx-tnote">{can ? SEND_HINT : SEND_AS_IS}</p>}
          <Table
            label="Остаётся и уходит"
            cols={cols}
            rows={rows.map((t) => {
              const d = TROOP_BY_ID[t];
              const n = going[t] ?? 0;
              return {
                key: t,
                cells: {
                  kind: (
                    <span className="ms-kind">
                      <Icon name={iconName('troop', t)} />
                      <span>
                        <small className="one-line">{d.name}</small>
                        <b>{fmtInt(all(t) - n)}</b>
                      </span>
                    </span>
                  ),
                  steps: can ? (
                    <span className="ms-steps">
                      <Steps
                        value={n}
                        max={top(t)}
                        spare={top(t) - n}
                        step={10}
                        names={{ less: 'Оставить в городе', more: 'Взять с собой' }}
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
              <Btn kind="link" why={troopTotal(want) === 0 ? 'Все остаются' : null} onClick={() => setWant({})}>
                Все остаются
              </Btn>
              <Btn
                kind="link"
                why={regroup.grow ?? (rows.every((t) => (want[t] ?? 0) >= all(t)) ? 'Все уходят' : null)}
                onClick={() => setWant({ ...total })}
              >
                Все уходят
              </Btn>
            </div>
          )}
        </>
      )}

      {send.after?.(going)}

      {/* Итог — в потоке окна; к низу меню липнет только «Отправить» (ДР-6: липкая полоса с итогом закрывала строки состава). */}
      {rows.length > 0 && (
        <div className="ms-bar">
          <Table
            label="Итог"
            cols={sumCols}
            rows={[
              {
                key: 'power',
                cells: {
                  k: 'Мощь',
                  g: (
                    <Num label="Мощь остающихся" tip={() => sideTip(s, 'Мощь остающихся', staysTroops, 'power', sums.garrison.was.power)}>
                      {shift(sums.garrison.was.power, sums.garrison.will.power, powerFmt)}
                    </Num>
                  ),
                  o: (
                    <Num label="Мощь уходящих" tip={() => sideTip(s, 'Мощь уходящих', going, 'power', sums.retinue.was.power)}>
                      {shift(sums.retinue.was.power, sums.retinue.will.power, powerFmt)}
                    </Num>
                  ),
                },
              },
              {
                key: 'defense',
                cells: {
                  k: 'Оборона города',
                  g: (
                    <Num
                      label="Оборона того, что остаётся"
                      tip={() => ({
                        title: `Оборона после ухода · ${fmtInt(Math.round(stays))}`,
                        body: 'Гарнизон, стены, башня, казармы и жители — без тех, кто уходит с полководцем.',
                      })}
                    >
                      {shift(defense(s), stays, (n) => fmtInt(Math.round(n)))}
                    </Num>
                  ),
                  o: '',
                },
              },
            ]}
          />
        </div>
      )}
      <div className="ms-bar ms-send">{sendBtn}</div>
    </div>
  );
}
