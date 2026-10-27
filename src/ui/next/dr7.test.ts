// ДР-7 в окнах (docs/city_v3.md, «Решения ДР-7»): режим марша — в окне дела (плитки трёх режимов, «Налегке» у осады погашено с
// причиной, убыль и вывоз по составу окна); Статуя — памятник: что даёт сейчас и на следующем уровне, без полководца; всё о
// полководце — в его карточке в Ратуше → «Агенты»; вещи — у правителя. Окна рисуются в строку (`renderToStaticMarkup`) с партией
// теста: сторы подменены видом, как в `ag1.test.ts`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { QUESTS } from '@/game/data/quests';
import { buildingOfType, payGraceDays } from '@/game/derived';
import { AGENT_ROLES } from '@/game/agentrules';
import { creditTech } from '@/game/sim/tech';
import { STATUE_TOP, statueCalm, statueMorale } from '@/game/statuerules';
import { num } from '@/game/num';
import { LIGHT_NO_CAMP, gaitTake } from '@/world/gait';
import type { GaitRow } from '@/world/types';
import { haulWords } from '@/ui/parts/GaitPick';

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
  return { ...real, useWorld: fake(real.useWorld, () => stores.world) };
});

const SRC = join(__dirname, '..', '..');
const code = (f: string): string =>
  readFileSync(join(SRC, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function town(statue = 3): GameState {
  const s = createInitialState(7);
  s.tutorialDone = true;
  s.completedQuests = QUESTS.map((q) => q.id);
  s.faith.id = 'catholic';
  for (const id of AGENT_ROLES) s.agents[id].vacant = false;
  creditTech(s);
  buildingOfType(s, 'statue')!.level = statue;
  return s;
}

const general = (free: boolean) => ({
  id: 'general',
  phase: free ? 'home' : 'moving',
  place: free ? 'city' : 'map',
  atHome: free,
  departAt: 0,
  arriveAt: 0,
  readyAt: 0,
  gone: null,
  troops: {},
  march: { gait: 'normal', haltUntil: 0, worn: 0, change: { free, price: free ? 0 : 10, haltMs: free ? 0 : 1000, block: {} } },
});

const view = (s: GameState, free = true): void => {
  stores.game = {
    s,
    act: () => true,
    sheet: null,
    mapOpen: false,
    showToast: () => undefined,
    openBuilding: () => undefined,
    openTownHall: () => undefined,
    openTab: () => undefined,
    closeMap: () => undefined,
  };
  stores.world = { figures: [general(free)], info: null, setGait: async () => null };
};

describe('ДР-7: Статуя — памятник: что даёт сейчас и на следующем уровне', () => {
  it('мораль, лад и терпение — числами дверей; ни отметок, ни риска, ни режима, ни карточки полководца; дверь в Ратушу', async () => {
    const { Statue } = await import('@/ui/parts/Statue');
    const s = town(3);
    view(s);
    const html = renderToStaticMarkup(h(Statue));
    expect(html).toContain('Что даёт Статуя');
    expect(html).toContain(`+${num(statueMorale(3), 1)}`);
    expect(html).toContain(`+${num(statueMorale(4), 1)}`);
    expect(html).toContain(`+${num(statueCalm(3), 2)}`);
    expect(html).toContain(`+${num(statueCalm(4), 2)}`);
    expect(html).toContain('«Дальше» — на ур. 4.');
    // Сведений полководца нет — только строка-дверь туда, где они теперь.
    for (const gone of ['Отметка прибавляет урон', 'Риск у ворот', 'gait-', 'Родословная', '<h3>Вещи', 'nx-acard', 'Дружина терпит']) {
      expect(html, gone).not.toContain(gone);
    }
    expect(html).toContain('В Ратушу');
    expect(payGraceDays(s), 'терпение — число Статуи').toBeGreaterThan(0);
    // На вершине — «вершина» вместо следующего.
    const top = town(STATUE_TOP);
    view(top);
    expect(renderToStaticMarkup(h(Statue))).toContain('Статуя на вершине.');
  });

  it('по исходнику: окно Статуи не зовёт карточку агента, строку места и вход в «Дружину»', () => {
    const statue = code('ui/parts/Statue.tsx');
    expect(statue).not.toMatch(/AgentCard|AgentPlaces|MusterLink|Lineage|GaitDesk/);
    const panel = code('ui/panels/BuildingPanel.tsx');
    expect(panel.slice(panel.indexOf("case 'statue':"), panel.indexOf("case 'watch':"))).not.toMatch(/AgentPlaces|AgentCard/);
  });
});

describe('ДР-7: всё о полководце — в Ратуше → «Агенты»', () => {
  it('в разделе у человека на месте — дверь в карточку; карточка — отметки, риск у ворот и в поле, где он и отряд, черты, родословная', async () => {
    const { HallAgents } = await import('./HallAgents');
    const { AgentCard } = await import('@/ui/parts/AgentCard');
    const s = town(1);
    s.agents.general.xp = 40;
    view(s);
    const hall = renderToStaticMarkup(h(HallAgents));
    expect(hall, 'дверь в карточку полководца').toContain('aria-label="Полководец: карточка"');
    const card = renderToStaticMarkup(h(AgentCard, { id: 'general', onBack: () => undefined }));
    for (const want of ['Отметка прибавляет урон', 'Риск у ворот', 'Полководец и дружина', 'Черты', 'Родословная', 'Режим марша']) {
      expect(card, want).toContain(want);
    }
    for (const gone of ['Вещи', 'Что даёт Статуя', 'Статуя даёт']) expect(card, gone).not.toContain(gone);
    // Дома режим выбирают в окне дела — в карточке только слово; в пути — окно отряда (плитки смены).
    expect(card).toContain('Дома его выбирают в окне дела');
    expect(card).not.toContain('gait-opts');
    view(s, false);
    expect(renderToStaticMarkup(h(AgentCard, { id: 'general', onBack: () => undefined }))).toContain('gait-opts');
  });

  it('по исходнику: карточка — в Ратуше поверх раздела «Агенты»; найм и смена — там же', () => {
    const hall = code('ui/next/HallAgents.tsx');
    expect(hall).toMatch(/<AgentCard id=\{role\} onBack=\{onClose\} \/>/);
  });
});

describe('ДР-7: режим марша в окне дела', () => {
  const rows = (walk: number, camp: boolean, haul = 1): GaitRow[] =>
    (['light', 'normal', 'train'] as const).map((g, i) => ({
      gait: g,
      walkMs: walk * [2 / 3, 1, 2][i],
      backMs: walk * [2 / 3, 1, 2][i],
      block: camp && g === 'light' ? LIGHT_NO_CAMP : null,
      siege: g === 'light' ? LIGHT_NO_CAMP : null,
      haul,
      energy: { price: 10, block: null },
    }));

  it('плитки трёх режимов: убыль и вывоз — по составу окна; у осады «Налегке» погашено с причиной', async () => {
    const { GaitPick } = await import('@/ui/parts/GaitPick');
    const walk = 40 * 3_600_000;
    const r = rows(walk, true);
    const html = renderToStaticMarkup(h(GaitPick, { rows: r, men: 3000, value: 'normal', free: true, onPick: () => undefined }));
    const light = gaitTake(3000, 'light', r[0].walkMs, 1);
    expect(light.lost, 'точка внутри области: налегке теряют').toBeGreaterThan(0);
    expect(html).toContain(`−${light.lost}`);
    for (const row of r) expect(html, row.gait).toContain(haulWords(gaitTake(3000, row.gait, row.walkMs, 1).carry));
    expect(html).toMatch(/aria-label="Налегке" disabled=""/);
    expect(html).toContain('Налегке лагерь не ставят');
    // Другой состав — другие числа: окно считает по тому, что выбрано, а не по отряду дома.
    const few = renderToStaticMarkup(h(GaitPick, { rows: r, men: 0, value: 'normal', free: true, onPick: () => undefined }));
    expect(few).not.toContain(haulWords(gaitTake(3000, 'normal', r[1].walkMs, 1).carry));
    // Удар: налегке не погашено; не дома — плитки только сравнить.
    const storm = renderToStaticMarkup(h(GaitPick, { rows: rows(walk, false), men: 30, value: 'normal', free: true, onPick: () => undefined }));
    expect(storm).not.toMatch(/aria-label="Налегке" disabled=""/);
    const away = renderToStaticMarkup(h(GaitPick, { rows: rows(walk, false), men: 30, value: 'normal', free: false, onPick: () => undefined }));
    expect(away).toMatch(/aria-label="Налегке" disabled=""/);
    expect(away).toContain('Не дома режим меняют в окне отряда');
  });

  it('по исходнику: окно дела — состав, потом режим по выбранному составу; карточка места режима не показывает', () => {
    const send = code('ui/map/ArmySend.tsx');
    expect(send).toMatch(/after: \(going\) =>\s*o\.gaits && <GaitPick rows=\{o\.gaits\} men=\{troopTotal\(going\)\}/);
    expect(send, 'режим уходит с делом одним приказом').toMatch(/\.\.\.\(free && row \? \{ gait \} : \{\}\)/);
    expect(code('ui/next/WorldNew.tsx'), 'карточка места — без таблицы режима').not.toMatch(/GaitPick/);
    // Срок на кнопках дел — по режиму окна.
    expect(code('ui/map/ActionMenu.tsx')).toMatch(/roadWords\(v\)/);
  });
});

describe('ДР-7: вещи — у правителя', () => {
  it('раздел правителя показывает его вещи и сундук; карточка агента вещей не знает', async () => {
    const { RulerTab } = await import('@/ui/realm/Ruler');
    const s = town(1);
    view(s);
    const html = renderToStaticMarkup(h(RulerTab));
    expect(html).toContain('<h3>Вещи</h3>');
    expect(html).toContain('Вещи надевают только на правителя');
    expect(html).toContain('сейчас он пуст');
    expect(code('ui/parts/AgentCard.tsx')).not.toMatch(/itemIn|regear|ownedItems|slots/);
  });
});
