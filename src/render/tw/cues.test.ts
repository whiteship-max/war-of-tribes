// Звук ролика TW из журнала (docs/battle_tw.md, «Звук»): рог, трубы и клич — по сшибке, грохот — где сошлись строи, залп —
// в миг срыва, крик — в миг слома, рог победителя — после слома побеждённых. Тот же журнал — те же звуки.
import { describe, expect, it } from 'vitest';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from './record';
import { ARROW_FLIGHT } from './plan';
import { CueClock, ambienceAt, cuesOf } from './cues';
import { figureFrame, poseFigures } from './plan';

const planOf = (q: string) => {
  const b = standBattle(new URLSearchParams(q));
  return twPlanOfRecord(b.result, b.us, b.troops, 'medium', undefined, b.place, b.beastSide);
};
const plan = planOf('replay=tw&men=600&foe=560&seed=7&place=woods,road&hour=10');
const cues = cuesOf(plan);

describe('звук ролика TW из журнала', () => {
  it('рог обеих сторон на построении, трубы и клич — до сшибки, грохот — на сшибке', () => {
    const horns = cues.filter((c) => c.kind === 'horn');
    expect(horns.map((c) => c.ours).sort()).toEqual([false, true]);
    for (const c of cues.filter((c) => c.kind === 'charge' || c.kind === 'cry')) expect(c.at).toBeLessThan(plan.clashAt);
    const crash = cues.filter((c) => c.kind === 'crash' && Math.abs(c.at - plan.clashAt) < 0.2);
    // Граница области: первые линии сошлись хотя бы в одном слоте.
    expect(crash.length).toBeGreaterThan(0);
  });

  it('залп звучит в миг срыва каждого залпа, стук — когда туча долетела', () => {
    const volleys = plan.units.flatMap((u) => u.volleys);
    expect(volleys.length).toBeGreaterThan(0);
    const bows = cues.filter((c) => c.kind === 'bows').map((c) => c.at);
    for (const v of volleys) expect(bows.some((t) => Math.abs(t - v) < 1e-9)).toBe(true);
    for (const c of cues.filter((c) => c.kind === 'thud')) expect(bows.some((t) => Math.abs(c.at - ARROW_FLIGHT - t) < 1e-9)).toBe(true);
  });

  it('крик — у каждого побежавшего отряда в миг слома, рог победителя — после слома побеждённых', () => {
    const fled = plan.units.filter((u) => u.fleeAt !== null && u.row !== 'general' && u.fleeAt < plan.seconds);
    expect(fled.length).toBeGreaterThan(0);
    const panic = cues.filter((c) => c.kind === 'panic').map((c) => c.at);
    for (const u of fled) expect(panic).toContain(u.fleeAt);
    const loser = plan.brokenAt.attacker !== null ? 'attacker' : 'defender';
    const win = cues.filter((c) => c.kind === 'victory');
    expect(win.length).toBe(1);
    expect(win[0].at).toBeGreaterThan(plan.brokenAt[loser]!);
    expect(win[0].ours).toBe(loser !== plan.us);
  });

  it('тот же журнал — те же звуки, по порядку времени', () => {
    const again = cuesOf(planOf('replay=tw&men=600&foe=560&seed=7&place=woods,road&hour=10'));
    expect(JSON.stringify(again)).toBe(JSON.stringify(cues));
    for (let i = 1; i < cues.length; i++) expect(cues[i].at).toBeGreaterThanOrEqual(cues[i - 1].at);
  });

  it('часы звуков: каждый звук — один раз; перемотка и скачок прошлого не сыплют', () => {
    const clock = new CueClock(cues);
    let heard = 0;
    for (let t = 0; t <= plan.seconds; t += 0.05) heard += clock.take(t).length;
    expect(heard).toBe(cues.length);
    expect(clock.take(5)).toEqual([]);
    expect(clock.take(5.05).every((c) => c.at > 5 && c.at <= 5.05)).toBe(true);
    expect(clock.take(plan.seconds)).toEqual([]);
  });

  it('гул из кадра: в сече рубятся, до сшибки — нет', () => {
    const frame = figureFrame(plan.figures);
    poseFigures(plan, 1, frame);
    expect(ambienceAt(plan, frame).roar).toBe(0);
    poseFigures(plan, plan.clashAt + 3, frame);
    const a = ambienceAt(plan, frame);
    expect(a.roar).toBeGreaterThan(0);
    expect(a.fight.reduce((n, f) => n + f.n, 0)).toBeGreaterThan(10);
  });
});
