// Викторина «Кто победит»: два состава сходятся в поле, игрок выбирает сторону.
//
// Вопросы не придуманы и нигде не записаны. Состав генерируется по сиду дня, а
// правильный ответ добывается прогоном настоящей боевой симуляции — той самой,
// что считает походы. Иначе викторина рано или поздно соврёт: рукописный ответ
// молча разойдётся с балансом при первой же правке `battle/config.ts`, и игрок
// будет учиться неправде. Поэтому в этом модуле нет ни таблицы ответов, ни
// одного множителя, написанного руками.
//
// Ни React, ни three, ни состояния игры, ни часов: чистая функция от числа.
// Единственный источник случайности — `seeded` (mulberry32). `rnd`/`pick` из
// sim/random сюда не годятся: их подменяют тесты, и уровень перестал бы быть
// одинаковым у всех.
import type { TroopId } from '../types';
import { seeded } from '../sim/random';
import { TROOPS_OF_KIND, gearOf, kindsOf, weightOf, type TroopStack } from '../battle/kinds';
import {
  UNIT_KINDS,
  describeEvent,
  deploySetup,
  simulateBattle,
  stackTotal,
  summarize,
  type ArmySetup,
  type BattleResult,
  type EventId,
  type UnitKind,
} from '@/battle';

/**
 * Все пороги отбора — здесь, как числа боя в `battle/config.ts`: логика ниже
 * только читает таблицу. Каждое число объясняет, откуда оно взялось, потому что
 * подбирались они прогоном по сотням дней, а не из головы.
 */
export const QUIZ = {
  /**
   * Сколько бойцов строя (`BATTLE_MAN`) выставляет сторона. Снизу — чтобы
   * секторная раскладка не выродилась в один-два человека на сектор и бой не
   * решался округлением; сверху — чтобы в вопросе стояли читаемые числа вроде
   * «40 копейщиков», а не полк из тысячи.
   */
  minMen: 90,
  maxMen: 260,
  /**
   * Не больше трёх видов на сторону: панель показывает две колонки по 171 px,
   * четвёртая строка в них не влезает.
   */
  maxTypes: 3,
  /**
   * Один вид на род боя. Три вида пехоты выглядят как выбор, а на поле это одна
   * и та же пехота — вопрос про кольцо контрров из такого не выйдет.
   */
  onePerKind: true,
  /**
   * Равенство сил: разница в бойцах строя не больше этой доли. Вопрос должен
   * решаться родом войск, а не тем, кого больше, — иначе игрок научится считать,
   * а не думать.
   */
  balance: 0.12,
  /**
   * Размен победителя (чужие потери к своим — та же мера, что `lossRatio` в
   * `battle/bench.ts`). Выше этого бой односторонний: ответ виден с первого
   * взгляда, и вопроса нет.
   */
  maxRatio: 2.5,
  /** Проигравший увёл с поля хотя бы столько — иначе это не бой, а избиение. */
  minKept: 0.15,
  /**
   * Потолок перебора на день. Замер по четырёмстам дням: в среднем уходит
   * два-три боя, худший день — семь. Потолок здесь не ради скорости, а ради
   * того, чтобы цикл отбраковки не мог стать бесконечным.
   */
  tries: 16,
  /**
   * Запасной проход другой солью, если ни одна попытка не прошла отбор: условие
   * одно — не ничья. На замере он не понадобился ни разу, и тест это стережёт;
   * флаг `fallback` в вопросе для того и заведён, чтобы недостижимость фильтров
   * вскрылась сразу, а не осталась незамеченной.
   */
  fallbackTries: 40,
  /** Сколько строк разбора показывать: длинный журнал после одного тапа никто не читает. */
  explainLines: 4,
} as const;

/**
 * Поучительные события — по приоритету, а не по времени. Именно они объясняют
 * угол кольца контрров; «сектор сломался» случается в каждом бою и не учит
 * ничему. `ReportLine` идентификатора события не несёт, а `summarize` сортирует
 * ключевые строки по тику, поэтому выбор делается здесь, до отчёта.
 */
const TEACHING: readonly EventId[] = [
  'spears-held',
  'cavalry-broke-archers',
  'cavalry-intercepted',
  'ranged-lost',
  'volley',
  'flank-turned',
  'archers-kiting',
];

/** Состав одной стороны: виды бойцов племени и во сколько бойцов строя это выходит. */
export interface QuizSide {
  troops: TroopStack;
  men: number;
}

export interface QuizQuestion {
  /**
   * Сид самого боя, а не номер дня: по нему разбор повторяет тот же бой, что
   * дал ответ. Хранить готовый ответ было бы проще — и ровно поэтому нельзя.
   */
  seed: number;
  /** Наши — они же нападающие. */
  ours: QuizSide;
  /** Чужие — обороняющиеся. */
  theirs: QuizSide;
  answer: 'ours' | 'theirs';
  /** Вопрос собран запасным проходом: фильтры отбора не прошёл ни один из основных. */
  fallback: boolean;
}

/**
 * Единственный путь из видов племени в ядро боя. Второго быть не должно: ответ,
 * посчитанный одним путём, разошёлся бы с боем, посчитанным другим. Стороны встают
 * по правилу развёртывания (`battle/setup.deploySetup`), как в игре. Генератор,
 * разбор и тест зовут только это.
 */
export const quizSetup = (t: TroopStack): ArmySetup => ({ ...deploySetup(kindsOf(t)), gear: gearOf(t) });

const menOfSide = (t: TroopStack): number => stackTotal(kindsOf(t));

/**
 * Вопрос ставится от лица игрока: наши всегда нападают. Причина не в правилах
 * боя, а в словах: `summarize` и `describeEvent` умеют писать «наши» и «чужие»,
 * а нейтральные «отряд А и отряд Б» потребовали бы своей копии всех
 * формулировок — второй правды об одном бое.
 */
const answerOf = (r: BattleResult): 'ours' | 'theirs' => {
  if (r.winner === 'attacker') return 'ours';
  if (r.winner === 'defender') return 'theirs';
  // Ничьи отсеиваются отбором; эта ветка достаётся только последнему рубежу
  // ниже, и там поле делит тот, кто потерял меньше.
  return r.sides.attacker.total.losses <= r.sides.defender.total.losses ? 'ours' : 'theirs';
};

/** Размен глазами стороны: чужие потери к своим. Мера та же, что `lossRatio` в `battle/bench.ts`. */
const ratioFor = (r: BattleResult, us: 'ours' | 'theirs'): number => {
  const me = us === 'ours' ? r.sides.attacker : r.sides.defender;
  const foe = us === 'ours' ? r.sides.defender : r.sides.attacker;
  return foe.total.losses / Math.max(1, me.total.losses);
};

/** Сколько проигравший увёл с поля. */
const keptOfLoser = (r: BattleResult, winner: 'ours' | 'theirs'): number => {
  const loser = winner === 'ours' ? r.sides.defender : r.sides.attacker;
  return loser.total.final / Math.max(1, loser.total.initial);
};

/** Перестановка порядка родов по сиду: какие роды достанутся этой стороне. */
function shuffledKinds(rng: () => number): UnitKind[] {
  const out = [...UNIT_KINDS];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Состав стороны примерно на `men` бойцов строя: один-три рода, по одному виду
 * племени на род, доли между родами случайные, но не вырожденные — иначе
 * «5 копейщиков и 200 дубинщиков» читается как один вид с шумом.
 */
function sideOf(rng: () => number, men: number): TroopStack {
  const kinds = shuffledKinds(rng).slice(0, 1 + Math.floor(rng() * QUIZ.maxTypes));
  const weights = kinds.map(() => 0.5 + rng());
  const sum = weights.reduce((n, w) => n + w, 0);
  const out: TroopStack = {};
  kinds.forEach((kind, i) => {
    const choices = TROOPS_OF_KIND[kind];
    const id: TroopId = choices[Math.floor(rng() * choices.length)];
    out[id] = Math.max(1, Math.round(((men * weights[i]) / sum) / weightOf(id)));
  });
  return out;
}

/** Мешалка сида: своя соль у каждого прохода, свой шаг у каждой попытки. */
const mix = (seed: number, salt: number, n: number): number =>
  (Math.imul((seed ^ salt) >>> 0, 2654435761) + Math.imul(n + 1, 0x9e3779b1)) >>> 0;

/**
 * Одна попытка: два состава, бой, отбор. `strict` — полный набор условий
 * неочевидности; без него остаётся единственное требование, чтобы у вопроса
 * вообще был ответ.
 */
function attempt(seed: number, salt: number, n: number, strict: boolean): QuizQuestion | null {
  const rng = seeded(mix(seed, salt, n));
  const men = QUIZ.minMen + Math.floor(rng() * (QUIZ.maxMen - QUIZ.minMen + 1));
  const ours = sideOf(rng, men);
  const theirs = sideOf(rng, men);
  const battleSeed = Math.floor(rng() * 0x7fffffff);

  const a = menOfSide(ours);
  const b = menOfSide(theirs);
  if (a <= 0 || b <= 0) return null;
  // Равенство сил проверяется до боя: это самая дешёвая отбраковка, и она
  // экономит большую часть прогонов.
  if (strict && Math.abs(a - b) / Math.max(a, b) > QUIZ.balance) return null;

  const setupOurs = quizSetup(ours);
  const setupTheirs = quizSetup(theirs);
  const r = simulateBattle({ seed: battleSeed, attacker: setupOurs, defender: setupTheirs });
  if (r.winner === 'draw') return null;

  const question: QuizQuestion = {
    seed: battleSeed,
    ours: { troops: ours, men: a },
    theirs: { troops: theirs, men: b },
    answer: answerOf(r),
    fallback: !strict,
  };
  if (!strict) return question;

  if (r.reason === 'annihilated' || r.pyrrhic) return null;
  if (ratioFor(r, question.answer) > QUIZ.maxRatio) return null;
  if (keptOfLoser(r, question.answer) < QUIZ.minKept) return null;

  // Тот же победитель при обмене сторонами. Без этой проверки ответ зависел бы
  // от того, кто числится нападающим, а не от войск, — а игроку показывают
  // только войска.
  const mirror = simulateBattle({ seed: battleSeed, attacker: setupTheirs, defender: setupOurs });
  const mirrorAnswer = mirror.winner === 'attacker' ? 'theirs' : mirror.winner === 'defender' ? 'ours' : 'draw';
  if (mirrorAnswer !== question.answer) return null;

  return question;
}

/**
 * Вопрос дня. Чистая и детерминированная: один сид — один и тот же вопрос у всех
 * игроков и у сервера, сколько ни перезагружай.
 *
 * Цикл отбраковки с потолком попыток и с запасным проходом: без потолка любое
 * ужесточение фильтров превратилось бы в зависание на глазах у игрока.
 */
export function quizQuestion(seed: number): QuizQuestion {
  for (let n = 0; n < QUIZ.tries; n++) {
    const q = attempt(seed, 0x51a2c3d4, n, true);
    if (q) return q;
  }
  for (let n = 0; n < QUIZ.fallbackTries; n++) {
    const q = attempt(seed, 0x2f6b91e7, n, false);
    if (q) return q;
  }
  // Последний рубеж: пара из кольца контрров, копья против конницы. Ответ и
  // здесь считает симуляция — записанного ответа в модуле нет нигде.
  const ours: TroopStack = { spearman: 45 };
  const theirs: TroopStack = { rider: 13 };
  const r = simulateBattle({ seed, attacker: quizSetup(ours), defender: quizSetup(theirs) });
  return {
    seed,
    ours: { troops: ours, men: menOfSide(ours) },
    theirs: { troops: theirs, men: menOfSide(theirs) },
    answer: answerOf(r),
    fallback: true,
  };
}

export interface QuizExplain {
  title: string;
  reason: string;
  lines: string[];
}

/**
 * Разбор после ответа — из настоящего журнала того же боя, а не из заготовленных
 * фраз. Сперва поучительное событие по приоритету (угол кольца контрров), потом
 * ключевые строки отчёта. Ни одного множителя и ни одной характеристики руками:
 * всё, что видит игрок, пришло из `summarize` и `describeEvent`.
 */
export function quizExplain(q: QuizQuestion): QuizExplain {
  const r = simulateBattle({
    seed: q.seed,
    attacker: quizSetup(q.ours.troops),
    defender: quizSetup(q.theirs.troops),
  });
  const sum = summarize(r, 'attacker');

  const lines: string[] = [];
  for (const id of TEACHING) {
    const e = r.log.find((ev) => ev.id === id);
    if (e) {
      lines.push(describeEvent(e, 'attacker'));
      break;
    }
  }
  for (const k of sum.keys) {
    if (lines.length >= QUIZ.explainLines) break;
    lines.push(`${k.icon} ${k.text}`);
  }
  // Бой без единого ключевого события — редкость, но разбор не имеет права
  // оказаться пустым: итог в журнале есть всегда.
  if (lines.length === 0) {
    const end = r.log[r.log.length - 1];
    if (end) lines.push(describeEvent(end, 'attacker'));
  }

  return { title: sum.title, reason: sum.reason, lines };
}
