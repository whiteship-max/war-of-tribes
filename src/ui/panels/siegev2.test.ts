// Окна осады, вылазки, переговоров и лагеря по общим правилам (UI-7, docs/ui_v2.md, 5.6; П4, К5, О6, О7): вкладками, а не
// столбцом на два с лишним экрана; строки — таблицами набора; наказы — переключателями 44 вместо родных флажков и списка;
// «из 3» проломов — из `BREACH_MAX`; сдача и «Отступить» — двумя касаниями одной кнопки; вылазка — общий ряд шага; окна — в
// куске нового вида; донесение не обещает журнала, которого нет.
//
// Области (правило 11): осада с ответами, переговорами (предложение ждёт ответа) и ходом фаз; лагерь под логовом (доли леса
// выбирают) с машинами и стеной.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import { estimate } from '@/world/intel';
import { BREACH_MAX } from '@/world/data/siegeroll';
import { WOOD_SHARES, playerWood, worksRipeAt } from '@/world/works';
import { realMinutes } from '@/ui/parts/wait';
import type { CampView, SiegeView } from '@/world/types';

const NOW = 1_900_000_000_000;
const H = 3_600_000;

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
  return { ...real, useWorld: fake(real.useWorld, () => stores.world), worldNow: () => 1_900_000_000_000 };
});

import { SiegePanel } from './SiegePanel';
import { CampPanel, ripeWords } from './CampPanel';
import { SiegeAnswers } from '@/ui/parts/SiegeAnswers';

const UI = join(__dirname, '..');
const code = (rel: string): string =>
  readFileSync(join(UI, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const siege = (over: Partial<SiegeView> = {}): SiegeView => ({
  byId: 'l-1',
  byName: 'Волчья падь',
  since: NOW - 5 * H,
  starvesAt: NOW + 14 * H,
  garrison: 50,
  foodAtStart: 900,
  campMen: 120,
  builders: 120,
  fate: 'plunder',
  palisade: 2,
  fall: { goods: 640, gold: 80, hidden: 60, ledBonded: 0, ledPop: 0, scatterPop: 0, scatterBonded: 0, buildings: 3, levels: 1, burnsWorks: false, routed: 0 },
  phases: { journal: ['Фаза 1: кость 5 — стена держит.'], next: '+1 пролом', nextAt: NOW + H, nextK: 2, breaches: 1, progress: 1 },
  answers: {
    repair: { cost: { wood: 80, stone: 40 }, reason: null, doneAt: null },
    ration: { on: false, starvesAt: NOW + 20 * H },
    surrender: 'captives',
    burn: [{ machine: 'ram', name: 'Таран', ready: true, guard: 40 }],
    reliefs: [],
    defend: { repair: true },
  },
  parley: { side: 'def', share: 0.32, fair: 210, block: null, bot: false, incoming: { kind: 'terms', fate: 'captives', until: NOW + H } },
  ...over,
});

function siegeHtml(view: SiegeView): string {
  const s = createInitialState(7);
  s.army.clubman = 20;
  stores.game = { s, openSortie: () => {}, showToast: () => {}, openBuilding: () => {} };
  stores.world = { siege: view, marches: [], figures: [], info: null, strikePlan: async () => null, strikeCamp: async () => null, defend: async () => null, parley: async () => null, setOrders: async () => null };
  return renderToStaticMarkup(h(SiegePanel));
}

const camp = (over: Partial<CampView> = {}): CampView =>
  ({
    byId: 'home',
    byName: 'Наша дружина',
    since: NOW - 6 * H,
    starvesAt: NOW + 11 * H,
    foodAtStart: 700,
    campMen: 90,
    builders: 90,
    fate: 'plunder',
    targetId: 'l-2',
    targetName: 'Чёрный яр',
    castle: false,
    lair: true,
    stage: 'stronghold',
    garrison: estimate(60, 'rough'),
    power: estimate(5000, 'rough'),
    fates: [{ id: 'plunder', can: true, reason: null, led: { min: 0, max: 0 }, less: { min: 0, max: 0 } }],
    men: 90,
    storm: { price: 30, block: null },
    machines: { share: 0.25, walls: true, breaches: 1, list: [], methods: [{ machine: 'ladders', words: 'Лестницы — треть стены без пролома' }] },
    ...over,
  }) as CampView;

function campHtml(view: CampView): string {
  stores.game = { showToast: () => {}, closeSheet: () => {} };
  stores.world = { camp: view, loadCamp: async () => {}, besiege: async () => null, attack: async () => null, retreat: async () => null, setWood: async () => null, campCraft: async () => null };
  return renderToStaticMarkup(h(CampPanel));
}

describe('окно осады — вкладками (П4)', () => {
  it('«Осада · Ответы · Условия · Ход» (переговоры у стен — вкладкой «Условия»); предложение, ждущее ответа, — счётчиком; на первой — участь, таблицы и вылазка', () => {
    const out = siegeHtml(siege());
    const tabs = [...out.matchAll(/role="tab"[^>]*>(?:<[^>]+>)*([^<]+)<\/span>(?:<em class="kit-badge">(\d+)<\/em>)?/g)].map((m) => [m[1], m[2] ?? '0']);
    expect(tabs).toEqual([
      ['Осада', '0'],
      ['Ответы', '0'],
      ['Условия', '1'],
      ['Ход', '0'],
    ]);
    expect(out).toContain('Объявлено: ограбить');
    expect(out).toMatch(/aria-label="Хлеб и оборона"/);
    expect(out).toMatch(/aria-label="Лагерь у ворот"/);
    expect(out).toContain('Вылазка');
    expect(out).not.toMatch(/class="mod/);
    // Без ответов, переговоров и фаз вкладок нет — одно окно.
    const bare = siegeHtml(siege({ answers: undefined, parley: undefined, phases: undefined }));
    expect(bare).not.toContain('role="tablist"');
  });
});

describe('наказы — переключателями 44, проломы — из `BREACH_MAX`, необратимое — двумя касаниями (К5, О6)', () => {
  it('ответы: два переключателя по наказам игрока, сдача — кнопкой набора без своей пары «Точно?»', () => {
    stores.game = { s: createInitialState(7), showToast: () => {}, openSortie: () => {} };
    stores.world = { defend: async () => null };
    const out = renderToStaticMarkup(h(SiegeAnswers, { siege: siege(), now: NOW }));
    const toggles = [...out.matchAll(/class="kit-toggle( on)?" aria-pressed="(true|false)"/g)].map((m) => m[2]);
    expect(toggles).toEqual(['true', 'false']);
    expect(out).toContain(`из ${BREACH_MAX}`);
    expect(out).toContain('Сдать город');
    expect(code('parts/SiegeAnswers.tsx')).not.toMatch(/setSure|Держаться/);
  });

  it('ни родных флажков, ни выпадающих списков, ни «из 3» рукой в окнах осады и лагеря', () => {
    for (const f of ['parts/SiegeAnswers.tsx', 'parts/SiegeParley.tsx', 'parts/SiegePhases.tsx', 'panels/CampPanel.tsx', 'panels/SiegePanel.tsx']) {
      const src = code(f);
      expect(src, `${f}: флажок`).not.toMatch(/type="checkbox"/);
      expect(src, `${f}: список`).not.toMatch(/<select\b/);
      expect(src, `${f}: «из 3» рукой`).not.toMatch(/из 3\b/);
      expect(src, `${f}: кнопка .mini`).not.toMatch(/className=\{?[`"]mini/);
    }
  });

  it('«Отступить» и «Открыть ворота» — двумя касаниями одной кнопки (`kit/twotap`)', () => {
    expect(code('panels/CampPanel.tsx')).toMatch(/<Btn wide confirm onClick=\{\(\) => void order\(retreat/);
    expect(code('parts/SiegeParley.tsx')).toMatch(/confirm=\{inc\.kind === 'terms'\}/);
  });
});

describe('окно лагеря — вкладками, доли леса — таблицей выбора', () => {
  it('«Лагерь · Машины · Ход · Штурм» по тому, что прислал мир; доли леса — пять строк выбора, выбрана нынешняя', () => {
    const out = campHtml(camp({ wood: playerWood(0.5, 0.25) }));
    expect(out).toContain('>Лагерь<');
    expect(out).toContain('>Машины<');
    expect(out).toContain('>Штурм<');
    const picks = [...out.matchAll(/class="kit-cells pick"[^>]*aria-pressed="(true|false)"/g)].map((m) => m[1]);
    expect(picks).toHaveLength(WOOD_SHARES.length);
    expect(picks[WOOD_SHARES.indexOf(0.5)]).toBe('true');
  });

  it('сроки долей — функцией сторон (`worksRipeAt`) при нынешней доле машинам; чем меньше леса стороне, тем позже', () => {
    for (const sh of WOOD_SHARES) {
      const r = ripeWords(sh, 0.25);
      for (const side of ['front', 'rear'] as const) {
        const at = worksRipeAt(0, side, playerWood(sh, 0.25));
        expect(r[side], `${sh}: ${side}`).toBe(Number.isFinite(at) ? realMinutes(at) : '—');
      }
    }
    // Область: доли меняют срок — «всё в тыл» дозревает к городу позже, чем «всё к городу» (доля тыла переходит туда,
    // когда тыл дозрел), и строки таблицы различаются.
    expect(worksRipeAt(0, 'front', playerWood(0, 0))).toBeGreaterThan(worksRipeAt(0, 'front', playerWood(1, 0)));
    expect(ripeWords(0, 0).front).not.toBe(ripeWords(1, 0).front);
  });
});

describe('вылазка, первая загрузка, донесение', () => {
  it('вылазка — общий ряд шага (`parts/Steps`), своей копии нет', () => {
    const src = code('panels/SortiePanel.tsx');
    expect(src).toMatch(/import \{ Steps \} from '@\/ui\/parts\/Steps'/);
    expect(src).not.toMatch(/function Steps\(/);
  });

  it('окна осады, вылазки и лагеря — в куске нового вида: `App` берёт их через `lazy`', () => {
    const app = readFileSync(join(UI, '..', 'App.tsx'), 'utf8');
    for (const name of ['SiegePanel', 'SortiePanel', 'CampPanel']) {
      expect(app, name).toMatch(new RegExp(`const ${name} = lazy\\(`));
      expect(app, name).not.toMatch(new RegExp(`import \\{ ${name} \\}`));
    }
  });

  it('донесение: при несопоставимых силах журнал есть — строка «Журнал ниже» не обманывает (О7)', () => {
    const src = code('panels/ReportPanel.tsx');
    expect(src).toContain('Журнал ниже');
    expect(src).toMatch(/\(watch \|\| lopsided\) && \(/);
  });
});
