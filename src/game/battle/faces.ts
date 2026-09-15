// Кто именно стоял в строю. Ядро боя знает четыре рода, а близкий план ролика
// обещает игроку «видно, кого ты собрал»: латника от дубинщика он должен
// отличить, раз нанимал и одевал их по отдельности.
//
// Мост, а не ядро: род боя → вид племени — это отображение, и живёт оно там же,
// где все остальные отображения между племенем и боем. Ядро про виды не знает и
// знать не должно; в раскадровку оно получает метки, которых само не читает.
//
// Второй таблицы «род показывается таким-то видом» в рендере быть не должно.
// Она врала бы ровно тогда, когда игрок собрал что-то другое.
import { UNIT_KINDS, type Stack, type UnitKind } from '@/battle';
import type { Face } from '@/battle/replay';
import { TROOP_BY_ID } from '../data/troops';
import type { TroopId } from '../types';
import { KIND_OF, TROOPS_OF_KIND, gearOfTroop, type TroopStack } from './kinds';

/**
 * Метка того, кто стоит в строю: вид бойца племени или ополчение. Ополчение —
 * не вид: это жители, которых на стену поставили частокол и башня, их нельзя
 * нанять и нельзя одеть. Поэтому в `TroopStack` их не запишешь, и метка у них
 * своя.
 */
export type FaceId = TroopId | 'militia';

/** Ополчение выходит в поле пехотой, а с башни — стрелками (см. `militiaArchers`). */
export const MILITIA: FaceId = 'militia';

/** Состав стороны глазами показа: сколько кого стояло. */
export interface SideFaces {
  troops: TroopStack;
  /** Сколько вышло ополчения и сколько из них стрелками. */
  militia?: number;
  militiaArchers?: number;
}

/**
 * Вид, которым показывается род боя, когда поимённого состава нет: берётся тот,
 * у кого ступень снаряжения ближе всего к ступени этого рода. Это не выдумка и
 * не новая таблица — ступень уже лежит и у вида (`gearOfTroop`), и у чужого
 * гарнизона (`gearTier` в `world/garrison.ts`). Так мелкое поселение выходит
 * дубинщиками, а замок — латниками, ровно как обещает разведка.
 */
export function troopOfKind(kind: UnitKind, tier: number): TroopId | null {
  const list = TROOPS_OF_KIND[kind];
  if (list.length === 0) return null;
  let best = list[0];
  let bestGap = Infinity;
  for (const id of list) {
    const gap = Math.abs(gearOfTroop(id) - tier);
    // При равной разнице побеждает тот, кто дешевле: он и типичнее.
    if (gap < bestGap || (gap === bestGap && TROOP_BY_ID[id].power < TROOP_BY_ID[best].power)) {
      best = id;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Состав по родам — в состав по видам. Так чужое войско, про которое мир хранит
 * одну мощь, получает лица: род плюс его ступень снаряжения дают вид.
 */
export function troopsOfKinds(kinds: Stack, gear: Partial<Record<UnitKind, number>> = {}): TroopStack {
  const out: TroopStack = {};
  for (const kind of UNIT_KINDS) {
    const men = Math.round(kinds[kind] ?? 0);
    if (men <= 0) continue;
    const id = troopOfKind(kind, Math.max(0, Math.round(gear[kind] ?? 0)));
    if (id) out[id] = (out[id] ?? 0) + men;
  }
  return out;
}

/**
 * Состав стороны — в метки для раскадровки. Ядро делит фигуры в той же
 * пропорции, в какой стоят люди, а что означает метка, знает тот, кто рисует.
 */
export function facesOf(side: SideFaces): Face[] {
  const out: Face[] = [];
  for (const id of Object.keys(side.troops) as TroopId[]) {
    const men = Math.max(0, side.troops[id] ?? 0);
    if (men > 0) out.push({ id, kind: KIND_OF[id], men });
  }
  const militia = Math.max(0, Math.round(side.militia ?? 0));
  if (militia > 0) {
    const archers = Math.min(militia, Math.max(0, Math.round(side.militiaArchers ?? 0)));
    if (archers > 0) out.push({ id: MILITIA, kind: 'archer', men: archers });
    if (militia - archers > 0) out.push({ id: MILITIA, kind: 'infantry', men: militia - archers });
  }
  return out;
}

/**
 * Во что одевать фигуру с этой меткой. Единственная дверь из метки в картинку:
 * рендер про виды и ополчение не рассуждает, он спрашивает здесь.
 *
 * Метка, которой нет ни среди видов, ни среди ополчения, приходит только из
 * ядра, собравшего раскадровку без состава (в игре состав есть всегда). Тогда
 * род показывается видом с ближайшей ступенью снаряжения — тем же правилом,
 * что и чужой гарнизон, а не отдельной таблицей.
 */
export type Wear = { wear: 'troop'; troop: TroopId } | { wear: 'folk' };

export function wearOf(id: string, kind: UnitKind): Wear {
  if (id === MILITIA) return { wear: 'folk' };
  if (id in TROOP_BY_ID) return { wear: 'troop', troop: id as TroopId };
  const guess = troopOfKind(kind, 0);
  return guess ? { wear: 'troop', troop: guess } : { wear: 'folk' };
}

/** Сколько всего людей описано метками: по нему видно, что состав ничего не потерял. */
export const facesTotal = (faces: Face[]): number => faces.reduce((n, f) => n + f.men, 0);

// Раскадровка из записи боя (`castOfRecord`) живёт в `cast.ts`: метками пользуется
// мир, а раскадровкой — только ролик, и в одном модуле они не лежат (см. там).
