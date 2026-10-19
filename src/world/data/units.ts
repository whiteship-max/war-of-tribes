// Кто ходит по карте. Скорость самого медленного юнита в отряде задаёт время пути,
// поэтому разведчик с воинами доедет со скоростью воинов — это осознанный выбор игрока.
import type { UnitId } from '../types';
import type { IconName } from '@/ui/icons/alias';

export interface UnitDef {
  id: UnitId;
  name: string;
  /** Название для «3 воина» / «1 воин». */
  one: string;
  icon: IconName;
  description: string;
  /** Клеток в минуту по равнине. */
  speed: number;
  /** Доля мощи, которую юнит даёт в атаке (для воина — сила воина племени). */
  attack: number;
  /** Сколько добра уносит с собой при удачном набеге. */
  carry: number;
  /**
   * Скольких невольников уводит с собой из павшего города. Тот же род числа, что
   * `carry`: верхний предел, а не доля, — малый отряд большой город не уведёт.
   */
  escort: number;
  /** Откуда берётся: воины — из воинов, разведчики — из свободных жителей. */
  from: 'warrior' | 'idle';
}

export const UNITS: UnitDef[] = [
  {
    id: 'scout',
    name: 'Разведчики',
    one: 'разведчик',
    icon: 'fig-scout',
    description: 'Свободный житель, посланный смотреть. Быстр, в драку не лезет.',
    speed: 9,
    attack: 0,
    carry: 0,
    escort: 0,
    from: 'idle',
  },
  {
    id: 'warrior',
    name: 'Бойцы',
    one: 'боец',
    icon: 'gear-shield',
    description: 'Пеший боец с копьём. В походе город не защищает.',
    speed: 4.5,
    attack: 1,
    // Сколько обоз отряда увозит на одного бойца. Число меряное и мерка одна:
    // набег дозревшего логова медианной опоры при жителях посёлка (`lairs.lairRaid`)
    // должен унести большую часть незапрятанного склада того же
    // уровня — но не весь. Проверяется разделом «что теряет игрок, ушедший на
    // ночь» в `npm run sack:report`.
    //
    // Прежние восемь были из времён, когда добычей считалась горстка: склад
    // первого уровня держит 33 600 добра, а отряд, способный его взять, уносил
    // 248 — правило «победитель забирает всё, кроме тайника» при таком обозе не
    // работало вовсе, и тайник был украшением.
    carry: 750,
    // Скольких невольников ведёт один боец. Меряное (`npm run order:report`,
    // раздел «падение города»): лагерь, севший под стенами, мал — он садится,
    // только когда штурм безнадёжен, — и уводит заметную часть, а не всех.
    escort: 5,
    from: 'warrior',
  },
];

export const UNIT_BY_ID: Record<UnitId, UnitDef> = Object.fromEntries(
  UNITS.map((u) => [u.id, u]),
) as Record<UnitId, UnitDef>;

export const UNIT_IDS: UnitId[] = UNITS.map((u) => u.id);

/** Сколько всего бойцов в отряде. */
export const stackSize = (units: { [k in UnitId]?: number }): number =>
  UNIT_IDS.reduce((n, id) => n + (units[id] ?? 0), 0);

/** Скорость отряда — по самому медленному. Пустой отряд считаем пешим воином. */
export function stackSpeed(units: { [k in UnitId]?: number }): number {
  let speed = Infinity;
  for (const u of UNITS) if ((units[u.id] ?? 0) > 0) speed = Math.min(speed, u.speed);
  return Number.isFinite(speed) ? speed : UNIT_BY_ID.warrior.speed;
}

/** Сколько добра отряд способен унести. */
export const stackCarry = (units: { [k in UnitId]?: number }): number =>
  UNITS.reduce((n, u) => n + (units[u.id] ?? 0) * u.carry, 0);

/** Скольких невольников отряд способен увести. */
export const stackEscort = (units: { [k in UnitId]?: number }): number =>
  UNITS.reduce((n, u) => n + (units[u.id] ?? 0) * u.escort, 0);
