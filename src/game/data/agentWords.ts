// Слова раздела «Агенты» Ратуши (АГ-1): характеристики, черты кандидатов и дело места — едут с окном Ратуши, первой загрузке
// они не нужны. Числа в строках — функциями правил (`agentrules`, `data/agents`, `world/peril`), своей арифметики у слов нет
// (правило 18). Летопись и весть о пустом месте — `data/recruit.ts`, числа — `game/agentrules.ts`.
import type { FigureId } from '@/world/types';
import type { PipId } from '@/battle';
import type { IconName } from '@/ui/icons/alias';
import { SABOTAGE_STEP, SERVICE_SHIFT, eloquenceCut, sabotagePower, type AgentStat, type AgentTrait } from '../agentrules';
import { SIGHT_PER_CIRCLE, STEALTH_PER_CIRCLE } from './agents';
import { veilAt } from '@/world/peril';
import { num } from '../num';

/** Строка характеристики: значок, имя и что даёт при `n` кружках (отметке — при `n` отметках). */
export interface StatWord {
  icon: IconName;
  name: string;
  /** Что даёт при этом числе — словами, числом той же функции, что считает дело. */
  does: (n: number) => string;
}

/** Отметки полководца по фазам: каждая — грань кости своей фазы в его боях. */
export const PIP_WORD: Readonly<Record<PipId, StatWord>> = {
  fire: { icon: 'stat-fire', name: 'Обстрел', does: (n) => `${n} — граней кости в обстреле: урон его отряда стрелами.` },
  shock: { icon: 'stat-shock', name: 'Сшибка', does: (n) => `${n} — граней кости в сшибке: урон его отряда в первом ударе.` },
  melee: { icon: 'stat-melee', name: 'Сеча', does: (n) => `${n} — граней кости в сече: урон его отряда в долгой рубке.` },
  maneuver: { icon: 'stat-maneuver', name: 'Манёвр', does: (n) => `${n} — манёвр: снимает штраф переправы, если у врага меньше.` },
};

/** Прочие характеристики: число — кружки (1…5), первый — новичок. */
export const STAT_WORD: Readonly<Record<Exclude<AgentStat, 'pips'>, StatWord>> = {
  sight: {
    icon: 'stat-sight',
    name: 'Зоркость',
    does: (n) => (n > 1 ? `Открывает землю в пути шире на ${num(SIGHT_PER_CIRCLE * (n - 1), 0)} кл.` : 'Новичок: открывает землю обычным кругом.'),
  },
  stealth: {
    icon: 'stat-stealth',
    name: 'Скрытность',
    does: (n) =>
      n > 1
        ? `${Math.round(STEALTH_PER_CIRCLE * (n - 1) * 100)} % провалов проходят без поимки, гибель на деле реже в ${num(1 / veilAt(n), 1)} раза.`
        : 'Новичок: провал — поимка, гибель на деле — как у всех.',
  },
  sabotage: {
    icon: 'stat-sabotage',
    name: 'Диверсия',
    does: (n) =>
      n > 1
        ? `Поджог, кража и смута у соседа — ×${num(sabotagePower(n), 2)} против новичка (+${Math.round(SABOTAGE_STEP * 100)} % за кружок).`
        : 'Новичок: поджог, кража и смута — обычной силы.',
  },
  eloquence: {
    icon: 'stat-eloquence',
    name: 'Красноречие',
    does: (n) =>
      n > 1 ? `Лагерь у стен сбавляет дань за снятие осады на ${Math.round(eloquenceCut(n) * 100)} %.` : 'Новичок: лагерь просит справедливую дань.',
  },
};

/** Черты кандидатов: имя, добрая ли и что делает. */
export const AGENT_TRAIT_WORD: Readonly<Record<AgentTrait, { name: string; good: boolean; does: string }>> = {
  frugal: { name: 'Бережливый', good: true, does: 'вперёд жалованья не берёт' },
  greedy: { name: 'Корыстный', good: false, does: 'просит жалованье ступенью выше' },
  apt: { name: 'Способный', good: true, does: 'удачное дело даёт на единицу опыта больше' },
  hale: { name: 'Крепкий', good: true, does: `уйдёт на покой на ${Math.round(SERVICE_SHIFT)} лет позже` },
  frail: { name: 'Хворый', good: false, does: `уйдёт на покой на ${Math.round(SERVICE_SHIFT)} лет раньше` },
};

/** Дело места — одной строкой под пустым местом. */
export const ROLE_DUTY: Readonly<Record<FigureId, string>> = {
  general: 'Водит отряд: удар, осада, перехват, выручка',
  scout: 'Открывает землю и считает гарнизоны',
  spy: 'Выведывает, жжёт, крадёт и мутит у соседей',
  diplomat: 'Союзы с соседями и дань за снятие осады',
};

/** Строки летописи найма и увольнения (`sim/recruits`). */
export const RECRUIT_LOG = {
  hired: (who: string, years: string): string => `${who} нанят в Ратуше, ${years}.`,
  dismissed: (who: string): string => `${who} уволен.`,
};
