// Энергия агента словами (docs/agent_energy.md). Своих чисел здесь нет: сколько, когда полная и когда кончится —
// от мира (`FigureView.energy`, дверь `world/energy.energyView`); строка только называет их (правило 18).
import type { EnergyView } from '@/world/energy';
import { ENERGY_FILL, ENERGY_MAX, ENERGY_ROAD } from '@/world/data/energy';
import { gameDaysOfMs } from '@/game/pace';
import { realLeft } from './wait';

const left = (at: number, now: number): string => realLeft(Math.max(0, (at - now) / 1000));

/** Запас числом: «64 из 100». */
export const energyCount = (e: EnergyView): string => `${e.value} из ${e.max}`;

/** Что с энергией сейчас — одной строкой: копится, уходит в дороге, стоит; выбившийся из сил идёт домой. */
export function energyLine(e: EnergyView, spent: boolean, now: number): string {
  if (spent) return 'Выбился из сил: идёт домой и дел не берёт, пока не дойдёт.';
  if (e.mode === 'fill') return e.fullBy !== undefined ? `Дома копится: полная через ${left(e.fullBy, now)}.` : 'Полная.';
  if (e.mode === 'drain') {
    if (e.emptyBy !== undefined) return `В дороге уходит: кончится через ${left(e.emptyBy, now)}, тогда пойдёт домой сам.`;
    return e.fullBy !== undefined ? 'В дороге уходит, дома начнёт копиться.' : 'В дороге уходит, у цели не тратится.';
  }
  return e.fullBy !== undefined ? 'Не тратится. Дома снова начнёт копиться.' : 'Не тратится, пока стоит: ожидание даром.';
}

/** Подсказка: откуда энергия берётся и куда уходит — словами решения владельца, числами двери (правило 18). */
export const ENERGY_TIP =
  `Энергия агента — ${ENERGY_MAX}. Уходит в дороге (полная — за ${Math.round(gameDaysOfMs(ENERGY_ROAD))} игровых дней пути) и на дела; ` +
  `ожидание у цели и стоянка даром. Дома копится за ${Math.round(gameDaysOfMs(ENERGY_FILL))} игровых дня. Не хватает ни на одно ` +
  'его дело — агент из ворот не выходит, а на карте идёт домой сам.';
