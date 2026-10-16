// «Мораль» — разбор цели одной таблицей (UI-8, Д13, docs/ui_v2.md, 5.7). Прежде окно писало налог, пир и обряд дважды:
// списком «Что добавляет / Что отнимает» и ещё раз в «Как складывается цель». Теперь каждое слагаемое — одна строка, и
// строки складываются в цель на глазах игрока (docs/ui_v2.md, 2.2): основа, слагаемые `moraleBreakdown`, срез шкалы, налог,
// пир, обряд и вести поимённо. Чистые функции — их сверяет тест (`ui8.test.ts`); своей арифметики нет (правило 18).
import type { GameState } from '@/game/types';
import { activeBoons, moraleBreakdown, taxOf } from '@/game/derived';

/** Строка разбора цели: значок, имя, откуда число, вклад; `after` — ложится после предела шкалы. */
export interface MoraleRow {
  id: string;
  icon: string;
  name: string;
  hint: string;
  value: number;
  after?: boolean;
}

/** Порог, ниже которого строку не пишут: «зима −0» — шум. */
const EPS = 0.001;

/**
 * Цель морали строками: основа и слагаемые до шкалы, срез шкалы (сумма выше 100 или цель за пределами 0…100) и то, что
 * ложится после неё, — налог, пир, обряд и усилители вестей поимённо (их сумма — `boon` разбора). Сумма строк — `target`
 * ровно. Служители — строкой и при нуле: рычаг, о котором иначе не узнать (`moraleBreakdown`).
 */
export function moraleRows(s: GameState): { rows: MoraleRow[]; target: number } {
  const m = moraleBreakdown(s);
  const after = m.clamped - m.tax + m.feast + m.rite + m.boon;
  const rows: MoraleRow[] = [{ id: 'base', icon: '🏛️', name: 'Основа', hint: 'мораль устоявшегося города', value: m.base }, ...m.lines];
  const cut = m.clamped - m.raw + (m.target - after);
  if (Math.abs(cut) > EPS) rows.push({ id: 'cut', icon: '🚧', name: 'Предел шкалы', hint: 'цель держится в 0…100', value: cut });
  const tax = taxOf(s);
  if (m.tax > EPS) rows.push({ id: 'tax', icon: tax.icon, name: `Налог: ${tax.name.toLowerCase()}`, hint: 'после предела шкалы', value: -m.tax, after: true });
  // Пир и обряд — две строки: это два здания и два решения (обряд, подписанный «Пиром», отправлял не в то здание).
  if (m.feast > EPS) rows.push({ id: 'feast', icon: '🍺', name: 'Пир в трактире', hint: 'после предела шкалы', value: m.feast, after: true });
  if (m.rite > EPS) rows.push({ id: 'rite', icon: '🕯️', name: 'Обряд в приходе', hint: 'после предела шкалы', value: m.rite, after: true });
  // Усилители вестей — по строке на каждый: игрок ищет, какой из них греет или студит.
  for (const { def } of activeBoons(s)) {
    if (!def.morale) continue;
    rows.push({ id: `boon-${def.id}`, icon: def.icon, name: def.name, hint: 'весть, после предела шкалы', value: def.morale, after: true });
  }
  return { rows, target: m.target };
}
