// Новый интерфейс: подсказка касанием, свежесть тревог, стрелки прироста, цели касания и числа подсказок из
// функций игры (правило 18). Каждый блок называет свою область и проверяет, что точки лежат внутри неё.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { armyPower, housingCapacity, netPerDay, storageCap, upkeepInfo } from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { TAP_SLIP, TAP_TARGET } from '@/gestures';
import { waitSpan } from '@/ui/parts/wait';
import { shortNum } from '@/ui/parts/shortNum';
import { count } from '@/ui/parts/plural';
import { TIP_EDGE, TIP_GAP, TIP_MAX, TIP_W, placeTip, type Rect, type TipContent } from './tip';
import { ALERT_FRESH_MS, isFresh } from './fresh';
import {
  TREND_DEAD,
  armyTip,
  fmtInt,
  goldTip,
  isFull,
  moraleTip,
  perDay,
  popRate,
  popTip,
  rate,
  resTip,
  seasonLeft,
  seasonTip,
  trendOf,
  type TipGo,
} from './hudTips';

const PHONE = { w: 390, h: 844 };
const NARROW = { w: 320, h: 640 };

describe('подсказка встаёт у элемента и не выходит за экран', () => {
  // Область: элементы по всему экрану — углы, середина, верх (строка запасов) и низ (шторка).
  const anchors: Rect[] = [];
  for (const view of [PHONE, NARROW]) {
    for (let x = 0; x <= view.w - 44; x += 23) for (const y of [0, 46, 120, view.h / 2 - 30, view.h / 2 + 10, view.h - 52]) anchors.push({ x, y, w: 44, h: 32 });
  }

  it('по ширине — внутри экрана с полем, стрелка — на середине элемента', () => {
    for (const view of [PHONE, NARROW]) {
      for (const a of anchors.filter((r) => r.x + r.w <= view.w && r.y + r.h <= view.h)) {
        const p = placeTip(a, view);
        expect(p.left, `${JSON.stringify(a)}: левое поле`).toBeGreaterThanOrEqual(TIP_EDGE);
        expect(p.left + p.width, `${JSON.stringify(a)}: правое поле`).toBeLessThanOrEqual(view.w - TIP_EDGE);
        expect(p.width).toBe(Math.min(TIP_W, view.w - 2 * TIP_EDGE));
        // Стрелка смотрит в середину элемента, пока середина не упёрлась в скругление плашки.
        const cx = a.x + a.w / 2;
        if (cx - p.left >= 14 && cx - p.left <= p.width - 14) expect(p.left + p.arrow, `${JSON.stringify(a)}: стрелка`).toBeCloseTo(cx, 6);
      }
    }
  });

  it('элемент в верхней половине — плашка под ним, в нижней — над ним, с зазором', () => {
    let below = 0;
    let above = 0;
    for (const a of anchors) {
      const p = placeTip(a, PHONE);
      if (a.y + a.h / 2 < PHONE.h / 2) {
        below++;
        expect(p.below, `${JSON.stringify(a)}: верхняя половина — под элементом`).toBe(true);
        expect(p.top).toBe(a.y + a.h + TIP_GAP);
        expect(p.bottom).toBeNull();
      } else {
        above++;
        expect(p.below, `${JSON.stringify(a)}: нижняя половина — над элементом`).toBe(false);
        expect(p.bottom).toBe(PHONE.h - a.y + TIP_GAP);
        expect(p.top).toBeNull();
      }
    }
    // Область: проверены обе половины.
    expect(below).toBeGreaterThan(10);
    expect(above).toBeGreaterThan(10);
  });
});

describe('тревога первые секунды стоит пилюлей', () => {
  it('свежая до срока и свёрнута с него; срок считается от первого появления', () => {
    const seen = new Map<string, number>();
    expect(isFresh('raid', 1000, seen)).toBe(true);
    expect(isFresh('raid', 1000 + ALERT_FRESH_MS - 1, seen)).toBe(true);
    expect(isFresh('raid', 1000 + ALERT_FRESH_MS, seen), 'ровно на сроке — уже значок').toBe(false);
    // Вторая тревога, пришедшая позже, свежа от своего прихода.
    expect(isFresh('hunger', 1000 + ALERT_FRESH_MS, seen)).toBe(true);
    expect(isFresh('hunger', 1000 + 2 * ALERT_FRESH_MS - 1, seen)).toBe(true);
    expect(isFresh('raid', 1000 + 2 * ALERT_FRESH_MS - 1, seen)).toBe(false);
  });
});

describe('прирост запаса — стрелкой', () => {
  it('выше порога — вверх, ниже минус порога — вниз, между — без стрелки; полный склад не растёт', () => {
    expect(trendOf(TREND_DEAD + 0.01, false)).toBe('up');
    expect(trendOf(TREND_DEAD, false)).toBeNull();
    expect(trendOf(0, false)).toBeNull();
    expect(trendOf(-TREND_DEAD, false)).toBeNull();
    expect(trendOf(-TREND_DEAD - 0.01, false)).toBe('down');
    expect(trendOf(50, true)).toBeNull();
    // Полный склад, который тратится, — убывает: стрелка вниз остаётся.
    expect(trendOf(-50, true)).toBe('down');
  });
});

describe('числа подсказок верха — функциями игры (правило 18)', () => {
  const go: TipGo = { tab: () => {}, building: () => {}, realm: () => {} };
  const s = createInitialState(7);
  const text = (t: { title: string; body?: string }): string => `${t.title} ${t.body ?? ''}`;

  // Разбор «в день» строками и двери к постройкам — `hudTips.test.ts`; здесь — заголовок и итог той же функцией игры.
  it('золото: итог «в день» — сбор минус причитающееся жалованье (`upkeepInfo`)', () => {
    s.gold = 1234;
    const up = upkeepInfo(s);
    const t = goldTip(s, go);
    expect(t.title).toBe(`Золото · ${fmtInt(1234)}`);
    expect(t.sum!.value).toBe(rate(up.income - up.due));
  });

  it('жители: число, крыши и прирост — из `housingCapacity` и `popGrowth`', () => {
    const t = popTip(s, go);
    expect(t.title).toBe(`Жители · ${fmtInt(s.pop)} из ${fmtInt(housingCapacity(s))}`);
    const g = popGrowth(s);
    expect(t.body).toBe(g.blocked ?? undefined);
    expect(t.sum!.value).toBe(popRate(g.perDay));
    expect(t.more!.sum!.value).toBe(fmtInt(housingCapacity(s)));
  });

  it('дружина: мощь — из `armyPower`, жалованье дружине — из `upkeepInfo`', () => {
    const a = createInitialState(7);
    a.army.spearman = 12;
    const t = armyTip(a, go);
    expect(t.body).toContain(`Мощь ${fmtInt(Math.round(armyPower(a)))}.`);
    expect(t.sum!.value).toBe(rate(-upkeepInfo(a).armyWages));
    // Область: жалованье не ноль — иначе итог «0» совпал бы с любой ошибкой.
    expect(upkeepInfo(a).armyWages).toBeGreaterThan(0);
  });

  it('сезон: до следующего — словами `waitSpan`', () => {
    expect(seasonTip(s, go).body).toContain(waitSpan(seasonLeft(s.time)));
    // Первой строкой — погода над городом (docs/city.md, 15): небо и ветер.
    expect(seasonTip(s, go).body).toMatch(/^(Ясно|Ясная ночь|Облачно|Пасмурно|Дождь|Ливень|Гроза|Снег|Метель|Туман), (тихо|ветерок|ветер|сильный ветер)/);
  });

  it('запас: есть и вместимость — `storageCap`, прирост — `netPerDay`; полный склад говорит, что новое пропадает', () => {
    const r = 'food' as const;
    const half = createInitialState(7);
    half.resources[r] = Math.floor(storageCap(half) / 2);
    expect(isFull(half, r)).toBe(false);
    const t = resTip(half, r, 1, go);
    expect(t.title).toContain(fmtInt(storageCap(half)));
    expect(t.title).toContain(fmtInt(half.resources[r]));
    expect(t.body).toBeUndefined();
    expect(t.sum!.value).toBe(rate(netPerDay(half)[r]));
    const full = createInitialState(7);
    full.resources[r] = storageCap(full);
    expect(isFull(full, r)).toBe(true);
    expect(resTip(full, r, 1, go).body).toBe('Склад полон, лишнее пропадает.');
  });

  it('разряды — узким пробелом, ставка — с запятой и знаком', () => {
    expect(fmtInt(4800)).toBe('4\u202f800');
    expect(fmtInt(999)).toBe('999');
    expect(fmtInt(1234567)).toBe('1\u202f234\u202f567');
    expect(perDay(12.44)).toBe('+12,4 в день');
    expect(perDay(-3)).toBe('−3,0 в день');
    expect(perDay(0)).toBe('0 в день');
    expect(perDay(0.04)).toBe('0 в день');
    expect(perDay(-1500)).toBe('−1\u202f500 в день');
  });

  it('подсказка не длиннее предела', () => {
    for (const t of [goldTip(s, go), popTip(s, go), moraleTip(s, go), armyTip(s, go), seasonTip(s, go), resTip(s, 'wood', 1, go)]) {
      expect(text(t).length, t.title).toBeLessThanOrEqual(TIP_MAX);
    }
  });
});

// ---------- Стиль нового вида: цели касания ----------

// Стиль нового вида — два файла: общий (`next.css`) и державы (`realm/realm-new.css`, ленивый кусок меню).
const CSS = [join(__dirname, 'next.css'), join(__dirname, '..', 'realm', 'realm-new.css')]
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const VARS: Record<string, number> = { '--tap': TAP_TARGET, '--nav-h': Number(CSS.match(/--nav-h:\s*(\d+)px/)![1]) };

/** Число свойства правила: px или переменная из `VARS`. */
function px(sel: string, prop: string): number | null {
  // Последнее правило с этим селектором, где свойство объявлено, — оно и действует.
  const v = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, s]) => s.split(',').map((x) => x.trim()).includes(sel))
    .map(([, , body]) => body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1].trim())
    .filter((x): x is string => x !== undefined)
    .pop();
  if (!v) return null;
  const m = v.match(/^(\d+(?:\.\d+)?)px$/);
  if (m) return Number(m[1]);
  const vr = v.match(/^var\((--[\w-]+)\)$/);
  return vr ? (VARS[vr[1]] ?? null) : null;
}

/**
 * Решение владельца 04.10.2026 (docs/ui_audit.md, 14.4, вопрос 3): числа верхней строки, растущие за тысячу, —
 * сокращённым форматом, как у запасов («4,0к»): на 375 px четырёхзначные распирали бы строку. Мораль, порядок и
 * энергия — до ста. Проверка по исходнику: каждое число ячейки строки идёт через `shortNum` или названо ограниченным.
 */
describe('верхняя строка: числа за тысячу — сокращённо', () => {
  it('золото, жители, жильё и дружина — через `shortNum`; без него — только мораль, порядок и энергия', () => {
    const src = readFileSync(join(__dirname, 'Hud.tsx'), 'utf8');
    const top = src.slice(src.indexOf('className={`nx-top'), src.indexOf('className="nx-res"'));
    const nums = [...top.matchAll(/<(?:b|small)>\/?\{([^}]+)\}<\/(?:b|small)>/g)].map((m) => m[1].trim());
    // Точка внутри области: ячейки строки найдены, и среди них есть и сокращённые, и ограниченные.
    expect(nums.length).toBeGreaterThanOrEqual(7);
    const bare = nums.filter((n) => !/^shortNum\(/.test(n));
    expect(bare.sort(), 'числа без сокращения').toEqual(['energy', 'morale', 'order']);
    expect(nums.filter((n) => /^shortNum\(/.test(n)).sort()).toEqual(['shortNum(armySize(s))', 'shortNum(housing)', 'shortNum(pop)', 'shortNum(s.gold)']);
  });

  it('сокращение: до тысячи — целиком, дальше — одна дробь запятой, и «10,0к» не бывает', () => {
    const cases: [number, string][] = [
      [999, '999'],
      [1000, '1,0к'],
      [4321, '4,3к'],
      [9949, '9,9к'],
      [9950, '10к'],
      [9999, '10к'],
      [12_345, '12к'],
    ];
    for (const [n, want] of cases) expect(shortNum(n), String(n)).toBe(want);
  });
});

describe('верхняя строка: ячейка не делит имя класса с блоком во всю ширину', () => {
  // Ячейка энергии звалась `nx-energy`, как шкала энергии агента (`width: 100%`), и растягивалась на всю строку: сезон
  // уходил за экран (щуп стенда `mini:shots`, docs/minigames.md, 17.8). Область — классы кнопок строки `nx-top` в Hud.tsx.
  it('ни у одного класса ячеек строки нет правила с шириной 100 %', () => {
    const hud = readFileSync(join(__dirname, 'Hud.tsx'), 'utf8');
    const top = hud.slice(hud.indexOf('nx-top'), hud.indexOf('nx-res'));
    const classes = new Set([...top.matchAll(/className=\{?[`"]([^`"$]+)/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('nx-')));
    expect(classes.has('nx-stat')).toBe(true);
    const css = readFileSync(join(__dirname, 'next.css'), 'utf8');
    for (const c of classes) {
      for (const m of css.matchAll(new RegExp(`(^|\\n)\\.${c}\\s*\\{([^}]*)\\}`, 'g'))) expect(m[2], c).not.toMatch(/width:\s*100%/);
    }
  });
});

describe('цели касания нового вида — не меньше порога проекта', () => {
  it('кнопки и ячейки-числа верха, тревоги, низ и ссылка подсказки — 44 и больше', () => {
    expect(TAP_TARGET).toBe(44);
    const targets: [string, string][] = [
      ['.nx-stat', 'height'],
      ['.nx-stat', 'min-width'],
      ['.nx-alert', 'height'],
      ['.nx-alert', 'min-width'],
      ['.nx-nav button', 'height'],
      ['.nx-tip .nx-tip-go', 'height'],
      // Главные кнопки подсказки — постройки, которые делают число (docs/ui_v2.md, 5.2).
      ['.nx-tip .nx-tip-maker', 'min-height'],
      ['.nx-tip .nx-tip-x', 'height'],
      ['.nx-tip .nx-tip-x', 'width'],
      ['.ui-new .nx-top .coat-btn', 'height'],
      ['.ui-new .nx-top .coat-btn', 'width'],
      // Окно постройки: значок здания, значок рабочих, «Улучшить», отмена двумя касаниями.
      ['.nx-bico', 'height'],
      ['.nx-bico', 'width'],
      ['.nx-wico', 'height'],
      ['.nx-wico', 'width'],
      ['.nx-up', 'height'],
      ['.nx-confirm', 'height'],
      ['.nx-bclose', 'height'],
      ['.nx-bclose', 'width'],
      // Промыслы (docs/minigames.md, 3): строка игры и её кнопка — «В лес», «В загон».
      ['.nx-trade', 'min-height'],
      ['.nx-go', 'height'],
      // Кузница: строка вещи, «Изучить ›», шаг заказа, «Заказать».
      ['.nx-grow-row', 'min-height'],
      ['.nx-link', 'height'],
      ['.nx-ostep > button:not(.nx-go)', 'height'],
      ['.nx-ostep > button:not(.nx-go)', 'width'],
      ['.nx-ostep .nx-go', 'height'],
      // Карта: кнопки таблички и полосы руки.
      ['.nx-mbtn', 'height'],
      ['.nx-mbtn', 'width'],
      // Держава: значки шапки, ячейки очков, вкладки, ступени технологий, «Изучить».
      ['.nx-ibtn', 'height'],
      ['.nx-ibtn', 'width'],
      ['.nx-pcell', 'height'],
      ['.nx-rtabs button', 'height'],
      ['.nx-tcell', 'height'],
      ['.nx-go', 'height'],
      // Имя города: поле и кубик шага стартового экрана, имя в шапке державы.
      ['.nx-cname-in', 'height'],
      ['.nx-cname-dice', 'height'],
      ['.nx-cname-dice', 'width'],
      ['.nx-rname', 'min-height'],
      // Вкладки державы: навыки, казна, выбор из трёх, порядок, ячейки наклона, страницы заданий, достижения, «Все».
      ['.nx-skill', 'min-height'],
      ['.nx-lcell', 'height'],
      ['.nx-opt', 'min-height'],
      ['.nx-orow', 'height'],
      ['.nx-tgcell', 'min-height'],
      ['.nx-seg button', 'height'],
      ['.nx-ach button', 'height'],
      ['.nx-more', 'height'],
      // Карточка клетки и «Походы»: ячейки-справки, действия, люди сеткой, строки, кнопки строк.
      ['.nx-fact', 'min-height'],
      ['.nx-cact', 'height'],
      ['.nx-leadb', 'min-height'],
      ['.nx-crow', 'min-height'],
      ['.nx-act', 'height'],
      // «Походы» таблицами (UI-7): имя человека и отряда — кнопка в ячейке.
      ['.mr-who', 'min-height'],
      ['.nx-ico44', 'height'],
      ['.nx-ico44', 'width'],
      // Весть: лупа, ответы, «Отложить»; донесение о бое: «итог или бой».
      ['.nx-mspot', 'height'],
      ['.nx-mspot', 'width'],
      ['.nx-ans', 'min-height'],
      ['.nx-mback', 'height'],
      ['.nx-rbtns .btn', 'height'],
    ];
    for (const [sel, prop] of targets) {
      const v = px(sel, prop);
      expect(v, `${sel} { ${prop} } объявлен`).not.toBeNull();
      expect(v!, `${sel} { ${prop} }`).toBeGreaterThanOrEqual(TAP_TARGET);
    }
  });

  // Решение владельца 16.10.2026 (docs/ui_v2.md, 6.3, К1): 32 → 33 — справка не меньше первого схода, который судья уже
  // не считает тапом (`TAP_SLIP` + 1). Прежде тест держал 32 (ui_audit.md, 3.6).
  it('ячейки-справки запасов — 33: промах попадает в соседнюю такую же и стоит одной подсказки', () => {
    expect(px('.nx-res', 'height')).toBeGreaterThanOrEqual(TAP_SLIP + 1);
    // Верх целиком — в своей высоте: строка 44, просвет 2 и запасы.
    expect(44 + 2 + px('.nx-res', 'height')!, 'верх помещается в --hud-h').toBeLessThanOrEqual(Number(CSS.match(/--hud-h:\s*(\d+)px/)![1]));
  });
});

// ---------- Долгого нажатия нет ----------

describe('подсказка — касанием, долгого нажатия нет', () => {
  const DIR = __dirname;
  const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

  it('элементы нового вида слушают `click`; нажатие-удержание и системное меню не слушает никто', () => {
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, `${f}: удержание`).not.toMatch(/onContextMenu|onTouchStart|onMouseDown|contextmenu|longpress|long-press/i);
      // Единственный `pointerdown` — ловец под открытой подсказкой: он закрывает её, а не открывает.
      if (/onPointerDown/.test(src)) expect(f, 'pointerdown — только у ловца подсказки').toBe('TipLayer.tsx');
    }
    const hud = readFileSync(join(DIR, 'Hud.tsx'), 'utf8');
    expect(hud.match(/onClick=\{tip\(/g)?.length, 'числа верха открывают подсказку касанием').toBeGreaterThanOrEqual(6);
  });
});

// ---------- Подсказка новичку не ловит касаний мимо плашки ----------

describe('подсказка новичку: касание мимо плашки доходит до города', () => {
  // Область: подсказки, которые встают сами (`Hints`), — все из данных; против них — подсказка числа (3.7), которую игрок
  // открыл сам. Всё, что не плашка, — город: без ловца во весь экран касание по постройке достаётся холсту, а холст судит
  // один судья пальца (`gestures.ts`) — тап открывает постройку, это меряет `tap:report`.
  const at: Rect = { x: 160, y: 790, w: 70, h: 54 };
  const draw = async (tip: TipContent, busy: boolean): Promise<string> => {
    const { TipView } = await import('./TipLayer');
    return renderToStaticMarkup(createElement(TipView, { tip: { ...tip, at }, view: PHONE, busy, modal: false, hide: () => {} }));
  };
  const NUMBER: TipContent = { title: 'Золото · 120', body: 'Казна города.' };

  it('каждая подсказка новичку свободная: на экране плашка с крестиком, ловца во весь экран нет', async () => {
    const { hintTip } = await import('./Hints');
    const { HINTS } = await import('@/game/data/hints');
    expect(HINTS.length, 'подсказки новичку есть').toBeGreaterThanOrEqual(5);
    for (const h of HINTS) {
      const tip = hintTip(h);
      expect(tip.free, `${h.id}: свободная`).toBe(true);
      const html = await draw(tip, false);
      expect(html, `${h.id}: плашка на экране`).toContain('role="tooltip"');
      expect(html, `${h.id}: ловца нет — тап по постройке доходит до города`).not.toContain('nx-tip-catch');
      expect(html, `${h.id}: крестик закрывает`).toContain('nx-tip-x');
    }
  });

  it('подсказка числа — ловец под плашкой и свой крестик (Г-5)', async () => {
    const html = await draw(NUMBER, false);
    expect(html).toContain('nx-tip-catch');
    expect(html).toContain('nx-tip-x');
  });

  it('город занят — подсказка новичку прячется и ждёт, подсказка числа стоит', async () => {
    const { hintTip } = await import('./Hints');
    const { HINTS } = await import('@/game/data/hints');
    expect(await draw(hintTip(HINTS[0]), true)).toBe('');
    expect(await draw(NUMBER, true)).toContain('role="tooltip"');
  });
});

// ---------- Крестик подсказки (Г-5) ----------

describe('крестик подсказки: закрывает её и не трогает окно под ней', () => {
  // Отзыв тестера: на телефоне подсказку с разбором числа не умели убрать и жали крестик окна под ней. Область — каждая
  // подсказка: числа (с ловцом мимо), с разбором и дверями, новичку (без ловца); окно под ней — шторка постройки.
  type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
  const walk = (n: unknown, out: El[] = []): El[] => {
    if (Array.isArray(n)) for (const c of n) walk(c, out);
    else if (n && typeof n === 'object' && 'props' in n) {
      const e = n as El;
      out.push(e);
      walk(e.props.children, out);
    }
    return out;
  };
  const at: Rect = { x: 160, y: 300, w: 70, h: 44 };
  const ROWS: TipContent = {
    title: 'Еда · +152 в день',
    rows: [
      { label: 'Поля', value: '+180', go: () => undefined },
      { label: 'Жители', value: '−28', tone: 'bad' },
    ],
    sum: { label: 'Итого', value: '+152' },
    link: { label: 'Склад', go: () => undefined },
  };

  it('у каждой подсказки × в правом верхнем углу, касание — 44 и больше', async () => {
    const { TipView } = await import('./TipLayer');
    const { hintTip } = await import('./Hints');
    const { HINTS } = await import('@/game/data/hints');
    for (const tip of [{ title: 'Золото · 120', body: 'Казна города.' }, ROWS, hintTip(HINTS[0])] as TipContent[]) {
      const html = renderToStaticMarkup(createElement(TipView, { tip: { ...tip, at }, view: PHONE, busy: false, modal: false, hide: () => {} }));
      expect(html, `${tip.title}: крестик есть`).toMatch(/class="nx-tip-x"[^>]*aria-label="Закрыть подсказку"/);
    }
    const css = readFileSync(join(__dirname, 'next.css'), 'utf8');
    const rule = css.match(/\.nx-tip \.nx-tip-x \{([^}]*)\}/)?.[1] ?? '';
    expect(rule, 'в правом верхнем углу плашки').toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/top:\s*-?\d+px/);
    expect(rule).toMatch(/right:\s*-?\d+px/);
    for (const k of ['width', 'height']) expect(Number(rule.match(new RegExp(`\\b${k}:\\s*(\\d+)px`))?.[1]), k).toBeGreaterThanOrEqual(TAP_TARGET);
  });

  it('× закрывает подсказку, касание до окна под ней не доходит; касание мимо — по-прежнему закрывает', async () => {
    const { TipView } = await import('./TipLayer');
    const { useGame } = await import('@/game/store');
    // Окно под подсказкой — шторка постройки: она открыта до касания и должна остаться открытой после.
    useGame.setState({ sheet: { kind: 'building', id: 'smithy' } as never });
    const sheet = useGame.getState().sheet;
    expect(sheet, 'окно под подсказкой открыто').not.toBeNull();
    let hidden = 0;
    const tree = TipView({ tip: { ...ROWS, at }, view: PHONE, busy: false, modal: false, hide: () => void hidden++ });
    const els = walk(tree);
    const x = els.find((e) => e.props.className === 'nx-tip-x');
    expect(x, 'крестик найден').toBeTruthy();
    let stopped = 0;
    let prevented = 0;
    const ev = { stopPropagation: () => void stopped++, preventDefault: () => void prevented++ };
    (x!.props.onPointerDown as (e: typeof ev) => void)(ev);
    (x!.props.onClick as (e: typeof ev) => void)(ev);
    expect(hidden, 'подсказка закрыта').toBe(1);
    expect(stopped, 'касание дальше крестика не идёт — ни нажатие, ни щелчок').toBe(2);
    expect(prevented, 'и не доходит до окна под ней призрачным щелчком').toBe(1);
    expect(useGame.getState().sheet, 'окно под подсказкой осталось открытым').toEqual(sheet);
    // Касание мимо плашки — ловец: закрывает подсказку, а не окно.
    const catcher = els.find((e) => e.props.className === 'nx-tip-catch');
    expect(catcher, 'ловец касания мимо — на месте').toBeTruthy();
    (catcher!.props.onPointerDown as (e: typeof ev) => void)(ev);
    expect(hidden).toBe(2);
    expect(useGame.getState().sheet).toEqual(sheet);
    useGame.setState({ sheet: null });
  });
});

// ---------- Окно постройки ----------

describe('подсказка рабочих окна постройки — числами игры', () => {
  it('занято из скольких, свободные руки и места следующего уровня — из `upgradeGains`', async () => {
    const { workerTip } = await import('./buildingTips');
    const { buildingSlots, idleCount, workerCount, bondedCount, mastersOn } = await import('@/game/derived');
    const { upgradeGains, spareSlotsHelp } = await import('@/ui/parts/upgrade');
    const s = createInitialState(7);
    // Область: здания с рабочими местами, у которых следующий уровень прибавляет места.
    let checked = 0;
    for (const b of s.buildings) {
      const slots = buildingSlots(b);
      if (slots <= 0) continue;
      const gains = upgradeGains(s, b, b.level + 1);
      const more = gains.find((g) => g.id === 'slots');
      const hands = workerCount(s, b.id) + bondedCount(s, b.id) + mastersOn(s, b.id);
      const t = workerTip('Кузнец', hands, slots, idleCount(s), gains, spareSlotsHelp(s, b, hands));
      expect(t.title).toBe(`Кузнец · ${hands} из ${slots}`);
      expect(t.body).toContain(`Свободных рук в городе: ${idleCount(s)}.`);
      if (more) {
        checked++;
        expect(t.body).toContain(`ещё ${count(more.after - more.before, 'место', 'места', 'мест')}.`);
      }
    }
    expect(checked, 'здания, где уровень прибавляет места, есть').toBeGreaterThan(2);
  });
});

describe('кузница нового вида: выбор вещи и шаг заказа', () => {
  it('выбрана последняя заказанная, если изучена; иначе первая изученная; ничего не изучено — первая', async () => {
    const { firstPick } = await import('./SmithyNew');
    const { EQUIPMENT } = await import('@/game/data/equipment');
    const ids = EQUIPMENT.map((e) => e.id);
    // Область: все вещи и последний заказ каждой из них.
    expect(ids.length).toBeGreaterThan(3);
    for (const last of ids) expect(firstPick(last, () => true)).toBe(last);
    const onlyThird = (id: string): boolean => id === ids[2];
    expect(firstPick(ids[0], onlyThird), 'заказанная закрыта — первая изученная').toBe(ids[2]);
    expect(firstPick(null, onlyThird)).toBe(ids[2]);
    expect(firstPick(null, () => false), 'ничего не изучено — первая, в ней и скажут почему').toBe(ids[0]);
  });

  it('число заказа — от одного до девяноста девяти', async () => {
    const { clampCount } = await import('./SmithyNew');
    expect(clampCount(0)).toBe(1);
    expect(clampCount(-9)).toBe(1);
    expect(clampCount(1)).toBe(1);
    expect(clampCount(99)).toBe(99);
    expect(clampCount(109)).toBe(99);
  });
});

describe('найм нового вида: какой вид выбран', () => {
  it('шаг обучения сильнее всего; затем последний нанятый, если открыт; затем первый открытый', async () => {
    const { firstTroop, tutorialTroop } = await import('./RecruitNew');
    const here = ['clubman', 'spearman', 'archer'] as const;
    const all = (): boolean => true;
    expect(tutorialTroop('[data-tut="recruit-spearman"]')).toBe('spearman');
    expect(tutorialTroop('[data-tut="nav-map"]')).toBeNull();
    expect(tutorialTroop(null)).toBeNull();
    expect(firstTroop([...here], 'spearman', 'archer', all), 'шаг обучения').toBe('spearman');
    expect(firstTroop([...here], null, 'archer', all), 'последний нанятый').toBe('archer');
    expect(firstTroop([...here], null, 'archer', (id) => id !== 'archer'), 'последний закрыт — первый открытый').toBe('clubman');
    expect(firstTroop([...here], null, null, (id) => id === 'archer')).toBe('archer');
    // Вид обучения не из этого здания (конница в казармах) — не выбирается.
    expect(firstTroop([...here], 'knight' as never, null, all)).toBe('clubman');
  });
});
