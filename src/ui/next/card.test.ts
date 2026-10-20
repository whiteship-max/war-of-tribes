// Карточка клетки и меню приказов (UI-7, docs/ui_v2.md, 5.6; Д15–Д17, О8, О9, Ч15): удар и осада с выбором участи —
// одним блоком карточки и для логова, и для города игрока (прежде — три копии: карточка, блок войны, меню приказов); меню
// полководца ведёт туда дверью; отношения и бунт — только в карточке; «Открыть город» в карточке нет (в город — «Город»
// низа карты); ячейка дороги — путь отряда полководца, а не разведчика; цена в энергии — со словом; тайные дела — с
// описанием строкой, а не в `title=`.
//
// Области (правило 11): логово, до которого полководец идёт (план «Дойти и ударить» есть, путь отряда длиннее пути
// разведчика); город игрока без своего похода (кнопки войны есть) и со своим походом (кнопок нет).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import { estimate } from '@/world/intel';
import { marchSeconds } from '@/world/geo';
import type { SettlementCard } from '@/world/types';
import { realLeft, waitLeft } from '@/ui/parts/wait';

const NOW = 1_900_000_000_000;

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown>, world: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});
vi.mock('@/world/store', async (orig) => {
  const real = await orig<{ useWorld: object }>();
  return { ...real, useWorld: fake(real.useWorld, () => stores.world), worldNow: () => 1_900_000_000_000, figuresOn: () => [] };
});
// Ворота края: в тесте все клетки — свой регион.
vi.mock('@/ui/map/twslot', async (orig) => ({ ...(await orig<object>()), reachable: () => true }));

import { WorldNew } from './WorldNew';

const UI = join(__dirname, '..');
const code = (rel: string): string =>
  readFileSync(join(UI, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const WALK_MS = 2 * 3_600_000 + 57 * 60_000;

function lair(over: Partial<SettlementCard> = {}): SettlementCard {
  return {
    id: 'l-1',
    x: 20,
    y: 20,
    name: 'Стоянка пришлых',
    stage: 'camp',
    relation: 'barbarian',
    owner: null,
    tribeId: null,
    tribeName: null,
    color: '#c33',
    mine: false,
    castle: false,
    visible: true,
    seenAt: NOW,
    stale: false,
    seenPop: null,
    marching: false,
    terrain: 'plain',
    distance: 9,
    terrainFactor: 1,
    power: estimate(400, 'rough'),
    pop: estimate(58, 'exact'),
    fates: [{ id: 'plunder', can: true, reason: null, led: { min: 0, max: 0 }, less: { min: 0, max: 0 } }],
    loot: estimate(300, 'rough'),
    intel: null,
    figuresHere: [],
    deals: [],
    diplomacy: null,
    revolt: null,
    can: { raid: false, scout: true, support: false, open: false, besiege: false },
    note: null,
    siege: null,
    ruinLeft: 0,
    sack: null,
    assault: { can: true, reason: null, walkMs: WALK_MS, men: 30, energy: { price: 20, block: null } },
    invest: { can: true, reason: null, walkMs: WALK_MS, men: 30, energy: { price: 10, block: null } },
    ...over,
  } as SettlementCard;
}

function html(card: SettlementCard): string {
  const s = createInitialState(7);
  stores.game = { s, showToast: () => {}, openSiege: () => {}, openCamp: () => {}, closeSheet: () => {} };
  stores.world = {
    card,
    cardTerrain: card.terrain,
    cardLoading: false,
    figures: [],
    marches: [],
    info: { home: { x: 10, y: 10 }, homeId: 'home' },
    send: async () => null,
    moveFigure: async () => null,
    shelter: async () => null,
    attack: async () => null,
    assault: async () => null,
    besiege: async () => null,
    negotiate: async () => null,
    openMenu: async () => {},
    warMarch: async () => null,
    recallFigure: async () => null,
    pact: async () => null,
    relief: async () => null,
    spyMenu: async () => null,
    spyRival: async () => null,
  };
  return renderToStaticMarkup(h(WorldNew, { x: card.x, y: card.y }));
}

describe('карточка: путь отряда, а не разведчика (О8); энергия со словом (Ч15)', () => {
  it('«Поход» — дорога полководца с отрядом; разведчик — в подсказке', () => {
    const card = lair();
    const scout = waitLeft(marchSeconds(card.distance, card.terrainFactor, { scout: 1 }));
    // Область: путь отряда не совпадает с путём разведчика.
    expect(realLeft(WALK_MS / 1000)).not.toBe(scout);
    const out = html(card);
    expect(out).toContain('<small>Поход</small>');
    expect(out).toContain(`<b class="">${realLeft(WALK_MS / 1000)}</b>`);
    expect(out).toContain('<small>энергии</small>');
  });
});

describe('удар и осада — одна копия (Д16), «Открыть город» нет (Д15)', () => {
  it('логово: «Дойти и ударить» и «Дойти и осадить» с одним выбором участи', () => {
    const out = html(lair());
    expect(out.match(/Дойти и ударить/g)?.length).toBe(1);
    expect(out.match(/Дойти и осадить/g)?.length).toBe(1);
    expect(out.match(/class="fate-pick"/g)?.length, 'выбор участи — один').toBe(1);
    expect(out).not.toContain('Открыть город');
  });

  it('город игрока без своего похода: кнопки войны — в блоке удара, выбор участи — один; со своим походом — кнопок нет', () => {
    const war = { can: true, reason: null, walkMs: WALK_MS, men: 30, power: 900, energy: { storm: { price: 20, block: null }, siege: { price: 10, block: null } } };
    const castle = lair({ castle: true, stage: 'castle' as SettlementCard['stage'], relation: 'neutral', assault: undefined, invest: undefined, war });
    const out = html(castle);
    expect(out.match(/Дойти и ударить/g)?.length, 'одна кнопка штурма').toBe(1);
    expect(out).toMatch(/Осадить · /);
    expect(out.match(/class="fate-pick"/g)?.length, 'выбор участи — один, у блока удара').toBe(1);
    const marching = html({ ...castle, war: { ...war, ours: { phase: 'march', mode: 'storm', arriveAt: NOW + WALK_MS } } });
    expect(marching).not.toContain('Дойти и ударить');
    expect(marching).toContain('Отозвать поход');
  });

  it('выбор участи и приказы удара — только в карточке: ни блока войны, ни меню приказов', () => {
    expect(code('next/WorldNew.tsx').match(/<FatePick\b/g)?.length).toBe(1);
    for (const f of ['next/WarCard.tsx', 'map/ActionMenu.tsx']) {
      const src = code(f);
      expect(src, `${f}: свой выбор участи`).not.toMatch(/<FatePick\b/);
      expect(src, `${f}: свой удар`).not.toMatch(/\b(attack|besiege|assault|warMarch)\(/);
    }
    // К-2: удар и осада — делом из меню полководца, участь — в окне войска тем же `FatePick`, что в карточке (одна
    // копия выбора — один компонент); у окна своих ударов нет, только дело. Прежняя карточка — ссылкой из меню.
    const send = code('map/ArmySend.tsx');
    expect(send.match(/<FatePick\b/g)?.length).toBe(1);
    expect(send, 'окно войска: свой удар').not.toMatch(/\b(attack|besiege|assault|warMarch)\(/);
    expect(code('map/ActionMenu.tsx')).toMatch(/name="Карточка места"[\s\S]{0,400}select\(menu\.cell\)/);
  });
});

describe('меню приказов: отношения и бунт — в карточке (Д17); затемнение закрывает', () => {
  it('меню не читает отношений и бунта места; карточка — читает', () => {
    const menu = code('map/ActionMenu.tsx');
    expect(menu).not.toMatch(/\.diplomacy|\.revolt/);
    const card = code('next/WorldNew.tsx');
    expect(card).toMatch(/card\.diplomacy/);
    expect(card).toMatch(/card\.revolt/);
  });

  it('касание затемнения вокруг меню закрывает его — обычным `click`', () => {
    const menu = code('map/ActionMenu.tsx');
    // Одна обёртка затемнения на все виды меню — дела, подтверждение, край региона (Р-4).
    expect(menu.match(/onClick=\{\(e\) => e\.target === e\.currentTarget && closeMenu\(\)\}/g)?.length).toBe(1);
    expect(menu.match(/<Wrap closeMenu=\{closeMenu\}>/g)?.length).toBe(4);
  });
});

describe('тайные дела — описание строкой (О9)', () => {
  it('описание дела — текстом, `title=` нет', () => {
    const src = code('next/SpyRival.tsx');
    expect(src).not.toMatch(/title=\{o\.description\}/);
    expect(src).toContain('{o.description}');
  });
});
