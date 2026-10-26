// Конный удар в ролике (BTL-8, п. 2; архив round1/server-battle-net/prove-7-1): конница — оба рода (`HORSE_KINDS`). Прежде ролик
// узнавал конный сектор только по лёгкой коннице, и латные всадники, обошедшие фланг или ударившие по лучникам, стояли на месте.
import { describe, expect, it } from 'vitest';
import { simulateBattle } from './sim';
import { deploySetup } from './setup';
import { buildCast, frameAt } from './replay';
import { HORSE_KINDS } from './types';

const CHARGES = ['cavalry-broke-archers', 'flank-turned', 'cavalry-intercepted'];

describe('конный удар в ролике — у обоих конных родов', () => {
  for (const kind of HORSE_KINDS) {
    it(`${kind}: сектор с конницей выносит в удар`, () => {
      let checked = 0;
      const stuck: string[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        const r = simulateBattle({ seed, attacker: deploySetup({ [kind]: 600 }), defender: deploySetup({ infantry: 300, archer: 300 }) });
        const cast = buildCast(r, 'attacker');
        for (const m of cast.marks) {
          if (!CHARGES.includes(m.id) || !m.sector) continue;
          for (const c of cast.sectors) {
            if (c.side !== m.side || !c.byFace.some((f) => f.kind === kind && f.figures > 0)) continue;
            if (c.brokenAt !== null && c.brokenAt <= m.t) continue;
            const s = frameAt(cast, m.t + 1.3).sectors.find((x) => x.side === c.side && x.sector === c.sector);
            if (!s || s.flee > 0) continue;
            checked += 1;
            if (s.dx === 0 && s.dz === 0) stuck.push(`сид ${seed}, ${m.id}, сектор ${c.sector}`);
          }
        }
      }
      expect(checked, 'точка внутри области: конные удары в журнале есть').toBeGreaterThan(0);
      expect(stuck.slice(0, 3)).toEqual([]);
    });
  }
});
