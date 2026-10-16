import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * Тест экрана загрузки.
 *
 * Он читает `index.html` и выполняет тот самый код, который уедет к игроку, —
 * не его копию и не отдельный модуль «с теми же правилами». Копии правил не
 * существует: экран живёт в одном файле целиком, и проверять его можно только
 * оттуда. Заодно это держит главное требование: экран действительно в
 * `index.html`, а не в бандле.
 */

const HTML_PATH = fileURLToPath(new URL('../../index.html', import.meta.url));
const html = readFileSync(HTML_PATH, 'utf8');

/** Тот единственный <script>, в котором живёт машинка экрана. */
function bootSource(): string {
  const i = html.indexOf('var TribeBoot');
  expect(i, 'машинка экрана загрузки должна лежать в index.html').toBeGreaterThan(0);
  const end = html.indexOf('</script>', i);
  expect(end).toBeGreaterThan(i);
  return html.slice(i, end);
}

interface FakeEl {
  id: string;
  className: string;
  textContent: string;
  style: { width: string };
  parentNode: unknown;
  __wired?: boolean;
  addEventListener(kind: string, fn: () => void): void;
  click(): void;
}

interface Boot {
  SHOW_AFTER_MS: number;
  MIN_VISIBLE_MS: number;
  FAIL_AFTER_MS: number;
  SAYINGS: string[];
  STAGES: Record<string, { at: number; text: string }>;
  visitNo(store: unknown, nowMs: number): number;
  sayingOf(no: number): string;
  create(env: unknown): {
    stage(name: string): void;
    done(): void;
    fail(why: string): void;
    attach(): void;
    visible(): boolean;
    failed(): boolean;
    saying: string;
  };
}

/** Выполняет код экрана в чистом окружении. `document` здесь нет, поэтому сам он не стартует. */
function loadBoot(): Boot {
  const make = new Function(`${bootSource()}\nreturn TribeBoot;`) as () => Boot;
  return make();
}

/** Минимальный DOM: ровно то, чего касается экран, и ни строкой больше. */
function fakeDom() {
  const els = new Map<string, FakeEl>();
  const clicks = new Map<string, Array<() => void>>();
  const vars: Record<string, string> = {};
  const el = (id: string): FakeEl => {
    const e: FakeEl = {
      id,
      className: '',
      textContent: '',
      style: { width: '' },
      parentNode: null,
      addEventListener(kind, fn) {
        if (kind !== 'click') return;
        const list = clicks.get(id) ?? [];
        list.push(fn);
        clicks.set(id, list);
      },
      click() {
        for (const fn of clicks.get(id) ?? []) fn();
      },
    };
    els.set(id, e);
    return e;
  };
  for (const id of ['boot', 'boot-say', 'boot-stage', 'boot-fill', 'boot-retry', 'boot-why']) el(id);
  return {
    els,
    vars,
    doc: {
      getElementById: (id: string) => els.get(id) ?? null,
      documentElement: { style: { setProperty: (k: string, v: string) => (vars[k] = v) } },
    },
  };
}

/** Часы и таймеры под рукой: время двигаем сами, чтобы порог проверялся числом. */
function fakeClock() {
  let now = 0;
  let id = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    delay: (fn: () => void, ms: number) => {
      jobs.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (i: number) => jobs.delete(i),
    /** Двигает время и выполняет всё, чему срок настал. */
    advance(ms: number) {
      now += ms;
      for (const [key, job] of [...jobs].sort((a, b) => a[1].at - b[1].at)) {
        if (job.at > now) continue;
        jobs.delete(key);
        job.fn();
      }
    },
  };
}

function memStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function boot(opts: { theme?: Record<string, string>; store?: ReturnType<typeof memStore> } = {}) {
  const B = loadBoot();
  const dom = fakeDom();
  const clock = fakeClock();
  let reloaded = 0;
  const win = opts.theme ? { Telegram: { WebApp: { themeParams: opts.theme } } } : {};
  const it = B.create({
    doc: dom.doc,
    win,
    now: clock.now,
    delay: clock.delay,
    clear: clock.clear,
    reload: () => reloaded++,
    store: opts.store ?? memStore(),
  });
  it.attach();
  return { B, it, dom, clock, reloaded: () => reloaded };
}

describe('экран загрузки', () => {
  it('тянет за собой ровно один файл — арт заставки, и больше ничего', () => {
    // Раньше здесь стоял полный запрет: экран загрузки не должен ждать того, что
    // сам прикрывает. Запрет снят ровно на один файл, и снят замером, а не на глаз
    // (числа — в docs/loading.md): вложенная строкой заставка растит index.html
    // с 3.3 до 30 КБ и отодвигает первый кадр на 3G с 268 мс до 821 мс, а
    // появляется при этом в тот же момент. Значит, дешевле показать экран сразу
    // и дать арту доехать.
    //
    // Правило «экран загрузки не тянет за собой полсети» осталось в силе: ссылка
    // разрешена ровно одна и ровно эта. Ни шрифта, ни стиля, ни второй картинки.
    const SPLASH = '/assets/splash/boot.webp';
    const body = html.slice(html.indexOf('<div id="boot"'), html.indexOf('type="module"'));
    const refs = [...body.matchAll(/(?:src|href)="([^"]*)"|url\(([^)]*)\)/g)]
      .map((m) => m[1] ?? m[2])
      // url(#…) — ссылка внутрь того же документа, это не запрос.
      .filter((u) => !u.startsWith('#'));
    expect(refs).toEqual([SPLASH]);
    expect(body).not.toMatch(/@import/);

    // Под артом с первой миллисекунды стоит цвет: пока файл едет, экран обязан
    // выглядеть кадром игры, а не белой вспышкой и не пустотой с подписью.
    const head = html.slice(0, html.indexOf('<div id="boot"'));
    expect(head).toMatch(/html\s*\{[^}]*background:/);
    expect(head).toMatch(/#boot\s*\{[^}]*background:\s*#1a1410/);

    // И по-прежнему ни одного адреса наружу: единственный внешний тег в документе —
    // SDK самого Telegram, он был здесь до экрана загрузки.
    const external = [...html.matchAll(/https?:\/\/[^"' )]+/g)].map((m) => m[0]);
    expect(external.filter((u) => !u.includes('telegram.org') && !u.includes('w3.org'))).toEqual([]);
  });

  it('предпросмотр заставки — строкой и крошечный, и лежит ровно под чётким кадром', () => {
    // Строкой в документе лежит ровно одна картинка — предпросмотр заставки в 12 точек (`npm run splash:build`).
    // Это не запрос, а полкилобайта: целиком строкой заставка отодвинула бы первый кадр экрана на полсекунды
    // (docs/loading.md), а предпросмотр размером с саму строку `<img>` не отодвигает ничего.
    const uris = [...html.matchAll(/url\((data:[^)]*)\)/g)].map((m) => m[1]);
    expect(uris).toHaveLength(1);
    expect(uris[0]).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
    expect(uris[0].length, 'предпросмотр вырос — первый кадр экрана опять ждёт картинку').toBeLessThan(600);

    // Размытый кадр и чёткий подрезаются одним правилом, иначе при проявлении город прыгнет. Тем же — и кадр
    // стартового экрана: он стоит под экраном загрузки и показывается при его уходе.
    const rule = (src: string, sel: string): string => new RegExp(`${sel}\\s*\\{([^}]*)\\}`).exec(src)?.[1] ?? '';
    const prop = (body: string, name: string): string | undefined => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1];
    const css = readFileSync(fileURLToPath(new URL('../ui/styles.css', import.meta.url)), 'utf8');
    const pos = prop(rule(html, '#boot-art'), 'object-position');
    expect(pos).toBeTruthy();
    expect(prop(rule(html, '#boot-blur'), 'background-position')).toBe(pos);
    expect(prop(rule(css, '\\.start-art'), 'object-position')).toBe(pos);

    // Название — на том же месте и теми же буквами на обоих экранах: смена экранов его не двигает.
    for (const name of ['top', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height']) {
      const boot = prop(rule(html, '#boot-name'), name);
      expect(boot, name).toBeTruthy();
      expect(prop(rule(css, '\\.start-name'), name), name).toBe(boot);
    }
  });

  it('при быстрой загрузке не показывается вовсе', () => {
    const { B, it: b, clock, dom } = boot();
    clock.advance(B.SHOW_AFTER_MS - 1);
    b.stage('scene');
    b.done();
    expect(b.visible()).toBe(false);
    // И его сразу убирают: мигнуть на 100 мс он не должен ни одним кадром.
    expect(dom.els.get('boot')!.className).toBe('off');
  });

  it('при медленной загрузке показывается и держится минимум времени', () => {
    const { B, it: b, clock, dom } = boot();
    clock.advance(B.SHOW_AFTER_MS);
    expect(b.visible()).toBe(true);
    expect(dom.els.get('boot')!.className).toBe('on');
    b.done();
    // Появившись, экран не гаснет мгновенно — иначе порог лечил бы один край.
    expect(dom.els.get('boot')!.className).toBe('on');
    clock.advance(B.MIN_VISIBLE_MS);
    expect(dom.els.get('boot')!.className).toBe('off');
  });

  it('тема клиента экран не перекрашивает: на светлой теме он тот же', () => {
    // Палитра игры своя (docs/polish.md, П-1): прежде фон, текст и кнопка брались из `themeParams`, и на светлой
    // теме Telegram экран загрузки становился белым под светлыми строками.
    const { dom } = boot({ theme: { bg_color: '#ffffff', text_color: '#000000', button_color: '#3a7bd5' } });
    expect(dom.vars).toEqual({});
    expect(html).not.toMatch(/themeParams|--boot-(bg|text|accent)/);
    const head = html.slice(0, html.indexOf('<div id="boot"'));
    expect(head).toMatch(/html\s*\{[^}]*background:\s*#1a1410/);
    expect(head).toMatch(/#boot\s*\{[^}]*color:\s*#f3e9d8/);
  });

  it('присказка детерминирована и меняется от захода к заходу', () => {
    const B = loadBoot();
    // Чистая функция от номера: одно и то же число — одна и та же строка.
    expect(B.sayingOf(3)).toBe(B.sayingOf(3));
    expect(B.sayingOf(3)).toBe(B.SAYINGS[3]);
    expect(B.sayingOf(B.SAYINGS.length)).toBe(B.SAYINGS[0]);

    const store = memStore();
    const seen = Array.from({ length: 4 }, () => boot({ store }).it.saying);
    expect(seen).toEqual(B.SAYINGS.slice(0, 4));
    // Ни одного Math.random во всём экране: иначе «детерминированно» — слово.
    const code = bootSource()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');
    expect(code).not.toMatch(/Math\.random/);
  });

  it('без localStorage присказка всё равно есть и всё равно не случайна', () => {
    const B = loadBoot();
    const broken = {
      getItem: () => {
        throw new Error('нет доступа');
      },
      setItem: () => {
        throw new Error('нет доступа');
      },
    };
    const a = B.visitNo(broken, 0);
    const b = B.visitNo(broken, 0);
    expect(a).toBe(b);
    expect(B.sayingOf(a)).toBeTypeOf('string');
  });

  it('при поломке появляется кнопка, а не вечное колесо', () => {
    const { it: b, dom, reloaded } = boot();
    b.fail('Проверь связь.');
    expect(b.failed()).toBe(true);
    expect(dom.els.get('boot')!.className).toBe('on bad');
    expect(dom.els.get('boot-why')!.textContent).toBe('Проверь связь.');
    // Кнопка есть в разметке и она настоящая.
    expect(html).toMatch(/id="boot-retry"[^>]*>\s*Повторить/);
    dom.els.get('boot-retry')!.click();
    expect(reloaded()).toBe(1);
  });

  it('поломка показывается сразу, не дожидаясь порога', () => {
    const { it: b, dom, clock } = boot();
    clock.advance(10);
    b.fail('оборвалась связь');
    expect(dom.els.get('boot')!.className).toBe('on bad');
  });

  it('дольше FAIL_AFTER_MS ожидание не длится', () => {
    const { B, it: b, clock } = boot();
    clock.advance(B.FAIL_AFTER_MS);
    expect(b.failed()).toBe(true);
  });

  it('готовая игра поломкой уже не станет', () => {
    const { B, it: b, clock } = boot();
    b.done();
    clock.advance(B.FAIL_AFTER_MS + 1);
    expect(b.failed()).toBe(false);
  });

  it('стадии настоящие: подпись и доля полосы растут по порядку работы', () => {
    const { B, it: b, dom, clock } = boot();
    clock.advance(B.SHOW_AFTER_MS);
    const order = ['code', 'save', 'offline', 'scene', 'done'];
    let prev = -1;
    for (const name of order) {
      b.stage(name);
      const at = B.STAGES[name].at;
      expect(at).toBeGreaterThan(prev);
      prev = at;
      expect(dom.els.get('boot-fill')!.style.width).toBe(`${Math.round(at * 100)}%`);
    }
    // Полоса доезжает до конца, а не виснет на 90% — последняя стадия ровно 1.
    expect(B.STAGES.done.at).toBe(1);
    // Подсчёт офлайна назван словами, а не «подождите».
    expect(B.STAGES.offline.text).toMatch(/без тебя/);
  });

  it('стадии, названные в коде игры, есть на экране', async () => {
    const B = loadBoot();
    const src = readFileSync(fileURLToPath(new URL('./stage.ts', import.meta.url)), 'utf8');
    const named = [...src.matchAll(/'(code|save|offline|scene|done)'/g)].map((m) => m[1]);
    expect(new Set(named).size).toBe(5);
    for (const n of named) expect(B.STAGES[n], n).toBeTruthy();
  });
});
