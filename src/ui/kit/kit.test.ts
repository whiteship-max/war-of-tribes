// Набор интерфейса UI-1 (docs/ui_v2.md, разделы 2–3): цели касания против порогов судьи, долгого нажатия нет, разметка
// частей, разбор числа складывается в итог, двери «к источнику» — из данных игры и те же, что у подсказок верха.
// Каждый блок называет свою область и проверяет, что точки лежат внутри неё (правило 11).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TAP_SLIP, TAP_TARGET } from '@/gestures';
import { createInitialState } from '@/game/state';
import { buildingOfType, housingCapacity, moraleBreakdown, moraleTarget } from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import { JOBS } from '@/game/data/jobs';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import type { Tab } from '@/game/store';
import type { RealmView } from '@/ui/realm/open';
import { TIP_EDGE, TIP_ROWS_MAX, placeTip, tipRoom } from '@/ui/next/tip';
import { armyTip, energyTip, goldTip, moraleTip, orderTip, popTip, rate, resTip, seasonTip, type TipGo } from '@/ui/next/hudTips';
import { Num } from './Num';
import { Row } from './Row';
import { COL_W, Table, tracks } from './Table';
import { Bar, fillOf } from './Bar';
import { Btn } from './Btn';
import { SheetPage, Tabs, badgeText } from './SheetPage';
import { REST_LABEL, breakdown, restOf, type Part } from './breakdown';
import { WINDOW, producersOf, sourceWord, type Source, type SourceKey } from './sources';

const DIR = __dirname;
const CSS = readFileSync(join(DIR, 'kit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const NEXT_CSS = readFileSync(join(DIR, '..', 'next', 'next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SOURCES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

/** Число свойства в последнем правиле с этим селектором (px или `var(--tap)`); нет правила — null. */
function px(css: string, sel: string, prop: string): number | null {
  const v = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, s]) => s.split(',').map((x) => x.trim()).includes(sel))
    .map(([, , body]) => body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))?.[1].trim())
    .filter((x): x is string => x !== undefined)
    .pop();
  if (!v) return null;
  const m = v.match(/^(\d+(?:\.\d+)?)px$/);
  if (m) return Number(m[1]);
  return v === 'var(--tap)' ? TAP_TARGET : null;
}

// ---------- Касание ----------

/**
 * Пороги касания набора (docs/ui_v2.md, раздел 2, «Касание»): действие — не меньше `TAP_TARGET`; справка, которая только
 * объясняет, — не меньше первого схода, который судья уже не считает тапом (`TAP_SLIP` + 1). Отчёт `tap` держит сами
 * пороги: сход 31 px — тап, 33 px — нет; палец 620 мс — тап, 780 мс — нет (docs/handbook/acceptance.md).
 */
const INFO_MIN = TAP_SLIP + 1;
const ACTIONS: [string, string][] = [
  ['.kit-row.go', 'min-height'],
  ['.kit-go', 'width'],
  ['.kit-go', 'min-height'],
  ['.kit-trow.go', 'min-height'],
  ['.kit-btn', 'min-height'],
  ['.kit-btn', 'min-width'],
  ['.kit-tabs button', 'height'],
  ['.kit-head-ico', 'width'],
  ['.kit-head-ico', 'height'],
  ['.kit-close', 'width'],
  ['.kit-close', 'height'],
];
const INFOS: [string, string][] = [
  ['.kit-num', 'min-height'],
  ['.kit-num', 'min-width'],
  ['.kit-row', 'min-height'],
  ['.kit-row-tip', 'min-height'],
  ['.kit-cells.tip', 'min-height'],
  ['.kit-trow', 'min-height'],
  ['.kit-bar', 'min-height'],
];

describe('касание набора — не мельче порогов судьи', () => {
  it('пороги — те, что названы в задании этапа: справка от 33, действие от 44', () => {
    expect(INFO_MIN).toBe(33);
    expect(TAP_TARGET).toBe(44);
  });

  it('действия — не меньше 44, справки — не меньше 33', () => {
    for (const [sel, prop] of ACTIONS) {
      const v = px(CSS, sel, prop);
      expect(v, `${sel} { ${prop} } объявлен`).not.toBeNull();
      expect(v!, `${sel} { ${prop} }`).toBeGreaterThanOrEqual(TAP_TARGET);
    }
    for (const [sel, prop] of INFOS) {
      const v = px(CSS, sel, prop);
      expect(v, `${sel} { ${prop} } объявлен`).not.toBeNull();
      expect(v!, `${sel} { ${prop} }`).toBeGreaterThanOrEqual(INFO_MIN);
    }
    // Строка разбора с дверью к источнику в подсказке — действие.
    expect(px(NEXT_CSS, '.nx-tip .nx-tip-row.go', 'min-height')).toBeGreaterThanOrEqual(TAP_TARGET);
  });

  it('каждая кнопка набора — в одном из двух списков: новая кнопка без размера не пройдёт', () => {
    // Область — все классы, которые набор вешает на `<button`: их берём из исходников, а не из списка рукой.
    const checked = new Set([...ACTIONS, ...INFOS].map(([sel]) => sel.split(/[ .]/).filter(Boolean)[0]));
    const classes = new Set<string>();
    for (const f of SOURCES.filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(join(DIR, f), 'utf8');
      for (const m of src.matchAll(/<button[^>]*className=\{?[`"]([a-z-]+)/g)) classes.add(m[1]);
    }
    expect(classes.size, 'кнопки набора найдены').toBeGreaterThanOrEqual(6);
    for (const c of classes) expect(checked.has(c) || c === 'kit-tabs', `${c}: размер касания проверен`).toBe(true);
  });
});

describe('долгого нажатия нет: набор слушает только `click`', () => {
  it('ни удержания, ни системного меню, ни своих часов нажатия', () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(8);
    for (const f of SOURCES) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, `${f}: удержание`).not.toMatch(/onPointerDown|onPointerUp|onTouchStart|onTouchEnd|onMouseDown|onContextMenu|contextmenu|longpress|long-press/i);
      // Таймер в наборе один — окно между двумя касаниями «Точно?», не удержание.
      if (/setTimeout/.test(src)) expect(f).toBe('twotap.ts');
    }
  });

  it('окно двух касаний — одна дверь: `Confirm` и ускорение за алмазы своих таймеров не держат', () => {
    for (const f of ['Confirm.tsx', 'Rush.tsx']) {
      const src = readFileSync(join(DIR, '..', 'next', f), 'utf8');
      expect(src, `${f}: через kit/twotap`).toMatch(/useTwoTap\(\)/);
      expect(src, `${f}: свой таймер «Точно?»`).not.toMatch(/setArmed/);
    }
  });
});

// ---------- Разметка частей ----------

const tip = () => ({ title: 'Еда' });

describe('части набора: разметка', () => {
  it('число — кнопка-справка с тоном, запись — как дана', () => {
    const html = renderToStaticMarkup(h(Num, { tip, tone: 'good', label: 'Еда', children: '+43,4' }));
    expect(html).toContain('class="kit-num good"');
    expect(html).toContain('+43,4');
    expect(html).toMatch(/^<button type="button"/);
  });

  it('строка: дверь — кнопкой со стрелкой; справка и дверь — двумя кнопками; без них — текст', () => {
    const go = () => undefined;
    const link = renderToStaticMarkup(h(Row, { label: 'Склад', go }));
    expect(link).toMatch(/^<button type="button" class="kit-row go"/);
    expect(link).toContain('›');
    const both = renderToStaticMarkup(h(Row, { label: 'Еда', value: '901', tip, go }));
    expect(both).toMatch(/^<div class="kit-row split"/);
    expect(both.match(/<button/g)?.length).toBe(2);
    const plain = renderToStaticMarkup(h(Row, { label: 'Жилых мест', value: '45' }));
    expect(plain).toMatch(/^<div class="kit-row"/);
    expect(plain).not.toContain('<button');
  });

  it('таблица: в каждой строке столько ячеек, сколько столбцов, и место под «›» у всех строк, если дверь есть хоть у одной', () => {
    const cols = [
      { key: 'name', title: 'Постройка' },
      { key: 'lvl', title: 'Ур.', align: 'right' as const, w: '40px' },
      { key: 'eta', title: 'Срок', align: 'right' as const },
    ];
    const rows = [
      { key: 'a', cells: { name: 'Ферма', lvl: '1', eta: '1 ч' }, go: () => undefined },
      { key: 'b', cells: { name: 'Рудник', lvl: '2', eta: '3 ч' }, tip },
      { key: 'c', cells: { name: 'Загон', lvl: '1', eta: '—' } },
    ];
    const html = renderToStaticMarkup(h(Table, { cols, rows }));
    expect(html.match(/role="columnheader"/g)?.length).toBe(cols.length);
    expect(html.match(/role="cell"/g)?.length).toBe(cols.length * rows.length);
    // Строка: дверь (кнопка) или пустое место той же ширины — у всех трёх и у шапки.
    expect((html.match(/class="kit-go"/g)?.length ?? 0) + (html.match(/class="kit-nogo"/g)?.length ?? 0)).toBe(rows.length + 1);
    // Дорожки: первый тянется, остальные твёрдые — столбцы ровные во всех строках.
    expect(tracks(cols)).toBe(`minmax(0, 1fr) 40px ${COL_W}`);
    expect(tracks(cols).split(' ').slice(1).some((t) => t === 'auto' || t.includes('content'))).toBe(false);
  });

  it('пустая таблица говорит словами', () => {
    const html = renderToStaticMarkup(h(Table, { cols: [{ key: 'a', title: 'Отряд' }], rows: [], empty: 'Походов нет.' }));
    expect(html).toContain('Походов нет.');
  });

  it('полоса: доля в пределах 0…100, порог — с подписью', () => {
    expect(fillOf(50, 100)).toBe(50);
    expect(fillOf(150, 100)).toBe(100);
    expect(fillOf(-5, 100)).toBe(0);
    expect(fillOf(5, 0)).toBe(0);
    expect(fillOf(Number.NaN, 100)).toBe(0);
    const html = renderToStaticMarkup(h(Bar, { value: 61, max: 100, text: '61 из 100', marks: [{ at: 30, label: 'ропот' }] }));
    expect(html).toContain('width:61%');
    expect(html).toContain('left:30%');
    expect(html).toContain('ропот');
  });

  it('кнопка: погасшая — с причиной строкой под ней, живая — без неё; срок — под подписью', () => {
    const off = renderToStaticMarkup(h(Btn, { onClick: () => undefined, kind: 'main', why: 'Не хватает запасов.', children: 'Улучшить' }));
    expect(off).toContain('disabled=""');
    expect(off).toContain('class="kit-why">Не хватает запасов.');
    const on = renderToStaticMarkup(h(Btn, { onClick: () => undefined, kind: 'main', sub: '1 ч 1 мин', children: 'Улучшить' }));
    expect(on).not.toContain('disabled');
    expect(on).not.toContain('kit-why');
    expect(on).toContain('<small>1 ч 1 мин</small>');
  });

  it('лист окна: «закрыть» в шапке, вкладки ролью, полоса действия внизу', () => {
    const html = renderToStaticMarkup(
      h(SheetPage<'a' | 'b'>, {
        title: 'Казармы',
        sub: 'ур. 1/10',
        onClose: () => undefined,
        tabs: [
          { id: 'a', label: 'Найм' },
          { id: 'b', label: 'Роспуск', badge: 12 },
        ],
        tab: 'a',
        onTab: () => undefined,
        foot: 'Нанять',
        children: 'тело',
      }),
    );
    expect(html).toContain('class="kit-head"');
    expect(html).toContain('aria-label="Закрыть"');
    expect(html.match(/role="tab"/g)?.length).toBe(2);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('9+');
    expect(html).toContain('class="kit-foot"');
  });

  it('счётчик вкладки — «9+» после девяти', () => {
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
    const html = renderToStaticMarkup(h(Tabs<'x'>, { tabs: [{ id: 'x', label: 'Вести', badge: 0 }], value: 'x', onChange: () => undefined }));
    expect(html).not.toContain('kit-badge');
  });
});

// ---------- Разбор числа ----------

describe('разбор числа складывается в итог', () => {
  const parts: Part[] = [
    { label: 'Ферма', value: 60.3 },
    { label: 'Охотничий домик', value: 67.6 },
    { label: 'Навес собирателей', value: 44.4 },
    { label: 'Едят жители', value: -29.3 },
  ];
  const total = parts.reduce((a, p) => a + p.value, 0);

  it('полный разбор — без строки остатка; итог — записью ставки, той же, что «в день» у подсказок', () => {
    const t = breakdown({ title: 'Еда', total, parts });
    expect(restOf({ total, parts })).toBe(0);
    expect(t.rows!.map((r) => r.label)).not.toContain(REST_LABEL);
    expect(t.rows!.length).toBe(parts.length);
    expect(t.sum!.value).toBe(rate(total));
    expect(t.rows![3].tone).toBe('bad');
    expect(t.rows![0].tone).toBe('good');
  });

  it('дыра в разборе видна строкой «Прочее» ровно на остаток', () => {
    const t = breakdown({ title: 'Еда', total: total + 10, parts });
    const rest = t.rows!.find((r) => r.label === REST_LABEL);
    expect(rest, 'строка остатка').toBeDefined();
    expect(rest!.value).toBe(rate(10));
  });

  it('нулевые слагаемые не пишутся; лишние строки складываются в одну, и подсказка не длиннее предела', () => {
    const many: Part[] = Array.from({ length: 14 }, (_, i) => ({ label: `Двор ${i + 1}`, value: i + 1 }));
    const all = [...many, { label: 'Пусто', value: 0 }];
    const sum = many.reduce((a, p) => a + p.value, 0);
    const t = breakdown({ title: 'Древесина', total: sum, parts: all });
    // Область: слагаемых больше, чем помещается (иначе складывать нечего).
    expect(many.length).toBeGreaterThan(TIP_ROWS_MAX);
    expect(t.rows!.length).toBeLessThanOrEqual(TIP_ROWS_MAX);
    expect(t.rows!.map((r) => r.label)).not.toContain('Пусто');
    expect(t.rows!.map((r) => r.label)).not.toContain(REST_LABEL);
    const folded = t.rows!.find((r) => r.label.startsWith('Ещё '))!;
    const named = many.filter((p) => t.rows!.some((r) => r.label === p.label));
    expect(folded.value).toBe(rate(sum - named.reduce((a, p) => a + p.value, 0)));
  });

  it('разбор морали из чисел игры (`moraleBreakdown`) полон: строки и итог — та же цель, что у справки', () => {
    // Стартовый город упирается в потолок шкалы (слагаемые дают больше ста, и шкала их срезает) — там итог не сумма
    // строк по правилу игры, а не по ошибке разбора. Город сверх крыш (теснота) — внутри области.
    const s = createInitialState();
    s.pop = Math.round(housingCapacity(s) * 1.4);
    const m = moraleBreakdown(s);
    // Область правила «строки складываются в итог»: шкала не срезала ни сумму слагаемых, ни итог, и налог не ноль —
    // иначе пропуск налога из разбора прошёл бы даром.
    expect(m.raw).toBeLessThanOrEqual(100);
    expect(m.target).toBeGreaterThan(0);
    expect(m.target).toBeLessThan(100);
    expect(m.tax).not.toBe(0);
    const parts: Part[] = [
      { label: 'Основа', value: m.base },
      ...m.lines.map((l) => ({ label: l.name, value: l.value })),
      { label: 'Налог', value: -m.tax },
      { label: 'Пир', value: m.feast },
      { label: 'Обряд', value: m.rite },
      { label: 'Вести', value: m.boon },
    ];
    const t = breakdown({ title: 'Мораль', total: moraleTarget(s), parts });
    expect(t.rows!.map((r) => r.label)).not.toContain(REST_LABEL);
  });
});

// ---------- Строки разбора в подсказке ----------

describe('подсказка рисует разбор: строки, итог и двери к источнику', () => {
  const content = breakdown({
    title: 'Еда',
    total: 30,
    parts: [
      { label: 'Ферма', value: 40, go: () => undefined },
      { label: 'Едят жители', value: -10 },
    ],
  });
  const at = { x: 100, y: 60, w: 44, h: 32 };
  const view = { w: 390, h: 844 };

  it('строка с дверью — кнопка, без двери — текст; итог — последней строкой', async () => {
    const { TipView } = await import('@/ui/next/TipLayer');
    const html = renderToStaticMarkup(h(TipView, { tip: { ...content, at }, view, busy: false, modal: false, hide: () => undefined }));
    expect(html).toContain('class="nx-tip-row good go"');
    expect(html).toContain('<div class="nx-tip-row bad">');
    expect(html).toMatch(/class="nx-tip-row sum good"><span>Итого<\/span><b>\+30,0<\/b><\/div><\/div>/);
  });

  it('пока поверх окно с вопросом, дверей нет — как и у ссылки внизу', async () => {
    const { TipView } = await import('@/ui/next/TipLayer');
    const html = renderToStaticMarkup(h(TipView, { tip: { ...content, at }, view, busy: false, modal: true, hide: () => undefined }));
    expect(html).not.toContain('nx-tip-row good go');
    expect(html).toContain('Ферма');
  });

  it('высота под строки — до края экрана с полем, над элементом и под ним', () => {
    // Область: элементы по всей высоте экрана, сверху (плашка под ними) и снизу (плашка над ними).
    let below = 0;
    let above = 0;
    for (let y = 0; y <= view.h - 44; y += 40) {
      const place = placeTip({ x: 120, y, w: 44, h: 44 }, view);
      const room = tipRoom(place, view);
      expect(room, `y ${y}`).toBeGreaterThan(0);
      if (place.below) {
        below++;
        expect(place.top! + room).toBe(view.h - TIP_EDGE);
      } else {
        above++;
        expect(place.bottom! + room).toBe(view.h - TIP_EDGE);
      }
    }
    expect(below).toBeGreaterThan(0);
    expect(above).toBeGreaterThan(0);
  });
});

// ---------- К источнику ----------

describe('к источнику: двери из данных игры', () => {
  it('у каждого запаса есть постройки, которые его делают, — и каждая правда делает его', () => {
    for (const r of RESOURCE_IDS) {
      const by = producersOf(r);
      expect(by.length, `${r}: кто делает`).toBeGreaterThan(0);
      for (const type of by) {
        expect(BUILDING_BY_ID[type], `${r}: ${type} — постройка`).toBeDefined();
        const makes = JOBS.some((j) => (j.yield[r] ?? 0) > 0 && (j.building === type || (type === 'campfire' && j.freeRange)));
        expect(makes, `${r}: ${type} делает`).toBe(true);
      }
    }
  });

  it('у каждого запаса и показателя верха есть окно и слово двери', () => {
    const keys: SourceKey[] = [...RESOURCE_IDS, 'gold', 'pop', 'morale', 'order', 'army', 'energy', 'season'];
    for (const k of keys) {
      expect(WINDOW[k], `${k}: окно`).toBeDefined();
      expect(sourceWord(WINDOW[k]).length, `${k}: слово`).toBeGreaterThan(0);
    }
  });

  it('подсказки верха ведут туда же, куда дверь набора, и тем же словом', () => {
    const s = createInitialState();
    const storage = buildingOfType(s, 'storage')!;
    let went: Source | null = null;
    const go: TipGo = {
      tab: (t: Tab) => (went = { kind: 'tab', tab: t }),
      building: (id: number) => (went = { kind: 'building', type: s.buildings.find((b) => b.id === id)!.type }),
      realm: (v: RealmView) => (went = { kind: 'realm', view: v }),
    };
    const cases: [SourceKey, () => ReturnType<typeof goldTip>][] = [
      ['gold', () => goldTip(s, go)],
      ['pop', () => popTip(s, go)],
      ['morale', () => moraleTip(s, go)],
      ['order', () => orderTip(s, go)],
      ['army', () => armyTip(s, go)],
      ['season', () => seasonTip(s, go)],
      ['energy', () => energyTip(s, 0, () => (went = { kind: 'trades' }))],
      ...RESOURCE_IDS.map((r): [SourceKey, () => ReturnType<typeof goldTip>] => [r, () => resTip(s, r, storage.id, go)]),
    ];
    for (const [key, make] of cases) {
      went = null;
      const t = make();
      expect(t.link, `${key}: ссылка`).toBeDefined();
      t.link!.go();
      expect(went, `${key}: куда`).toEqual(WINDOW[key]);
      expect(t.link!.label, `${key}: слово`).toBe(sourceWord(WINDOW[key]));
    }
  });
});
