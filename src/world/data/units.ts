// Кто ходит по карте. Скорость самого медленного юнита в отряде задаёт время пути,
// поэтому разведчик с воинами доедет со скоростью воинов — это осознанный выбор игрока.
import type { UnitId } from '../types';

export interface UnitDef {
  id: UnitId;
  name: string;
  /** Название для «3 воина» / «1 воин». */
  one: string;
  icon: string;
  description: string;
  /** Клеток в минуту по равнине. */
  speed: number;
  /** Доля мощи, которую юнит даёт в атаке (для воина — сила воина племени). */
  attack: number;
  /** Сколько добра уносит с собой при удачном набеге. */
  carry: number;
  /** Откуда берётся: воины — из воинов, разведчики — из свободных жителей. */
  from: 'warrior' | 'idle';
}

export const UNITS: UnitDef[] = [
  {
    id: 'scout',
    name: 'Разведчики',
    one: 'разведчик',
    icon: '👣',
    description: 'Свободный житель, посланный смотреть. Быстр, в драку не лезет.',
    speed: 9,
    attack: 0,
    carry: 0,
    from: 'idle',
  },
  {
    id: 'warrior',
    name: 'Воины',
    one: 'воин',
    icon: '🛡️',
    description: 'Копьё племени. Пока в походе — деревню не защищает.',
    speed: 4.5,
    attack: 1,
    carry: 8,
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
