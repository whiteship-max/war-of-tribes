// Новый интерфейс: подсказка касанием, свежесть тревог, стрелки прироста, цели касания и числа подсказок из
// функций игры (правило 18). Каждый блок называет свою область и проверяет, что точки лежат внутри неё.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { armyPower, housingCapacity, netPerDay, storageCap, upkeepInfo } from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { TAP_TARGET } from '@/gestures';
import { waitSpan } from '@/ui/parts/wait';
import { TIP_EDGE, TIP_GAP, TIP_MAX, TIP_W, placeTip, type Rect } from './tip';
import { ALERT_FRESH_MS, isFresh } from './fresh';
import {
  TREND_DEAD,
  armyTip,
  fmtInt,
  fmtRate,
  goldTip,
  isFull,
  moraleTip,
  perDay,
  popTip,
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

  it('золото: казна, сбор и жалованье — из `upkeepInfo`', () => {
    s.gold = 1234;
    const up = upkeepInfo(s);
    const t = goldTip(s, go);
    expect(t.title).toBe(`Золото · ${fmtInt(1234)}`);
    expect(t.body).toBe(`Сбор ${fmtRate(up.income)} в день, жалованье ${fmtRate(up.wages)} в день.`);
  });

  it('жители: число, крыши и прирост — из `housingCapacity` и `popGrowth`', () => {
    const t = popTip(s, go);
    expect(t.title).toBe(`Жители · ${fmtInt(s.pop)} из ${fmtInt(housingCapacity(s))}`);
    const g = popGrowth(s);
    expect(t.body).toBe(g.blocked ?? `Прирост ${perDay(g.perDay)}.`);
  });

  it('дружина: мощь — из `armyPower`, жалованье войску — из `upkeepInfo`', () => {
    const t = armyTip(s, go);
    expect(t.body).toBe(`Мощь ${fmtInt(Math.round(armyPower(s)))}. Жалованье ${fmtRate(upkeepInfo(s).armyWages)} в день.`);
  });

  it('сезон: до следующего — словами `waitSpan`', () => {
    expect(seasonTip(s, go).body).toContain(waitSpan(seasonLeft(s.time)));
  });

  it('запас: есть и вместимость — `storageCap`, прирост — `netPerDay`; полный склад говорит, что новое пропадает', () => {
    const r = 'food' as const;
    const half = createInitialState(7);
    half.resources[r] = Math.floor(storageCap(half) / 2);
    expect(isFull(half, r)).toBe(false);
    const t = resTip(half, r, 1, go);
    expect(t.title).toContain(fmtInt(storageCap(half)));
    expect(t.title).toContain(fmtInt(half.resources[r]));
    expect(t.body).toBe(perDay(netPerDay(half)[r]));
    const full = createInitialState(7);
    full.resources[r] = storageCap(full);
    expect(isFull(full, r)).toBe(true);
    expect(resTip(full, r, 1, go).body).toBe('Склад полон: новое пропадает.');
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
    ];
    for (const [sel, prop] of targets) {
      const v = px(sel, prop);
      expect(v, `${sel} { ${prop} } объявлен`).not.toBeNull();
      expect(v!, `${sel} { ${prop} }`).toBeGreaterThanOrEqual(TAP_TARGET);
    }
  });

  it('ячейки-справки запасов — 32: промах попадает в соседнюю такую же и стоит одной подсказки', () => {
    expect(px('.nx-res', 'height')).toBeGreaterThanOrEqual(32);
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
      if (/onPointerDown/.test(src)) expect(f, 'pointerdown — только у ловца подсказки').toBe('Tip.tsx');
    }
    const hud = readFileSync(join(DIR, 'Hud.tsx'), 'utf8');
    expect(hud.match(/onClick=\{tip\(/g)?.length, 'числа верха открывают подсказку касанием').toBeGreaterThanOrEqual(6);
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
      expect(t.body).toContain(`Свободных рук в племени: ${idleCount(s)}.`);
      if (more) {
        checked++;
        expect(t.body).toContain(`ещё ${more.after - more.before} мест`);
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
