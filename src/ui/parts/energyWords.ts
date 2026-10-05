// Энергия агента словами (docs/agent_energy.md). Своих чисел здесь нет: сколько, когда полная и когда кончится —
// от мира (`FigureView.energy`, дверь `world/energy.energyView`); строка только называет их (правило 18).
import type { EnergyView } from '@/world/energy';
import { realLeft } from './wait';

const left = (at: number, now: number): string => realLeft(Math.max(0, (at - now) / 1000));

/** Запас числом: «64 из 100». */
export const energyCount = (e: EnergyView): string => `${e.value} из ${e.max}`;

/** Что с энергией сейчас — одной строкой: копится, уходит, стоит; выбившийся из сил идёт домой. */
export function energyLine(e: EnergyView, spent: boolean, now: number): string {
  if (spent) return 'Выбился из сил: идёт домой и дел не берёт, пока не дойдёт.';
  if (e.mode === 'fill') return e.fullBy !== undefined ? `Дома копится: полная через ${left(e.fullBy, now)}.` : 'Полная.';
  if (e.mode === 'drain') {
    return e.emptyBy !== undefined
      ? `На карте уходит: кончится через ${left(e.emptyBy, now)}, тогда пойдёт домой сам.`
      : 'На карте уходит, дома снова начнёт копиться.';
  }
  return e.fullBy !== undefined ? 'Не тратится. Дома снова начнёт копиться.' : 'Не тратится, пока стоит лагерь или идёт война.';
}

/** Подсказка: откуда энергия берётся и куда уходит — словами решения владельца. */
export const ENERGY_TIP =
  'Энергия агента — сто. На карте уходит за пять игровых дней, дома копится за два. Дела стоят энергию; без неё агент ничего не делает, а кончилась на карте — идёт домой сам.';
