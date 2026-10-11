// Ход осады фазами — правила двери `world/siegeroll` (docs/siege_v2.md, разделы 2, 3, 8.3; этап 2б). Каждое утверждение
// держит своё правило; точки — внутри области, где правило действует (правило 11).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSiege, starvesAt, wearSpan, type SiegeWindow } from './siege';
import {
  breachesOf,
  cleanOrders,
  dieOf,
  gatesAt,
  modsOf,
  modsSum,
  modsText,
  nextRollAt,
  orderStorms,
  orderVolleys,
  outOf,
  phaseAt,
  phaseOf,
  phaseText,
  progressOf,
  projectPhases,
  rollPhase,
  shakeShare,
  softerFate,
  volleyBlock,
  wallFaces,
  wasteOf,
  type PhaseRow,
} from './siegeroll';
import { craftAfter, craftAt, garrisonWear } from './siegecraft';
import { CAMP_WASTE, CAMP_WASTE_DAYS, SIEGE_DIE, SIEGE_PHASE } from './data/siegeroll';
import { SIEGE_WEAR_FLOOR } from './data/tuning';

const T0 = 1_700_000_000_000;

/** Окно осады: хлеба на `phases` фаз и ещё полфазы, стена `wall`. */
function win(o: { phases?: number; wall?: number; log?: SiegeWindow['log'] } = {}): SiegeWindow {
  const hours = ((o.phases ?? 5) + 0.5) * (SIEGE_PHASE / 3_600_000);
  return openSiege({
    byId: 'lair-1',
    campId: 'm7',
    now: T0,
    food: 100 * hours,
    garrison: 0,
    townPerHour: 100,
    perManPerHour: 0,
    ...(o.wall !== undefined ? { wall: o.wall } : {}),
    log: o.log ?? [],
  });
}

const row = (out: PhaseRow['out'], k = 1): PhaseRow => ({ at: phaseAt(T0, k), die: 7, mods: {}, out, waste: 0 });

describe('фаза — минута из отметки осады (2.1)', () => {
  it('бросок фазы k — в t_k = since + k × 4 игр. дн.; фаза k — промежуток [t_{k−1}, t_k)', () => {
    expect(phaseAt(T0, 1) - T0).toBe(SIEGE_PHASE);
    expect(phaseOf(T0, T0)).toBe(1);
    expect(phaseOf(T0, phaseAt(T0, 1) - 1)).toBe(1);
    expect(phaseOf(T0, phaseAt(T0, 1))).toBe(2);
    const w = win();
    expect(nextRollAt(w)).toBe(phaseAt(T0, 1));
    expect(nextRollAt({ ...w, phases: [row('calm')] })).toBe(phaseAt(T0, 2));
  });
});

describe('кость d14 (2.3)', () => {
  it('тот же сид и номер — тот же бросок; грани 1…14, и каждая выпадает', () => {
    const seen = new Set<number>();
    for (let k = 1; k <= 2000; k++) {
      const d = dieOf('m7:1', k);
      expect(d).toBe(dieOf('m7:1', k));
      expect(Number.isInteger(d) && d >= 1 && d <= SIEGE_DIE).toBe(true);
      seen.add(d);
    }
    expect(seen.size).toBe(SIEGE_DIE);
  });

  it('грань выпадает примерно в каждой четырнадцатой фазе: доли на 14 000 бросках — в пределах трети от 1/14', () => {
    const n = 14_000;
    const count = new Array(SIEGE_DIE + 1).fill(0);
    for (let k = 1; k <= n; k++) count[dieOf('сид', k)] += 1;
    for (let f = 1; f <= SIEGE_DIE; f++) {
      expect(count[f] / n, `грань ${f}`).toBeGreaterThan((1 / SIEGE_DIE) * (2 / 3));
      expect(count[f] / n, `грань ${f}`).toBeLessThan((1 / SIEGE_DIE) * (4 / 3));
    }
  });
});

describe('поправки (2.3) — целые грани, нулевых нет', () => {
  it('стена: −1 за каждые два уровня частокола, не больше −5; у логова стены нет — ноль', () => {
    expect(wallFaces(undefined)).toBe(-0);
    expect(wallFaces(1)).toBe(-0);
    expect(wallFaces(2)).toBe(-1);
    expect(wallFaces(9)).toBe(-4);
    expect(wallFaces(10)).toBe(-5);
    expect(wallFaces(30)).toBe(-5);
    expect(modsOf(win({ wall: 6 }), 1).wall).toBe(-3);
    expect(modsOf(win(), 1).wall, 'логово — поля нет').toBeUndefined();
  });

  it('залп своей фазы — +2, залп прошлой фазы — нет', () => {
    const w = win({ log: [{ at: phaseAt(T0, 1) + 10, act: 'volley' }] });
    expect(modsOf(w, 1).volley, 'фаза 1 — залпа в её промежутке нет').toBeUndefined();
    expect(modsOf(w, 2).volley, 'фаза 2 — залп в её промежутке').toBe(2);
    expect(modsOf(w, 3).volley).toBeUndefined();
  });

  it('голод: +1 при хлебе меньше половины, +2 — меньше четверти; доля — от часов голода окна', () => {
    const w = win({ phases: 7 });
    const span = starvesAt(w) - T0;
    for (let k = 1; phaseAt(T0, k) < starvesAt(w); k++) {
      const left = (starvesAt(w) - phaseAt(T0, k)) / span;
      const want = left < 0.25 ? 2 : left < 0.5 ? 1 : undefined;
      expect(modsOf(w, k).hunger, `фаза ${k}, хлеба ${left.toFixed(2)}`).toBe(want);
    }
    // Граница области: в окне есть фазы со всеми тремя ступенями.
    expect(modsOf(w, 1).hunger).toBeUndefined();
    expect(modsOf(w, 7).hunger).toBe(2);
  });

  it('проломы и ход — из прошлых строк: пролом +1 к обоим, нехватка +1 к ходу; пролом сверх трёх — ход +2', () => {
    const w = win();
    const prior = [row('breach', 1), row('short', 2), row('breach', 3), row('breach', 4), row('breach', 5)];
    expect(breachesOf(w, prior)).toBe(3);
    expect(progressOf(w, prior)).toBe(1 + 1 + 1 + 1 + 2);
    const mods = modsOf(w, 6, prior);
    expect(mods.breach).toBe(3);
    expect(mods.progress).toBe(6);
    expect(modsSum({ breach: 3, volley: 2, wall: -5 })).toBe(0);
    expect(modsText({ breach: 3, volley: 2, wall: -5 })).toBe('+3 пролом, +2 залп, −5 стена');
    expect(modsText({})).toBe('без поправок');
  });
});

describe('исходы (2.4) и ответ владельца 7', () => {
  it('таблица EU4: до 3 — мор, 4–9 — без перемен, 10–12 — нехватка, 13–15 — пролом, от 16 — ворота', () => {
    const before = [row('breach')];
    expect(outOf(3, before)).toBe('plague');
    expect(outOf(4, before)).toBe('calm');
    expect(outOf(9, before)).toBe('calm');
    expect(outOf(10, before)).toBe('short');
    expect(outOf(12, before)).toBe('short');
    expect(outOf(13, before)).toBe('breach');
    expect(outOf(15, before)).toBe('breach');
    expect(outOf(16, before)).toBe('gates');
  });

  it('город не падает раньше, чем через фазу после вести о проломе: сдача без пролома в прошлых фазах — пролом', () => {
    expect(outOf(16, []), 'пролома не было — весть не ушла').toBe('breach');
    expect(outOf(20, [row('short'), row('calm', 2)])).toBe('breach');
    expect(outOf(16, [row('breach')]), 'пролом в прошлой фазе — весть ушла').toBe('gates');
    // Окно до фаз: прежние залпы — проломы, о которых защитник знал.
    expect(outOf(16, [], 1)).toBe('gates');
  });

  it('бросок по окну: та же строка у кого угодно — кость, поправки и исход из входов фазы', () => {
    const w = win({ wall: 4, log: [{ at: T0 + 5, act: 'volley' }] });
    const a = rollPhase(w, 1);
    const b = rollPhase(JSON.parse(JSON.stringify(w)) as SiegeWindow, 1);
    expect(a).toEqual(b);
    expect(a.at).toBe(phaseAt(T0, 1));
    expect(a.mods).toEqual({ volley: 2, wall: -2 });
    expect(a.out).toBe(outOf(a.die + 0, []));
  });
});

describe('прогноз фаз для вести — те же строки, что бросит мир', () => {
  it('projectPhases — это rollPhase по очереди; кончается на сдаче', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = { ...win({ phases: 9, wall: 0 }), campId: `c${seed}` };
      const ahead = projectPhases(w, starvesAt(w));
      let cur: SiegeWindow = { ...w, phases: [] };
      for (const [i, r] of ahead.entries()) {
        expect(r).toEqual(rollPhase(cur, i + 1));
        cur = { ...cur, phases: [...(cur.phases ?? []), r] };
      }
      const g = gatesAt(ahead);
      if (g !== null) expect(ahead[ahead.length - 1].out).toBe('gates');
      for (const r of ahead) expect(r.at).toBeLessThan(starvesAt(w));
    }
  });
});

describe('истощение лагеря (раздел 3)', () => {
  it('доля a за фазу, вдвое — на дальности D, мор — ещё доля, пустой амбар дома — вдвое', () => {
    expect(wasteOf('calm', 0)).toBeCloseTo(CAMP_WASTE, 12);
    expect(wasteOf('calm', CAMP_WASTE_DAYS)).toBeCloseTo(2 * CAMP_WASTE, 12);
    expect(wasteOf('plague', 0)).toBeCloseTo(2 * CAMP_WASTE, 12);
    expect(wasteOf('calm', 0, true)).toBeCloseTo(2 * CAMP_WASTE, 12);
    expect(wasteOf('plague', CAMP_WASTE_DAYS, true)).toBeCloseTo(8 * CAMP_WASTE, 12);
    expect(wasteOf('plague', 1e9, true)).toBe(1);
    expect(rollPhase({ ...win(), homeDays: CAMP_WASTE_DAYS }, 1).waste).toBeGreaterThanOrEqual(2 * CAMP_WASTE - 1e-12);
  });
});

describe('обстрел — дело фазы (2.5) и износ к голоду (2.6)', () => {
  it('один залп за фазу: второй в той же фазе — отказ, в следующей — можно', () => {
    const w = win();
    expect(volleyBlock(w, T0 + 1)).toBeNull();
    const after = { ...w, ...craftAfter(w, 'bombard', T0 + 1) };
    expect(after.log).toEqual([{ at: T0 + 1, act: 'volley' }]);
    expect(after.craft?.shots).toBe(1);
    expect(volleyBlock(after, T0 + 2)).not.toBeNull();
    expect(volleyBlock(after, phaseAt(T0, 1))).toBeNull();
  });

  it('пролом даёт исход фазы, а не залп: залпы без пролома стену не ломают', () => {
    const w = win();
    let cur: SiegeWindow = w;
    for (let k = 0; k < 3; k++) cur = { ...cur, ...craftAfter(cur, 'bombard', phaseAt(T0, k) + 1) };
    expect(craftAt(cur).breach).toBe(0);
    expect(craftAt({ ...cur, phases: [row('breach')] }).breach).toBe(1);
  });

  it('окно до фаз (без журнала дел): прежние залпы — проломы, доля стены × 3 вниз до целого', () => {
    const old = { ...win(), log: undefined, craft: { shots: 3 } };
    // 20 + 10 + 5 % = 35 % стены → 1.05 пролома → 1.
    expect(breachesOf(old)).toBe(1);
    expect(breachesOf({ ...old, craft: { shots: 1 } })).toBe(0);
    expect(breachesOf({ ...old, log: [] }), 'фазовое окно своих залпов в проломы не переводит').toBe(0);
  });

  it('к голоду окна гарнизон на дне износа; залпы двигают часы — первый на пятую часть пути, дальше вполовину', () => {
    const w = win({ phases: 5 });
    const end = starvesAt(w);
    // Граница области: голод — внутри осады, и до него износ не на дне.
    expect(garrisonWear(w, T0 + (end - T0) / 2)).toBeGreaterThan(SIEGE_WEAR_FLOOR);
    expect(garrisonWear(w, end)).toBeCloseTo(SIEGE_WEAR_FLOOR, 12);
    expect(wearSpan(w)).toBe(end - T0);
    expect(shakeShare(1)).toBeCloseTo(1 / 5, 12);
    expect(shakeShare(3)).toBeCloseTo(1 / 5 + 1 / 10 + 1 / 20, 12);
    const at = T0 + (end - T0) / 4;
    const shot = { ...w, ...craftAfter(w, 'bombard', T0 + 1) };
    const drop = garrisonWear(w, at) - garrisonWear(shot, at);
    expect(drop).toBeCloseTo((1 - SIEGE_WEAR_FLOOR) / 5, 9);
  });
});

describe('сдача мягче падения (ответ владельца 5)', () => {
  it('участь на ступень легче: сжечь → увести → ограбить; ограбить — мягче некуда', () => {
    expect(softerFate('burn')).toBe('captives');
    expect(softerFate('captives')).toBe('plunder');
    expect(softerFate('plunder')).toBe('plunder');
  });
});

describe('наказы на отлучку (8.3)', () => {
  it('залп — пока энергии хватает и на залп, и на штурм после него; штурм — при названных проломах', () => {
    expect(orderVolleys({ volley: true }, 35, 15, 20)).toBe(true);
    expect(orderVolleys({ volley: true }, 34.9, 15, 20)).toBe(false);
    expect(orderVolleys({}, 100, 15, 20)).toBe(false);
    expect(orderStorms({ storm: 2 }, 1)).toBe(false);
    expect(orderStorms({ storm: 2 }, 2)).toBe(true);
    expect(orderStorms(undefined, 3)).toBe(false);
    expect(cleanOrders({ storm: 7 })).toEqual({ storm: 3 });
    expect(cleanOrders({ volley: false, storm: 0 })).toBeUndefined();
  });
});

describe('слова журнала', () => {
  it('строка фазы: кость, поправки, итог, исход и убыль — числами двери', () => {
    const r: PhaseRow = { at: T0, die: 9, mods: { breach: 1, volley: 2, wall: -2 }, out: 'short', waste: 0.04 };
    expect(phaseText(r, 3)).toBe('Ф3 · кость 9 + 1 пролом + 2 залп − 2 стена = 10 · нехватка в городе · из лагеря ушло 4 %');
  });
});

describe('одна дверь фаз', () => {
  it('мир и сервер войны бросают фазу одной функцией: своей кости и таблицы исходов ни у кого нет', () => {
    const root = path.resolve(__dirname, '../..');
    for (const file of ['src/world/local/LocalWorld.ts', 'netlify/lib/war.ts']) {
      const src = readFileSync(path.join(root, file), 'utf8');
      expect(src, `${file}: бросает rollPhase`).toContain('rollPhase(');
      expect(src, `${file}: своей кости нет`).not.toMatch(/dieOf\(|SIEGE_DIE/);
      expect(src, `${file}: своей таблицы исходов нет`).not.toMatch(/OUT_(PLAGUE|CALM|SHORT|BREACH)_MAX/);
    }
  });
});
