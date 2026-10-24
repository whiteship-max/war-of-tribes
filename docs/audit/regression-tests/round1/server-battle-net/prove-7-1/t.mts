const root = process.argv[2];
const { simulateBattle } = await import(`./${root}/src/battle/sim.ts`);
const { deploySetup } = await import(`./${root}/src/battle/setup.ts`);
const { buildCast, frameAt } = await import(`./${root}/src/battle/replay.ts`);
const IDS = ['cavalry-broke-archers','flank-turned','cavalry-intercepted'];
let checked = 0, fail = 0;
for (let seed = 1; seed <= 40; seed++) {
  const r = simulateBattle({ seed, attacker: deploySetup({ heavy: 600 }), defender: deploySetup({ infantry: 300, archer: 300 }) });
  const cast = buildCast(r, 'attacker');
  for (const m of cast.marks) {
    if (!IDS.includes(m.id) || !m.sector) continue;
    for (const c of cast.sectors) {
      if (c.side !== m.side || !c.byFace.some((f) => f.kind === 'heavy' && f.figures > 0) || c.brokenAt !== null && c.brokenAt <= m.t) continue;
      const fr = frameAt(cast, m.t + 1.3);
      const s = fr.sectors.find((x) => x.side === c.side && x.sector === c.sector);
      if (!s || s.flee > 0) continue;
      checked++;
      if (s.dx === 0 && s.dz === 0) { fail++; if (fail < 3) console.log('FAIL seed', seed, m.id, m.side, m.sector, 'heavy sector', c.sector, 'dx/dz', s.dx, s.dz); }
    }
  }
}
console.log(root, 'checked', checked, 'stuck', fail);
process.exit(checked > 0 && fail === 0 ? 0 : 1);
