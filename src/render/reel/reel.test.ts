// Общий модуль ролика на наборе боёв (docs/gfx.md, «Проверки»): часы 15–40 с, шкала сил приходит к итогу боя, живых
// фигур в конце — образ итога, такты по журналу. Набор — решётка стенда (`battle-stand`): размеры от стычки до большого
// боя, обе стороны с перевесом, ровно, место (брод, лес и холмы), стая у ворот — каждый бой ядром, тем же путём, что
// в игре.
import { describe, expect, it } from 'vitest';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from '../tw/record';
import { aliveFigures, type TwPlan } from '../tw/plan';
import type { BattleResult, Side } from '@/battle/types';
import { MAX_SECONDS, MIN_SECONDS, castTimeOfTick, castToReel, reelToCast } from './clock';
import { strengthAt } from './strength';
import { beatsOf, loserOf } from './beats';

const SIDES: readonly Side[] = ['attacker', 'defender'];

interface Case {
  q: string;
  plan: TwPlan;
  result: BattleResult;
}

/** Решётка боёв: 3 × 3 размера, два сида, три места; плюс стая у ворот. */
const SET: Case[] = (() => {
  const out: Case[] = [];
  const places = ['', '&place=ford,river', '&place=woods,hills'];
  let n = 0;
  for (const men of [40, 260, 900]) {
    for (const foe of [30, 240, 700]) {
      for (const seed of [3, 11]) {
        const q = `replay=tw&men=${men}&foe=${foe}&seed=${seed}${places[n++ % places.length]}`;
        const b = standBattle(new URLSearchParams(q));
        out.push({ q, plan: twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide), result: b.result });
      }
    }
  }
  for (const seed of [2, 7]) {
    const q = `replay=tw&beasts=1&men=60&foe=50&seed=${seed}`;
    const b = standBattle(new URLSearchParams(q));
    out.push({ q, plan: twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide), result: b.result });
  }
  return out;
})();

/** Живые фигуры стороны на секунде ролика. */
const aliveOf = (p: TwPlan, side: Side, t: number): number => p.units.filter((u) => u.side === side && u.row !== 'general').reduce((n, u) => n + aliveFigures(p, u, t), 0);

describe('ролик боя на наборе боёв', () => {
  it('набор живой: есть бои с k = 1 и с k > 1, со сломом и победителем', () => {
    expect(SET.length).toBeGreaterThanOrEqual(20);
    expect(SET.some((c) => c.plan.k === 1)).toBe(true);
    expect(SET.some((c) => c.plan.k > 1)).toBe(true);
    expect(SET.filter((c) => loserOf(c.result) && c.result.sides[loserOf(c.result)!].brokenAt !== null).length).toBeGreaterThan(10);
  });

  it('ролик в поле — от 15 до 40 секунд, и спорный бой не короче разгрома', () => {
    for (const c of SET) {
      expect(c.plan.seconds, c.q).toBeGreaterThanOrEqual(MIN_SECONDS);
      expect(c.plan.seconds, c.q).toBeLessThanOrEqual(MAX_SECONDS);
    }
    const even = SET.find((c) => c.q.startsWith('replay=tw&men=260&foe=240'))!;
    const rout = SET.find((c) => c.q.startsWith('replay=tw&men=900&foe=30'))!;
    expect(even.plan.seconds).toBeGreaterThan(rout.plan.seconds);
  });

  it('шкала сил: на старте — с какими начали, к концу боя — ровно итог боя, и только убывает', () => {
    for (const c of SET) {
      const p = c.plan;
      const start = strengthAt(p.cast, c.result, reelToCast(p.timing, 0));
      const end = strengthAt(p.cast, c.result, reelToCast(p.timing, p.timing.end));
      const coda = strengthAt(p.cast, c.result, reelToCast(p.timing, p.seconds));
      for (const side of SIDES) {
        expect(start[side].men, c.q).toBe(c.result.sides[side].total.initial);
        expect(end[side].men, c.q).toBe(c.result.sides[side].total.final);
        expect(coda[side].men, c.q).toBe(c.result.sides[side].total.final);
        expect(end[side].lost, c.q).toBe(c.result.sides[side].total.losses);
        let last = Infinity;
        for (let t = 0; t <= p.seconds; t += 0.25) {
          const m = strengthAt(p.cast, c.result, reelToCast(p.timing, t))[side].men;
          expect(m, `${c.q} ${side} t=${t}`).toBeLessThanOrEqual(last);
          last = m;
        }
      }
    }
  });

  it('живых фигур в конце ролика — итог боя: при k = 1 ровно, при k > 1 — образ итога по родам отрядов', () => {
    let exact = 0;
    for (const c of SET) {
      const p = c.plan;
      for (const side of SIDES) {
        const alive = aliveOf(p, side, p.seconds);
        // Образ итога: у каждого рода отряда фигур столько, сколько бойцов, павших — доля павших бойцов.
        let image = 0;
        for (const u of p.units) {
          if (u.side !== side || u.row === 'general') continue;
          for (const pt of u.parts) image += pt.figures - Math.min(pt.figures, Math.round((pt.figures * (pt.men - pt.finalMen)) / pt.men));
        }
        expect(alive, `${c.q} ${side}`).toBe(image);
        // В бойцах: живые фигуры × k — итог боя с точностью до округления каждого рода каждого отряда.
        const parts = p.units.filter((u) => u.side === side).reduce((n, u) => n + u.parts.length, 0);
        expect(Math.abs(alive * p.k - c.result.sides[side].total.final), `${c.q} ${side}`).toBeLessThanOrEqual(p.k * parts);
        if (p.k === 1) {
          expect(alive, `${c.q} ${side}: k = 1`).toBe(c.result.sides[side].total.final);
          exact++;
        }
      }
    }
    // Точки внутри области правила «ровно»: боёв с k = 1 хватает (правило 11).
    expect(exact).toBeGreaterThanOrEqual(8);
  });

  it('павшие падают до конца боя: на развязке не падает никто', () => {
    for (const c of SET) {
      const p = c.plan;
      for (let i = 0; i < p.figures; i++) if (Number.isFinite(p.deathAt[i])) expect(p.deathAt[i], c.q).toBeLessThanOrEqual(p.timing.end + 1e-6);
    }
  });

  it('такты по журналу: общий план, сшибка, перелом (если был), развязка — по порядку; развязка — слом побеждённого', () => {
    let turns = 0;
    for (const c of SET) {
      const p = c.plan;
      const beats = beatsOf(p.cast, c.result, p.timing);
      const ids = beats.map((b) => b.id);
      expect(ids[0], c.q).toBe('overview');
      expect(ids[1], c.q).toBe('clash');
      expect(ids[ids.length - 1], c.q).toBe('outcome');
      for (let i = 1; i < beats.length; i++) expect(beats[i].at, c.q).toBeGreaterThan(beats[i - 1].at);
      expect(beats[1].at, c.q).toBeCloseTo(p.clashAt, 5);
      const loser = loserOf(c.result);
      const tick = loser ? c.result.sides[loser].brokenAt : null;
      if (loser && tick !== null) {
        const want = castToReel(p.timing, castTimeOfTick(p.cast, tick));
        if (want > p.clashAt + 1.5) expect(beats[beats.length - 1].at, c.q).toBeCloseTo(want, 5);
      }
      const turn = beats.find((b) => b.id === 'turn');
      if (turn) {
        turns++;
        expect(turn.focus?.side, c.q).toBe(loser);
        expect(turn.at, c.q).toBeLessThan(p.timing.end);
      }
    }
    // Перелом бывает: хотя бы в части боёв набора сектор побеждённого бежит раньше всей стороны (правило 11).
    expect(turns).toBeGreaterThan(3);
  });
});
