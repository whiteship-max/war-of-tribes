import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTER, describeEvent, simulateBattle, stackTotal, type BattleResult, type EventId } from '@/battle';
import { KIND_OF, kindsOf, type TroopStack } from '../battle/kinds';
import { TROOP_IDS } from '../data/troops';
import { dailySeed } from '../data/daily';
import { QUIZ, quizExplain, quizQuestion, quizSetup, type QuizQuestion } from './quiz';

/**
 * Шестьдесят дней подряд — два месяца игры. Проверять один сид бессмысленно:
 * викторина обязана держать обещание каждый день, а не в среднем.
 */
const DAYS = 60;
const seedOfDay = (i: number): number => dailySeed(20_000 + i);
const everyDay = <T,>(f: (q: QuizQuestion, day: number) => T): T[] =>
  Array.from({ length: DAYS }, (_, i) => f(quizQuestion(seedOfDay(i)), i));

/**
 * Бой того же вопроса, тем же единственным путём в ядро. Ровно так его считает и
 * генератор, и разбор: два разных пути раскладывали бы состав по секторам
 * по-своему, и сверять было бы нечего.
 */
const battleOf = (q: QuizQuestion): BattleResult =>
  simulateBattle({ seed: q.seed, attacker: quizSetup(q.ours.troops), defender: quizSetup(q.theirs.troops) });

/** Тот же приоритет поучительных событий, что и в модуле: тест держит договор, а не повторяет код. */
const TEACHING: readonly EventId[] = [
  'spears-held',
  'cavalry-broke-archers',
  'cavalry-intercepted',
  'ranged-lost',
  'volley',
  'flank-turned',
  'archers-kiting',
];

const kindsUsed = (t: TroopStack): string[] => TROOP_IDS.filter((id) => (t[id] ?? 0) > 0).map((id) => KIND_OF[id]);

describe('викторина «Кто победит»: ответ считает симуляция', () => {
  /**
   * Главное обещание модуля. Правильный ответ нигде не записан — он добывается
   * прогоном боя. Тест прогоняет тот же бой сам и требует совпадения: если
   * когда-нибудь кто-то захочет «ускорить» викторину заготовленной таблицей
   * ответов, это упадёт здесь.
   */
  it('на шестидесяти днях подряд ответ совпадает с исходом настоящего боя', () => {
    everyDay((q) => {
      const r = battleOf(q);
      expect(r.winner).not.toBe('draw');
      expect(q.answer).toBe(r.winner === 'attacker' ? 'ours' : 'theirs');
    });
  });

  it('ответ не зависит от того, кто числится нападающим', () => {
    everyDay((q) => {
      const mirror = simulateBattle({
        seed: q.seed,
        attacker: quizSetup(q.theirs.troops),
        defender: quizSetup(q.ours.troops),
      });
      // Игроку показывают только войска, поэтому и ответ обязан следовать из
      // войск, а не из стороны поля.
      expect(mirror.winner === 'attacker' ? 'theirs' : 'ours').toBe(q.answer);
    });
  });

  it('пара неочевидна: силы равны, размен и остаток проигравшего в объявленных коридорах', () => {
    everyDay((q) => {
      expect(q.ours.men).toBe(stackTotal(kindsOf(q.ours.troops)));
      expect(q.theirs.men).toBe(stackTotal(kindsOf(q.theirs.troops)));
      const spread = Math.abs(q.ours.men - q.theirs.men) / Math.max(q.ours.men, q.theirs.men);
      expect(spread).toBeLessThanOrEqual(QUIZ.balance);

      const r = battleOf(q);
      expect(r.pyrrhic).toBe(false);
      expect(r.reason).not.toBe('annihilated');
      const win = q.answer === 'ours' ? r.sides.attacker : r.sides.defender;
      const lose = q.answer === 'ours' ? r.sides.defender : r.sides.attacker;
      // Размен считается той же мерой, что в battle/bench.ts: чужие потери к своим.
      expect(lose.total.losses / Math.max(1, win.total.losses)).toBeLessThanOrEqual(QUIZ.maxRatio);
      expect(lose.total.final / lose.total.initial).toBeGreaterThanOrEqual(QUIZ.minKept);
    });
  });

  /**
   * Запасной проход — сигнальная лампа, а не рабочий режим. Загорелась — значит
   * фильтры отбора стали недостижимы (например, после правки баланса боя), и об
   * этом надо узнать здесь, а не по вопросу-избиению на экране игрока.
   */
  it('ни одного запасного вопроса на шестидесяти днях подряд', () => {
    everyDay((q) => expect(q.fallback).toBe(false));
  });

  it('вопрос детерминирован по сиду, а разные дни дают разные составы', () => {
    for (let i = 0; i < 5; i++) {
      expect(quizQuestion(seedOfDay(i))).toEqual(quizQuestion(seedOfDay(i)));
    }
    const shapes = new Set(
      everyDay((q) => JSON.stringify([q.ours.troops, q.theirs.troops])),
    );
    // Повторы допустимы, но вопрос не должен быть один и тот же всю неделю.
    expect(shapes.size).toBeGreaterThan(DAYS * 0.8);
  });

  it('на стороне не больше трёх видов, по одному на род боя, и обе стороны непусты', () => {
    everyDay((q) => {
      for (const side of [q.ours, q.theirs]) {
        const ids = TROOP_IDS.filter((id) => (side.troops[id] ?? 0) > 0);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.length).toBeLessThanOrEqual(QUIZ.maxTypes);
        for (const id of ids) expect(side.troops[id]).toBeGreaterThan(0);
        // Три вида пехоты выглядят выбором, а на поле это одна и та же пехота.
        const kinds = kindsUsed(side.troops);
        expect(new Set(kinds).size).toBe(kinds.length);
        expect(side.men).toBeGreaterThan(0);
      }
    });
  });

  /**
   * Ответ вычисляется, а не записан. Проверяется прямой подменой числа в кольце
   * контрров: `COUNTER` — обычный объект, а `sim.ts` читает его в момент боя, а
   * не запекает при загрузке модуля. Перевернём два угла кольца — и часть дней
   * обязана ответить иначе. Если бы ответы лежали таблицей, не изменилось бы
   * ничего, и игрок после правки баланса учился бы неправде.
   */
  it('подмена числа в кольце контрров меняет ответы', () => {
    const before = everyDay((q) => q.answer);

    const counter = COUNTER as unknown as {
      spear: { cavalryHolding: number };
      cavalry: { archer: number; spearClosed: number };
    };
    const saved = { hold: counter.spear.cavalryHolding, archer: counter.cavalry.archer, closed: counter.cavalry.spearClosed };
    let after: string[];
    try {
      // Кольцо наизнанку: копья больше не держат конницу, конница вязнет в них,
      // а лучников не режет.
      counter.spear.cavalryHolding = 0.5;
      counter.cavalry.archer = 0.4;
      counter.cavalry.spearClosed = 2.5;
      after = everyDay((q) => q.answer);
    } finally {
      counter.spear.cavalryHolding = saved.hold;
      counter.cavalry.archer = saved.archer;
      counter.cavalry.spearClosed = saved.closed;
    }

    const changed = after.filter((a, i) => a !== before[i]).length;
    expect(changed).toBeGreaterThan(0);
    // И после возврата чисел на место ответы те же, что были: подмена ничего не
    // испортила, а тест не зависит от порядка запуска.
    expect(everyDay((q) => q.answer)).toEqual(before);
  });
});

describe('викторина: разбор из журнала боя', () => {
  it('разбор непустой на всех днях, и заголовок называет исход глазами игрока', () => {
    everyDay((q) => {
      const ex = quizExplain(q);
      expect(ex.lines.length).toBeGreaterThan(0);
      expect(ex.lines.length).toBeLessThanOrEqual(QUIZ.explainLines);
      expect(ex.reason.length).toBeGreaterThan(0);
      // Разбор показывается после ответа и обязан подтверждать его словами.
      expect(ex.title).toBe(q.answer === 'ours' ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ');
    });
  });

  /**
   * Мини-игра учит кольцу контрров, а не проверяет удачу: разбор должен
   * начинаться с угла кольца, если он в бою был. Порядок — по важности, а не по
   * времени: `ReportLine` идентификатора события не несёт, и без своего
   * приоритета первой строкой лез бы «сектор сломался», случающийся всегда.
   */
  it('первая строка — поучительное событие по приоритету, и оно есть на большинстве дней', () => {
    let teaching = 0;
    everyDay((q) => {
      const r = battleOf(q);
      const found = TEACHING.map((id) => r.log.find((e) => e.id === id)).find((e) => e);
      if (!found) return;
      teaching++;
      expect(quizExplain(q).lines[0]).toBe(describeEvent(found, 'attacker'));
    });
    expect(teaching).toBeGreaterThan(DAYS * 0.6);
  });
});

describe('викторина: чистота модуля', () => {
  /**
   * Один сид — один уровень у всех игроков и у будущего сервера. Держится это
   * на единственном источнике случайности: `seeded`. Кость партии (`roll`/`chance` из
   * sim/random) у каждой партии своя и подменяется тестами (`setRandom`), `Math.random` не повторяется
   * вовсе, а `seededRng` живёт в ядре боя, куда ходят только через `@/battle`.
   */
  it('в модуле нет ни одного источника случайности, кроме seeded', () => {
    const src = readFileSync(join(__dirname, 'quiz.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/\bseededRng\b/);
    expect(src).not.toMatch(/\b(roll|rollInt|chance|freshSeed)\s*\(/);
    expect(src).toMatch(/\bseeded\s*\(/);
    // Дверь в ядро боя одна: глубоких импортов мимо неё быть не должно.
    expect(src).not.toMatch(/from '@\/battle\//);
  });
});
