// Случайности, которую нельзя повторить, в игровой логике нет — тест по всему `src`, как
// у алмазов.
//
// Бросок, который нельзя повторить, нельзя ни проверить, ни показать игроку заранее, ни
// однажды посчитать на сервере. Поэтому у случайности две двери: кость партии
// (`sim/roll.roll`, от сида партии) и корень сида (`sim/random.freshSeed`, единственное
// обращение к генератору устройства). Всё прочее — сеяные генераторы.
//
// Где `Math.random` остаётся, и почему это не игровая логика — поимённо, списком ниже.
// Новый файл в этот список попадает только правкой теста, то есть вслух.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import type { GameState } from '../types';
import { setRandom } from './random';
import { roll } from './roll';
import { tick } from './tick';
import { resolveEvent } from './actions';
import { mailArrive } from './mail';
import { EVENT_BY_ID } from '../data/events';

const ROOT = join(__dirname, '..', '..');

/**
 * Где случайность устройства законна: картинка и звук, в сохранение из них не попадает
 * ничего, и повторять их незачем, — и имя вкладки, которое не число игры.
 */
const ALLOWED: readonly { path: string; why: string }[] = [
  { path: 'render/', why: 'сцена: походка жителей, снег, фаза телеги — картинка, не состояние' },
  { path: 'sound/', why: 'музыка: порядок пьес в круге деревни' },
  { path: 'net/session.ts', why: 'признак устройства и вкладки — не число игры' },
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Как можно дотянуться до случайности устройства — все написания, которые ловит тест. */
const DEVICE_RANDOM = /\bMath\s*(?:\.\s*random\b|\[\s*['"`]random['"`]\s*\])|\bgetRandomValues\b|\brandomUUID\b/;

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');

describe('случайность устройства — только там, где она не игра', () => {
  it('образцы ловят все написания, а честное чтение сеяного генератора — нет', () => {
    for (const bad of ['Math.random()', 'const r = Math.random;', "Math['random']()", 'Math . random()', 'crypto.getRandomValues(a)', 'crypto.randomUUID()']) {
      expect(DEVICE_RANDOM.test(bad), bad).toBe(true);
    }
    for (const good of ['seeded(seed)()', 'roll(s)', 'freshSeed()', 'const random = seeded(1);', 'randomize(x)']) {
      expect(DEVICE_RANDOM.test(good), good).toBe(false);
    }
  });

  it('по всему src: ни одного обращения вне картинки, звука и признака вкладки — и корня сида', () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const file of sources(ROOT)) {
      const path = rel(file);
      scanned++;
      const lines = strip(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (!DEVICE_RANDOM.test(line)) return;
        // Корень сида — ровно одно обращение к генератору устройства, и только в нём.
        if (path === 'game/sim/random.ts' && /getRandomValues/.test(line) && !/Math/.test(line)) return;
        if (ALLOWED.some((a) => path.startsWith(a.path))) return;
        hits.push(`${path}:${i + 1} ${line.trim()}`);
      });
    }
    expect(scanned, 'обошли весь src').toBeGreaterThan(300);
    expect(hits).toEqual([]);
  });

  it('корень сида один: `freshSeed` определён ровно в одном файле, и `Math.random` в нём нет', () => {
    const owners = sources(ROOT).filter((f) => /export function freshSeed\b/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(owners).toEqual(['game/sim/random.ts']);
    expect(strip(readFileSync(join(ROOT, 'game/sim/random.ts'), 'utf8'))).not.toMatch(/Math\s*\.\s*random/);
  });
});

describe('кость партии повторяется', () => {
  it('один сид — один ход событий: две партии с тем же сидом за игровой час живут одинаково', () => {
    setRandom(null);
    const a = createInitialState(12345);
    const b = createInitialState(12345);
    a.tutorialDone = true;
    b.tutorialDone = true;
    // Окно события ждёт ответа — отвечаем последним вариантом: у каждого события
    // последний ничего не стоит, и ход игры не встаёт.
    const answer = (s: GameState): void => {
      while (s.inbox.length > 0) {
        const n = s.inbox.length;
        const def = EVENT_BY_ID[s.inbox[0].defId];
        for (let k = def.options.length - 1; k >= 0 && s.inbox.length === n; k--) resolveEvent(s, k);
      }
    };
    // Вести приходят по настоящим часам (`mailArrive`): трое суток окнами по два часа — около девяти
    // приходов сетки, и на каждом кость партии выбирает вид вести.
    const T = 1_700_000_000_000;
    const WINDOW = 2 * 3600_000;
    for (let i = 0; i < 36; i++) {
      for (let k = 0; k < 50; k++) {
        tick(a, 2);
        tick(b, 2);
      }
      mailArrive(a, T + i * WINDOW, T + (i + 1) * WINDOW);
      mailArrive(b, T + i * WINDOW, T + (i + 1) * WINDOW);
      answer(a);
      answer(b);
    }
    expect(a.rolls, 'кость бросали — правило спрашивалось').toBeGreaterThan(5);
    expect(a.log.map((e) => e.text)).toEqual(b.log.map((e) => e.text));
    expect(a.rolls).toBe(b.rolls);
    expect(a.pop).toBe(b.pop);
  });

  it('другой сид — другой поток, а следующий бросок идёт от числа уже брошенных', () => {
    setRandom(null);
    const a = createInitialState(1);
    const b = createInitialState(2);
    const xs = Array.from({ length: 20 }, () => roll(a));
    const ys = Array.from({ length: 20 }, () => roll(b));
    expect(xs).not.toEqual(ys);
    const c = createInitialState(1);
    c.rolls = 10;
    expect(roll(c)).toBe(xs[10]);
  });
});
