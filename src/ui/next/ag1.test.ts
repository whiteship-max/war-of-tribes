// АГ-1 (docs/city_v3.md, «Решения АГ-1»): раздел «Агенты» Ратуши — карточки мест с портретом, характеристиками числами и
// чертами, лист кандидатов со сравнением с нынешним, «Нанять», «Сменить», «Уволить» с ценой и причиной погашения; здания ведут
// в Ратушу; весть о пустом месте — дверью туда; раздел — своим куском.
//
// Окна рисуются в строку (`renderToStaticMarkup`) с партией теста: стор игры и мир подменены видом, как в `rt1.test.ts`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { QUESTS } from '@/game/data/quests';
import { buildingOfType, hallLevel } from '@/game/derived';
import { AGENT_ROLES } from '@/game/agentrules';
import { candidateCount } from '@/game/councilrules';
import { creditTech } from '@/game/sim/tech';
import { bestRecruit, hireRecruit, recruitsOf } from '@/game/sim/recruits';
import { agentVacancyEvent } from '@/game/sim/recruit';
import { personName } from '@/game/sim/agents';
import { eventDispatch } from '@/ui/realm/dispatch';
import { raiseEvent } from '@/game/sim/mail';

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
/** Исходник без комментариев: объяснения не должны проходить за код. */
const code = (f: string): string =>
  readFileSync(join(SRC, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Сыгранный город теста: вера названа, места открыты, золото есть, ратуша `hall`. */
function town(hall = 7): GameState {
  const s = createInitialState(7);
  s.tutorialDone = true;
  s.completedQuests = QUESTS.map((q) => q.id);
  s.faith.id = 'catholic';
  s.gold = 500_000;
  for (const id of AGENT_ROLES) s.agents[id].vacant = false;
  creditTech(s);
  buildingOfType(s, 'town_hall')!.level = hall;
  return s;
}

/** Где стоят фигуры: все дома — или одна в поле. */
const figures = (field: string | null = null) =>
  AGENT_ROLES.map((id) => ({ id, phase: id === field ? 'field' : 'home', place: id === field ? 'map' : 'city', departAt: 0, gone: null }));

const view = (s: GameState, field: string | null = null): void => {
  stores.game = { s, act: () => true, sheet: null, openBuilding: () => undefined, openTownHall: () => undefined, townTab: 'agents', setTownTab: () => undefined };
  stores.world = { figures: figures(field), info: null };
};

describe('раздел «Агенты» в Ратуше', () => {
  it('вкладка рядом с «Советниками» и «Сословиями», своим значком, раздел — своим куском', () => {
    const council = code('ui/next/HallCouncil.tsx');
    expect(council).toMatch(/\{ id: 'agents', label: 'Агенты', icon: 'hall-agents' \}/);
    expect(council).toMatch(/lazy\(\(\) => import\('\.\/HallAgents'\)/);
    // Лист кандидатов и найм едут докачкой: статически их зовёт только окно раздела (и отчёт времени, и тесты).
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ) files.push(p);
      }
    };
    walk(SRC);
    const users = files.filter((f) => /from '[^']*sim\/recruits'/.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f).split(sep).join('/'));
    expect(users).toEqual(['ui/next/HallAgents.tsx']);
  });

  it('карточки мест: портрет, имя, кружки уровня, характеристики числами; свои люди — без жалованья; «Сменить» и «Уволить»', async () => {
    const { HallAgents } = await import('./HallAgents');
    const s = town();
    view(s);
    const html = renderToStaticMarkup(h(HallAgents));
    for (const id of AGENT_ROLES) expect(html, id).toContain(personName(s, id));
    expect(html).toContain('●○○○○');
    expect((html.match(/class="ag-stat"/g) ?? []).length, 'отметки — четыре, зоркость, скрытность и диверсия, красноречие').toBe(4 + 1 + 2 + 1);
    expect(html).toContain('без жалованья');
    expect((html.match(/>Сменить</g) ?? []).length).toBe(4);
    expect((html.match(/>Уволить</g) ?? []).length).toBe(4);
  });

  it('человек в поле: «Сменить» и «Уволить» погашены словами — менять дома', async () => {
    const { HallAgents } = await import('./HallAgents');
    const s = town();
    view(s, 'spy');
    const html = renderToStaticMarkup(h(HallAgents));
    expect((html.match(/В поле — менять дома\./g) ?? []).length, 'обе кнопки лазутчика').toBe(2);
  });

  it('пустое место: «Место пустует», «Нанять» со счётом кандидатов; нанятый — с чертами и жалованьем', async () => {
    const { HallAgents } = await import('./HallAgents');
    const s = town();
    s.agents.scout.vacant = true;
    view(s);
    let html = renderToStaticMarkup(h(HallAgents));
    expect(html).toContain('Место пустует');
    expect(html).toContain(`кандидатов ${candidateCount(hallLevel(s))}`);
    const c = bestRecruit(s, 'scout')!;
    expect(hireRecruit(s, 'scout', c.n, null)).toBeNull();
    view(s);
    html = renderToStaticMarkup(h(HallAgents));
    expect(html).toContain(c.name);
    expect(html).toContain('cn-trait');
    if (c.wage > 0) expect(html).toContain('ag-wage neg');
  });

  it('лист кандидатов: имя, возраст, черты, характеристики с разницей против нынешнего, цена и «Сменить»', async () => {
    const { RecruitList } = await import('./HallAgents');
    const s = town(10);
    view(s);
    const html = renderToStaticMarkup(h(RecruitList, { role: 'spy', onClose: () => undefined }));
    const list = recruitsOf(s, 'spy');
    expect(list.length, 'точка внутри области: кандидаты есть').toBeGreaterThan(0);
    for (const c of list) expect(html).toContain(c.name);
    expect(html).toContain('Нанятый займёт его место');
    expect((html.match(/>Сменить</g) ?? []).length).toBe(list.length);
    // Кандидат с врождённой скрытностью — на кружок выше нынешнего лазутчика первого уровня: разница зелёным.
    if (list.some((c) => (c.head.stealth ?? 0) > 0 || (c.head.sabotage ?? 0) > 0)) expect(html).toMatch(/class="pos">\+\d/);
  });
});

describe('здания и весть ведут в Ратушу', () => {
  it('Дозор, храм и Статуя: найма в здании нет — кнопка «Нанять в Ратуше» открывает раздел «Агенты»', () => {
    const places = code('ui/parts/AgentPlaces.tsx');
    expect(places).toContain("openHall('agents')");
    expect(places).toContain('Нанять в Ратуше');
    expect(places).not.toMatch(/hireAgent|hireInfo|hireRecruit/);
    expect(code('ui/alertItems.ts')).toContain("openHall('agents')");
  });

  it('весть о пустом месте агента — дверью «Ратуша» на раздел «Агенты»', () => {
    const s = town();
    expect(raiseEvent(s, agentVacancyEvent('spy'))).toBe(true);
    const ev = s.inbox.find((e) => e.defId === agentVacancyEvent('spy'))!;
    expect(eventDispatch(s, ev, 0)?.agents).toBe(true);
    expect(code('ui/realm/Mail.tsx')).toContain("setTownTab('agents')");
  });
});
