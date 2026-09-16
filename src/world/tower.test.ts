// Башня бьёт по лагерю — в настоящем мире и через одну дверь (`LocalWorld.campArmy`).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { menOfPower } from './garrison';
import { campSides, sideWorks } from './works';
import { CAMP_WOOD, CAMP_WORKS_RIPE } from './data/tuning';
import type { PlayerProfile, WorldPulse } from './types';
import type { TowerGun } from './bombard';
import { shieldVillagers } from './lairs';

const START = 1_700_000_000_000;
const MIN = 60_000;
const CATAPULT: TowerGun = { slow: 2 / 7, thin: 0.1, crew: 4, seats: 4 };

/** Деревня, которую штурмовать бессмысленно, — тот же слепок, что у `works.test.ts`. Лучников дома двадцать. */
const holdout: PlayerProfile = {
  name: 'Тест',
  // Жителей чуть выше защиты новичка: набег выходит, но мал (`lairs.lairShield`).
  pop: shieldVillagers(0.1),
  defense: 100_000,
  // Ополчение, которое любой такой набег отобьёт: отряд садится лагерем, потому что
  // штурм не удался бы (`LocalWorld.sitsDown`), а не потому, что число обороны велико.
  militia: 1000,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  army: { legionary: 40, spearman: 30, archer: 20 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
};
const gunned: PlayerProfile = { ...holdout, tower: CATAPULT };

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

interface Frozen {
  save: string;
  siege: NonNullable<WorldPulse['siege']>;
}

/** Мир до первой осады деревни со слепком `p` — и его сохранение в эту минуту. */
async function freeze(p: PlayerProfile, seed = 7): Promise<Frozen> {
  let now = START;
  const store = memory();
  const world = new LocalWorld({ seed, now: () => now, storage: store });
  await world.sync(p);
  for (let i = 0; i < 3000; i++) {
    now += 20_000;
    const pulse = await world.sync(p);
    if (pulse.siege) return { save: store.read() as string, siege: pulse.siege };
  }
  throw new Error('осады так и не случилось');
}

async function thaw(fz: Frozen, at: number, p: PlayerProfile, seed = 7) {
  let now = at;
  const store = memory(fz.save);
  const world = new LocalWorld({ seed, now: () => now, storage: store });
  const pulse = await world.sync(p);
  return { world, pulse, store, set: (t: number): void => void (now = t) };
}

describe('башня бьёт по лагерю', () => {
  it('рогатки со стороны города растут медленнее, лагерь редеет, а проход держат строившие', async () => {
    const plain = await freeze(holdout);
    const fired = await freeze(gunned);
    expect(fired.siege.since, 'та же осада').toBe(plain.siege.since);
    const since = fired.siege.since;
    // Область: осада стоит, фронт ещё не дозрел ни с обстрелом, ни без.
    for (const m of [7, 14, 21, 27]) {
      const at = since + m * MIN;
      expect(at, `${m} мин внутри окна голода`).toBeLessThan(fired.siege.starvesAt);
      expect(sideWorks(since, at, 'front', CAMP_WOOD), `${m} мин: фронт не дозрел`).toBeLessThan(1);
      const a = (await thaw(plain, at, holdout)).pulse.siege!;
      const b = (await thaw(fired, at, gunned)).pulse.siege!;
      expect(b.fire, `${m} мин: башня бьёт`).toBeTruthy();
      expect(b.fire!.thin, `${m} мин: выбито ровно со временем`).toBeCloseTo((0.1 * m * MIN) / CAMP_WORKS_RIPE, 9);
      const front = campSides(b, at).front.works;
      expect(front, `${m} мин: фронт под обстрелом`).toBeCloseTo(campSides(a, at).front.works * (5 / 7), 9);
      expect(campSides(b, at).rear.works, `${m} мин: тыл обстрел не достаёт`).toBeCloseTo(campSides(a, at).rear.works, 9);
      expect(b.builders, `${m} мин: строившие те же`).toBe(a.builders);
    }
    // К дозреванию обстрела выбита десятая часть мощи — лагерь, которым бьются, тоньше.
    const save = JSON.parse(fired.save);
    const power = save.marches.find((x: { id: string }) => x.id === save.sieges.home.campId).power as number;
    const ripe = (await thaw(fired, since + CAMP_WORKS_RIPE, gunned)).pulse.siege!;
    expect(ripe.campMen, 'люди лагеря — из прорежённой мощи').toBe(menOfPower(power * 0.9));
    expect(ripe.builders, 'а проход — от строивших').toBe(menOfPower(power));
  }, 120_000);

  it('выбитое записывается в войско лагеря одним разом, когда осада снята', async () => {
    const fired = await freeze(gunned);
    const save = JSON.parse(fired.save);
    const campId: string = save.sieges.home.campId;
    const before = save.marches.find((x: { id: string }) => x.id === campId).power as number;
    const end = fired.siege.starvesAt;
    expect(end - fired.siege.since, 'голод позже дозревания обстрела').toBeGreaterThan(CAMP_WORKS_RIPE);
    const t = await thaw(fired, end - 1000, gunned);
    t.set(end + 1000);
    await t.world.sync(gunned);
    const after = JSON.parse(t.store.read() as string);
    expect(after.sieges.home, 'осада снята').toBeUndefined();
    const camp = after.marches.find((x: { id: string }) => x.id === campId);
    expect(camp, 'лагерь ушёл домой').toBeTruthy();
    expect(camp.power, 'в войско записано выбитое к минуте снятия').toBeCloseTo(before * 0.9, 9);
  }, 120_000);

  it('расчёт ушёл — башня замолкает, а выбитое остаётся выбитым', async () => {
    const fired = await freeze(gunned);
    const since = fired.siege.since;
    const change = since + 14 * MIN;
    const late = since + CAMP_WORKS_RIPE;
    expect(late, 'точка внутри окна голода').toBeLessThan(fired.siege.starvesAt);
    // Лучников дома не стало: слепок везёт войско без них.
    const noArchers: PlayerProfile = { ...gunned, army: { legionary: 40, spearman: 30 } };
    const t = await thaw(fired, change, noArchers);
    const at14 = (0.1 * 14 * MIN) / CAMP_WORKS_RIPE;
    t.set(late);
    const view = (await t.world.sync(noArchers)).siege!;
    expect(view.fire, 'выбитое к 14-й минуте помнится').toBeTruthy();
    expect(view.fire!.thin, 'после ухода расчёта не растёт').toBeCloseTo(at14, 9);
    expect(view.fire!.slow, 'рогатки больше не замедляет').toBe(0);
  }, 120_000);

  it('обстрел прикладывается к лагерю в одном месте, и бой про него не знает', () => {
    const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const lw = strip(readFileSync(path.join(process.cwd(), 'src/world/local/LocalWorld.ts'), 'utf8'));
    const count = (re: RegExp): number => (lw.match(re) ?? []).length;
    // campArmy — чтение лагеря, liftSiege — единственная запись выбитого.
    expect(count(/\bthinAt\(/g), 'thinAt: campArmy и liftSiege').toBe(2);
    expect(count(/\bfirePlan\(/g), 'firePlan: только campArmy').toBe(1);
    expect(count(/\breaim\(/g), 'reaim: только aimTower').toBe(1);
    expect(count(/\baimOf\(/g), 'aimOf: только aimTower').toBe(1);
    const body = lw.slice(lw.indexOf('private campArmy('), lw.indexOf('private aimTower('));
    expect(body, 'чтение обстрела — внутри campArmy').toMatch(/thinAt\(w\.fire, at\)/);
    expect(body).toMatch(/firePlan\(w\.fire, w\.wood\)/);
    // Никто, кроме мира и самого модуля, обстрел не считает; ядро боя о нём не знает.
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), 'src'));
    for (const f of files) {
      const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
      const src = strip(readFileSync(f, 'utf8'));
      if (rel === 'src/world/bombard.ts' || rel === 'src/world/local/LocalWorld.ts') continue;
      expect(src, rel).not.toMatch(/\b(thinAt|firePlan|reaim|aimOf)\(/);
      if (rel.startsWith('src/battle/')) expect(src, rel).not.toMatch(/bombard|TowerGun|engine/i);
    }
  });
});
