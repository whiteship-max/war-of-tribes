// Черты армии в бою (ДР-4, docs/siege_v2.md, «Решения ДР-4», Ш5): сила армии с чертой и вывод величин `SCAR_SIZE`. Сила — та же
// мерка, что у духа ДР-1 и командиров ДР-3 (`spirit.ts`, `flank.ts`): во сколько раз армия с чертой стоит той же армии без неё по
// числу людей — армию с чертой ставят против той же, растянутой в k раз, и ищут k, при котором победы делятся поровну. Бои — той
// же дверью, что у мира и сервера (`world/battle.resolveField`), стороны по очереди нападают, место и час — те, где черта
// действует (у обеих сторон одни).
//
// Ориентир — дух ДР-1: добрая черта в своём бою стоит, как одна шкала духа на верху (мораль 100 при дисциплине 70), дурная —
// столько же отнимает (её зеркало: единица, делённая на силу доброй). Ориентир меряется той же меркой на том же составе, что и
// черта. Дно шкалы (×0,875) дурной не годится: при потолке поправки `SCAR_CAP` черта до него не дотягивает (27.2).
import { SPIRIT, type Spirit } from '@/battle';
import { HORSE_KINDS } from '@/battle/types';
import { resolveField, type FieldSide } from '@/world/battle';
import { kindsOf } from '@/game/battle/price';
import type { TroopStack } from '@/game/battle/kinds';
import { SCARS, SCAR_BY_ID, SCAR_SIZE, shareOf, type ScarId, type ScarSide, type ScarWhere } from '@/game/scarrules';
import { SCAR_CAP } from '@/battle/config';
import { SPIRIT_MIX, scaled, strengthOf } from './spirit';
import { fan, serveFan } from '../lib/fan';

/** Мерка черты против конницы (`pikewall`): та же армия мерки с конницей — конных в родах ядра не меньше четверти. */
export const HORSE_MIX: TroopStack = { spearman: 160, archer: 60, legionary: 40, rider: 60, knight: 40 };

/** Где черта действует в мерке: состав, место и голод — ровно её тема. */
export interface ScarBench {
  troops: TroopStack;
  where: ScarWhere;
  hungry?: true;
}

export function benchOf(id: ScarId): ScarBench {
  const theme = SCAR_BY_ID[id].theme;
  switch (theme) {
    case 'woods':
      return { troops: SPIRIT_MIX, where: { woods: true } };
    case 'river':
      return { troops: SPIRIT_MIX, where: { river: true } };
    case 'hills':
      return { troops: SPIRIT_MIX, where: { hills: true } };
    case 'siege':
      return { troops: SPIRIT_MIX, where: { siege: true } };
    case 'night':
      return { troops: SPIRIT_MIX, where: { night: true } };
    case 'winter':
      return { troops: SPIRIT_MIX, where: { winter: true } };
    case 'hunger':
      return { troops: SPIRIT_MIX, where: {}, hungry: true };
    case 'horse':
      return { troops: HORSE_MIX, where: {} };
    case 'arrows':
      return { troops: SPIRIT_MIX, where: {} };
  }
}

/** Доля побед армии с чертами `scars` против той же армии в `k` раз без них, на сидах `1…seeds` (ничья — половина). */
export function scarShare(b: ScarBench, held: ScarId[], k: number, seeds: number): number {
  const us = kindsOf(b.troops);
  const them = kindsOf(scaled(b.troops, k));
  const scars: ScarSide = { held, ...(b.hungry ? { hungry: true as const } : {}) };
  let won = 0;
  for (let i = 1; i <= seeds; i++) {
    const seed = i * 7919;
    const ours: FieldSide = { kinds: us, scars };
    const theirs: FieldSide = { kinds: them };
    const atk = i % 2 === 0;
    const f = resolveField({ seed, attacker: atk ? ours : theirs, defender: atk ? theirs : ours, where: b.where });
    const w = f.result?.winner;
    if (w === 'draw') won += 0.5;
    else if ((w === 'attacker') === atk) won += 1;
  }
  return won / seeds;
}

/** Сила черт `held` в их бою: k, при котором армия с ними бьётся с той же армией в k раз ровно (бисекция, 12 шагов). */
export function scarStrength(b: ScarBench, held: ScarId[], seeds: number, lo = 0.4, hi = 1.8): number {
  let a = lo;
  let c = hi;
  for (let i = 0; i < 12; i++) {
    const m = (a + c) / 2;
    if (scarShare(b, held, m, seeds) > 0.5) a = m;
    else c = m;
  }
  return (a + c) / 2;
}

/** Ориентир черты (Ш5) на составе `troops`: одна шкала духа на верху — добрая, её зеркало (единица на ту же силу) — дурная. */
export function scarAim(troops: TroopStack, good: boolean, seeds: number): number {
  const spirit: Spirit = { morale: SPIRIT.top, discipline: SPIRIT.even };
  const top = strengthOf(troops, spirit, seeds);
  return good ? top : 1 / top;
}

export interface ScarDerived {
  id: ScarId;
  aim: number;
  size: number;
  /** Сила при выведенной величине (на тех же сидах). */
  strength: number;
  /** Ориентир не достигнут и при потолке `SCAR_CAP`. */
  capped: boolean;
}

/**
 * Величина черты `id`: бисекцией по величине (7 шагов, 0…`SCAR_CAP`) — сила в её бою равна ориентиру. Сила с величиной у доброй
 * растёт, у дурной падает (монотонность — из устройства ядра, `battle/scars.test.ts`). Не достиг ориентира и при потолке — `capped`.
 */
export function deriveScar(id: ScarId, seeds: number, aims: Map<string, number>): ScarDerived {
  const def = SCAR_BY_ID[id];
  const b = benchOf(id);
  const key = `${JSON.stringify(b.troops)}|${def.good}`;
  const aim = aims.get(key) ?? scarAim(b.troops, def.good, seeds);
  aims.set(key, aim);
  const was = SCAR_SIZE[id];
  const at = (x: number): number => {
    SCAR_SIZE[id] = x;
    return scarStrength(b, [id], seeds);
  };
  const top = at(SCAR_CAP);
  if (def.good ? top < aim : top > aim) {
    SCAR_SIZE[id] = was;
    return { id, aim, size: SCAR_CAP, strength: top, capped: true };
  }
  let lo = 0;
  let hi = SCAR_CAP;
  for (let i = 0; i < 7; i++) {
    const m = (lo + hi) / 2;
    const s = at(m);
    if (def.good ? s < aim : s > aim) lo = m;
    else hi = m;
  }
  const size = Math.round(((lo + hi) / 2) * 100) / 100;
  const strength = at(size);
  SCAR_SIZE[id] = was;
  return { id, aim, size, strength, capped: false };
}

/** Все черты таблицы; черты с одинаковым направлением и меркой выводятся один раз. */
export function deriveScars(seeds: number): ScarDerived[] {
  const aims = new Map<string, number>();
  const done = new Map<string, ScarDerived>();
  const out: ScarDerived[] = [];
  for (const def of SCARS) {
    const b = benchOf(def.id);
    const key = `${JSON.stringify(def.shape)}|${JSON.stringify(b.troops)}`;
    const same = done.get(key);
    const d = same ? { ...same, id: def.id } : deriveScar(def.id, seeds, aims);
    done.set(key, d);
    out.push(d);
  }
  return out;
}

/**
 * Черта `id` в своём процессе веера: ориентир считается заново (своя `aims`) — он детерминирован, итог тот же, что подряд в одном
 * процессе. Модуль — без действий на верхнем уровне: задачу берёт `serveFan` ниже.
 */
function deriveScarTask(a: { id: ScarId; seeds: number }): ScarDerived {
  return deriveScar(a.id, a.seeds, new Map());
}

/** Названные черты веером (`lib/fan`, бюджет ядер): каждая — в своём процессе, итог — в порядке `ids`. */
export const deriveScarsFan = (ids: readonly ScarId[], seeds: number): Promise<ScarDerived[]> =>
  fan(deriveScarTask, import.meta.url, ids.map((id) => ({ id, seeds })));

/** Сила каждой черты при записанных величинах и её ориентир — проверка; `ids` — только названные (прочие не считаются). */
export function scarChecks(seeds: number, ids?: readonly ScarId[]): { id: ScarId; aim: number; strength: number }[] {
  const aims = new Map<string, number>();
  return SCARS.filter((def) => !ids || ids.includes(def.id)).map((def) => {
    const b = benchOf(def.id);
    const key = `${JSON.stringify(b.troops)}|${def.good}`;
    const aim = aims.get(key) ?? scarAim(b.troops, def.good, seeds);
    aims.set(key, aim);
    return { id: def.id, aim, strength: scarStrength(b, [def.id], seeds) };
  });
}

/** Конных в мерке против конницы — не меньше `HORSE_HEAVY` (иначе черта в мерке не действует). */
export const horseShareOfMix = (): number => shareOf(kindsOf(HORSE_MIX), HORSE_KINDS);

serveFan(import.meta.url, { deriveScarTask });
