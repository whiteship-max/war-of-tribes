// РТ-1 (docs/city_v3.md, «Решения РТ-1»): «Здания» низа вместо «Ратуши» — всё прежнее окно стройки на новом месте; Ратуша —
// своё здание с советом: карточки должностей, просители, найм, черта и польза числом.
//
// Окна рисуются в строку (`renderToStaticMarkup`) с партией теста: стор игры подменён видом, как в `hall.test.ts`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdvisorPost, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { buildingOfType } from '@/game/derived';
import { startUpgrade } from '@/game/sim/actions';
import { ADVISOR_POSTS, advisorWage, candidateCount, giftOf } from '@/game/councilrules';
import { POST_GIFT, TRAIT_WORD } from '@/game/data/council';
import { bestCandidate, candidatesOf, councilOf, hireAdvisor, titleOf } from '@/game/sim/council';
import { TUTORIAL } from '@/game/data/tutorial';
import { HINTS } from '@/game/data/hints';
import { hallTiles } from './hall';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});
vi.mock('./Rush', async (orig) => {
  const real = await orig<object>();
  return { ...real, RushButton: () => h('span', { className: 'nx-rush' }) };
});

const SRC = join(__dirname, '..', '..');
/** Исходник без комментариев: объяснения не должны проходить за код. */
const code = (f: string): string =>
  readFileSync(join(SRC, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Город теста: вера названа, золото есть, ратуша седьмого уровня (ступень совета 3), стройка идёт и ещё одна ждёт. */
function town(hall = 7): GameState {
  const s = createInitialState(7);
  s.faith.id = 'catholic';
  s.gold = 50_000;
  for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 5000;
  buildingOfType(s, 'town_hall')!.level = hall;
  startUpgrade(s, buildingOfType(s, 'farm')!.id);
  startUpgrade(s, buildingOfType(s, 'houses')!.id);
  return s;
}

const view = (s: GameState, extra: Record<string, unknown> = {}): void => {
  stores.game = { s, act: () => true, sheet: null, openBuilding: () => undefined, closeSheet: () => undefined, townTab: 'council', setTownTab: () => undefined, showToast: () => undefined, ...extra };
};

describe('«Здания» низа: всё, что было в ратуше, — здесь', () => {
  it('низ: кнопка «Здания» с меткой обучения на месте «Ратуши» открывает раздел шторки', () => {
    const nav = code('ui/next/Nav.tsx');
    expect(nav).toContain('data-tut="nav-buildings"');
    expect(nav).toContain("openTab('buildings')");
    expect(nav).toMatch(/<Icon name="nav-buildings" \/>/);
    expect(nav).toMatch(/>\s*Здания\s*</);
    expect(nav).not.toContain('nav-townhall');
    // Обучение и подсказка «Улучши постройку» ведут туда же.
    expect(TUTORIAL.find((t) => t.id === 'open_town')!.target).toEqual({ kind: 'dom', sel: '[data-tut="nav-buildings"]' });
    const up = HINTS.find((x) => x.id === 'upgrade')!;
    expect(up.anchor).toBe('[data-tut="nav-buildings"]');
    expect(up.link.go).toBe('buildings');
    // Дверь «к источнику» «Здания» (`build`) открывает тот же раздел — и кнопки «Построить», и планы построек в покоях.
    expect(code('ui/kit/nav.ts')).toMatch(/case 'build': \{[\s\S]*?openTab\('buildings'\)/);
    expect(code('App.tsx')).toMatch(/case 'buildings':[\s\S]*?<BuildingsPanel \/>/);
  });

  it('окно «Здания»: все постройки плитками, очередь стройки, порядок, группы и скорость стройки', async () => {
    const { BuildingsPanel } = await import('./HallBuild');
    const s = town();
    view(s);
    const html = renderToStaticMarkup(h(BuildingsPanel));
    expect(html).toContain('>Здания</b>');
    expect(html.match(/<button type="button" class="hall-tile /g)?.length).toBe(s.buildings.length);
    for (const b of s.buildings) expect(html, b.type).toContain(`data-tut="list-${b.type}"`);
    expect(html).toContain('hall-queue');
    expect(html).toContain('Скорость стройки');
    expect(html).toContain('aria-label="Порядок: Готовность"');
    expect(html).toContain(`построек ${s.buildings.length}`);
    const ready = hallTiles(s).filter((t) => t.state === 'ready').length;
    expect(html).toContain(`можно улучшить ${ready}`);
  });

  it('окно ратуши — без сетки стройки: совет, «Сословия» и что ратуша даёт городу', async () => {
    const { BuildingPanel } = await import('@/ui/panels/BuildingPanel');
    const { HallCouncil } = await import('./HallCouncil');
    const { HallGives } = await import('./HallGives');
    const s = town();
    const hall = buildingOfType(s, 'town_hall')!;
    view(s, { sheet: { kind: 'building', id: hall.id } });
    const panel = renderToStaticMarkup(h(BuildingPanel, { id: hall.id }));
    expect(panel, 'сетки построек в ратуше нет').not.toContain('hall-tile');
    expect(code('ui/parts/TownHall.tsx')).not.toMatch(/TownBuild|HallBuild/);
    const council = renderToStaticMarkup(h(HallCouncil));
    expect(council).toContain('Советники');
    expect(council).toContain('Сословия');
    expect(council.match(/class="cn-card/g)?.length).toBe(ADVISOR_POSTS.length);
    const gives = renderToStaticMarkup(h(HallGives, { b: hall }));
    expect(gives).toContain('Ступень совета');
    expect(gives).toContain('3 из 3');
  });
});

describe('совет Ратуши в окне', () => {
  it('пустое место: должность, «Место пустует», «Назначить» со счётом просителей', async () => {
    const { HallCouncil } = await import('./HallCouncil');
    const s = town();
    view(s);
    const html = renderToStaticMarkup(h(HallCouncil));
    for (const p of ADVISOR_POSTS) expect(html).toContain(titleOf(s, p));
    expect(html.match(/Место пустует/g)?.length).toBe(3);
    expect(html.match(/>Назначить</g)?.length).toBe(3);
    expect(html).toContain(`просителей ${candidateCount(7)}`);
  });

  it('сидящий: имя, черта, польза числом той же формулой, очки, жалованье, «Сменить» и «Уволить»', async () => {
    const { HallCouncil, giftText } = await import('./HallCouncil');
    const s = town();
    for (const p of ADVISOR_POSTS) expect(hireAdvisor(s, p, bestCandidate(s, p)!.n)).toBeNull();
    view(s);
    const html = renderToStaticMarkup(h(HallCouncil));
    for (const p of ADVISOR_POSTS) {
      const a = councilOf(s).seats[p]!;
      expect(html, p).toContain(a.name);
      expect(html, p).toContain(TRAIT_WORD[a.trait].name);
      expect(html, p).toContain(giftText(p, giftOf(p, a.level, a.trait)));
      expect(html, p).toContain(POST_GIFT[p]);
      expect(html, p).toContain(`−${String(Number(advisorWage(a.level, a.trait).toFixed(1))).replace('.', ',')}`);
    }
    expect(html.match(/>Сменить</g)?.length).toBe(3);
    expect(html.match(/>Уволить</g)?.length).toBe(3);
    expect(html).not.toContain('Место пустует');
  });

  it('польза числом: доля — процентом, стойкость — очками', async () => {
    const { giftText } = await import('./HallCouncil');
    expect(giftText('steward', 0.1)).toBe('+10 %');
    expect(giftText('treasurer', 0.15)).toBe('+15 %');
    expect(giftText('marshal', 6)).toBe('+6');
  });

  it('просители: столько, сколько даёт ратуша, у каждого — «Назначить» с ценой или «без платы вперёд»', async () => {
    const mod = await import('./HallCouncil');
    const s = town();
    view(s);
    // Лист просителей открывается касанием; в строку рисуем сам ряд — `CandRow` не наружу, поэтому через `Candidates`-лист.
    const list = candidatesOf(s, 'marshal');
    expect(list.length).toBe(candidateCount(7));
    const html = renderToStaticMarkup(h(mod.CandidateList, { post: 'marshal' as AdvisorPost, onClose: () => undefined }));
    expect(html.match(/class="cn-cand"/g)?.length).toBe(list.length);
    for (const c of list) {
      expect(html).toContain(c.name);
      if (c.price > 0) expect(html).toContain(`${c.price}`);
    }
    expect(html.match(/>Назначить</g)?.length).toBe(list.length);
    if (list.some((c) => c.price === 0)) expect(html).toContain('без платы вперёд');
  });

  it('«Сословия» — раздел оставлен и закрыт', async () => {
    const { HallCouncil } = await import('./HallCouncil');
    const s = town();
    view(s, { townTab: 'estates' });
    const html = renderToStaticMarkup(h(HallCouncil));
    expect(html).toContain('Раздел откроется позже');
    expect(html).not.toContain('cn-card');
  });
});
