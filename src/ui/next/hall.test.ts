// Ратуша «Стройка» одной сеткой (docs/ui_v2.md, раздел 5, UI-2): группы из данных игры, плитка — числами игры, порядок,
// и само окно — все постройки плитками, сетка в квадрат экрана, лист постройки с рабочими, выходом, ценой и улучшением.
//
// Окно рисуется в строку (`renderToStaticMarkup`) с партией теста: стор игры подменён видом, как в тестах окон осады
// (`panels/siegepanels.test.ts`), — строка без браузера читает сторы `zustand` с их начального состояния.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { BUILDINGS } from '@/game/data/buildings';
import { JOB_BY_ID } from '@/game/data/jobs';
import { buildRate, buildingOfType, buildingProduction, currentSite, handsCount, upgradeInfo } from '@/game/derived';
import { startUpgrade } from '@/game/sim/actions';
import { TAP_TARGET } from '@/gestures';
import { HALL_GROUPS, HALL_SORTS, RAW_SERVICES, WAR, groupOf, hallTiles, nextSort, readyCount, sortTiles, yieldsOf, type HallSort } from './hall';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});
// Кнопка ускорения спрашивает Telegram (`net/gems.gemsOffline` → `window.Telegram`), которого в строке без браузера нет;
// своё она проверяет сама (`next.test.ts`). С UI-8 (Д5) лист её не ставит — подмена остаётся меткой: вернись кнопка в
// лист, тест «ускорения нет» увидит её класс.
vi.mock('./Rush', async (orig) => {
  const real = await orig<object>();
  return { ...real, RushButton: () => h('span', { className: 'nx-rush' }) };
});

/**
 * Город теста: одна стройка идёт, вторая ждёт очереди, а склад богат всем, кроме камня, — часть построек можно улучшить,
 * часть нельзя (камень в цене), и плитка обязана их различать.
 */
function town(): GameState {
  const s = createInitialState(7);
  for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 5000;
  startUpgrade(s, buildingOfType(s, 'farm')!.id);
  startUpgrade(s, buildingOfType(s, 'houses')!.id);
  s.resources.stone = 0;
  return s;
}

// ---------- Группы ----------

describe('группы построек — из данных игры', () => {
  it('каждая постройка в группе; дворы — по выработке профессии, война — не дворы', () => {
    for (const d of BUILDINGS) {
      const g = groupOf(d.id);
      expect(HALL_GROUPS.map((x) => x.id), d.id).toContain(g);
      const y = d.job ? JOB_BY_ID[d.job].yield : {};
      if ((y.food ?? 0) > 0) expect(g, `${d.id}: двор с едой`).toBe('food');
      else if (yieldsOf(d.id).length > 0 || RAW_SERVICES.has(d.id)) expect(g, `${d.id}: двор с сырьём или мастерская`).toBe('raw');
      else expect(g, `${d.id}: не двор`).toBe(WAR.has(d.id) ? 'war' : 'city');
    }
    // Решение владельца 16.10.2026 (docs/ui_v2.md, 6.4): мастерская — в «Сырье», службы и жильё — группой «Город».
    expect(groupOf('workshop'), 'мастерская — «Сырьё»').toBe('raw');
    expect(yieldsOf('workshop'), 'точка внутри области: мастерская запаса не делает').toEqual([]);
    expect(HALL_GROUPS.map((x) => x.label), 'слова групп').toEqual(['Еда', 'Сырьё', 'Война', 'Город']);
    expect(groupOf('houses'), 'дома — «Город»').toBe('city');
    for (const t of WAR) {
      expect(BUILDINGS.some((d) => d.id === t), `${t}: такая постройка есть`).toBe(true);
      expect(yieldsOf(t), `${t}: война — не двор`).toEqual([]);
    }
    // Область: в каждой группе есть постройки — пустая вкладка была бы дверью в никуда.
    for (const g of HALL_GROUPS) expect(BUILDINGS.filter((d) => groupOf(d.id) === g.id).length, g.label).toBeGreaterThan(0);
  });
});

// ---------- Плитка ----------

describe('плитка — числами игры', () => {
  it('руки, выход, состояние, срок и доля — те же функции, что кладут добро и решают стройку', () => {
    const s = town();
    s.buildings.find((b) => b.type === 'farm')!.work = 30;
    const tiles = hallTiles(s);
    expect(tiles.length).toBe(s.buildings.length);
    const first = currentSite(s)!;
    const rate = buildRate(s);
    // Область: стройка идёт и строители есть — иначе срока нет и сверять нечего.
    expect(rate).toBeGreaterThan(0);
    for (const t of tiles) {
      const b = t.b;
      if (t.hands !== null) expect(t.hands, b.type).toBe(handsCount(s, b.id));
      const res = yieldsOf(b.type);
      if (res.length) expect(t.out, b.type).toEqual({ r: res[0], perDay: buildingProduction(s, b)[res[0]] });
      else expect(t.out, b.type).toBeNull();
      const up = upgradeInfo(s, b);
      if (b.workRequired > 0) expect(t.state, b.type).toBe(b.id === first.id ? 'site' : 'queued');
      else if (t.state !== 'top') expect(t.state, b.type).toBe(up.blocked === null ? 'ready' : 'locked');
      expect(t.why, b.type).toBe(up.blocked);
    }
    const site = tiles.find((t) => t.state === 'site')!;
    expect(site.eta).toBeCloseTo((first.workRequired - first.work) / rate, 6);
    expect(site.share).toBe(Math.floor((first.work / first.workRequired) * 100));
    expect(tiles.filter((t) => t.state === 'queued').length).toBe(1);
    expect(readyCount(tiles)).toBe(tiles.filter((t) => t.state === 'ready').length);
    // Область: в городе есть и что улучшить, и что нельзя — иначе «можно ли» не различало бы ничего.
    expect(readyCount(tiles)).toBeGreaterThan(0);
    expect(tiles.some((t) => t.state === 'locked')).toBe(true);
  });
});

// ---------- Порядок ----------

describe('порядок сетки', () => {
  const s = town();
  s.buildings.find((b) => b.type === 'mine')!.level = 4;
  s.buildings.find((b) => b.type === 'barracks')!.level = 3;
  const tiles = hallTiles(s);
  const BOOK = BUILDINGS.map((d) => d.id);

  it('кнопка порядка обходит все порядки по кругу', () => {
    let at: HallSort = HALL_SORTS[0].id;
    const seen = new Set<HallSort>();
    for (let i = 0; i < HALL_SORTS.length; i++) {
      seen.add(at);
      at = nextSort(at);
    }
    expect(seen.size).toBe(HALL_SORTS.length);
    expect(at).toBe(HALL_SORTS[0].id);
  });

  it('каждый порядок держит свой ключ, а при равенстве — порядок таблицы построек', () => {
    const groupRank = (g: string) => HALL_GROUPS.findIndex((x) => x.id === g);
    const stateRank = { site: 0, queued: 1, ready: 2, locked: 3, top: 4 } as const;
    const keys: Record<HallSort, (t: (typeof tiles)[number]) => number> = {
      group: (t) => groupRank(t.group),
      ready: (t) => stateRank[t.state],
      level: (t) => -t.level,
      output: (t) => -t.outSum,
    };
    for (const { id } of HALL_SORTS) {
      const out = sortTiles(tiles, id);
      expect(out.length, id).toBe(tiles.length);
      // Область: ключ различает плитки — иначе порядок проверялся бы на одной таблице построек.
      expect(new Set(out.map(keys[id])).size, `${id}: ключ различает`).toBeGreaterThan(1);
      for (let i = 1; i < out.length; i++) {
        const a = keys[id](out[i - 1]);
        const b = keys[id](out[i]);
        expect(a, `${id}: ${out[i - 1].b.type} перед ${out[i].b.type}`).toBeLessThanOrEqual(b);
        if (a === b) expect(BOOK.indexOf(out[i - 1].b.type), `${id}: равные — порядком таблицы`).toBeLessThan(BOOK.indexOf(out[i].b.type));
      }
    }
  });
});

// ---------- Окно ----------

const CSS = readFileSync(join(__dirname, 'hall.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Число свойства в правиле с этим селектором (px); нет — null. */
function px(sel: string, prop: string): number | null {
  const rule = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, s]) => s.split(',').map((x) => x.trim()).includes(sel));
  const v = rule?.[2].match(new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+)px`))?.[1];
  return v === undefined ? null : Number(v);
}

describe('окно ратуши: сетка всех построек в квадрат экрана', () => {
  /** Телефон стенда и снимков: 390 по ширине, поле шторки — 12 с каждой стороны (`.panel`). */
  const PHONE_W = 390;
  const FIELD = 12;

  it('плитка — действие не мельче 44; вся сетка не выше примерно квадрата ширины экрана', () => {
    const tile = px('.hall-tile', 'min-height');
    const gap = px('.hall-grid', 'gap');
    expect(tile, '.hall-tile { min-height }').not.toBeNull();
    expect(gap, '.hall-grid { gap }').not.toBeNull();
    expect(CSS).toMatch(/\.hall-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
    expect(tile!).toBeGreaterThanOrEqual(TAP_TARGET);
    const rows = Math.ceil(BUILDINGS.length / 3);
    const height = rows * tile! + (rows - 1) * gap!;
    const width = PHONE_W - 2 * FIELD;
    // «Примерно квадрат»: не выше ширины больше чем на четверть (24 постройки — 8 рядов по 52).
    expect(height, `сетка ${height} px при ширине ${width}`).toBeLessThanOrEqual(width * 1.25);
  });

  it('все постройки — плитками-кнопками, у каждой метка обучения; ленты карточек нет', async () => {
    const { HallBuild } = await import('./HallBuild');
    const s = town();
    stores.game = { s, act: () => undefined, sheet: null, openBuilding: () => undefined };
    const html = renderToStaticMarkup(h(HallBuild));
    expect(html.match(/<button type="button" class="hall-tile /g)?.length).toBe(s.buildings.length);
    for (const b of s.buildings) expect(html.match(new RegExp(`data-tut="list-${b.type}"`, 'g'))?.length, b.type).toBe(1);
    expect(html).not.toContain('build-row');
    // Метка «можно улучшить» — ровно у тех, что можно; срок — у первой стройки; группы — вкладками.
    expect(html.match(/aria-label="Можно улучшить"/g)?.length).toBe(readyCount(hallTiles(s)));
    expect(html).toContain('hall-bar');
    for (const g of HALL_GROUPS) expect(html).toContain(`>${g.label}</span>`);
    expect(html).toContain('aria-label="Порядок: Готовность"');
  });

  it('лист постройки: рабочие, выход с разбором и итогом, цена и «Улучшить», дверь «Открыть ›» с меткой обучения', async () => {
    const { HallCard } = await import('./HallBuild');
    const s = createInitialState(7);
    for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 5000;
    const farm = buildingOfType(s, 'farm')!;
    s.workers = { ...s.workers, [farm.id]: 4 };
    stores.game = { s, act: () => undefined, sheet: null, openBuilding: () => undefined };
    const html = renderToStaticMarkup(h(HallCard, { id: farm.id, onClose: () => undefined }));
    expect(html).toContain('class="nx-wrow"');
    expect(html).toContain('Выход в день');
    expect(html).toContain('Рабочие 4');
    expect(html).toContain('Итого');
    expect(html).toContain('class="cost"');
    expect(html).toContain('data-tut="upgrade-farm"');
    expect(html).toMatch(/data-tut="list-farm"[^>]*>.*Открыть ›/);
  });

  it('лист постройки с местами, но без запаса: рабочие — одним рядом, строки «Рабочих: N/M» под ним нет', async () => {
    const { HallCard } = await import('./HallBuild');
    const s = createInitialState(7);
    const shop = buildingOfType(s, 'workshop')!;
    // Область: у Мастерской места есть, а выработки ресурсов нет.
    expect(yieldsOf('workshop')).toEqual([]);
    stores.game = { s, act: () => undefined, sheet: null, openBuilding: () => undefined };
    const html = renderToStaticMarkup(h(HallCard, { id: shop.id, onClose: () => undefined }));
    expect(html).toContain('class="nx-wrow"');
    expect(html).not.toContain('Рабочих:');
    expect(html).not.toContain('Выход в день');
  });

  // Д5 (UI-8, docs/ui_v2.md, 5.7): ускорение — одной копией в окне постройки; лист ведёт туда дверью «Открыть ›». Прежде
  // здесь стояло «ход, ускорение и отмена» — ускорение было в трёх местах (ярлык у лесов, окно, лист).
  it('лист стройки: ход и отмена вместо цены; ускорения нет — оно в окне, за дверью «Открыть ›»', async () => {
    const { HallCard } = await import('./HallBuild');
    const s = town();
    const farm = buildingOfType(s, 'farm')!;
    stores.game = { s, act: () => undefined, sheet: null, openBuilding: () => undefined };
    const html = renderToStaticMarkup(h(HallCard, { id: farm.id, onClose: () => undefined }));
    expect(html).toContain(`Стройка до ур. ${farm.level + 1}`);
    expect(html).toContain('Отменить');
    expect(html).not.toContain('nx-rush');
    expect(html).toContain('Открыть ›');
    expect(html).not.toContain('data-tut="upgrade-farm"');
  });

  // Д4 (UI-8): ратуша в ратуше — лист постройки, чьё окно открыто под ним, «Улучшить» второй раз не рисует: кнопка — в
  // шапке окна. Область: окно ратуши открыто, ратушу можно улучшить (5000 каждого запаса).
  it('лист самой ратуши в её окне: «Улучшить» и цены нет — где их искать, сказано словами', async () => {
    const { HallCard } = await import('./HallBuild');
    const s = createInitialState(7);
    for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 5000;
    const hall = buildingOfType(s, 'town_hall')!;
    stores.game = { s, act: () => undefined, sheet: { kind: 'building', id: hall.id }, openBuilding: () => undefined };
    const here = renderToStaticMarkup(h(HallCard, { id: hall.id, onClose: () => undefined }));
    expect(here, 'в своём окне — без второй кнопки').not.toContain('data-tut="upgrade-town_hall"');
    expect(here).not.toContain('class="cost"');
    expect(here).toContain('в шапке этого окна');
    stores.game = { s, act: () => undefined, sheet: null, openBuilding: () => undefined };
    const away = renderToStaticMarkup(h(HallCard, { id: hall.id, onClose: () => undefined }));
    expect(away, 'точка внутри области: в другом окне кнопка есть').toContain('data-tut="upgrade-town_hall"');
  });

  it('лист открыт — метка обучения уходит с плитки на дверь: селектор шага находит одно место', async () => {
    const { HallTileView } = await import('./HallBuild');
    const s = town();
    const t = hallTiles(s).find((x) => x.b.type === 'barracks')!;
    expect(renderToStaticMarkup(h(HallTileView, { t, tut: true, onPick: () => undefined }))).toContain('data-tut="list-barracks"');
    expect(renderToStaticMarkup(h(HallTileView, { t, tut: false, onPick: () => undefined }))).not.toContain('data-tut');
  });

  // СТ-1 (docs/ui_v2.md, «Решения СТ-1»): очередь стройки. Область: две стройки — ферма строится (работа есть), Жилища ждут.
  it('очередь: номер места на плитке, полоса очереди со сроком первого, дела места — выше, ниже, отмена с возвратом', async () => {
    const { HallBuild, HallCard, QueueActs } = await import('./HallBuild');
    const { cancelRefund } = await import('@/game/labour');
    const { BUILDING_BY_ID } = await import('@/game/data/buildings');
    const s = town();
    const farm = buildingOfType(s, 'farm')!;
    const houses = buildingOfType(s, 'houses')!;
    farm.work = 1;
    expect(currentSite(s)?.id, 'точка внутри правила: ферма строится первой').toBe(farm.id);
    stores.game = { s, act: () => undefined, sheet: null, openBuilding: () => undefined, showToast: () => undefined };
    const html = renderToStaticMarkup(h(HallBuild));
    expect(html).toContain('hall-queue');
    expect(html.match(/class="hall-q"/g) ?? []).toHaveLength(2);
    expect(html).toContain('aria-label="1. ');
    expect(html).toContain('aria-label="2. ');
    expect(html).toContain('2-е в очереди');
    // Под полосой — дела ждущего: выше нельзя (строящееся начато), ниже нельзя (последнее), отмена вернёт всё.
    const acts = renderToStaticMarkup(h(QueueActs, { b: houses, onOpen: () => undefined }));
    expect(acts).toContain('Строящееся уже начато');
    expect(acts).toContain('Уже последнее.');
    expect(acts).toContain('вернёт всё');
    const back = cancelRefund(BUILDING_BY_ID.houses, houses.level + 1, false);
    for (const v of Object.values(back)) expect(acts).toContain(`+${v}`);
    expect(renderToStaticMarkup(h(QueueActs, { b: farm, onOpen: () => undefined }))).toContain('вернёт половину');
    expect(renderToStaticMarkup(h(HallCard, { id: houses.id, onClose: () => undefined }))).toContain('ждёт, 2-е в очереди');
  });
});
