// «Указы» державы — одна копия на игру (UI-7, docs/ui_v2.md, 5.6; находка Д3): указ, паёк и налог правят здесь, ратуша
// ведёт сюда дверью. Каждый вариант — строкой таблицы с тем, что он даст (находка Ч14: прежде видно было только
// выбранное), и касание строки выбирает его: переключают даром в любой миг. Казна — три числа с разбором (Ч1).
//
// Своей арифметики нет (правило 18): что даст вариант — поля записи (`DecreeDef`, `RationDef`) и `derived.taxQuote`;
// сбор — `taxIncomePerDay` со своим слагаемым веры (`faithGoldPerDay`), жалованье — `upkeepInfo` (дружине и мастерам),
// как у подсказки золота верха (`hudTips.goldTip`).
import type { EstateId, GameState } from '@/game/types';
import { DECREES, RATIONS, TAXES, type DecreeId } from '@/game/data/policy';
import { decreeBlock, estatesNow, faithDef, faithGoldPerDay, taxIncomePerDay, taxQuote, upkeepInfo, wagesDue } from '@/game/derived';
import { leverWords } from '@/ui/next/estates';
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
  { key: 'output', title: 'Выработка', align: 'right', w: '88px' },
  { key: 'morale', title: 'Мораль/д', align: 'right', w: '76px' },
];
export const RATION_COLS: readonly Col[] = [
  { key: 'name', title: 'Паёк' },
  { key: 'food', title: 'Еда', align: 'right', w: '52px' },
  { key: 'morale', title: 'Мораль/д', align: 'right', w: '76px' },
  { key: 'growth', title: 'Рождения', align: 'right', w: '76px' },
];
export const TAX_COLS: readonly Col[] = [
  { key: 'name', title: 'Налог' },
  { key: 'gold', title: 'Золото/д', align: 'right', w: '76px' },
  { key: 'morale', title: 'Мораль', align: 'right', w: '60px' },
  { key: 'output', title: 'Выработка', align: 'right', w: '88px' },
];

/** Строки указа короны: что даст каждый — полями записи. Указы сословий — своей таблицей (`estateDecreeCells`). */
export function decreeCells(): { id: (typeof DECREES)[number]['id']; cells: Record<string, string> }[] {
  return DECREES.filter((d) => !d.estate).map((d) => ({ id: d.id, cells: { name: d.name, output: pctCell(d.output), morale: perDayCell(d.moralePerDay) } }));
}

export const ESTATE_DECREE_COLS: readonly Col[] = [
  { key: 'name', title: 'Указ сословия · что даст' },
  { key: 'loyalty', title: 'Лояльн.', align: 'right', w: '64px' },
];

/**
 * Строки указов сословий (РТ-2, docs/stability.md, Р1.6): что даст указ — плюс сословия на копии партии с этим указом (та же
 * мерка, `derived.estatesNow`), лояльность сословия и порог. Закрыт — строка гаснет, причина — тостом двери `setDecree`.
 */
export function estateDecreeCells(s: GameState): { id: DecreeId; estate: EstateId; open: boolean; gives: string; loyalty: number }[] {
  return DECREES.filter((d) => d.estate).map((d) => {
    const e = d.estate as EstateId;
    const tried = estatesNow({ ...s, decree: d.id })[e];
    return { id: d.id, estate: e, open: decreeBlock(s, d.id) === null, gives: leverWords(e, tried).plus, loyalty: estatesNow(s)[e].loyalty };
  });
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
