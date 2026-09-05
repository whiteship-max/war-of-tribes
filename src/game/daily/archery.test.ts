import { describe, expect, it } from 'vitest';
import { seeded } from '../sim/random';
import { dailySeed } from '../data/daily';
import {
  ARCHERY_MAX,
  ARCHERY_SHOTS,
  ARCHERY_WIN,
  SCORE_BULL,
  SCORE_RING,
  archeryLevel,
  archeryWon,
  markerAt,
  scoreAt,
} from './archery';

/**
 * Виртуальный игрок целится в середину зоны и ошибается ВРЕМЕНЕМ, а не местом:
 * бегунок ходит сам, игрок выбирает только момент тапа. Ошибка нормальная,
 * сигма — 90 мс.
 *
 * Девяносто — допущение, а не измерение: столько составляет разброс времени
 * реакции на ожидаемый зрительный сигнал вместе с задержкой тач-экрана. Если
 * когда-нибудь появятся настоящие замеры, менять надо это число, а не вилки
 * уровня.
 */
const SIGMA_MS = 90;

/** Нормаль по Бокс-Мюллеру поверх seeded: в тесте Math.random нельзя — он должен повторяться. */
function normals(seed: number): () => number {
  const rng = seeded(seed);
  return () => {
    const u = Math.max(rng(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };
}

describe('стрельба из лука: уровень выводится из сида', () => {
  it('один сид — один уровень, разные сиды — разные', () => {
    expect(archeryLevel(12345)).toEqual(archeryLevel(12345));
    const levels = new Set<string>();
    for (let d = 0; d < 200; d++) levels.add(JSON.stringify(archeryLevel(dailySeed(d))));
    // Совпадений быть почти не должно: иначе вчерашний уровень предсказывал бы сегодняшний.
    expect(levels.size).toBeGreaterThan(195);
  });

  it('уровень сложен из объявленного: три выстрела, максимум девять очков', () => {
    expect(ARCHERY_MAX).toBe(ARCHERY_SHOTS * SCORE_BULL);
    expect(archeryLevel(7).shots).toHaveLength(ARCHERY_SHOTS);
  });

  it('зона не выходит за края дорожки и не вырождается — на 400 сидах подряд', () => {
    for (let seed = 0; seed < 400; seed++) {
      const lv = archeryLevel(seed);
      expect(lv.sweep).toBeGreaterThan(0);
      for (const shot of lv.shots) {
        expect(shot.center - shot.ring).toBeGreaterThanOrEqual(0);
        expect(shot.center + shot.ring).toBeLessThanOrEqual(1);
        // Яблочко внутри кольца, а не рядом с ним.
        expect(shot.bull).toBeGreaterThan(0);
        expect(shot.ring).toBeGreaterThan(shot.bull);
      }
    }
  });

  it('зоны трёх выстрелов разведены: попытка не решается одним заученным движением', () => {
    for (let seed = 0; seed < 400; seed++) {
      const { shots } = archeryLevel(seed);
      for (let i = 0; i < shots.length; i++) {
        for (let j = i + 1; j < shots.length; j++) {
          expect(Math.abs(shots[i].center - shots[j].center)).toBeGreaterThanOrEqual(0.06);
        }
      }
    }
  });

  it('скорость одна на все три выстрела и лежит в вилке', () => {
    for (let seed = 0; seed < 400; seed++) {
      const lv = archeryLevel(seed);
      expect(lv.sweep).toBeGreaterThanOrEqual(1.15);
      expect(lv.sweep).toBeLessThanOrEqual(1.4);
    }
  });
});

describe('стрельба из лука: бегунок', () => {
  it('не сходит с дорожки ни в один момент', () => {
    const lv = archeryLevel(99);
    for (let ms = -5000; ms <= 20000; ms += 7) {
      const x = markerAt(lv, ms);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it('ходит туда и обратно: к середине периода уходит в дальний конец, к концу возвращается', () => {
    const lv = archeryLevel(3);
    const half = lv.sweep * 1000;
    expect(markerAt(lv, 0)).toBeCloseTo(0, 10);
    expect(markerAt(lv, half / 2)).toBeCloseTo(0.5, 10);
    expect(markerAt(lv, half)).toBeCloseTo(1, 10);
    expect(markerAt(lv, half * 1.5)).toBeCloseTo(0.5, 10);
    expect(markerAt(lv, half * 2)).toBeCloseTo(0, 10);
  });

  it('на пути туда идёт только вперёд, на пути обратно — только назад', () => {
    const lv = archeryLevel(41);
    const half = lv.sweep * 1000;
    for (let i = 1; i < 200; i++) {
      const t = (half * i) / 200;
      expect(markerAt(lv, t)).toBeGreaterThan(markerAt(lv, t - half / 200));
      expect(markerAt(lv, half + t)).toBeLessThan(markerAt(lv, half + t - half / 200));
    }
  });

  it('период равен двум проходам', () => {
    const lv = archeryLevel(17);
    const period = lv.sweep * 2000;
    for (let ms = 0; ms < 3000; ms += 13) {
      expect(markerAt(lv, ms + period)).toBeCloseTo(markerAt(lv, ms), 10);
      expect(markerAt(lv, ms + 3 * period)).toBeCloseTo(markerAt(lv, ms), 10);
    }
  });
});

describe('стрельба из лука: очки', () => {
  // Полуширины взяты из настоящих вилок, но двоичными дробями (3/64 и 7/64):
  // тогда «точно на границе» — действительно граница, а не волосок за ней,
  // набежавший при сложении. Проверять надо правило, а не арифметику double.
  const shot = { center: 0.5, bull: 0.046875, ring: 0.109375 };

  it('в центре — яблочко, на границе яблочка — ещё яблочко', () => {
    expect(scoreAt(shot, 0.5)).toBe(SCORE_BULL);
    expect(scoreAt(shot, 0.5 + shot.bull)).toBe(SCORE_BULL);
    expect(scoreAt(shot, 0.5 - shot.bull)).toBe(SCORE_BULL);
  });

  it('чуть за яблочком — кольцо, за кольцом — мимо', () => {
    expect(scoreAt(shot, 0.5 + shot.bull + 1e-6)).toBe(SCORE_RING);
    expect(scoreAt(shot, 0.5 + shot.ring)).toBe(SCORE_RING);
    expect(scoreAt(shot, 0.5 + shot.ring + 1e-6)).toBe(0);
    expect(scoreAt(shot, 0)).toBe(0);
    expect(scoreAt(shot, 1)).toBe(0);
  });

  it('победа — от пяти очков: два яблочка или яблочко и два кольца', () => {
    expect(archeryWon(ARCHERY_WIN - 1)).toBe(false);
    expect(archeryWon(SCORE_BULL * 2)).toBe(true);
    expect(archeryWon(SCORE_BULL + SCORE_RING * 2)).toBe(true);
    expect(archeryWon(SCORE_BULL + SCORE_RING)).toBe(false);
    expect(archeryWon(SCORE_RING * 3)).toBe(false);
    expect(archeryWon(ARCHERY_MAX)).toBe(true);
  });
});

/**
 * Здесь держится вся сложность игры разом.
 *
 * «Средняя сложность» — не мнение, а число: проигрывать должна примерно треть
 * попыток. Всё, чем её можно случайно сдвинуть, — вилка скорости, полуширины
 * яблочка и кольца и порог победы; каждое из них правится в одну строку и
 * поодиночке выглядит безобидно. Прогон виртуальных игроков переводит эти строки
 * обратно в долю побед и говорит об этом сразу, а не через месяц по отзывам.
 *
 * Коридор 0.60..0.75 шире расчётного 0.68 нарочно: за краем быстрой скорости
 * выходит ~0.60, за краем медленной ~0.75, и уровень одного дня имеет право
 * оказаться на любом из них. Уехала доля за коридор — сдвинулся не тест, а игра.
 */
describe('стрельба из лука: баланс', () => {
  it('игрок с человеческим разбросом времени выигрывает три попытки из четырёх, но не всякую', () => {
    const gauss = normals(0xa5c3);
    const coin = seeded(0x51ee);
    const PLAYERS = 120;
    let wins = 0;
    let games = 0;

    for (let day = 0; day < 365; day++) {
      const lv = archeryLevel(dailySeed(day));
      const period = lv.sweep * 2000;
      for (let p = 0; p < PLAYERS; p++) {
        let score = 0;
        for (const shot of lv.shots) {
          // Игрок ждёт нужный проход — их два, туда и обратно, — и жмёт с ошибкой.
          const back = coin() < 0.5;
          const aim = (back ? 2 - shot.center : shot.center) * lv.sweep * 1000;
          score += scoreAt(shot, markerAt(lv, period * 3 + aim + gauss() * SIGMA_MS));
        }
        if (archeryWon(score)) wins++;
        games++;
      }
    }

    // Расчётом выходит 0.68, прогоном — 0.6793: примерно каждая третья попытка
    // проиграна, как и задумано.
    const rate = wins / games;
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(0.75);
  });

  it('дрожащая рука проигрывает, твёрдая выигрывает: сложность держится на точности, а не на удаче', () => {
    const shaky = normals(0x1234);
    const steady = normals(0x1234);
    const play = (sigma: number, gauss: () => number): number => {
      let wins = 0;
      for (let day = 0; day < 120; day++) {
        const lv = archeryLevel(dailySeed(day));
        for (let p = 0; p < 60; p++) {
          let score = 0;
          for (const shot of lv.shots) {
            const aim = shot.center * lv.sweep * 1000;
            score += scoreAt(shot, markerAt(lv, lv.sweep * 6000 + aim + gauss() * sigma));
          }
          if (archeryWon(score)) wins++;
        }
      }
      return wins / (120 * 60);
    };

    expect(play(220, shaky)).toBeLessThan(0.3);
    expect(play(35, steady)).toBeGreaterThan(0.95);
  });
});
