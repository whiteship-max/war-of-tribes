// Дверь кадра: в скрытой странице кадров нет, при возврате они снова идут, и
// чаще потолка их не бывает ни на каком экране.
//
// Проверяется настоящий код, а не его описание: часы у лупа внешние, и здесь
// им подставлены поддельные. Заодно это единственный способ вообще проверить
// это в node, где requestAnimationFrame не существует.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { awayNow, DPR_CAP, FPS_CAP, FrameLoop, pace, pixelRatio, setAppAsleep } from './loop';

/**
 * Поддельные часы: кадр случается только тогда, когда его позовут. Каждый кадр
 * экрана идёт через `hz`-ю долю секунды после прошлого — по умолчанию экран 60 Гц.
 */
class FakeClock {
  private id = 1;
  private queue = new Map<number, (now: number) => void>();
  /** Сколько заявок сняли — по нему видно, что цепочка не раздвоилась. */
  cancelled = 0;
  /** Время экрана, мс. */
  now = 1000;
  /** Страница скрыта — так её видит дверь. */
  hidden = false;

  constructor(private hz = 60) {}

  raf = (cb: (now: number) => void): number => {
    const id = this.id++;
    this.queue.set(id, cb);
    return id;
  };

  caf = (id: number): void => {
    if (this.queue.delete(id)) this.cancelled++;
  };

  away = (): boolean => this.hidden;

  /** Сколько заявок ждёт кадра. Больше одной — цепочка раздвоилась. */
  get waiting(): number {
    return this.queue.size;
  }

  /** Прогнать n кадров экрана. */
  run(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.now += 1000 / this.hz;
      const [id, cb] = [...this.queue.entries()][0] ?? [];
      if (id === undefined || !cb) continue;
      this.queue.delete(id);
      cb(this.now);
    }
  }

  /**
   * Страница ушла в фон: браузер кадров не даёт. Заявка при этом остаётся
   * висеть — ровно так же, как в настоящем свёрнутом вебвью.
   */
  freeze(): void {
    /* ничего не делаем: run() просто никто не зовёт */
  }

  /** Заявка не пережила фон — вебвью её выбросил. Так и теряется цепочка. */
  drop(): void {
    this.queue.clear();
  }
}

type Block = 'map' | 'hidden' | 'lost';

describe('луп кадров', () => {
  let clock: FakeClock;
  let ticks: number;
  let starts: number;
  let loop: FrameLoop<Block>;

  beforeEach(() => {
    clock = new FakeClock();
    ticks = 0;
    starts = 0;
    loop = new FrameLoop<Block>(
      () => void ticks++,
      () => void starts++,
      clock,
    );
  });

  afterEach(() => loop.stop());

  it('сам по себе стоит: цепочку заводит первое снятие причин', () => {
    expect(loop.running).toBe(false);
    loop.block('hidden', false); // причины и не было — заводить нечего
    expect(loop.running).toBe(false);
    loop.block('hidden', true);
    loop.block('hidden', false);
    expect(loop.running).toBe(true);
    clock.run(5);
    expect(ticks).toBe(5);
  });

  it('в скрытой странице кадров не бывает', () => {
    loop.restart();
    clock.run(3);
    expect(ticks).toBe(3);

    loop.block('hidden', true);
    expect(loop.running).toBe(false);
    expect(clock.waiting).toBe(0);
    clock.freeze();
    clock.run(10);
    expect(ticks).toBe(3);
  });

  it('при возврате видимости кадры возобновляются', () => {
    loop.restart();
    clock.run(2);
    loop.block('hidden', true);
    clock.run(10);
    expect(ticks).toBe(2);

    loop.block('hidden', false);
    clock.run(4);
    expect(ticks).toBe(6);
  });

  it('заявка, не пережившая фон, не оставляет луп мёртвым', () => {
    // Ровно та болезнь, из-за которой заведён restart: цепочка «жива» по
    // счётчику, а кадра ей никто уже не даст.
    loop.restart();
    clock.drop();
    clock.run(5);
    expect(ticks).toBe(0);

    loop.restart();
    clock.run(3);
    expect(ticks).toBe(3);
  });

  it('снятие одной причины не отменяет другую', () => {
    loop.block('map', true);
    loop.block('hidden', true);
    loop.block('hidden', false);
    expect(loop.running).toBe(false);
    expect(loop.stopped()).toEqual(['map']);
    loop.block('map', false);
    expect(loop.running).toBe(true);
  });

  it('цепочка одна, сколько бы раз её ни будили', () => {
    loop.restart();
    loop.restart();
    loop.block('hidden', false);
    loop.restart();
    expect(clock.waiting).toBe(1);
    clock.run(3);
    expect(clock.waiting).toBe(1);
    expect(ticks).toBe(3);
  });

  it('перед новой цепочкой сцену предупреждают: часы стояли', () => {
    loop.restart();
    clock.run(2);
    expect(starts).toBe(1);
    loop.block('hidden', true);
    loop.block('hidden', false);
    expect(starts).toBe(2);
    // Внутри цепочки о старте не сообщают: часы идут своим ходом.
    clock.run(5);
    expect(starts).toBe(2);
  });

  it('причина, поставленная между заявкой и кадром, кадр отменяет', () => {
    loop.restart();
    loop.block('lost', true);
    clock.run(3);
    expect(ticks).toBe(0);
  });

  it('выгруженная сцена не оживает от снятия причин', () => {
    loop.restart();
    loop.stop();
    clock.run(3);
    expect(ticks).toBe(0);
    expect(loop.running).toBe(false);
    // И от возврата видимости тоже: выгруженная цепочка двери больше не слушает.
    loop.block('map', true);
    loop.block('map', false);
    loop.restart();
    expect(loop.running).toBe(false);
  });

  it('скрытую страницу restart спрашивает у часов, а не у памяти о событии', () => {
    // Событие скрытия не пришло, а страница скрыта: заводить цепочку нельзя —
    // заявка повисла бы до возвращения.
    clock.hidden = true;
    loop.restart();
    expect(loop.running).toBe(false);
    expect(loop.stopped()).toEqual(['hidden']);
    // Вернулись, а события возврата не было: `wake` зовёт restart, и его хватает.
    clock.hidden = false;
    loop.restart();
    expect(loop.running).toBe(true);
    clock.run(3);
    expect(ticks).toBe(3);
  });

  it('скрылись посреди цепочки без события — цепочка встаёт сама', () => {
    loop.restart();
    clock.run(2);
    clock.hidden = true;
    clock.run(5);
    expect(ticks).toBe(2);
    expect(loop.running).toBe(false);
    expect(loop.stopped()).toEqual(['hidden']);
  });
});

/**
 * Сколько кадров в секунду нарисует цепочка на экране `hz` герц. Прогон идёт
 * чистой функцией `pace` — тем же решением, что принимает цепочка.
 *
 * `jitter` — дрожание отметок кадра, мс: сдвиг детерминированный, из номера кадра.
 */
function drawn(hz: number, opts: { seconds?: number; hidden?: boolean; jitter?: number } = {}): { perSecond: number; gaps: number[] } {
  const seconds = opts.seconds ?? 10;
  const frame = 1000 / hz;
  const gaps: number[] = [];
  let next = -Infinity;
  let n = 0;
  let last = -1;
  for (let i = 0; i * frame < seconds * 1000; i++) {
    const jitter = opts.jitter ? ((((i * 7919) % 13) / 12) * 2 - 1) * opts.jitter : 0;
    const paced = pace(next, 1000 + i * frame + jitter, opts.hidden ?? false);
    next = paced.next;
    if (!paced.draw) continue;
    n++;
    if (last >= 0) gaps.push(i - last);
    last = i;
  }
  return { perSecond: n / seconds, gaps };
}

describe('потолок частоты: решение о кадре', () => {
  it('потолок — шестьдесят', () => {
    expect(FPS_CAP).toBe(60);
  });

  it('144 Гц → ровно 60, а не 48 и не 72', () => {
    const { perSecond, gaps } = drawn(144);
    expect(perSecond).toBeGreaterThanOrEqual(59.9);
    expect(perSecond).toBeLessThanOrEqual(60.1);
    // 48 — каждый третий кадр экрана, 72 — каждый второй. Ровно 60 бывает
    // только через два и три интервала по очереди, и никогда — через один.
    expect(new Set(gaps)).toEqual(new Set([2, 3]));
  });

  it('120 и 165 Гц → 60', () => {
    for (const hz of [120, 165]) {
      const { perSecond, gaps } = drawn(hz);
      expect(perSecond, `${hz} Гц`).toBeGreaterThanOrEqual(59.9);
      expect(perSecond, `${hz} Гц`).toBeLessThanOrEqual(60.1);
      expect(Math.min(...gaps), `${hz} Гц: два кадра подряд`).toBeGreaterThanOrEqual(2);
    }
  });

  it('60 Гц → 60, и дрожание отметок кадров не теряет', () => {
    for (const jitter of [0, 0.5, 2]) {
      const { perSecond, gaps } = drawn(60, { jitter });
      expect(perSecond, `дрожание ${jitter} мс`).toBeGreaterThanOrEqual(59.9);
      expect(Math.max(...gaps), `дрожание ${jitter} мс: пропущен кадр`).toBe(1);
    }
  });

  it('30 Гц → 30: экран медленнее потолка отдаёт каждый свой кадр', () => {
    const { perSecond, gaps } = drawn(30);
    expect(perSecond).toBe(30);
    expect(Math.max(...gaps)).toBe(1);
  });

  it('скрыто → 0', () => {
    for (const hz of [30, 60, 144]) expect(drawn(hz, { hidden: true }).perSecond, `${hz} Гц`).toBe(0);
  });

  it('отставание не догоняется очередью кадров', () => {
    // Тяжёлый кадр или возврат из фона: полсекунды кадров не было. Дальше на
    // 144 Гц кадры обязаны идти не чаще потолка, а не каждым кадром экрана.
    const frame = 1000 / 144;
    let next = pace(-Infinity, 1000, false).next;
    const after = 1500;
    let n = 0;
    for (let t = after; t < after + 100; t += frame) {
      const paced = pace(next, t, false);
      next = paced.next;
      if (paced.draw) n++;
    }
    // В сто миллисекунд при потолке 60 умещается 6 кадров (7 — с первым на самой границе).
    expect(n).toBeLessThanOrEqual(7);
  });
});

/** Цепочка на поддельных кадрах и настоящей видимости двери. */
const FrameLoopOn = (fake: FakeClock, tick: () => void): FrameLoop<never> =>
  new FrameLoop<never>(tick, undefined, { raf: fake.raf, caf: fake.caf, away: awayNow });

describe('цепочка кадров держит потолок', () => {
  it('на экране 144 Гц цепочка рисует 60 кадров в секунду', () => {
    const clock = new FakeClock(144);
    let ticks = 0;
    const loop = new FrameLoop<never>(() => void ticks++, undefined, clock);
    loop.restart();
    clock.run(144 * 10);
    loop.stop();
    expect(ticks).toBeGreaterThanOrEqual(599);
    expect(ticks).toBeLessThanOrEqual(601);
  });

  it('дверь будит только заведённые цепочки', () => {
    // Конструктор владельца упал на полпути — цепочка создана, но не заведена.
    // Возврат аппки не должен заводить её: кадры пошли бы в недособранную сцену.
    const fake = new FakeClock();
    let idle = 0;
    const orphan = new FrameLoop<never>(() => void idle++, undefined, { raf: fake.raf, caf: fake.caf, away: awayNow });
    setAppAsleep(true);
    setAppAsleep(false);
    fake.run(3);
    expect(orphan.running).toBe(false);
    expect(idle).toBe(0);
    orphan.stop();

    // А заведённая на свёрнутой аппке — просыпается, когда аппку развернут.
    let ticks = 0;
    setAppAsleep(true);
    const loop = FrameLoopOn(fake, () => void ticks++);
    loop.restart();
    expect(loop.running).toBe(false);
    setAppAsleep(false);
    expect(loop.running).toBe(true);
    fake.run(2);
    expect(ticks).toBe(2);
    loop.stop();
  });

  it('свёрнутая в Телеграме аппка кадров не получает, развёрнутая — снова получает', () => {
    // Страница при этом видима: Telegram Desktop сворачивает аппку, не скрывая
    // её от браузера. Часы здесь — поддельные кадры и настоящая видимость двери.
    const fake = new FakeClock();
    let ticks = 0;
    const loop = new FrameLoop<never>(() => void ticks++, undefined, { raf: fake.raf, caf: fake.caf, away: awayNow });
    loop.restart();
    fake.run(3);
    expect(ticks).toBe(3);

    setAppAsleep(true);
    expect(loop.running).toBe(false);
    expect(loop.stopped()).toEqual(['hidden']);
    fake.run(10);
    expect(ticks).toBe(3);

    setAppAsleep(false);
    expect(loop.running).toBe(true);
    fake.run(2);
    expect(ticks).toBe(5);
    loop.stop();
  });
});

describe('потолок плотности пикселей', () => {
  it('потолок — два, и его не обойти ни экраном, ни стендом', () => {
    expect(DPR_CAP).toBe(2);
    expect(pixelRatio(3)).toBe(2);
    expect(pixelRatio(1.5)).toBe(1.5);
    // Стенд вправе попросить меньше единицы — это его замер, а не экран.
    expect(pixelRatio(0.5)).toBe(0.5);
    // Мусор из адреса — не плотность: берётся экран.
    expect(pixelRatio(Number.NaN)).toBe(1);
    expect(pixelRatio(null)).toBe(1);
  });
});

// ---------- Дверь одна ----------

const SRC = join(__dirname, '..');
const DOOR = 'render/loop.ts';

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

const rel = (p: string): string => relative(SRC, p).split(sep).join('/');

/** Как можно завести кадр мимо двери — все написания, которые ловит тест. */
const RAW_FRAME = /\b(?:requestAnimationFrame|cancelAnimationFrame|setAnimationLoop|webkitRequestAnimationFrame)\b/;

describe('дверь кадра одна', () => {
  it('образец ловит все способы завести кадр, а дверь — нет', () => {
    for (const bad of ['requestAnimationFrame(f)', 'window.requestAnimationFrame(f)', 'cancelAnimationFrame(id)', 'renderer.setAnimationLoop(f)', "window['requestAnimationFrame']"]) {
      expect(RAW_FRAME.test(bad), bad).toBe(true);
    }
    for (const good of ['nextFrame(f)', 'FrameLoop.run(f)', 'loop.restart()', 'afterPaint()']) {
      expect(RAW_FRAME.test(good), good).toBe(false);
    }
  });

  it('requestAnimationFrame и setAnimationLoop в src — только в двери кадра', () => {
    // Цепочка мимо двери — это кадры без потолка и без остановки в свёрнутой
    // аппке. Так дважды выключалась машина владельца (CLAUDE.md, «Бюджет железа»).
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(100);
    const outside = files.filter((f) => rel(f) !== DOOR && RAW_FRAME.test(strip(readFileSync(f, 'utf8')))).map(rel);
    expect(outside).toEqual([]);
    // И дверь на месте: тест, не нашедший ни одного вызова нигде, был бы зелёным даром.
    expect(RAW_FRAME.test(strip(readFileSync(join(SRC, DOOR), 'utf8')))).toBe(true);
  });

  it('плотность экрана читает только дверь, и каждый буфер ставится через её потолок', () => {
    const files = sources(SRC);
    const readers = files.filter((f) => rel(f) !== DOOR && /\bdevicePixelRatio\b/.test(strip(readFileSync(f, 'utf8')))).map(rel);
    expect(readers).toEqual([]);
    const setters = files.filter((f) => /\.setPixelRatio\s*\(/.test(strip(readFileSync(f, 'utf8'))));
    // Рендереров в игре несколько — диорама, предыстория, ролик, стенды: пустой список значил бы сломанный образец.
    expect(setters.length).toBeGreaterThanOrEqual(4);
    const bare = setters.filter((f) => !/\bpixelRatio\s*\(/.test(strip(readFileSync(f, 'utf8')))).map(rel);
    expect(bare).toEqual([]);
  });
});
