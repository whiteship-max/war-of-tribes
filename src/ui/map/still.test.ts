// Стоящая карта рисует только по изменению (`still.ts`, docs/perf.md, решение 9): сколько спать после кадра, какой
// сдвиг камеры — ведение, что в сторе — перемена.
import { describe, expect, it } from 'vitest';
import { QUALITY } from '@/render/quality';
import { CLOCK_MS, IDLE_MS, MOVE_MS, STILL_FRAME, cameraBox, changedBesides, restAfter } from './still';

const LONG_AGO = 60_000;

describe('сон стоящей карты', () => {
  it('ведут карту или печётся земля — рисовать каждый кадр', () => {
    // Точки внутри области: «только что» — внутри окна ведения, «давно» — за ним.
    expect(MOVE_MS - 1).toBeLessThan(MOVE_MS);
    expect(restAfter(STILL_FRAME, MOVE_MS - 1, 10)).toBe(0);
    expect(restAfter({ ...STILL_FRAME, live: true }, 0, 10)).toBe(0);
    expect(restAfter({ ...STILL_FRAME, busy: true }, LONG_AGO, 10)).toBe(0);
  });

  it('движется само — шаг уровня: не реже десяти и не чаще двадцати раз в секунду', () => {
    for (const q of ['high', 'medium', 'low'] as const) {
      const fps = QUALITY[q].mapStepFps;
      for (const m of [{ ...STILL_FRAME, live: true }, { ...STILL_FRAME, decor: true }]) {
        const nap = restAfter(m, LONG_AGO, fps);
        // Сон короче шага не больше чем на кадр экрана: будильник звонит между кадрами, кадр — на ближайшем.
        expect(nap, q).toBeGreaterThan(1000 / fps - 1000 / 60);
        expect(nap, q).toBeLessThan(1000 / fps);
        expect(nap, q).toBeLessThanOrEqual(100);
        expect(nap, q).toBeGreaterThanOrEqual(1000 / 20 - 1000 / 60);
      }
    }
  });

  it('сроки по часам — раз в секунду; ничего — до толчка или страховки', () => {
    expect(restAfter({ ...STILL_FRAME, clock: true }, LONG_AGO, 10)).toBe(CLOCK_MS);
    expect(restAfter(STILL_FRAME, LONG_AGO, 10)).toBe(IDLE_MS);
    // Живое сильнее сроков: отряд в пути со сроком шагает шагом уровня, а не секундой.
    expect(restAfter({ ...STILL_FRAME, clock: true, live: true }, LONG_AGO, 10)).toBeLessThan(CLOCK_MS);
    expect(IDLE_MS).toBeGreaterThan(CLOCK_MS);
  });
});

describe('камера карты: ведение будит, поводок — нет', () => {
  it('присвоение новой камеры отмечает сдвиг и будит, той же — нет', () => {
    let t = 100;
    let woke = 0;
    const box = cameraBox({ cx: 1, cy: 2, scale: 24 }, () => t);
    box.onMove = () => void woke++;
    expect(box.movedAt).toBe(-Infinity);
    box.current = { cx: 1, cy: 2, scale: 24 };
    expect(woke).toBe(0);
    t = 200;
    box.current = { cx: 1.5, cy: 2, scale: 24 };
    expect(woke).toBe(1);
    expect(box.movedAt).toBe(200);
    expect(box.current.cx).toBe(1.5);
  });

  it('поводок кадра двигает камеру мимо отметки', () => {
    let woke = 0;
    const box = cameraBox({ cx: 1, cy: 2, scale: 24 }, () => 500);
    box.onMove = () => void woke++;
    box.follow({ cx: 9, cy: 9, scale: 24 });
    expect(box.current.cx).toBe(9);
    expect(woke).toBe(0);
    expect(box.movedAt).toBe(-Infinity);
  });
});

describe('перемена стора — по содержанию, а не по ссылке', () => {
  const base = { now: 1, marches: [{ id: 'm1', arriveAt: 5 }], picked: null as string | null, chunks: 3, pulse: () => 0 };

  it('пульс со свежими массивами того же содержания и новым `now` — не перемена', () => {
    const next = { ...base, now: 2, marches: [{ id: 'm1', arriveAt: 5 }] };
    expect(next.marches).not.toBe(base.marches);
    expect(changedBesides(base, next, ['now'])).toBe(false);
  });

  it('новый срок отряда, новый кусок тумана, выбор — перемена', () => {
    expect(changedBesides(base, { ...base, marches: [{ id: 'm1', arriveAt: 6 }] }, ['now'])).toBe(true);
    expect(changedBesides(base, { ...base, chunks: 4 }, ['now'])).toBe(true);
    expect(changedBesides(base, { ...base, picked: 'scout' }, ['now'])).toBe(true);
    // `now` не пропущен — тогда и он перемена: пропуск работает именем, а не случаем.
    expect(changedBesides(base, { ...base, now: 2 }, [])).toBe(true);
  });

  it('новое поле и несравнимое значение — перемена', () => {
    expect(changedBesides(base, { ...base, extra: 1 }, ['now'])).toBe(true);
    const loop: { self?: unknown } = {};
    loop.self = loop;
    expect(changedBesides({ a: {} }, { a: loop }, [])).toBe(true);
  });
});
