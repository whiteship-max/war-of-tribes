// «Указы» державы — одна копия на игру (UI-7, docs/ui_v2.md, 5.6; находка Д3): указ, паёк и налог правят здесь, ратуша
// ведёт сюда дверью. Каждый вариант — строкой таблицы с тем, что он даст (находка Ч14: прежде видно было только
// выбранное), и касание строки выбирает его: переключают даром в любой миг. Казна — три числа с разбором (Ч1).
//
// Своей арифметики нет (правило 18): что даст вариант — поля записи (`DecreeDef`, `RationDef`) и `derived.taxQuote`;
// сбор — `taxIncomePerDay` со своим слагаемым веры (`faithGoldPerDay`), жалованье — `upkeepInfo` (дружине и мастерам),
// как у подсказки золота верха (`hudTips.goldTip`).
import type { GameState } from '@/game/types';
import { DECREES, RATIONS, TAXES } from '@/game/data/policy';
import { faithDef, faithGoldPerDay, taxIncomePerDay, taxQuote, upkeepInfo, wagesDue } from '@/game/derived';
import { daysSpan } from '@/game/span';
import { num } from '@/game/num';
import { signed } from '@/ui/parts/signed';
import { breakdown } from '@/ui/kit/breakdown';
import type { Col } from '@/ui/kit/Table';
import type { TipContent } from '@/ui/next/tip';
import { perDay, PER_DAY } from '@/ui/next/hudTips';

/** Множитель — процентом перемены: 1.1 → «+10 %»; без перемены — «—» (пустое не пишется числом). */
export const pctCell = (mult: number): string => (Math.abs(mult - 1) < 1e-9 ? '—' : `${signed((mult - 1) * 100, 0)} %`);
/** Мораль в день со знаком; ноль — «—». */
export const perDayCell = (n: number): string => (n === 0 ? '—' : signed(n));
/** Рождения пайка: нет, без перемены или множителем. */
export const growthCell = (g: number): string => (g === 0 ? 'нет' : g === 1 ? '—' : `×${num(g, 3)}`);

export const DECREE_COLS: readonly Col[] = [
  { key: 'name', title: 'Указ' },
  { key: 'output', title: 'Выработка', align: 'right', w: '72px' },
  { key: 'morale', title: 'Мораль/д', align: 'right', w: '64px' },
];
export const RATION_COLS: readonly Col[] = [
  { key: 'name', title: 'Паёк' },
  { key: 'food', title: 'Еда', align: 'right', w: '52px' },
  { key: 'morale', title: 'Мораль/д', align: 'right', w: '64px' },
  { key: 'growth', title: 'Рождения', align: 'right', w: '64px' },
];
export const TAX_COLS: readonly Col[] = [
  { key: 'name', title: 'Налог' },
  { key: 'gold', title: 'Золото/д', align: 'right', w: '64px' },
  { key: 'morale', title: 'Мораль', align: 'right', w: '52px' },
  { key: 'output', title: 'Выработка', align: 'right', w: '72px' },
];

/** Строки указа: что даст каждый — полями записи. */
export function decreeCells(): { id: (typeof DECREES)[number]['id']; cells: Record<string, string> }[] {
  return DECREES.map((d) => ({ id: d.id, cells: { name: d.name, output: pctCell(d.output), morale: perDayCell(d.moralePerDay) } }));
}

/** Строки пайка: еда, мораль, рождения — полями записи. */
export function rationCells(): { id: (typeof RATIONS)[number]['id']; cells: Record<string, string> }[] {
  return RATIONS.map((r) => ({
    id: r.id,
    cells: { name: r.name, food: pctCell(r.food), morale: perDayCell(r.moralePerDay), growth: growthCell(r.growth) },
  }));
}

/** Строки налога: сбор в день, цель морали и выработка при этом налоге — `taxQuote`, тем же числом, что считает игра. */
export function taxCells(s: GameState): { id: (typeof TAXES)[number]['id']; cells: Record<string, string>; gold: number }[] {
  return TAXES.map((t) => {
    const q = taxQuote(s, t.id);
    return {
      id: t.id,
      gold: q.gold,
      cells: { name: t.name, gold: perDay(q.gold).replace(/ в день$/, ''), morale: String(Math.round(q.morale)), output: `×${num(q.output, 2)}` },
    };
  });
}

/** Сбор в день: налог и вера (`taxIncomePerDay` — одна дверь, вера в ней своим слагаемым). */
export function incomeTip(s: GameState): TipContent {
  const income = taxIncomePerDay(s);
  const faith = faithGoldPerDay(s);
  return breakdown({
    title: `Сбор · ${perDay(income)}`,
    body: 'Чем больше жителей, тем больше сбор. Налог выше — мораль ниже.',
    total: income,
    parts: [
      { label: 'Налог', value: income - faith },
      { label: faithDef(s)?.name ?? 'Вера', value: faith },
    ],
    sumLabel: PER_DAY,
  });
}

/** Жалованье в день: дружине и наёмным мастерам (`upkeepInfo`); пока идёт отсрочка, платить нечего. */
export function wagesTip(s: GameState): TipContent {
  const up = upkeepInfo(s);
  const due = wagesDue(s);
  const paid = due > 0;
  return breakdown({
    title: `Жалованье · ${perDay(-due)}`,
    body: up.amnestyDays > 0 ? `Платить начнём через ${daysSpan(up.amnestyDays)}.` : 'Не хватит золота, и бойцы начнут уходить.',
    total: -due,
    parts: [
      { label: 'Дружине', value: paid ? -up.armyWages : 0 },
      { label: 'Наёмным мастерам', value: paid ? -up.mastersWages : 0 },
    ],
    sumLabel: PER_DAY,
  });
}
