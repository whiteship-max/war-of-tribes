// Режиссура ролика TW: один `k` на обе стороны, потолки уровней, строй, сшибка на линии, гибель по журналу,
// детерминизм (docs/battle_tw.md, разделы 2–4).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUALITIES, type Quality } from '../quality';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from './record';
import { TW_SPEC } from './spec';
import {
  CONTACT_HALF,
  FORM,
  MAX_SECONDS,
  advanceOf,
  aliveFigures,
  figureFrame,
  poseFigures,
  ratioOf,
  unitPose,
  type TwPlan,
} from './plan';

const planOf = (query: string, quality: Quality = 'medium'): TwPlan => {
  const b = standBattle(new URLSearchParams(query));
  return twPlanOfRecord(b.result, b.us, b.troops, quality, undefined, b.place, b.beastSide);
};

describe('ролик TW: сколько фигур', () => {
  it('k один на обе стороны: соотношение сил видно глазами', () => {
    // 500 против 20: фигур у сторон столько же раз меньше, во сколько раз меньше бойцов.
    const p = planOf('replay=tw&men=500&foe=20&seed=3', 'low');
    expect(p.k).toBe(ratioOf(p.cast.men.attacker, p.cast.men.defender, TW_SPEC.low.perSide));
    const ratioMen = p.cast.men.attacker / p.cast.men.defender;
    const ratioFig = p.sideFigures.attacker / p.sideFigures.defender;
    expect(Math.abs(ratioFig - ratioMen) / ratioMen).toBeLessThan(0.2);
  });

  it('ни одна сторона не стоит больше потолка уровня, и фигуры отрядов сходятся со стороной', () => {
    for (const q of QUALITIES) {
      for (const size of [30, 300, 1500, 5000]) {
        const p = planOf(`replay=tw&men=${size}&foe=${Math.round(size * 0.8)}&seed=5`, q);
        for (const side of ['attacker', 'defender'] as const) {
          expect(p.sideFigures[side]).toBeLessThanOrEqual(TW_SPEC[q].perSide);
          const sum = p.units.filter((u) => u.side === side && u.row !== 'general').reduce((n, u) => n + u.figures, 0);
          expect(sum).toBe(p.sideFigures[side]);
        }
        // Меньшая армия не нарезается мельче нужного: k — наименьшее, при котором большая влезает в потолок.
        if (p.k > 1) expect(Math.max(p.cast.men.attacker, p.cast.men.defender) / (p.k - 1)).toBeGreaterThan(TW_SPEC[q].perSide);
      }
    }
  });

  it('низкий уровень ставит меньше фигур, чем средний, средний — меньше высокого', () => {
    const n = (q: Quality): number => planOf('replay=tw&men=2000&foe=2000&seed=2', q).figures;
    expect(n('low')).toBeLessThan(n('medium'));
    expect(n('medium')).toBeLessThan(n('high'));
  });

  it('отряд не больше потолка рода: больше — соседний со своим знаменем', () => {
    const p = planOf('replay=tw&men=3000&foe=3000&seed=1', 'high');
    for (const u of p.units) expect(u.figures).toBeLessThanOrEqual(FORM[u.form].cap);
  });
});

describe('ролик TW: строй и место', () => {
  it('отряды одной стороны на построении не налезают друг на друга', () => {
    for (const q of QUALITIES) {
      const p = planOf('replay=tw&men=900&foe=700&seed=4', q);
      const box = (u: TwPlan['units'][number]) => {
        const back = u.ours ? -1 : 1;
        const z1 = u.z;
        const z2 = u.z + back * u.depth;
        return { x0: u.x - u.width / 2, x1: u.x + u.width / 2, z0: Math.min(z1, z2) - 0.3, z1: Math.max(z1, z2) + 0.3 };
      };
      const list = p.units.filter((u) => u.row !== 'general');
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].side !== list[j].side) continue;
          const a = box(list[i]);
          const b = box(list[j]);
          const overlap = a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.z0 < b.z1 && b.z0 < a.z1;
          expect(overlap, `${list[i].sector}/${list[i].face} и ${list[j].sector}/${list[j].face}`).toBe(false);
        }
      }
    }
  });

  it('наши смотрят на +Z и стоят на −Z, чужие — наоборот; конница на краю своей полосы', () => {
    const p = planOf('replay=tw&men=600&foe=600&seed=9');
    for (const u of p.units) {
      if (u.row === 'general') continue;
      expect(Math.sign(u.z)).toBe(u.ours ? -1 : 1);
      expect(u.yaw).toBe(u.ours ? 0 : Math.PI);
    }
    // Наша левая полоса (A) — у +X: камера стоит за нами и смотрит на +Z, левый край экрана — +X.
    const a = p.units.filter((u) => u.ours && u.sector === 'A');
    const c = p.units.filter((u) => u.ours && u.sector === 'C');
    if (a.length && c.length) expect(Math.min(...a.map((u) => u.x))).toBeGreaterThan(Math.max(...c.map((u) => u.x)));
  });

  it('к сшибке передняя шеренга первой линии стоит на линии соприкосновения', () => {
    const p = planOf('replay=tw&men=400&foe=400&seed=7');
    for (const side of ['attacker', 'defender'] as const) {
      const a = advanceOf(p, side, p.clashAt);
      expect(Math.abs(Math.abs(p.deployZ[side]) - a.dist)).toBeCloseTo(CONTACT_HALF, 5);
    }
    for (const u of p.units.filter((x) => x.row === 'front' && x.fleeAt === null)) {
      const pose = unitPose(p, u, p.clashAt + 0.01);
      expect(Math.abs(pose.z)).toBeCloseTo(CONTACT_HALF, 1);
    }
  });

  it('до начала сближения строй стоит, на сближении идёт вперёд и не обгоняет линию', () => {
    const p = planOf('replay=tw&men=400&foe=400&seed=7');
    for (const side of ['attacker', 'defender'] as const) {
      let last = -1;
      for (let t = 0; t <= p.clashAt; t += 0.1) {
        const d = advanceOf(p, side, t).dist;
        expect(d).toBeGreaterThanOrEqual(last - 1e-9);
        last = d;
      }
    }
  });

  it('поле накрывает все отряды на построении', () => {
    const p = planOf('replay=tw&men=2500&foe=2500&seed=11', 'high');
    for (const u of p.units) {
      expect(Math.abs(u.x) + u.width / 2).toBeLessThan(p.field.halfX);
      expect(u.z).toBeGreaterThan(p.field.minZ);
      expect(u.z).toBeLessThan(p.field.maxZ);
    }
  });
});

describe('ролик TW: гибель и время', () => {
  it('павших фигур к концу столько, сколько бойцов потерял отряд, в долях k', () => {
    const p = planOf('replay=tw&men=500&foe=500&seed=6');
    for (const u of p.units) {
      if (u.men <= 0) continue;
      const dead = u.figures - aliveFigures(p, u, p.seconds + 1);
      expect(dead).toBe(Math.min(u.figures, Math.round((u.figures * (u.men - u.finalMen)) / u.men)));
    }
  });

  it('павших только прибывает: живых фигур со временем не больше, чем было', () => {
    const p = planOf('replay=tw&men=300&foe=350&seed=8');
    for (const u of p.units) {
      let last = Infinity;
      for (let t = 0; t <= p.seconds; t += 0.5) {
        const n = aliveFigures(p, u, t);
        expect(n).toBeLessThanOrEqual(last);
        last = n;
      }
    }
  });

  it('ролик не длиннее 70 с', () => {
    for (const q of ['replay=tw&men=500&foe=500&seed=1', 'replay=tw&men=60&foe=60&seed=2', 'replay=tw&men=900&foe=40&seed=3']) {
      expect(planOf(q).seconds).toBeLessThanOrEqual(MAX_SECONDS);
    }
  });

  it('тот же журнал — тот же ролик до фигуры', () => {
    const a = planOf('replay=tw&men=700&foe=650&seed=12&place=ford,woods&hour=17');
    const b = planOf('replay=tw&men=700&foe=650&seed=12&place=ford,woods&hour=17');
    const fa = figureFrame(a.figures);
    const fb = figureFrame(b.figures);
    for (const t of [0, 5, 13, 30, a.seconds]) {
      poseFigures(a, t, fa);
      poseFigures(b, t, fb);
      expect(Array.from(fa.x)).toEqual(Array.from(fb.x));
      expect(Array.from(fa.clip)).toEqual(Array.from(fb.clip));
      expect(Array.from(fa.time)).toEqual(Array.from(fb.time));
    }
  });

  it('стая — без знамён, люди — со знаменем у каждого отряда', () => {
    const p = planOf('replay=tw&beasts=1&men=60&foe=40&seed=7');
    for (const u of p.units) {
      if (u.face === 'wolf') expect(u.banner).toBeNull();
      else expect(u.banner).not.toBeNull();
    }
  });
});

describe('ролик TW: показ не считает бой', () => {
  it('в коде ролика нет ни симуляции, ни мира, ни Math.random', () => {
    const dir = join(__dirname);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'stand.ts') continue;
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random/);
      expect(src, f).not.toMatch(/battle\/sim|simulateBattle|@\/world\//);
    }
  });
});
