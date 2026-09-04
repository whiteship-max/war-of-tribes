// Мост между восемью видами бойцов племени и четырьмя родами полевого боя.
// Ядро (`src/battle/`) про племя не знает и знать не должно — отображение живёт
// здесь. Обратная зависимость запрещена: отсюда в ядро только типы.
import type { TroopId } from '../types';
import { TROOPS, TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { GEAR, UNIT_KINDS, type Stack, type UnitKind } from '@/battle';

/** Кто из племени каким родом выходит в поле. Все четыре рода закрыты. */
export const KIND_OF: Record<TroopId, UnitKind> = {
  clubman: 'infantry',
  spearman: 'spear',
  archer: 'archer',
  axeman: 'infantry',
  swordsman: 'infantry',
  shieldman: 'infantry',
  rider: 'cavalry',
  legionary: 'infantry',
};

/** Виды племени, выходящие этим родом, — в порядке списка казарм. */
export const TROOPS_OF_KIND: Record<UnitKind, TroopId[]> = UNIT_KINDS.reduce(
  (acc, k) => {
    acc[k] = TROOP_IDS.filter((id) => KIND_OF[id] === k);
    return acc;
  },
  {} as Record<UnitKind, TroopId[]>,
);

/** Роды, которые племя вообще способно выставить: пустые в интерфейсе не показываются. */
export const OWN_KINDS: UnitKind[] = UNIT_KINDS.filter((k) => TROOPS_OF_KIND[k].length > 0);

/**
 * Мощь племени на одного бойца полевого строя. Дубинщик (power 2) — единица
 * измерения: он и есть «один боец в строю», всё остальное дороже и весит больше.
 *
 * Иначе не сходится экономика: ядро знает только четыре рода и ступень снаряжения
 * (а она даёт лишь мораль), и один латник в строю считался бы за одного дубинщика.
 * Мощь вида бойца — это уже вложенное в него снаряжение, поэтому она и есть вес
 * в строю. Числа боя и числа племени после этого в одной шкале: `defense()` тоже
 * складывает мощь.
 */
export const BATTLE_MAN = 2;

/** Сколько бойцов строя даёт n бойцов этого вида. Ноль людей — ноль строя. */
export const menOf = (troop: TroopId, n: number): number =>
  n > 0 ? Math.max(1, Math.round((n * TROOP_BY_ID[troop].power) / BATTLE_MAN)) : 0;

/** Обратный перевод: сколько мощи в строю стоит один боец этого вида. */
export const weightOf = (troop: TroopId): number => TROOP_BY_ID[troop].power / BATTLE_MAN;

/** Сколько кого в племени. Отдельный тип, чтобы не таскать полный `Army` с нулями. */
export type TroopStack = Partial<Record<TroopId, number>>;

export const troopTotal = (t: TroopStack): number =>
  TROOP_IDS.reduce((n, id) => n + Math.max(0, t[id] ?? 0), 0);

export const emptyTroops = (): TroopStack => ({});

/** Состав в родах боя — то, что понимает ядро. */
export function kindsOf(t: TroopStack): Stack {
  const out: Stack = { spear: 0, infantry: 0, archer: 0, cavalry: 0 };
  for (const id of TROOP_IDS) out[KIND_OF[id]] += menOf(id, Math.max(0, t[id] ?? 0));
  return out;
}

/**
 * Ступень снаряжения рода, 0..`GEAR.max`: средняя по бойцам этого рода, взвешенная
 * их числом. Ступень — это число предметов из кузницы на бойце: дубинщику хватает
 * палки (0), латнику нужны меч, щит и доспех (3). Так кузница влияет на стойкость.
 */
export const gearOfTroop = (troop: TroopId): number =>
  Math.min(
    GEAR.max,
    Object.values(TROOP_BY_ID[troop].gear).reduce((n, v) => n + (v ?? 0), 0),
  );

export function gearOf(t: TroopStack): Partial<Record<UnitKind, number>> {
  const out: Partial<Record<UnitKind, number>> = {};
  for (const k of UNIT_KINDS) {
    let men = 0;
    let sum = 0;
    for (const id of TROOPS_OF_KIND[k]) {
      const n = Math.max(0, t[id] ?? 0);
      if (n <= 0) continue;
      men += n;
      sum += n * gearOfTroop(id);
    }
    if (men > 0) out[k] = Math.round(sum / men);
  }
  return out;
}

/**
 * Потери по роду переводятся обратно в бойцов племени: доля от каждого вида этого
 * рода, слабые первыми — как в `removeSoldiers`. Так отряд из дубинщиков и латников
 * теряет сперва дубинщиков, а не «полтора латника».
 */
export function spreadLosses(t: TroopStack, kind: UnitKind, lostMen: number): TroopStack {
  const out: TroopStack = {};
  if (lostMen <= 0) return out;
  let left = lostMen;
  // Слабые первыми: список видов рода уже идёт от дешёвого к дорогому.
  for (const id of TROOPS_OF_KIND[kind]) {
    const have = Math.max(0, t[id] ?? 0);
    if (have <= 0 || left <= 0) continue;
    const w = weightOf(id);
    const take = Math.min(have, Math.round(left / w));
    if (take > 0) {
      out[id] = take;
      left -= take * w;
    }
  }
  return out;
}

/** Потери сразу по всем родам. */
export function troopLosses(t: TroopStack, lost: Stack): TroopStack {
  const out: TroopStack = {};
  for (const k of UNIT_KINDS) {
    const part = spreadLosses(t, k, lost[k]);
    for (const id of TROOP_IDS) if (part[id]) out[id] = (out[id] ?? 0) + (part[id] as number);
  }
  return out;
}

/** Вычитает потери из состава. Отрицательных остатков не бывает. */
export function troopsAfter(t: TroopStack, lost: TroopStack): TroopStack {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = Math.max(0, (t[id] ?? 0) - (lost[id] ?? 0));
    if (n > 0) out[id] = n;
  }
  return out;
}

/** Иконка и имя вида — для строк вида «🔱 8». */
export const TROOP_ICON: Record<TroopId, string> = Object.fromEntries(
  TROOPS.map((t) => [t.id, t.icon]),
) as Record<TroopId, string>;
