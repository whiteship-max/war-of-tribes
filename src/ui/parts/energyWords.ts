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
  if (spent) return 'Выбился из сил. Идёт домой и до дома дел не берёт.';
  if (e.mode === 'fill') return e.fullBy !== undefined ? `Дома копится, полная через ${left(e.fullBy, now)}.` : 'Полная.';
  if (e.mode === 'drain') {
    if (e.emptyBy !== undefined) return `В дороге уходит. Кончится через ${left(e.emptyBy, now)}, тогда повернёт домой сам.`;
    return e.fullBy !== undefined ? 'В дороге уходит, дома начнёт копиться.' : 'В дороге уходит, у цели не тратится.';
  }
  return e.fullBy !== undefined ? 'Не тратится. Дома снова начнёт копиться.' : 'Пока стоит, не тратится.';
}

/** Подсказка: откуда энергия берётся и куда уходит — словами решения владельца, числами двери (правило 18). */
export const ENERGY_TIP =
  `Полная энергия — ${ENERGY_MAX}. Она уходит на дела и в дороге: полной хватает на ${Math.round(gameDaysOfMs(ENERGY_ROAD))} игр. дн. пути. ` +
  `Ожидание у цели и стоянка ничего не стоят. Дома энергия копится за ${Math.round(gameDaysOfMs(ENERGY_FILL))} игр. дн. ` +
  'Если её не хватает ни на одно дело, человек не выходит из ворот, а с карты сам идёт домой.';
