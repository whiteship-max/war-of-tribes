// Дверь окна: после сворачивания и разворачивания приложение снова во всё окно, какую бы
// высоту ни оставил Телеграм, и пишет высоту приложения только она.
//
// Проверяется настоящий код, а не его описание: окружение у двери внешнее, и здесь ему
// подставлено поддельное — окно, Телеграм, видимость и таймеры. Последовательности
// событий — те, что дают картину из жалобы (docs/scene-revive.md, раздел 9): что
// именно шлёт клиент на телефоне, не измерено, поэтому проверяются все варианты.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appHeight, SETTLE, TG_CUT_MAX, ViewportDoor, type TgWindow, type ViewportEnv, type ViewSize } from './viewport';

/** Экран телефона из жалобы и полоска свёрнутой аппки. */
const FULL = 812;
const WIDE = 390;
const BAR = 64;

/** Поддельный мир двери: окно, Телеграм, видимость и таймеры с ручными часами. */
class FakeEnv implements ViewportEnv {
  win: ViewSize = { w: WIDE, h: FULL, dpr: 2 };
  app: (TgWindow & { platform?: string }) | null = { viewportHeight: FULL, viewportStableHeight: FULL };
  hidden = false;
  /** Что лежит в `--app-h`. */
  height = 0;
  heights: number[] = [];
  asked = 0;
  notes: string[] = [];
  now = 0;
  private timers: { at: number; cb: () => void; dead: boolean }[] = [];

  window = (): ViewSize => ({ ...this.win });
  tg = (): TgWindow | null => this.app;
  away = (): boolean => this.hidden;
  writeHeight = (h: number): void => {
    this.height = h;
    this.heights.push(h);
  };
  writeInsets = (): void => undefined;
  later = (ms: number, cb: () => void): (() => void) => {
    const t = { at: this.now + ms, cb, dead: false };
    this.timers.push(t);
    return () => {
      t.dead = true;
    };
  };
  ask = (): void => {
    this.asked++;
  };
  note = (text: string): void => {
    this.notes.push(text);
  };

  /** Пустить часы на `ms` вперёд, отрабатывая таймеры по порядку. */
  run(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.now = due.at;
      due.dead = true;
      due.cb();
    }
    this.now = end;
  }

  /** Сколько таймеров ещё ждёт. */
  get pending(): number {
    return this.timers.filter((t) => !t.dead).length;
  }

  /** Телеграм прислал высоту, как это делает SDK: устоявшаяся меняется только с `is_state_stable`. */
  say(height: number, stable: boolean): void {
    if (!this.app) throw new Error('вне Телеграма');
    this.app.viewportHeight = height;
    if (stable) this.app.viewportStableHeight = height;
  }
}

describe('правило высоты', () => {
  it('правда — окно: вне Телеграма и без свежего слова Телеграма', () => {
    expect(appHeight(FULL, null)).toBe(FULL);
    expect(appHeight(FULL, { height: BAR, stable: BAR, fresh: false })).toBe(FULL);
  });

  it('нулевое окно — держать прежнее, а не раскладывать в ноль', () => {
    expect(appHeight(0, null)).toBeNull();
    expect(appHeight(Number.NaN, { height: FULL, stable: FULL, fresh: true })).toBeNull();
  });

  it('свежий Телеграм обрезает окно на шапку', () => {
    expect(appHeight(FULL, { height: 760, stable: 760, fresh: true })).toBe(760);
    // Больше окна Телеграм раскладку не растягивает.
    expect(appHeight(FULL, { height: 900, stable: 900, fresh: true })).toBe(FULL);
  });

  it('полоску свёрнутой аппки не берёт даже свежей: Телеграм режет не больше четверти', () => {
    expect(appHeight(FULL, { height: BAR, stable: BAR, fresh: true })).toBe(FULL);
    // Граница — четверть окна. Точки по обе стороны от неё, и то, что они по обе
    // стороны, проверено здесь же, а не в уме (правило 11).
    const inside = Math.ceil(FULL * (1 - TG_CUT_MAX)) + 1;
    const outside = Math.floor(FULL * (1 - TG_CUT_MAX)) - 1;
    expect(FULL - inside).toBeLessThan(FULL * TG_CUT_MAX);
    expect(FULL - outside).toBeGreaterThan(FULL * TG_CUT_MAX);
    expect(appHeight(FULL, { height: inside, stable: inside, fresh: true })).toBe(inside);
    expect(appHeight(FULL, { height: outside, stable: outside, fresh: true })).toBe(FULL);
  });

  it('из двух чисел Телеграма — большее: устоявшееся отстаёт от разворачивания', () => {
    expect(appHeight(FULL, { height: 780, stable: BAR, fresh: true })).toBe(780);
    expect(appHeight(FULL, { height: 700, stable: 780, fresh: true })).toBe(780);
  });
});

describe('свернули и развернули', () => {
  let env: FakeEnv;
  let door: ViewportDoor;

  beforeEach(() => {
    env = new FakeEnv();
    door = new ViewportDoor(env);
    door.told('запуск');
    expect(env.height).toBe(FULL);
  });

  /** Свернуть так, как сворачивает клиент: событие, полоска, окно сжалось. */
  const minimize = (stableBar: boolean): void => {
    env.hidden = true;
    door.turned(true);
    env.say(BAR, stableBar);
    door.told('вьюпорт');
    env.win = { ...env.win, h: BAR };
    door.measure('окно');
  };

  it('жалоба: устоявшаяся высота полоски, при разворачивании — только промежуточные', () => {
    minimize(true);
    env.hidden = false;
    door.turned(false);
    // Анимация разворачивания: окно растёт, Телеграм шлёт промежуточные, устоявшейся нет.
    for (const h of [200, 500, FULL]) {
      env.win = { ...env.win, h };
      env.say(h, false);
      door.told('вьюпорт');
    }
    env.run(2000);
    expect(env.app?.viewportStableHeight).toBe(BAR);
    expect(env.height).toBe(FULL);
  });

  it('при разворачивании не пришло ничего: ни событий Телеграма, ни resize', () => {
    minimize(true);
    env.hidden = false;
    door.turned(false);
    // Окно доехало до размера позже, и события об этом не было.
    env.win = { ...env.win, h: FULL };
    env.run(SETTLE[SETTLE.length - 1]);
    expect(env.height).toBe(FULL);
  });

  it('вебвью вернулся нулевым на кадр-другой — ноль не раскладывается, размер догоняется', () => {
    minimize(true);
    env.win = { ...env.win, h: 0 };
    env.hidden = false;
    door.turned(false);
    expect(env.heights).not.toContain(0);
    env.run(100);
    env.win = { ...env.win, h: FULL };
    env.run(2000);
    expect(env.height).toBe(FULL);
  });

  it('полоска пришла раньше «свернули», пока аппку ещё видно', () => {
    env.say(BAR, true);
    door.told('вьюпорт');
    expect(env.height).toBe(FULL);
  });

  it('после разворачивания дверь просит клиент сказать вьюпорт заново', () => {
    minimize(true);
    const before = env.asked;
    env.hidden = false;
    door.turned(false);
    expect(env.asked).toBe(before + 1);
  });

  it('шапку Телеграм режет и после разворачивания — когда скажет заново', () => {
    env.say(760, true);
    door.told('вьюпорт');
    expect(env.height).toBe(760);
    // Свернули и развернули, а клиент за это время не сказал ничего. Его прошлое число — в пределах четверти
    // окна, порог его не отсекает: держит здесь только свежесть.
    expect(FULL - 760).toBeLessThan(FULL * TG_CUT_MAX);
    env.hidden = true;
    door.turned(true);
    env.hidden = false;
    door.turned(false);
    env.run(2000);
    // Сказанное до сворачивания — про другое окно: до нового слова правда — окно.
    expect(env.height).toBe(FULL);
    env.say(760, true);
    door.told('вьюпорт');
    expect(env.height).toBe(760);
  });

  it('свернули посреди попыток — попытки снимаются', () => {
    env.hidden = false;
    door.turned(false);
    expect(env.pending).toBe(SETTLE.filter((ms) => ms > 0).length);
    env.hidden = true;
    door.turned(true);
    expect(env.pending).toBe(0);
  });

  it('подписчики узнают о каждой перемене один раз и могут отписаться', () => {
    const seen: number[] = [];
    const off = door.subscribe((s) => seen.push(s.h));
    minimize(true);
    env.hidden = false;
    door.turned(false);
    env.win = { ...env.win, h: FULL };
    env.run(2000);
    expect(seen).toEqual([BAR, FULL]);
    off();
    env.win = { ...env.win, h: 700 };
    door.measure('окно');
    expect(seen).toEqual([BAR, FULL]);
  });

  it('плотность пикселей поменялась без перемены размера — подписчики узнают', () => {
    const seen: number[] = [];
    door.subscribe((s) => seen.push(s.dpr));
    env.win = { ...env.win, dpr: 3 };
    door.measure('окно');
    expect(seen).toEqual([3]);
  });
});

// ---------- Дверь одна ----------

const SRC = __dirname;
const DOOR = 'viewport.ts';

function sources(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p, ext));
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string): string => relative(SRC, p).split(sep).join('/');
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Как можно записать высоту приложения мимо двери. */
const WRITE_APP_H = /--app-h['"`]\s*,/;

describe('высоту приложения пишет одна дверь', () => {
  it('образец ловит запись, а не чтение', () => {
    expect(WRITE_APP_H.test("root.setProperty('--app-h', `${h}px`)")).toBe(true);
    expect(WRITE_APP_H.test('style.setProperty("--app-h", v)')).toBe(true);
    expect(WRITE_APP_H.test('height: var(--app-h);')).toBe(false);
  });

  it('`--app-h` в src записывает только дверь окна', () => {
    const files = sources(SRC, /\.tsx?$/);
    expect(files.length).toBeGreaterThan(100);
    const writers = files.filter((f) => WRITE_APP_H.test(strip(readFileSync(f, 'utf8')))).map(rel);
    expect(writers).toEqual([DOOR]);
  });

  it('в стилях высота окна — только `--app-h`: ни `vh`, ни `dvh` мимо неё', () => {
    // Своя высота окна у правила стилей разошлась бы с дверью ровно в ту минуту, когда
    // дверь держит прежнюю высоту, — после разворачивания. Исключение одно: запасное
    // значение самой переменной до первого замера двери.
    const css = sources(SRC, /\.css$/);
    expect(css.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of css) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      for (const m of text.matchAll(/[^;{}]*\b\d+(?:\.\d+)?d?vh\b[^;{}]*/g)) {
        // Запрос возможностей браузера (`@supports (height: 100dvh)`) — не высота.
        if (/^\s*@supports\s/.test(m[0])) continue;
        if (/^\s*--app-h\s*:/.test(m[0])) continue;
        bad.push(`${rel(f)}: ${m[0].trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
