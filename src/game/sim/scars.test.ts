// Журнал боёв армии (ДР-4, docs/siege_v2.md, «Решения ДР-4», Ш4, Ш8, Ш9): одна дверь `sim/scars` — метка в журнал с полководцем,
// летопись только на перемену набора черт, смена полководца снимает «Страх обстрела» строкой сразу, старая партия без черт,
// мост и опись.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { deserialize, serialize } from '../save';
import { NO_GENERAL, SCAR_LOG, type FightMark } from '../scarrules';
import { generalNow, mergeScars, noteFight, scarIds, scarsNow, scarsStep, scarsWatch, warScarsNow } from './scars';
import { release, seat } from './agents';
import { applyEffects, playerProfile } from '@/world/bridge';

const party = (): GameState => createInitialState();
const lines = (s: GameState, from = 0): string[] => s.log.slice(0, s.log.length - from).map((e) => e.text);
const woodsWin: FightMark = { out: 'win', woods: true };

describe('метка — в журнал', () => {
  it('своя метка — с полководцем на месте; у метки войны полководец — сервера', () => {
    const s = party();
    const gen = generalNow(s);
    expect(gen).toBeGreaterThanOrEqual(0);
    noteFight(s, woodsWin);
    noteFight(s, { out: 'loss', war: { id: 'w.0', at: 5 } });
    noteFight(s, { out: 'loss', gen: 9, war: { id: 'w.1', at: 6 } });
    expect(s.scars!.log.map((m) => m.gen)).toEqual([gen, undefined, 9]);
  });
  it(`журнал держит ${SCAR_LOG} последних боёв`, () => {
    const s = party();
    for (let i = 0; i < SCAR_LOG + 5; i++) noteFight(s, { out: i % 2 ? 'win' : 'loss' });
    expect(s.scars!.log.length).toBe(SCAR_LOG);
  });
  it('метка из последствия мира идёт в журнал той же минутой, что бой', () => {
    const s = party();
    applyEffects(s, [{ id: 'e1', lost: {}, resources: {}, prestige: 0, morale: 0, battle: 'won', scar: woodsWin, text: '', good: true }]);
    applyEffects(s, [{ id: 'e2', lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, text: '', good: true }]);
    expect(s.scars!.log.length).toBe(1);
  });
});

describe('летопись — одна строка на перемену', () => {
  it('пришла — строка; подтверждена ещё одной победой — ни строки; ушла — строка', () => {
    const s = party();
    const before = s.log.length;
    for (let i = 0; i < 3; i++) noteFight(s, woodsWin);
    const got = lines(s, before);
    expect(got.length).toBe(1);
    expect(got[0]).toContain('«Лесные призраки»');
    noteFight(s, woodsWin);
    expect(lines(s, before).length, 'без повторов').toBe(1);
    noteFight(s, { out: 'loss', woods: true });
    const lost = lines(s, before);
    expect(lost.length).toBe(2);
    expect(lost[0]).toMatch(/утратила славу «Лесные призраки»: поражение в лесу/);
    expect(scarsNow(s)).toEqual([]);
  });
  it('вытесненная четвёртой — своей строкой «забыла»', () => {
    const s = party();
    for (let i = 0; i < 2; i++) noteFight(s, { out: 'win', river: true });
    for (let i = 0; i < 2; i++) noteFight(s, { out: 'win', night: true });
    for (let i = 0; i < 3; i++) noteFight(s, { out: 'win', hills: true });
    const before = s.log.length;
    for (let i = 0; i < 3; i++) noteFight(s, woodsWin);
    const got = lines(s, before);
    expect(got.some((t) => t.includes('забыла «Бродники»'))).toBe(true);
    expect(got.some((t) => t.includes('прослыла «Лесные призраки»'))).toBe(true);
    expect(scarIds(s)).toEqual(['nightwolves', 'highland', 'ghosts']);
  });
});

describe('новый полководец снимает «Страх обстрела»', () => {
  it('шаг племени — строкой сразу, а не со следующим боем; тот же полководец — ничего', () => {
    const s = party();
    noteFight(s, { out: 'loss', arrows: 0.3 });
    expect(scarIds(s)).toEqual(['arrowfear']);
    const before = s.log.length;
    scarsStep(s);
    expect(s.log.length, 'полководец тот же').toBe(before);
    seat(s, 'general', s.time, 30, 'Новый');
    expect(scarIds(s), 'черт уже нет').toEqual([]);
    scarsStep(s);
    expect(lines(s, before)).toEqual([expect.stringMatching(/избыла «Страх обстрела»: новый полководец/)]);
    scarsStep(s);
    expect(s.log.length - before, 'строка одна').toBe(1);
  });
  it('место опустело — тоже другой полководец', () => {
    const s = party();
    noteFight(s, { out: 'loss', arrows: 0.3 });
    release(s, 'general');
    expect(generalNow(s)).toBe(NO_GENERAL);
    expect(scarIds(s)).toEqual([]);
  });
});

describe('старые сохранения и чтение', () => {
  it('партия до ДР-4 — без журнала и без черт; запись и чтение журнал сохраняют', () => {
    const s = party();
    expect(s.scars).toBeUndefined();
    expect(scarsNow(s)).toEqual([]);
    const raw = JSON.parse(serialize(s));
    delete raw.scars;
    expect(deserialize(JSON.stringify(raw))!.scars).toBeUndefined();
    for (let i = 0; i < 3; i++) noteFight(s, woodsWin);
    const back = deserialize(serialize(s))!;
    expect(back.scars).toEqual(s.scars);
    expect(scarIds(back)).toEqual(['ghosts']);
  });
  it('мусор — нет поля; чужие поля метки отбрасываются', () => {
    expect(mergeScars(undefined)).toBeUndefined();
    expect(mergeScars({ log: 'x' })).toBeUndefined();
    expect(mergeScars({ log: [{ out: 'nope' }] })).toBeUndefined();
    expect(mergeScars({ log: [{ out: 'win', woods: true, evil: 1 }], gen: 2 })).toEqual({ log: [{ out: 'win', woods: true }], gen: 2 });
  });
});

describe('мост и опись', () => {
  it('в мир едут имена черт; черт нет — поля нет', () => {
    const s = party();
    expect(playerProfile(s).scars).toBeUndefined();
    for (let i = 0; i < 3; i++) noteFight(s, woodsWin);
    expect(playerProfile(s).scars).toEqual(['ghosts']);
  });
  it('опись: свои черты, номера боёв войны и черты войны по ним', () => {
    const s = party();
    expect(scarsWatch(s)).toBeUndefined();
    for (let i = 0; i < 3; i++) noteFight(s, woodsWin);
    noteFight(s, { out: 'win', river: true, war: { id: 'w.0', at: 1 } });
    noteFight(s, { out: 'win', river: true, war: { id: 'w.1', at: 2 } });
    expect(scarsWatch(s)).toEqual({ held: ['ghosts', 'fords'], war: ['w.0', 'w.1'], warHeld: ['fords'] });
    expect(warScarsNow(s).map((h) => h.id)).toEqual(['fords']);
  });
});

describe('одна дверь', () => {
  it('журнал армии пишет только sim/scars', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
      }
    };
    walk(root);
    const writers = files.filter((f) => /\bs\.scars\s*=(?!=)/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1).replace(/\\/g, '/'));
    expect(writers).toEqual(['game/sim/scars.ts']);
  });
});
