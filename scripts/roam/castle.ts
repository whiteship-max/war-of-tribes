// Вольный замок автопилотом (ПН-10, docs/gdd/path_of_sword.md, 3.11 и 2.4): штурм с ходу или осада — **сервером войны в памяти**
// (`netlify/lib/war.ts`: поход отряда `marchFree`, НПС-слепок, стена, фазы, голод → последняя вылазка), теми же дверями, что у игрока.
// Своей арифметики боя здесь нет: замок, гарнизон и хлеб — `world/freecastle`, исход — запись войны.
import { advance, applyOrder, emptyWars } from '../../netlify/lib/war';
import { emptyRoster } from '../../netlify/lib/roster';
import type { RosterFile } from '../../netlify/lib/contract';
import { freeId, freePrestige, type FreeTier } from '../../src/world/freecastle';
import { roamSeat } from '../../src/world/roam';
import { SICILY } from '../../src/world/spawn';
import { troopTotal, type TroopStack } from '../../src/game/battle/kinds';

/** Где стоит замок прибора: клетка Сицилии (земля места боя — та же дверь `place.groundAt`, что у игрока). */
const AT = SICILY[0];
const FREE = freeId(AT.x, AT.y);
const KEY = 'tg-pilot';
const HOUR = 3_600_000;
/** Дольше осада автопилота не стоит: замок без хлеба выходит раньше (прибор печатает часы). */
const SIEGE_MAX_H = 24 * 14;

export interface CastleTry {
  won: boolean;
  /** Сколько отряд потерял за дело: павшие, истощение лагеря, выбитые башней. */
  lost: TroopStack;
  /** Часов от приказа до конца дела. */
  hours: number;
}

/**
 * Одно дело у стен вольного замка ступени `tier`: штурм с ходу (`storm`) или осада (`siege`). Отряд стоит у стен; минута приказа —
 * от `seed` (номер войны и кость фаз — от неё, как у сервера). Победа — замок взят (штурмом или отбитой последней вылазкой).
 */
export function castleTry(band: TroopStack, tier: FreeTier, mode: 'storm' | 'siege', seed: number): CastleTry {
  if (troopTotal(band) <= 0) return { won: false, lost: {}, hours: 0 };
  const t0 = Date.UTC(2026, 9, 30) + (Math.abs(seed) % 46_656) * 60_000;
  const troops = Object.fromEntries(Object.entries(band).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>;
  const roster: RosterFile = {
    ...emptyRoster(),
    bands: {
      [KEY]: {
        way: roamSeat({ x: AT.x + 1, y: AT.y }, t0).way,
        born: t0,
        name: 'Прибор',
        prestige: freePrestige(tier),
        men: troopTotal(band),
        seenAt: t0,
        book: { troops, join: -1, drill: 0, fights: 0, grant: 0, keys: [] },
      },
    },
    free: { [FREE]: { x: AT.x, y: AT.y, tier, born: t0 } },
  };
  const file = emptyWars();
  const no = applyOrder(file, KEY, { op: 'march', target: FREE, mode, fate: 'occupy', army: { troops, resolve: 0, pips: {} } }, t0, { roster, sheet: () => null, roamOpen: true });
  if (no) throw new Error(`прибор: приказ на вольный замок не принят — ${no}`);
  const w = file.wars[0];
  for (let t = w.arriveAt + 1; w.phase !== 'done' && t <= t0 + SIEGE_MAX_H * HOUR; t += HOUR) advance(file, t, new Map());
  if (w.phase === 'march' || w.phase === 'camp') applyOrder(file, KEY, { op: 'retreat', id: w.id }, t0 + SIEGE_MAX_H * HOUR, { roster, sheet: () => null, roamOpen: true });
  const lost: TroopStack = {};
  for (const [k, n] of Object.entries(troops)) {
    const d = n - ((w.army.troops as Record<string, number>)[k] ?? 0);
    if (d > 0) lost[k as keyof TroopStack] = d;
  }
  return { won: w.end === 'taken', lost, hours: ((w.endAt ?? t0) - t0) / HOUR };
}
