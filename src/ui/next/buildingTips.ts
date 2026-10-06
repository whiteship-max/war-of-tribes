// Подсказки окна постройки нового интерфейса — чистые функции (правило 18: числа — из функций игры, тест
// сверяет строку с ними, `building.test.ts`).
import type { UpgradeGain } from '@/ui/parts/upgrade';
import { count } from '@/ui/parts/plural';
import type { TipContent } from './tip';

/**
 * Подсказка по значку рабочих: сколько занято из скольких, сколько свободных рук в племени, дадут ли что-то
 * свободные места и сколько мест прибавит следующий уровень — замером `upgradeGains`, а не числом рядом.
 */
export function workerTip(job: string, hands: number, slots: number, free: number, gains: UpgradeGain[] | null, spareHelps: boolean): TipContent {
  const parts = [`Свободных рук в городе: ${free}.`];
  if (hands < slots && !spareHelps) parts.push('Выработка на потолке, новые руки ничего не дадут.');
  const more = gains?.find((g) => g.id === 'slots');
  if (more) parts.push(`Следующий уровень даст ещё ${count(more.after - more.before, 'место', 'места', 'мест')}.`);
  return { title: `${job} · ${hands} из ${slots}`, body: parts.join(' ') };
}
