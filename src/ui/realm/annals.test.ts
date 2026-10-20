// Летопись «Вестей» (ВС-2, docs/ui_v2.md, 5.8): строки одного последствия мира — одно событие с донесением; событие с
// донесением открывает его в «Вестях» касанием строки целиком, а донесение — ролик боя или осады; «Задания» ведут сюда.
//
// Области (правило 11): последствие мира с донесением (бой у ворот) и без него (договор), строки партии с родом (указ,
// стройка) и без; донесения каждого рода, у которого есть ролик: бой с журналом и осада с записью.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { simulateBattle } from '@/battle/sim';
import { deploySetup } from '@/battle/setup';
import { createInitialState } from '@/game/state';
import { setDecree, startUpgrade } from '@/game/sim/actions';
import { DECREES } from '@/game/data/policy';
import type { GameState } from '@/game/types';
import type { HomeEffect, Report } from '@/world/types';
import type { SiegeRecord } from '@/world/siegerecord';
import { applyEffects } from '@/world/bridge';
import { chronEvents, refTopic, reportOf, reportTopic } from './annals';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown>, world: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});
// Хранилище державы читается напрямую: на сервере зустанд отдаёт начальное состояние, а окно смотрит на текущее.
vi.mock('./open', async (orig) => {
  const real = await orig<{ useRealm: { getState: () => Record<string, unknown> } }>();
  return { ...real, useRealm: fake(real.useRealm, () => real.useRealm.getState()) };
});
vi.mock('@/world/store', async (orig) => {
  const real = await orig<{ useWorld: object }>();
  return { ...real, useWorld: fake(real.useWorld, () => stores.world), worldNow: () => 1_900_000_000_000 };
});

import { Mail } from './Mail';
import { chronRows } from './Chronicle';
import { ChronLink } from './ChronLink';
import { useRealm } from './open';

const result = simulateBattle({
  seed: 7,
  attacker: deploySetup({ spear: 10, infantry: 10, archer: 5, cavalry: 0 }),
  defender: deploySetup({ spear: 30, infantry: 30, archer: 10, cavalry: 0 }),
});

const report = (over: Partial<Report>): Report =>
  ({
    id: 'r',
    at: 0,
    kind: 'defense',
    title: 'Волки у ворот',
    target: { id: 'home', name: 'Каменец', x: 1, y: 1 },
    won: false,
    sent: {},
    lost: {},
    enemyPower: 60,
    enemyLost: 19,
    loot: null,
    intel: null,
    battle: { us: 'defender', result },
    text: 'Из леса вышла стая.',
    read: false,
    ...over,
  }) as Report;

/** Бой у ворот: строка события, павшие и раненые — одно последствие мира с ключом донесения. */
const GATE: HomeEffect = {
  id: 'gate-3-gate',
  lost: { warrior: 14 },
  lostTroops: { clubman: 14 },
  resources: {},
  prestige: 0,
  morale: -2,
  battle: 'lost',
  text: 'Из леса вышла стая и порвала заслон у ворот.',
  good: false,
};
/** Договор с соседом: последствие без донесения. */
const PACT: HomeEffect = { id: 'pact-t1-trade-500', lost: {}, resources: { food: 40 }, prestige: 0, morale: 0, battle: null, text: 'Караван соседа пришёл.', good: true };

function party(): GameState {
  const s = createInitialState(7);
  s.army.clubman = 30;
  s.log = [];
  setDecree(s, DECREES.find((d) => d.id !== s.decree)!.id);
  startUpgrade(s, s.buildings.find((b) => b.type === 'farm')!.id);
  applyEffects(s, [GATE, PACT]);
  return s;
}

describe('события летописи', () => {
  it('строки одного последствия мира — одно событие: голова — строка события, ниже потери; ключ — у всех строк', () => {
    const s = party();
    const gateLines = s.log.filter((e) => e.ref === GATE.id);
    // Область: последствие оставило больше одной строки (павшие), иначе сводить нечего.
    expect(gateLines.length, 'строк боя у ворот').toBeGreaterThan(1);
    const events = chronEvents(s.log, [report({ id: GATE.id })]);
    const gate = events.find((e) => e.head.ref === GATE.id)!;
    expect(gate.head.text).toBe(GATE.text);
    expect(gate.rest.map((e) => e.text)).toEqual(gateLines.slice(0, -1).reverse().map((e) => e.text));
    expect(events.filter((e) => e.head.ref === GATE.id || e.rest.some((x) => x.ref === GATE.id))).toHaveLength(1);
  });

  it('род: бой у ворот — набег (по донесению), договор — торговля (по ключу), указ и стройка — как записала партия', () => {
    const s = party();
    const events = chronEvents(s.log, [report({ id: GATE.id })]);
    const by = (pred: (t: string) => boolean) => events.find((e) => pred(e.head.text))!;
    expect(by((t) => t === GATE.text).topic).toBe('raid');
    expect(by((t) => t === GATE.text).report?.id).toBe(GATE.id);
    expect(by((t) => t === PACT.text).topic).toBe('trade');
    expect(by((t) => t === PACT.text).report).toBeNull();
    expect(by((t) => t.startsWith('Объявлен указ')).topic).toBe('decree');
    expect(by((t) => t.startsWith('Заложили стройку')).topic).toBe('build');
  });

  it('род донесения: осада по записи и ключу, набег — бой у своих стен, соседи — сделки и лазутчики, прочий бой — «Бои»', () => {
    expect(reportTopic(report({ id: 'atk5', kind: 'raid' }))).toBe('battle');
    expect(reportTopic(report({ id: 'atk5', kind: 'raid', siege: {} as SiegeRecord }))).toBe('siege');
    expect(reportTopic(report({ id: 'siege-home-9' }))).toBe('siege');
    expect(reportTopic(report({ id: 'war-w1-fall', kind: 'raid' }))).toBe('siege');
    expect(reportTopic(report({ id: 'm1-defense' }))).toBe('raid');
    expect(reportTopic(report({ id: 'spy-c1-steal-5', kind: 'scout' }))).toBe('rival');
    expect(refTopic('fig-scout-deed-c1-5')).toBe('rival');
    expect(refTopic('siege-phase-5')).toBe('siege');
    expect(refTopic('m1-home')).toBe('battle');
    expect(refTopic('fig-general-back-5')).toBe('town');
  });

  it('у каждой пары «донесение — последствие» одного дела мира донесение находится по ключу последствия (чтение LocalWorld)', () => {
    // Ключи пишет мир шаблонами: одна и та же переменная — одно значение. Минута, сид и отметка — числом, прочее — словом
    // (номер фигуры — `general`, клетки — `c1`), как в живых ключах; голая переменная — та же подстановка, что в шаблоне.
    const value = (expr: string): string => (/\b(at|now|seed|spent)\b/.test(expr) ? '17' : expr.replace(/[^a-z]/gi, '').toLowerCase() || 'x');
    const sample = (id: string): string =>
      id.startsWith('`') ? id.slice(1, -1).replace(/\$\{([^}]*)\}/g, (_, e: string) => value(e)) : value(id);
    const src = readFileSync(join(__dirname, '..', '..', 'world', 'local', 'LocalWorld.ts'), 'utf8').split('\n');
    const calls: { line: number; kind: 'report' | 'effect'; id: string }[] = [];
    src.forEach((l, i) => {
      const m = l.match(/this\.add(Report|Effect)\(/);
      if (!m) return;
      const id = src.slice(i, i + 4).join('\n').match(/id: (`[^`]*`|[\w.()]+)/)?.[1];
      if (id) calls.push({ line: i, kind: m[1] === 'Report' ? 'report' : 'effect', id: sample(id) });
    });
    // Пара — донесение и последствие одного дела: донесение пишется перед последствием, не дальше 35 строк; нет такого —
    // ближайшее после (приказ соседу: последствие, потом донесение `-r`).
    const reports = calls.filter((c) => c.kind === 'report');
    const pairs = calls
      .filter((c) => c.kind === 'effect')
      .map((e) => {
        const before = reports.filter((c) => c.line < e.line && e.line - c.line <= 35).pop();
        const after = reports.find((c) => c.line > e.line && c.line - e.line <= 35);
        const near = before ?? after;
        return near ? { effect: e.id, report: near.id } : null;
      })
      .filter((p): p is { effect: string; report: string } => p !== null);
    // Область: пар столько, сколько у мира дел с донесением и последствием (бой у ворот, вылазка, походы, осада, война).
    expect(pairs.length, 'пар донесение — последствие').toBeGreaterThanOrEqual(20);
    for (const p of pairs) expect(reportOf(p.effect, [report({ id: p.report })])?.id, `${p.effect} → ${p.report}`).toBe(p.report);
  });
});

describe('«Вести»: летопись, донесение, ролики', () => {
  const sieged = report({ id: 'siege-home-9', kind: 'defense', battle: null, siege: { phases: [] } as unknown as SiegeRecord, won: true });

  function setup(): GameState {
    const s = party();
    stores.game = { s, resolve: () => null, openMap: () => {}, act: () => {}, closeSheet: () => {} };
    stores.world = { letters: [], rivals: { proposals: [], marching: [] }, marches: [], info: null, reports: [report({ id: GATE.id }), sieged], loadReports: async () => {}, spotLetter: () => {} };
    return s;
  }

  it('вкладка «Летопись»: событие с донесением — строка-кнопка целиком; её касание открывает донесение в «Вестях»', () => {
    const s = setup();
    useRealm.setState({ mailTab: 'chron', report: null, mail: null });
    const html = renderToStaticMarkup(h(Mail));
    const rows = html.match(/<button type="button" class="kit-tgo"[\s\S]*?<\/button>/g) ?? [];
    expect(rows, 'строк-дверей: бой у ворот').toHaveLength(1);
    expect(rows[0]).toContain(GATE.text);
    expect(rows[0]).toContain('Поражение');
    // Касание строки — той, что в окне: строки дня собирает `chronRows`, их дверь и жмём.
    const events = chronEvents(s.log, stores.world.reports as Report[]);
    const opened: string[] = [];
    const doors = chronRows(events, (id) => opened.push(id)).filter((r) => r.go);
    expect(doors).toHaveLength(1);
    doors[0].go!();
    expect(opened).toEqual([GATE.id]);
  });

  it('открытое донесение боя — итог и «Смотреть бой», осады — «Смотреть осаду»; назад — «К летописи»', () => {
    setup();
    useRealm.getState().openChronicle(GATE.id);
    expect(useRealm.getState()).toMatchObject({ open: true, view: 'decisions', mailTab: 'chron', report: GATE.id });
    const battle = renderToStaticMarkup(h(Mail));
    expect(battle).toContain('Смотреть бой');
    expect(battle).toContain('К летописи');
    useRealm.getState().openChronicle(sieged.id);
    expect(renderToStaticMarkup(h(Mail))).toContain('Смотреть осаду');
    useRealm.getState().openChronicle(null);
    expect(renderToStaticMarkup(h(Mail))).not.toContain('Смотреть осаду');
  });

  it('ролики боя и осады — куски, которые донесение грузит по кнопке: они есть и отдают проигрыватель', async () => {
    const battle = await import('@/ui/battle/BattleReplay');
    const siege = await import('@/ui/battle/SiegeReplay');
    expect(typeof battle.BattleReplay).toBe('function');
    expect(typeof siege.SiegeReplay).toBe('function');
    const panel = readFileSync(join(__dirname, '..', 'panels', 'ReportPanel.tsx'), 'utf8');
    expect(panel).toContain("import('@/ui/battle/BattleReplay')");
    expect(panel).toContain("import('@/ui/battle/SiegeReplay')");
  });

  it('«Задания»: строка «Летопись» целиком — дверь в «Вести» на вкладку летописи', () => {
    useRealm.setState({ mailTab: 'all', report: 'x', open: false, view: 'quests' });
    const html = renderToStaticMarkup(h(ChronLink));
    expect(html).toMatch(/^<button type="button" class="kit-row go"[^>]*>[\s\S]*Летопись/);
    useRealm.getState().openChronicle(null);
    expect(useRealm.getState()).toMatchObject({ open: true, view: 'decisions', mailTab: 'chron', report: null });
    for (const f of ['RealmTabs.tsx', '../panels/QuestsPanel.tsx']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src, f).toContain('<ChronLink />');
      expect(src, f).not.toContain('<Chronicle');
    }
  });
});
