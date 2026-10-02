// Место боя ролика TW: стена, ворота, город, лагерь, логово (docs/battle_tw.md, раздел 13). Место меняет, где стоят и
// как идут, но не кто и когда падает; ворота выбиты только по журналу; сквозь стену не ходят; тот же бой — тот же ролик.
import { describe, expect, it } from 'vitest';
import { standBattle } from '../battle-stand';
import { MAN_HEIGHT } from '../units';
import { twPlanOfRecord } from './record';
import { figureFrame, poseFigures, type TwPlan } from './plan';
import { CITY_M, SITE_KINDS, inWallBody, outOf, siteKindOf, type TwSiteKind } from './site';

const planOf = (query: string, site?: TwSiteKind | null): TwPlan => {
  const b = standBattle(new URLSearchParams(query));
  return twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide, site === undefined ? b.site : (site ?? undefined));
};

describe('место боя: строки и мера', () => {
  it('метки места — те же строки, что у мира; метр города — рост бойца на эталон', () => {
    expect([...SITE_KINDS]).toEqual(['wall', 'gate', 'sortie', 'camp', 'joint', 'lair']);
    expect(siteKindOf('wall')).toBe('wall');
    expect(siteKindOf('castle')).toBeNull();
    expect(siteKindOf(undefined)).toBeNull();
    expect(CITY_M).toBeCloseTo(MAN_HEIGHT / 1.79, 6);
  });

  it('каждое место строится и кадр без пустых чисел', () => {
    for (const kind of SITE_KINDS) {
      const q = kind === 'gate' ? 'replay=tw&men=300&foe=260&seed=4&site=gate' : `replay=tw&men=500&foe=460&seed=4&site=${kind}`;
      const p = planOf(q);
      expect(p.site?.kind, kind).toBe(kind);
      const fr = figureFrame(p.figures);
      for (const t of [0, p.clashAt, p.clashAt + 6, p.seconds * 0.8, p.seconds]) {
        poseFigures(p, t, fr);
        for (let i = 0; i < p.figures; i++) {
          expect(Number.isFinite(fr.x[i]) && Number.isFinite(fr.y[i]) && Number.isFinite(fr.z[i]), `${kind} ${t} ${i}`).toBe(true);
        }
      }
    }
  });
});

describe('место боя: штурм стены', () => {
  it('сквозь стену не ходят: в толще стены фигура только поверху', () => {
    // Набор: штурм берёт (420 против 560) и отбит (500 против 400) — в обоих есть выбитые ворота и лезущие.
    for (const [men, foe, seed] of [[420, 560, 1], [420, 560, 2], [420, 560, 3], [420, 560, 6], [500, 400, 3], [500, 400, 4], [500, 400, 6], [200, 600, 5]]) {
      const p = planOf(`replay=tw&men=${men}&foe=${foe}&seed=${seed}&site=wall`);
      const w = p.site!.wall!;
      const fr = figureFrame(p.figures);
      let inBody = 0;
      for (let t = 0; t <= p.seconds; t += 0.5) {
        poseFigures(p, t, fr);
        for (let i = 0; i < p.figures; i++) {
          if (!fr.shown[i] || !inWallBody(w, fr.x[i], fr.z[i])) continue;
          inBody++;
          expect(fr.y[i], `${men}/${foe} seed ${seed} t ${t} фигура ${i}`).toBeGreaterThan(w.base + w.top - 0.05);
        }
      }
      // Область правила не пуста: на стене стоят и через неё лезут.
      expect(inBody).toBeGreaterThan(0);
      void outOf;
    }
  });
});
