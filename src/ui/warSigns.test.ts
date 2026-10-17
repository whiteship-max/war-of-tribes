// Тревоги войны значками (П-7, docs/polish.md): значок осады есть, пока город в осаде, ведёт в окно осады и пропадает,
// когда осаду сняли; срочное — пролом, условия, готовая машина — горит красным; больше трёх — счётчик; касание по
// порогу; на карте столбец под меню приказов.
//
// Области правил: «значок осады» — вид осады есть (`siege` не null); «срочное в осаде» — осада стоит, и каждая причина
// проверяется внутри своего окна (предложение — до `until`, машина — готова, пролом — больше нуля), рядом с точкой за
// окном; «столбец» — тревог больше нуля, «счётчик» — больше `SIGNS_MAX`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import { TAP_TARGET } from '@/gestures';
import type { CampView, SiegeView } from '@/world/types';
import type { RaidWords } from '@/ui/parts/raidWords';
import { hungerLeft } from '@/ui/parts/hunger';
import { campUrgency, fitSigns, siegeUrgency, SIGNS_MAX, warSigns, type WarSignDoors } from './warSigns';
import { WarSigns } from './next/WarSigns';

const NOW = 1_900_000_000_000;
const H = 3_600_000;
const ROOT = process.cwd();

// Строка без браузера читает сторы с их начального состояния: компонент читает здесь вид, который кладёт тест, теми же
// селекторами (`useGame`, `useWorld`), а часы — его минута (как `panels/siegepanels.test.ts`).
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

const siege = (over: Partial<SiegeView> = {}): SiegeView => ({
  byId: 'c-1',
  byName: 'Альфа',
  since: NOW - H,
  starvesAt: NOW + 10 * H,
  garrison: 20,
  foodAtStart: 500,
  campMen: 80,
  builders: 80,
  fate: 'plunder',
  fall: { goods: 100, gold: 0, hidden: 10, ledBonded: 0, ledPop: 0, scatterPop: 0, scatterBonded: 0, buildings: 0, levels: 1, burnsWorks: false, routed: 0 },
  palisade: 2,
  ...over,
});

const camp = (over: Partial<CampView> = {}): CampView => ({ ...siege(), targetId: 'c-2', targetName: 'Бета', ...over }) as unknown as CampView;

const raid = (id: string, from: string, inMs: number): RaidWords =>
  ({ win: { march: { id, fromName: from, arriveAt: NOW + inMs }, seconds: inMs / 1000 }, left: `${inMs / 60_000}:00`, long: '' }) as unknown as RaidWords;

function doors(): WarSignDoors & { calls: string[] } {
  const calls: string[] = [];
  return { calls, siege: () => calls.push('siege'), camp: () => calls.push('camp'), raid: (id) => calls.push(`raid:${id}`) };
}

/** Столбец целиком, как его нарисует город, с видом мира теста. */
function html(world: { siege?: SiegeView | null; camp?: CampView | null }, opts: { tutorial?: boolean; sheet?: boolean } = {}): string {
  const s = createInitialState();
  s.tutorialDone = !opts.tutorial;
  if (opts.tutorial) s.tutorialStep = 0;
  stores.game = { s, openSiege: () => {}, openCamp: () => {}, mapOpen: false, sheet: opts.sheet ? { kind: 'siege' } : null };
  stores.world = { siege: world.siege ?? null, camp: world.camp ?? null, marches: [], info: null };
  return renderToStaticMarkup(createElement(WarSigns, { where: 'city' }));
}

describe('значок осады', () => {
  it('есть при осаде: знак, «Осаждён» и часы голода той же дверью, что окно', () => {
    const out = html({ siege: siege() });
    expect(out).toContain('nx-sign siege');
    expect(out).toContain('Осаждён');
    expect(out).toContain(hungerLeft(NOW + 10 * H, NOW));
    // Без лишнего текста: ни кто у ворот, ни участь, ни «Что делать» на самом значке не написаны — только в имени кнопки.
    expect(out).not.toContain('>Альфа');
    expect(out).not.toContain('Что делать');
    expect(out).toMatch(/aria-label="Город в осаде: «Альфа» у ворот, до голода [^"]+объявлено: ограбить\./);
  });

  it('ведёт в окно осады — дверью игры, а не своим окном', () => {
    const d = doors();
    const [sign] = warSigns({ siege: siege(), camp: null, raids: [], now: NOW, go: d });
    expect(sign.kind).toBe('siege');
    sign.go();
    expect(d.calls).toEqual(['siege']);
    // Дверь у значка — та, что открывает окно осады в сторе: `openSiege` (вкладка «Осада» — первая и по умолчанию).
    const src = readFileSync(join(ROOT, 'src/ui/warSigns.ts'), 'utf8');
    expect(src).toMatch(/siege: openSiege/);
    expect(readFileSync(join(ROOT, 'src/ui/panels/SiegePanel.tsx'), 'utf8')).toMatch(/useState<View>\('siege'\)/);
  });

  it('пропадает, когда осаду сняли', () => {
    expect(html({ siege: siege() })).toContain('Осаждён');
    expect(html({ siege: null })).toBe('');
    expect(warSigns({ siege: null, camp: null, raids: [], now: NOW, go: doors() })).toEqual([]);
  });

  it('пока идёт обучение или открыто окно, столбца нет', () => {
    expect(html({ siege: siege() }, { tutorial: true })).toBe('');
    // Шторка полупрозрачна: значок под ней проступал бы сквозь строки окна.
    expect(html({ siege: siege() }, { sheet: true })).toBe('');
  });
});

describe('срочное в осаде — красным, без слов на значке', () => {
  it('спокойная осада не срочная', () => {
    expect(siegeUrgency(siege(), NOW)).toEqual([]);
    expect(html({ siege: siege() })).not.toContain('urgent');
  });

  it('пролом в стене', () => {
    const v = siege({ phases: { journal: [], next: '', nextAt: NOW + H, nextK: 2, breaches: 1, progress: 1 } });
    expect(siegeUrgency(v, NOW)).toEqual(['пролом в стене']);
    expect(siegeUrgency(siege({ phases: { journal: [], next: '', nextAt: NOW + H, nextK: 2, breaches: 0, progress: 0 } }), NOW)).toEqual([]);
    expect(html({ siege: v })).toContain('nx-sign siege urgent');
  });

  it('предложение условий — пока оно стоит', () => {
    const until = NOW + H;
    const v = siege({ parley: { side: 'def', share: 0.3, block: null, bot: true, incoming: { kind: 'terms', fate: 'captives', until } } });
    expect(until, 'точка внутри окна предложения').toBeGreaterThan(NOW);
    expect(siegeUrgency(v, NOW)).toEqual(['враг предлагает условия сдачи']);
    // За окном предложения — уже не срочно.
    expect(siegeUrgency(v, until + 1)).toEqual([]);
  });

  it('штурм скоро — у лагеря готова осадная машина', () => {
    const answers = (ready: boolean): SiegeView['answers'] => ({
      repair: { cost: {}, reason: null, doneAt: null },
      ration: { on: false, starvesAt: NOW + 12 * H },
      surrender: 'captives',
      burn: [{ machine: 'ram', name: 'Таран', ready, guard: 30 }],
      reliefs: [],
    });
    expect(siegeUrgency(siege({ answers: answers(true) }), NOW)).toEqual(['штурм скоро: готов таран']);
    expect(siegeUrgency(siege({ answers: answers(false) }), NOW)).toEqual([]);
  });

  it('в лагере под чужими стенами срочное — дань на столе и выручка на подходе', () => {
    expect(campUrgency(camp(), NOW)).toEqual([]);
    const at = NOW + H / 2;
    expect(at, 'точка до прихода выручки').toBeGreaterThan(NOW);
    expect(campUrgency(camp({ relief: { from: 'Соседи', men: 40, at, joint: false } }), NOW)).toEqual(['на лагерь идёт выручка: 40 бойцов']);
    expect(campUrgency(camp({ relief: { from: 'Соседи', men: 40, at, joint: false } }), at + 1)).toEqual([]);
    const tribute = camp({ parley: { side: 'atk', share: 0.2, block: null, bot: false, incoming: { kind: 'tribute', price: 150, until: NOW + H } } });
    expect(campUrgency(tribute, NOW)).toEqual(['город предлагает дань']);
  });
});

describe('столбец тревог войны', () => {
  it('набеги и свой лагерь — тем же приёмом; срочные первыми, дальше осада, набеги, лагерь', () => {
    const d = doors();
    const list = warSigns({ siege: siege(), camp: camp(), raids: [raid('m-1', 'Брод', 20 * 60_000), raid('m-2', 'Балка', 50 * 60_000)], now: NOW, go: d });
    // Осада спокойная, набег всегда срочный: набеги поднимаются над осадой, лагерь — последним.
    expect(list.map((s) => s.key)).toEqual(['raid-m-1', 'raid-m-2', 'siege', 'camp']);
    expect(list.map((s) => s.label)).toEqual(['Набег', 'Набег', 'Осаждён', 'Лагерь']);
    list[0].go();
    list[3].go();
    expect(d.calls).toEqual(['raid:m-1', 'camp']);
  });

  it('не больше трёх мест: четвёртая тревога и дальше — счётчиком', () => {
    const list = warSigns({ siege: siege(), camp: camp(), raids: [raid('m-1', 'Брод', 20 * 60_000), raid('m-2', 'Балка', 50 * 60_000)], now: NOW, go: doors() });
    expect(list.length, 'тревог больше мест столбца').toBeGreaterThan(SIGNS_MAX);
    const { shown, more } = fitSigns(list);
    expect(shown.length + (more.length > 0 ? 1 : 0)).toBe(SIGNS_MAX);
    expect([...shown, ...more]).toEqual(list);
    // Влезают все — счётчика нет.
    const three = list.slice(0, SIGNS_MAX);
    expect(fitSigns(three)).toEqual({ shown: three, more: [] });
  });

  it('значок — цель касания не меньше порога действия; столбец не шире значка', () => {
    const css = readFileSync(join(ROOT, 'src/ui/next/next.css'), 'utf8');
    const rule = /\n\.nx-sign \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const size = (k: string): number => Number(new RegExp(`\\n\\s*${k}: (\\d+)px;`).exec(rule)?.[1] ?? 0);
    expect(size('width')).toBeGreaterThanOrEqual(TAP_TARGET);
    expect(size('height')).toBeGreaterThanOrEqual(TAP_TARGET);
    // Квадрат: значок, а не плашка.
    expect(size('width')).toBe(size('height'));
    // Пульс — мягкий и уважает «меньше движения».
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^}]*\.nx-sign\.urgent/);
  });

  it('на карте столбец стоит в её слое раньше меню приказов и листов — они ложатся поверх', () => {
    const map = readFileSync(join(ROOT, 'src/ui/map/WorldMap.tsx'), 'utf8');
    const at = map.indexOf('<WarSigns where="map"');
    expect(at).toBeGreaterThan(0);
    for (const later of ['<ActionMenu />', '<Rating ', '<Feed ', '<Legend ']) expect(map.indexOf(later), later).toBeGreaterThan(at);
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    expect(app).toContain('<WarSigns where="city" />');
    expect(app).not.toContain('SiegeBanner');
    // Набег не стоит дважды: в ряду под верхом его нет, он — значок войны.
    expect(readFileSync(join(ROOT, 'src/ui/next/Alerts.tsx'), 'utf8')).toMatch(/filter\(\(a\) => !a\.war\)/);
  });
});
