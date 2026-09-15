// Кто именно стоял в строю. Проверяется главное обещание близкого плана: игрок
// видит, кого он собрал, — а не «род боя вообще».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateBattle } from '@/battle/sim';
import { quickSetup } from '@/battle/setup';
import { UNIT_KINDS, type Stack } from '@/battle';
import { TROOP_IDS } from '../data/troops';
import type { TroopId } from '../types';
import { KIND_OF, gearOfTroop, kindsOf, type TroopStack } from './kinds';
import { MILITIA, facesOf, facesTotal, troopOfKind, troopsOfKinds, wearOf } from './faces';
import { castOfRecord } from './cast';

const fight = (a: TroopStack, d: TroopStack, seed = 7) =>
  simulateBattle({ seed, attacker: quickSetup(kindsOf(a)), defender: quickSetup(kindsOf(d)) });

const MIXED: TroopStack = { spearman: 60, legionary: 40, clubman: 50, archer: 45, rider: 20 };
const FOE: TroopStack = { spearman: 70, swordsman: 60, archer: 40, rider: 15 };

describe('состав стороны — метки для показа', () => {
  it('каждый вид с людьми получает метку, и люди не теряются', () => {
    const faces = facesOf({ troops: MIXED });
    expect(facesTotal(faces)).toBe(Object.values(MIXED).reduce((a, b) => a + b, 0));
    for (const f of faces) expect(KIND_OF[f.id as TroopId]).toBe(f.kind);
    expect(faces.map((f) => f.id).sort()).toEqual(Object.keys(MIXED).sort());
  });

  it('ополчение — отдельная метка: его нельзя нанять и нельзя записать видом', () => {
    const faces = facesOf({ troops: { spearman: 10 }, militia: 30, militiaArchers: 12 });
    const militia = faces.filter((f) => f.id === MILITIA);
    expect(militia.map((f) => f.kind).sort()).toEqual(['archer', 'infantry']);
    expect(militia.reduce((n, f) => n + f.men, 0)).toBe(30);
    // Башня переводит часть ополчения в стрелки: людей не прибавляется.
    expect(militia.find((f) => f.kind === 'archer')!.men).toBe(12);
    expect(facesTotal(faces)).toBe(40);
    expect(wearOf(MILITIA, 'infantry')).toEqual({ wear: 'folk' });
  });
});

describe('чужое войско получает лица из своей же ступени снаряжения', () => {
  it('чем лучше кован гарнизон, тем тяжелее вид пехоты', () => {
    const light = troopsOfKinds({ ...empty(), infantry: 100 }, { infantry: 0 });
    const heavy = troopsOfKinds({ ...empty(), infantry: 100 }, { infantry: 3 });
    const idOf = (t: TroopStack): TroopId => Object.keys(t)[0] as TroopId;
    expect(idOf(light)).not.toBe(idOf(heavy));
    expect(gearOfTroop(idOf(light))).toBeLessThan(gearOfTroop(idOf(heavy)));
    // Люди не теряются и не появляются.
    expect(Object.values(heavy).reduce((a, b) => a + (b ?? 0), 0)).toBe(100);
  });

  it('вид выбирается правилом, а не таблицей: род и ступень дают его сами', () => {
    for (const kind of UNIT_KINDS) {
      for (let tier = 0; tier <= 3; tier++) {
        const id = troopOfKind(kind, tier);
        expect(id, `${kind}/${tier}`).toBeTruthy();
        expect(KIND_OF[id!]).toBe(kind);
      }
    }
    // Ровно того же правила держится и мост: одинокий род не пропадает.
    const all = troopsOfKinds({ spear: 10, infantry: 10, archer: 10, cavalry: 10 });
    expect(Object.values(all).reduce((a, b) => a + (b ?? 0), 0)).toBe(40);
  });
});

describe('раскадровка получает виды, а не роды', () => {
  const record = () => {
    const result = fight(MIXED, FOE);
    return castOfRecord(result, 'attacker', { attacker: MIXED, defender: FOE });
  };

  it('в кадре стоят именно те виды, которых игрок нанимал', () => {
    const cast = record();
    const mine = new Set<string>();
    for (const c of cast.sectors) if (c.side === 'attacker') for (const f of c.byFace) mine.add(f.id);
    // Латника от дубинщика видно: обоих собрали, обоих и показывают.
    expect(mine.has('legionary')).toBe(true);
    expect(mine.has('clubman')).toBe(true);
    expect(mine.has('rider')).toBe(true);
    // Ни одной метки, которой в составе нет.
    for (const id of mine) expect(Object.keys(MIXED)).toContain(id);
  });

  it('все метки — настоящие виды или ополчение: род боя до картинки не доходит', () => {
    const cast = record();
    const known = new Set<string>([...TROOP_IDS, MILITIA]);
    for (const c of cast.sectors) {
      for (const f of c.byFace) {
        expect(known.has(f.id), `метка ${f.id}`).toBe(true);
        const wear = wearOf(f.id, f.kind);
        if (wear.wear === 'troop') expect(KIND_OF[wear.troop]).toBe(f.kind);
      }
      expect(c.byFace.reduce((n, f) => n + f.figures, 0)).toBe(c.figures);
    }
  });

  it('правка состава меняет то, что стоит в кадре', () => {
    const result = fight(MIXED, FOE);
    const a = castOfRecord(result, 'attacker', { attacker: MIXED, defender: FOE });
    const other: TroopStack = { spearman: 60, clubman: 90, archer: 45, rider: 20 };
    const b = castOfRecord(result, 'attacker', { attacker: other, defender: FOE });
    const ids = (c: typeof a): string[] => [
      ...new Set(c.sectors.filter((s) => s.side === 'attacker').flatMap((s) => s.byFace.map((f) => f.id))),
    ];
    expect(ids(a)).toContain('legionary');
    expect(ids(b)).not.toContain('legionary');
  });

  it('ополчение доходит до кадра: дом обороняют и жители', () => {
    const home: TroopStack = { spearman: 20, archer: 10 };
    const result = fight(FOE, { ...home, clubman: 120 });
    const cast = castOfRecord(result, 'defender', { attacker: FOE, defender: home }, {
      attacker: { men: 0, archers: 0 },
      defender: { men: 120, archers: 40 },
    });
    const mine = new Set<string>();
    for (const c of cast.sectors) if (c.side === 'defender') for (const f of c.byFace) mine.add(f.id);
    expect(mine.has(MILITIA)).toBe(true);
  });

  it('раскадровка самодостаточна и повторяется: тот же вход — те же кадры', () => {
    const result = fight(MIXED, FOE);
    const once = castOfRecord(result, 'attacker', { attacker: MIXED, defender: FOE });
    const twice = castOfRecord(result, 'attacker', { attacker: MIXED, defender: FOE });
    expect(twice).toEqual(once);
  });
});

describe('границы моста', () => {
  it('мост состава не зовёт симуляцию и не бросает кубик', () => {
    const src = readFileSync(join(__dirname, 'faces.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/simulateBattle|resolveBattle|battle\/sim/);
    expect(src).not.toMatch(/Math\.random|seededRng/);
  });
});

const empty = (): Stack => ({ spear: 0, infantry: 0, archer: 0, cavalry: 0 });
