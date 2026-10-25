// Черты агентов: то, чем человек прослыл по своим делам. Все числа здесь, а
// поведение — в `sim/agents.ts` (счёт дел и что черта даёт дома) и в мире (что
// черта даёт на карте, числом из слепка).
//
// Три правила, на которых стоит таблица:
//
// 1. **Черта следует из дел, а не из броска.** Условие — чистая функция от счёта
//    дел человека (`Tally`), и счёт этот пишет та же дверь, что опыт
//    (`sim/agents.recordDeed`), с тем же `DEED_GAP`: иначе черты фармились бы
//    там же, где фармился бы опыт без него.
//
// 2. **Порог — минимум дел плюс доля исходов, а не число дел.** Жизнь агента
//    меряется годом (`AGENT_YEAR`), и это рычаг владельца: при нынешнем годе
//    полководец делает за службу восемь-десять дел, при годе в шесть-тринадцать
//    часов — сорок-девяносто. Порог «шесть побед» молча сгорел бы на первой же
//    правке года; доля её переживает. Плата названа вслух: **черту можно
//    потерять** — первое поражение снимает «Победоносного». Хранить при этом
//    нечего: черт в сохранении нет, есть только счёт дел.
//
// 3. **Черта не трогает число, которым владеет здание или навык.** Вместимость и
//    герой — Статуя; старение разведданных, предупреждение и шанс лазутчика —
//    Дозор; гибель — скрытность; стойкость — обряд; кость боя — отметки полководца; живой обзор — не
//    растёт от агента вовсе. Черты лежат на свободных осях: дух дома после боя,
//    срок сбора дружины, обоз, часовые разведчика, сколько лазутчик занят после
//    дела. Держит это `agents.owners.test.ts`.
//
// Каталога черт игрок не видит — только полученные: черта, которую не заслужить,
// обещанием без действия не становится. «Битый» и «Мясник» приходят: логова растут
// от жителей, и дружина, которая жжёт их всю службу, проигрывает — в приборе
// `npm run time:report`, «служба агента», из пяти полководцев за службу «Битого»
// носили трое, «Мясника» — один.
//
// Черты за безделье нет нарочно: она ударила бы по дипломату, которому сегодня
// нечего делать. Появится вместе с его делом — отношениями с логовами
// (docs/AGENTS.md, «Впереди»).
import type { FigureId } from '@/world/types';
import type { LineagePlace, Tally } from '../types';
import { has } from '../guard';

export type TraitId = 'victor' | 'beaten' | 'swift' | 'butcher' | 'carter' | 'unseen' | 'marked' | 'deft' | 'lagging';

/**
 * Доля исходов дробью, а не числом с точкой: пороги сравниваются умножением
 * крест-накрест, и шесть шестых остаются единицей.
 */
export interface Share {
  num: number;
  den: number;
}

/**
 * Что черта даёт. Дух дома — слагаемое к морали за исход боя полководца; всё
 * прочее — множители к числам мира (единица — ничего). В мир черты едут не
 * именами, а готовыми множителями (`PlayerProfile.traits`): мир не знает, что
 * такое черта, как не знает, что такое уровень.
 */
export interface TraitEffect {
  /** Прибавка к морали дома после выигранного боя полководца. */
  won?: number;
  /** Прибавка к морали дома после проигранного боя полководца. */
  lost?: number;
  /** Срок сбора и роспуска дружины. */
  muster?: number;
  /** Сколько поднимает обоз полководца. */
  carry?: number;
  /** Доля приходов, в которые часовые берут разведчика. */
  catch?: number;
  /** Сколько лазутчик занят после удачного или незамеченного дела. */
  busy?: number;
  /** Сколько лазутчика держат после замеченного провала. */
  held?: number;
}

export type TraitNumbers = Pick<TraitEffect, 'muster' | 'carry' | 'catch' | 'busy' | 'held'>;

export interface TraitDef {
  id: TraitId;
  agent: FigureId;
  name: string;
  good: boolean;
  /** Не меньше стольких дел: раньше доля ничего не говорит. */
  min: number;
  /** Что считается: доля неудач (`fail`), павших на дело (`bled`), сожжённых логов (`burned`). */
  of: 'fail' | 'bled' | 'burned';
  /** Не больше этой доли — `at: 'most'`; не меньше — `at: 'least'`. */
  at: 'most' | 'least';
  share: Share;
  effect: TraitEffect;
}

/** Доля павших измеряется людьми на бой: «не больше одного», «не меньше десяти». */
const per = (n: number): Share => ({ num: n, den: 1 });

export const TRAITS: readonly TraitDef[] = [
  // ---------- Полководец ----------
  {
    id: 'victor',
    agent: 'general',
    name: 'Победоносный',
    good: true,
    min: 5,
    of: 'fail',
    at: 'most',
    share: { num: 0, den: 1 },
    effect: { won: 2 },
  },
  {
    id: 'beaten',
    agent: 'general',
    name: 'Битый',
    good: false,
    min: 3,
    of: 'fail',
    at: 'least',
    share: { num: 1, den: 2 },
    effect: { lost: -3 },
  },
  {
    id: 'swift',
    agent: 'general',
    name: 'Скорый на сборы',
    good: true,
    min: 6,
    of: 'bled',
    at: 'most',
    share: per(1),
    effect: { muster: 0.75 },
  },
  {
    id: 'butcher',
    agent: 'general',
    name: 'Мясник',
    good: false,
    min: 3,
    of: 'bled',
    at: 'least',
    share: per(10),
    effect: { muster: 1.5 },
  },
  {
    id: 'carter',
    agent: 'general',
    name: 'Добычливый',
    good: true,
    min: 4,
    of: 'burned',
    at: 'least',
    share: { num: 3, den: 4 },
    effect: { carry: 1.15 },
  },
  // ---------- Разведчик ----------
  {
    id: 'unseen',
    agent: 'scout',
    name: 'Неприметный',
    good: true,
    min: 8,
    of: 'fail',
    at: 'most',
    share: { num: 1, den: 8 },
    effect: { catch: 0.72 },
  },
  {
    id: 'marked',
    agent: 'scout',
    name: 'Приметный',
    good: false,
    min: 4,
    of: 'fail',
    at: 'least',
    share: { num: 1, den: 3 },
    effect: { catch: 1.32 },
  },
  // ---------- Лазутчик ----------
  {
    id: 'deft',
    agent: 'spy',
    name: 'Сноровистый',
    good: true,
    min: 5,
    of: 'fail',
    at: 'most',
    share: { num: 1, den: 5 },
    effect: { busy: 0.75 },
  },
  {
    id: 'lagging',
    agent: 'spy',
    name: 'Неловкий',
    good: false,
    min: 4,
    of: 'fail',
    at: 'least',
    share: { num: 2, den: 5 },
    effect: { held: 1.5 },
  },
];

export const TRAIT_BY_ID: Readonly<Record<TraitId, TraitDef>> = Object.fromEntries(
  TRAITS.map((t) => [t.id, t]),
) as Record<TraitId, TraitDef>;

export const isTraitId = (v: unknown): v is TraitId =>
  typeof v === 'string' && has(TRAIT_BY_ID, v);

/** Сколько дел засчитано человеку: удачи и неудачи вместе. */
export const deedsOf = (t: Tally): number => t.ok + t.fail;

/** Держит ли человек черту при таком счёте. Чистая функция: хранить черты незачем. */
export function holds(def: TraitDef, t: Tally): boolean {
  const n = deedsOf(t);
  if (n < def.min) return false;
  const part = t[def.of];
  // part / n против num / den — крест-накрест, без деления.
  return def.at === 'most' ? part * def.share.den <= n * def.share.num : part * def.share.den >= n * def.share.num;
}

/** Черты человека на этом месте, в порядке таблицы. */
export const traitsOf = (agent: FigureId, t: Tally): TraitId[] =>
  TRAITS.filter((d) => d.agent === agent && holds(d, t)).map((d) => d.id);

// ---------- Родословная ----------

/**
 * Сколько ушедших помнит каждое место. Родословная заведена у Статуи — дом
 * военачальников — и у дома правителя; у остальных мест потолок ноль: четыре списка
 * по шесть имён стоили бы трети сохранения партии. Захочется родословной в Дозоре —
 * меняется одно число, а не дверь.
 *
 * **Книга одна на дом и на места агентов** (docs/dynasty.md, раздел 1.2): двух книг
 * рядом быть не должно — это два потолка, два места записи и две правды о том, кого мы
 * помним. Потолок дома тот же, что у Статуи: второго числа не заводили.
 */
export const LINEAGE_KEEP: Readonly<Record<LineagePlace, number>> = { general: 6, scout: 0, spy: 0, diplomat: 0, ruler: 6 };

/**
 * С какого уровня ушедшего на покой помнят. Погибших помнят всех: смерть помнят
 * и без заслуг, а сорок новичков, отслуживших по полдня, — это шум.
 */
export const LINEAGE_LEVEL = 2;
