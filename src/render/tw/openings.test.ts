// Ролик штурма по проёмам (docs/siege_v2.md, 4.5; этап 2в): чем лезли — лестницы, таран, осадная башня, пролом — ролик
// берёт из записи (`BattleRecord.openings`), а кто и когда падает — из журнала, как прежде.
import { describe, expect, it } from 'vitest';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from './record';
import { figureFrame, poseFigures, slotUses, type TwPlan } from './plan';
import { OPENING_KINDS, inWallBody, type TwOpening } from './site';
import { OPENING_IDS } from '@/world/wall';

const planOf = (query: string): TwPlan => {
  const b = standBattle(new URLSearchParams(query));
  return twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide, b.site, undefined, b.openings);
};
const o = (id: TwOpening['id'], share = 1 / 3, round = 0): TwOpening => ({ id, share, round });

describe('проёмы штурма в ролике', () => {
  it('имена проёмов — те же строки, что у мира', () => {
    expect([...OPENING_KINDS]).toEqual([...OPENING_IDS]);
  });

  it('раскладка по слотам: ворота в середине, проломы с краёв, башня в свободный край, лестницы на себе — в один слот', () => {
    expect(slotUses([o('scaling')])).toEqual(['ladders', 'wall', 'wall']);
    expect(slotUses([o('ladders', 1)])).toEqual(['ladders', 'ladders', 'ladders']);
    expect(slotUses([o('gate', 1 / 3, 1), o('scaling')])).toEqual(['ladders', 'gate', 'wall']);
    expect(slotUses([o('breach', 2 / 3), o('scaling', 1 / 3)])).toEqual(['breach', 'ladders', 'breach']);
    expect(slotUses([o('breach', 1 / 3), o('scaling', 1 / 3)])).toEqual(['breach', 'wall', 'ladders']);
    expect(slotUses([o('breach', 1)])).toEqual(['breach', 'breach', 'breach']);
    expect(slotUses([o('tower'), o('ladders', 2 / 3)])).toEqual(['ladders', 'ladders', 'tower']);
  });

  it('лестницы — только там, где по ним шли; без тарана ворота целы и тарана нет', () => {
    const p = planOf('replay=tw&men=420&foe=560&seed=2&site=wall&open=scaling');
    const site = p.site!;
    expect(site.uses).toEqual(['ladders', 'wall', 'wall']);
    expect(site.ladders.length, 'точка внутри области: лестницы есть').toBeGreaterThan(0);
    for (const l of site.ladders) expect(Math.abs(l.x - p.slotX[0])).toBeLessThan(Math.abs(l.x - p.slotX[1]));
    expect(site.ram).toBeNull();
    expect(site.wall!.gateAt).toBeNull();
  });

  it('таран: ворота выбиты в миг, когда ядро открыло проём (событие widen), не раньше', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const b = standBattle(new URLSearchParams(`replay=tw&men=300&foe=560&seed=${seed}&site=wall&open=ram,ladders`));
      const p = twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide, b.site, undefined, b.openings);
      expect(p.site!.ram, 'таран у ворот').not.toBeNull();
      const widen = b.result.log.find((e) => e.id === 'widen');
      if (!widen) {
        expect(p.site!.wall!.gateAt, 'проём не открылся — ворота целы').toBeNull();
        continue;
      }
      seen += 1;
      const gateAt = p.site!.wall!.gateAt;
      if (gateAt !== null) expect(gateAt).toBeGreaterThan(p.clashAt);
    }
    expect(seen, 'точка внутри области: ворота открывались хоть раз').toBeGreaterThan(0);
  });

  it('осадная башня: стоит в своём слоте, по её лестнице лезут вдвое гуще, сама лестница не рисуется', () => {
    const p = planOf('replay=tw&men=420&foe=560&seed=2&site=wall&open=tower');
    const site = p.site!;
    expect(site.tower).toBeTruthy();
    const towerSlot = site.uses!.indexOf('tower');
    const nearest = p.slotX.reduce((best, x, k) => (Math.abs(x - site.tower!.x) < Math.abs(p.slotX[best] - site.tower!.x) ? k : best), 0);
    expect(nearest).toBe(towerSlot);
    const lad = site.ladders.find((l) => l.tower);
    expect(lad?.queue.length).toBeGreaterThan(3);
  });

  it('место не меняет темпа потерь: тот же бой с проёмами и без — павшие те же', () => {
    const b = standBattle(new URLSearchParams('replay=tw&men=420&foe=560&seed=3&site=wall&open=ram,tower,b1'));
    const a = twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide, b.site, undefined, b.openings);
    const plain = twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide, b.site);
    const dead = (p: TwPlan): number[] => [...p.deathAt].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    expect(dead(a)).toEqual(dead(plain));
  });

  it('через пролом и с башни — поверху: в толще стены фигура только над ходом', () => {
    let inBody = 0;
    for (const open of ['b2', 'b1,tower', 'tower,ladders', 'ram,b1']) {
      for (const seed of [2, 3]) {
        const p = planOf(`replay=tw&men=300&foe=620&seed=${seed}&site=wall&open=${open}`);
        const w = p.site!.wall!;
        const fr = figureFrame(p.figures);
        for (let t = 0; t <= p.seconds; t += 0.5) {
          poseFigures(p, t, fr);
          for (let i = 0; i < p.figures; i++) {
            if (!fr.shown[i] || !inWallBody(w, fr.x[i], fr.z[i])) continue;
            inBody++;
            expect(fr.y[i], `${open} seed ${seed} t ${t} фигура ${i}`).toBeGreaterThan(w.base + w.top - 0.05);
          }
        }
      }
    }
    expect(inBody, 'точка внутри области: на стене стоят и через неё лезут').toBeGreaterThan(0);
  });
});
