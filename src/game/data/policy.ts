// Указы и рацион — то, чем вождь правит племенем из своего дома.
// Всё, что они меняют, лежит здесь: логика читает эту таблицу и нигде не считает
// проценты сама. Последствия написаны словами прямо в `effect` — этот текст
// стоит на кнопке, а не в подсказке: игрок выбирает, уже зная цену.

export type DecreeId = 'none' | 'order' | 'freedom';
export type TaxId = 'none' | 'moderate' | 'high';
export type RationId = 'lean' | 'normal' | 'rich';

export interface DecreeDef {
  id: DecreeId;
  name: string;
  /** Множитель всей выработки ресурсов. */
  output: number;
  /** Прибавка к морали за игровой день. */
  moralePerDay: number;
  /** Строка последствий — она же надпись на кнопке. */
  effect: string;
}

export const DECREES: DecreeDef[] = [
  {
    id: 'none',
    name: 'Без указа',
    output: 1,
    moralePerDay: 0,
    effect: 'Город живёт по обычаю',
  },
  {
    id: 'order',
    name: 'Твёрдая рука',
    output: 1.1,
    moralePerDay: -0.5,
    effect: 'Стража на улицах, работа от зари до зари',
  },
  {
    id: 'freedom',
    name: 'Вольный уклад',
    output: 0.95,
    moralePerDay: 0.5,
    effect: 'Праздники чаще, работа неспешнее',
  },
];

export const DECREE_BY_ID: Record<DecreeId, DecreeDef> = Object.fromEntries(
  DECREES.map((d) => [d.id, d]),
) as Record<DecreeId, DecreeDef>;

export interface RationDef {
  id: RationId;
  name: string;
  /** Множитель расхода еды. */
  food: number;
  /** Прибавка к морали за игровой день. */
  moralePerDay: number;
  /**
   * Множитель скорости прироста населения. 0 — рождений нет вовсе:
   * на скудном пайке племя выживает, но не растёт.
   */
  growth: number;
  effect: string;
}

export const RATIONS: RationDef[] = [
  {
    id: 'lean',
    name: 'Скудный',
    food: 0.7,
    moralePerDay: -0.6,
    growth: 0,
    effect: 'Пустая похлёбка, свадьбы откладывают',
  },
  {
    id: 'normal',
    name: 'Обычный',
    food: 1,
    moralePerDay: 0,
    growth: 1,
    effect: 'Каша и хлеб каждому',
  },
  {
    id: 'rich',
    name: 'Щедрый',
    food: 1.4,
    moralePerDay: 0.6,
    growth: 1.5,
    effect: 'Мясо к столу, свадьбы играют чаще',
  },
];

export const RATION_BY_ID: Record<RationId, RationDef> = Object.fromEntries(
  RATIONS.map((r) => [r.id, r]),
) as Record<RationId, RationDef>;

// ---------- Налог ----------

/**
 * Сколько золота приносит один человек за игровой день при полном налоге.
 * Это и есть ценность населения: казна растёт от того, сколько народу в посёлке,
 * а не от указа вождя. Множитель самого уровня налога — ниже, в `TaxDef.perPop`.
 */
export const TAX_PER_POP = 0.7;

/**
 * Уровень налога — третий переключатель ратуши.
 *
 * Плата за налог — мораль, и берётся она не медленным сползанием, а прямой
 * просадкой цели (`moraleTarget`): сползание племя отыграло бы за минуту, а
 * просадка держится ровно столько, сколько держат налог. Низкая мораль режет всю
 * выработку разом, поэтому высокий налог выгоден в короткую — заткнуть дыру, —
 * но не как постоянный уклад: за игровой год потерянная выработка стоит дороже
 * всей собранной казны (это проверяет тест).
 *
 * Мерка теста — рынок, а не оборона. Партия, которая держит войско, показала обратное:
 * высокий налог держит зрелый город и почти не стоит роста, потому что мораль стоит в
 * потолке и просадка до выработки почти не доходит (docs/hiring.md). Поэтому новая партия
 * начинается с высокого налога, а настоящий выбор между уровнями — долг
 * (docs/PROMISES_DEBT.md). Цену ратуша показывает числами — `derived.taxQuote`.
 */
export interface TaxDef {
  id: TaxId;
  name: string;
  /** Доля от «золота с человека в день» (см. TAX_PER_POP). */
  perPop: number;
  /** На сколько проседает целевая мораль, пока налог держат. */
  moralePenalty: number;
  /** Строка последствий — она же надпись на кнопке. */
  effect: string;
}

export const TAXES: TaxDef[] = [
  {
    id: 'none',
    name: 'Без налога',
    perPop: 0,
    moralePenalty: 0,
    effect: 'Сборщики сидят дома',
  },
  {
    id: 'moderate',
    name: 'Умеренный',
    perPop: 0.55,
    moralePenalty: 8,
    effect: 'Сборщики берут с оглядкой',
  },
  {
    id: 'high',
    name: 'Высокий',
    perPop: 1,
    moralePenalty: 22,
    effect: 'Сборщики выгребают всё до гроша',
  },
];

export const TAX_BY_ID: Record<TaxId, TaxDef> = Object.fromEntries(
  TAXES.map((t) => [t.id, t]),
) as Record<TaxId, TaxDef>;
