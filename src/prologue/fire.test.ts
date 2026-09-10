/**
 * Костёр и граница времени.
 *
 * Проверяется здесь не арифметика — она на три строки, — а **обещание**: всё,
 * что переживает выход из игры, считается чистой функцией от времени, без
 * тиков, без накопления и без фоновой работы. Обещание такого рода поведением
 * одним не проверишь: «тик появился» выглядит как обычная правка и ничем себя
 * не выдаёт. Поэтому половина этого файла читает исходники.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BURN_FULL_MS, HEARTH_CAP, LOG_MS, burnLeftMs, burnWords, burning, feed, fuelAt, hearthFill, logsTaken, newHearth } from './fire';

const H = 3_600_000;

describe('костёр горит по формуле, а не по тику', () => {
  it('полный костёр прогорает ровно за двое суток', () => {
    expect(BURN_FULL_MS).toBe(48 * H);
    const full = { fuel: HEARTH_CAP, at: 0 };
    expect(fuelAt(full, 0)).toBe(HEARTH_CAP);
    expect(fuelAt(full, 24 * H)).toBeCloseTo(HEARTH_CAP / 2, 6);
    expect(fuelAt(full, 48 * H)).toBe(0);
    expect(burning(full, 48 * H - 1)).toBe(true);
    expect(burning(full, 48 * H)).toBe(false);
  });

  it('ответ не зависит от того, сколько раз спросили', () => {
    // Это и есть отличие чтения от тика: тик, которого не случилось, теряется;
    // формула отдаёт одно и то же, сколько бы кадров ни пропустили.
    const h = { fuel: 6, at: 1000 };
    const once = fuelAt(h, 1000 + 10 * H);
    for (let i = 0; i < 100; i++) fuelAt(h, 1000 + i * H);
    expect(fuelAt(h, 1000 + 10 * H)).toBe(once);
    // И само состояние при чтении не меняется — читать нечего, кроме пары чисел.
    expect(h).toEqual({ fuel: 6, at: 1000 });
  });

  it('час игры и час без игры стоят костру одинаково', () => {
    const h = newHearth(0);
    // «Играли» — спрашивали каждую секунду; «не играли» — не спрашивали вовсе.
    for (let t = 0; t <= H; t += 1000) fuelAt(h, t);
    expect(fuelAt(h, H)).toBeCloseTo(fuelAt({ ...h }, H), 12);
  });

  it('прогоревший костёр — ноль, а не долг', () => {
    expect(fuelAt({ fuel: 1, at: 0 }, 100 * H)).toBe(0);
    expect(burnLeftMs({ fuel: 1, at: 0 }, 100 * H)).toBe(0);
    expect(hearthFill({ fuel: 1, at: 0 }, 100 * H)).toBe(0);
  });

  it('часы, переведённые назад, дров не прибавляют', () => {
    // Запись из будущего бывает у того, у кого сбилась дата на телефоне.
    // Выдать ему полный костёр было бы наградой за сбитые часы.
    const h = { fuel: 3, at: 10 * H };
    expect(fuelAt(h, 0)).toBe(3);
    expect(fuelAt(h, 5 * H)).toBe(3);
  });
});

describe('подкладывание дров', () => {
  it('возвращает новый очаг, а не правит старый', () => {
    const h = { fuel: 2, at: 0 };
    const next = feed(h, H, 3);
    expect(h).toEqual({ fuel: 2, at: 0 });
    expect(next.at).toBe(H);
    // Через час от двух полен осталось 2 − 1/6; плюс три.
    expect(next.fuel).toBeCloseTo(2 - H / LOG_MS + 3, 6);
  });

  it('сверх вместимости не влезает, и лишнее остаётся в руках', () => {
    const h = { fuel: HEARTH_CAP - 1, at: 0 };
    expect(logsTaken(h, 0, 5)).toBe(1);
    expect(feed(h, 0, 5).fuel).toBe(HEARTH_CAP);
    expect(logsTaken({ fuel: HEARTH_CAP, at: 0 }, 0, 3)).toBe(0);
  });

  it('отрицательных дров не бывает', () => {
    expect(logsTaken({ fuel: 2, at: 0 }, 0, -5)).toBe(0);
    expect(feed({ fuel: 2, at: 0 }, 0, -5).fuel).toBe(2);
  });
});

describe('сколько ещё гореть — словами', () => {
  it('срок называется тем, чем игрок его меряет', () => {
    expect(burnWords({ fuel: HEARTH_CAP, at: 0 }, 0)).toBe('двое суток');
    expect(burnWords({ fuel: 5, at: 0 }, 0)).toBe('сутки');
    expect(burnWords({ fuel: 2, at: 0 }, 0)).toBe('12 ч');
    // Секунда спустя всё ещё двенадцать: часы округляются, а не отбрасываются.
    expect(burnWords({ fuel: 2, at: 0 }, 1000)).toBe('12 ч');
    // Сорок два часа — «сутки»: в эту сторону ошибаться безопаснее.
    expect(burnWords({ fuel: 7, at: 0 }, 0)).toBe('сутки');
    expect(burnWords({ fuel: 0.1, at: 0 }, 0)).toBe('36 мин');
    expect(burnWords({ fuel: 0, at: 0 }, 0)).toBe('погас');
  });

  it('«0 мин» не говорится никогда', () => {
    // Ноль минут — это «погас», и говорить его иначе значит врать дважды.
    for (let f = 0.0001; f < 0.05; f += 0.0007) {
      const s = burnWords({ fuel: f, at: 0 }, 0);
      expect(s === 'погас' || /^[1-9]/.test(s), s).toBe(true);
    }
  });
});

// ---------- Обещания, которые проверяются только чтением исходников ----------

const DIR = __dirname;

const sources = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(DIR);
  return out;
};

/** Исходник без комментариев: объяснения не должны проходить за код. */
const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('граница между временем сцены и нашим счётом', () => {
  // Что часы здесь спрашивают в одну дверь (`net/clock`), стережёт не этот файл,
  // а `net/clock.test.ts`: `src/prologue` дописан в его список зон. Второй такой
  // же проверки тут нарочно нет — две правды об одном правиле расходятся ровно
  // в тот день, когда правят одну из них.

  it('`performance.now()` живёт только в сцене и в разборе жеста', () => {
    // Время кадров — законное время, но ему нельзя попадать в сохранение.
    // Стеречь это надо по файлам: сцена его считает, сохранение — нет.
    const allowed = new Set(['scene.ts']);
    for (const f of sources()) {
      const name = f.slice(DIR.length + 1);
      if (allowed.has(name)) continue;
      expect(strip(readFileSync(f, 'utf8')), `${name}: считает кадровое время`).not.toContain('performance.now');
    }
  });

  it('у костра нет ни тика, ни таймера, ни догона', () => {
    // Костёр — это формула. Появившийся здесь `setInterval` означал бы, что
    // кто-то начал копить то, что и так считается, и две правды разойдутся у
    // первого же игрока, свернувшего аппку.
    const src = strip(readFileSync(join(DIR, 'fire.ts'), 'utf8'));
    for (const word of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date', 'catchUp']) {
      expect(src, `костёр начал тикать: ${word}`).not.toContain(word);
    }
  });

  it('сохранение везёт отметку времени, а не остаток', () => {
    // Пара «сколько было и когда» — единственная форма, при которой офлайн не
    // надо ни ловить, ни досчитывать. Поле вроде `left` или `secondsLeft`
    // означало бы, что кто-то записал результат вместо исходных данных.
    const src = strip(readFileSync(join(DIR, 'save.ts'), 'utf8'));
    expect(src).toContain('hearth');
    for (const word of ['left', 'remaining', 'lastTick', 'elapsed']) {
      expect(src, `в сохранении записан результат, а не исходные данные: ${word}`).not.toContain(word);
    }
  });

  it('предыстория не трогает ни сохранение партии, ни сервер', () => {
    // Связи с основной игрой в этом куске нет вовсе, и заводить её нельзя.
    for (const f of sources()) {
      const src = strip(readFileSync(f, 'utf8'));
      const name = f.slice(DIR.length + 1);
      // `gold` — в том же списке: премиальную валюту стережёт общий замок, а
      // золото деревни нет, и завести его здесь было бы связью с партией.
      for (const word of ['saveGame', 'loadGame', 'useGame', 'SAVE_VERSION', 'apiGet', 'apiPut', '/api/', 'worldApi', 'gold']) {
        expect(src, `${name}: предыстория лезет в игру: ${word}`).not.toContain(word);
      }
    }
  });

  // Что алмазов здесь нет ни в каком виде, стережёт не этот файл, а
  // `game/sim/gems.test.ts`: замок стоит на всём `src`, и `src/prologue` попал
  // под него сам, без единой строки. Своя такая же проверка тут не только
  // лишняя — она себя же и ловит: слово `creditGems`, написанное в списке
  // запретов, для замка неотличимо от вызова. Так и вышло при первом прогоне.
});
