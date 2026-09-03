// Указы и рацион — то, чем вождь правит племенем из своего дома.
// Всё, что они меняют, лежит здесь: логика читает эту таблицу и нигде не считает
// проценты сама. Последствия написаны словами прямо в `effect` — этот текст
// стоит на кнопке, а не в подсказке: игрок выбирает, уже зная цену.

export type DecreeId = 'none' | 'order' | 'freedom';
export type RationId = 'lean' | 'normal' | 'rich';

export interface DecreeDef {
  id: DecreeId;
  name: string;
  icon: string;
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
    icon: '🤝',
    output: 1,
    moralePerDay: 0,
    effect: 'Всё идёт своим чередом',
  },
  {
    id: 'order',
    name: 'Строгий порядок',
    icon: '⚖️',
    output: 1.1,
    moralePerDay: -0.5,
    effect: '+10% ко всей выработке, −0.5 морали в день',
  },
  {
    id: 'freedom',
    name: 'Вольный уклад',
    icon: '🎶',
    output: 0.95,
    moralePerDay: 0.5,
    effect: '−5% выработки, +0.5 морали в день',
  },
];

export const DECREE_BY_ID: Record<DecreeId, DecreeDef> = Object.fromEntries(
  DECREES.map((d) => [d.id, d]),
) as Record<DecreeId, DecreeDef>;

export interface RationDef {
  id: RationId;
  name: string;
  icon: string;
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
    icon: '🥣',
    food: 0.7,
    moralePerDay: -0.6,
    growth: 0,
    effect: '−30% расхода еды, мораль падает, рождений нет',
  },
  {
    id: 'normal',
    name: 'Обычный',
    icon: '🍖',
    food: 1,
    moralePerDay: 0,
    growth: 1,
    effect: 'Ровно столько, сколько нужно',
  },
  {
    id: 'rich',
    name: 'Щедрый',
    icon: '🍲',
    food: 1.4,
    moralePerDay: 0.6,
    growth: 1.5,
    effect: '+40% расхода еды, мораль растёт, рождения чаще',
  },
];

export const RATION_BY_ID: Record<RationId, RationDef> = Object.fromEntries(
  RATIONS.map((r) => [r.id, r]),
) as Record<RationId, RationDef>;
