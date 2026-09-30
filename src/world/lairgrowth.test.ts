import '@/game/pace.minute';
// Рост логова и всё, что из него следует (docs/lair_growth.md): сила от возраста и жителей,
// набег — всё логово через защиту новичка, осада по сухому прогону боя, одно окно после
// падения, оружие своей дверью, строка летописи для старой партии и выход из осады новичку.
//
// Каждый тест — свойство одного правила, и точки выборки в нём проверяются на то, что они
// внутри области, где правило спрашивается: иначе тест зеленел бы даром.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld, HOME_ID } from './local/LocalWorld';
import { isLair, type GenSettlement } from './gen';
import { lairRaid, lairShield, shieldPower, shieldVillagers } from './lairs';
import { troopPower } from '@/game/battle/price';
import { SIEGE_IMMUNE } from './data/tuning';
import { LAIRS_GREW_TEXT, WORLD_SAVE_VERSION, parseWorldSave, type StoredMarch, type WorldSave } from './local/state';
import { applyEffects, playerProfile } from './bridge';
import { createInitialState } from '@/game/state';
import type { FieldOutcome } from './battle';
import type { PlayerProfile } from './types';

const START = 1_700_000_000_000;
const MIN = 60_000;

/** Мир с ручными часами и сохранением в памяти. */
function makeWorld(seed: number) {
  let now = START;
  let saved: string | null = null;
  const storage = {
    read: (): string | null => saved,
    write: (json: string): void => {
      saved = json;
    },
  };
  const world = new LocalWorld({ seed, now: () => now, storage });
  return {
    world,
    advance: (ms: number): void => {
      now += ms;
    },
    at: (t: number): void => {
      now = t;
    },
    now: (): number => now,
    saved: (): string | null => saved,
  };
}

/** Внутренности мира, которые тесту положено видеть. */
interface Inside {
  save: WorldSave;
  gen: { settlements: GenSettlement[] };
  powerNow(s: GenSettlement, now: number): number;
  wallField(m: StoredMarch, at: number): { field: FieldOutcome };
  beginSiege(m: StoredMarch, at: number, field: FieldOutcome): boolean;
  lairArmsAt(s: GenSettlement, at: number, power: number): number;
  treasury(s: GenSettlement, now: number): number;
}
const inside = (w: LocalWorld): Inside => w as unknown as Inside;

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.5),
  defense: 300,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 10 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  ...over,
});

describe('сила логова растёт от возраста и жителей — и ни от чего из обороны', () => {
  it('оборона, ополчение, войско и уровни построек силу логова не двигают; жители — двигают', async () => {
    for (const seed of [7, 42]) {
      const w = makeWorld(seed);
      const base = profile({ levels: { palisade: 2, tower: 2, barracks: 2, town_hall: 2 } });
      await w.world.sync(base);
      const lairs = inside(w.world).gen.settlements.filter(isLair);
      expect(lairs.length, `мир ${seed}: логова есть`).toBeGreaterThan(0);
      const at = w.now();
      const before = lairs.map((s) => inside(w.world).powerNow(s, at));

      // Всё, что вкладывают в защиту: число обороны, ополчение и стрелки на стене, войско,
      // уровни укреплений и ратуши. Ни одно из них логово кормить не должно.
      await w.world.sync({
        ...base,
        defense: 90_000,
        militia: 5_000,
        militiaArchers: 300,
        army: { legionary: 400, spearman: 300 },
        levels: { palisade: 10, tower: 10, barracks: 10, town_hall: 10 },
      });
      lairs.forEach((s, i) => expect(inside(w.world).powerNow(s, at), `мир ${seed}/${s.id}`).toBe(before[i]));

      // А жители — растят: город стал больше, и логово это видит.
      await w.world.sync({ ...base, pop: base.pop * 2 });
      lairs.forEach((s, i) => expect(inside(w.world).powerNow(s, at), `мир ${seed}/${s.id}`).toBeGreaterThan(before[i]));
    }
  });
});

describe('набег — всё логово через защиту новичка', () => {
  /**
   * Сколько часов мира надо прогнать, чтобы набегов пришло несколько. Горизонт выводится из
   * окна защиты, а не пишется числом: павший город не трогают до конца окна (`scheduleAi`), и
   * второй набег приходит только после него. Литерал «три часа» был верен, пока окно стояло
   * сорок пять минут; с окном в настоящие сутки (пачка 5) он молча давал по одному набегу на
   * мир, и свойство проверялось на одной точке вместо нескольких.
   */
  const RAID_HOURS = Math.ceil(SIEGE_IMMUNE / 3_600_000) + 6;

  /** Прогнать мир и собрать отряды, вышедшие на деревню, с силой логова в минуту выхода. */
  async function raids(seed: number, p: PlayerProfile, hours: number) {
    const w = makeWorld(seed);
    await w.world.sync(p);
    const seen = new Map<string, { power: number; lair: number }>();
    for (let t = 0; t < hours * 60; t++) {
      w.advance(MIN);
      await w.world.sync(p);
      for (const m of inside(w.world).save.marches) {
        if (m.own || m.targetId !== HOME_ID || seen.has(m.id)) continue;
        const src = inside(w.world).gen.settlements.find((s) => s.id === m.fromId)!;
        seen.set(m.id, { power: m.power, lair: inside(w.world).powerNow(src, m.departAt) });
      }
    }
    return [...seen.values()];
  }

  /** Мощь войска тестового слепка — ниже порога защиты слабого войском: зрелость здесь решают жители. */
  const ARMY = troopPower(profile().army ?? {});

  it('пока логово город не замечает, набег не выходит вовсе', async () => {
    const pop = shieldVillagers(0) - 1;
    // Точка внутри области правила: защита ровно ноль, а не «мала».
    expect(lairShield(pop, ARMY)).toBe(0);
    for (const seed of [7, 42]) {
      expect(await raids(seed, profile({ pop }), 3), `мир ${seed}`).toEqual([]);
    }
  }, 120_000);

  it('защита слабого — и жителями, и всем войском: малый город с сильным войском логово замечает, хутор с дубинщиками — нет', async () => {
    // Слово владельца по 14.35, п. 6: защита слабого по той же лестнице и войску, без срока. Войско — всё, мощью
    // (`price.troopPower`): хутор с сотней дубинщиков войском слаб и остаётся под защитой.
    const pop = shieldVillagers(0) - 1;
    const strong = { legionary: Math.ceil(shieldPower(0.5) / troopPower({ legionary: 1 })) };
    const hamlet = { clubman: 124 };
    // Граница области: жители — под защитой, сильное войско — выше порога, хутор — ниже.
    expect(lairShield(pop, 0)).toBe(0);
    expect(lairShield(pop, troopPower(strong))).toBeGreaterThan(0);
    expect(lairShield(pop, troopPower(hamlet))).toBe(0);
    let noticed = 0;
    for (const seed of [7, 42]) {
      noticed += (await raids(seed, profile({ pop, army: strong }), RAID_HOURS)).length;
      expect(await raids(seed, profile({ pop, army: hamlet }), 3), `мир ${seed}: хутор с дубинщиками`).toEqual([]);
    }
    expect(noticed, 'малый город с сильным войском: набеги выходили').toBeGreaterThan(0);
  }, 120_000);

  it('вышедший набег — вся сила логова, умноженная на защиту, и никакой доли сверх неё', async () => {
    const pop = shieldVillagers(0.5);
    const shield = lairShield(pop, ARMY);
    // Внутри области: защита уже не ноль и ещё не единица — множитель виден.
    expect(shield).toBeGreaterThan(0);
    expect(shield).toBeLessThan(1);
    let checked = 0;
    for (const seed of [7, 42]) {
      for (const r of await raids(seed, profile({ pop }), RAID_HOURS)) {
        expect(r.power).toBeCloseTo(Math.max(2, lairRaid(r.lair, pop, ARMY)), 6);
        expect(r.power).toBeCloseTo(Math.max(2, r.lair * shield), 6);
        checked++;
      }
    }
    expect(checked, 'набеги выходили').toBeGreaterThan(2);
  }, 120_000);
});

describe('осаду решает бой у стены, прогнанный всухую', () => {
  /** Каждый пришедший к деревне отряд: прорвался бы он и сел ли лагерем. */
  async function arrivals(seed: number, p: PlayerProfile, hours: number) {
    const w = makeWorld(seed);
    const i = inside(w.world);
    const won = new Map<string, boolean>();
    const sat = new Set<string>();
    const wall = i.wallField.bind(w.world);
    i.wallField = (m, at) => {
      const out = wall(m, at);
      won.set(m.id, out.field.won);
      return out;
    };
    const begin = i.beginSiege.bind(w.world);
    i.beginSiege = (m, at, field) => {
      const r = begin(m, at, field);
      if (r) sat.add(m.id);
      return r;
    };
    await w.world.sync(p);
    for (let t = 0; t < hours * 60; t++) {
      w.advance(MIN);
      await w.world.sync(p);
    }
    return { won, sat };
  }

  it('лагерем садится только тот, кого отбили бы, и никогда тот, кто прорвался бы', async () => {
    let held = 0;
    let broke = 0;
    let sieges = 0;
    for (const seed of [7, 42, 77]) {
      // Крепость: любой набег проиграл бы бой у стены — часть садится лагерем.
      const strong = await arrivals(seed, profile({ militia: 2000 }), 4);
      // Пустой город: любой набег прорвался бы — лагеря нет ни разу.
      const weak = await arrivals(seed, profile({ militia: 0, army: { clubman: 1 } }), 4);
      for (const { won, sat } of [strong, weak]) {
        for (const [id, w] of won) {
          if (w) broke++;
          else held++;
          if (sat.has(id)) {
            sieges++;
            expect(w, `${seed}/${id}: лагерь у того, кто прорвался бы`).toBe(false);
          }
        }
      }
    }
    // Обе стороны правила спрошены: были и отбитые, и прорвавшиеся, и лагеря.
    expect(held, 'отбитые были').toBeGreaterThan(0);
    expect(broke, 'прорвавшиеся были').toBeGreaterThan(0);
    expect(sieges, 'лагеря вставали').toBeGreaterThan(0);
  }, 240_000);
});

describe('одно окно после падения: ни набега, ни осады', () => {
  it('прорыв ставит то же окно, что падение голодом, и набег в нём не выходит', async () => {
    let checked = 0;
    for (const seed of [7, 42]) {
      const w = makeWorld(seed);
      const p = profile({ pop: shieldVillagers(1), militia: 0, army: { clubman: 1 } });
      await w.world.sync(p);
      let fellAt = 0;
      for (let t = 0; t < 4 * 60 && !fellAt; t++) {
        w.advance(MIN);
        const pulse = await w.world.sync(p);
        const breach = pulse.reports.find((r) => r.id.endsWith('-defense') && r.battle && !r.won);
        if (breach) fellAt = breach.at;
      }
      expect(fellAt, `мир ${seed}: прорыв был`).toBeGreaterThan(0);
      const until = inside(w.world).save.siegeImmune[HOME_ID];
      expect(until, `мир ${seed}: окно — то же число`).toBe(fellAt + SIEGE_IMMUNE);

      const known = new Set(inside(w.world).save.marches.map((m) => m.id));
      let inWindow = 0;
      while (w.now() < until - MIN) {
        w.advance(MIN);
        const pulse = await w.world.sync(p);
        inWindow++;
        for (const m of inside(w.world).save.marches) {
          if (m.own || m.targetId !== HOME_ID || known.has(m.id)) continue;
          expect(m.departAt, `мир ${seed}: набег вышел в окне`).toBeGreaterThanOrEqual(until);
        }
        expect(pulse.siege, `мир ${seed}: осада в окне`).toBeNull();
      }
      // Окно длиннее самой долгой паузы между набегами — в нём набег обязан был бы выйти.
      expect(inWindow).toBeGreaterThan(26);
      checked++;
    }
    expect(checked).toBe(2);
  }, 240_000);
});

describe('оружие логова не растёт с городом', () => {
  it('тот же бой по тому же логову даёт то же оружие у малого и у большого города, а казну — разную', async () => {
    const w = makeWorld(42);
    await w.world.sync(profile({ pop: shieldVillagers(0.1) }));
    const i = inside(w.world);
    const lair = i.gen.settlements.find(isLair)!;
    const at = w.now();
    const smallPower = i.powerNow(lair, at);
    const smallArms = i.lairArmsAt(lair, at, smallPower);
    const smallGold = i.treasury(lair, at);
    await w.world.sync(profile({ pop: shieldVillagers(1) * 2 }));
    const bigPower = i.powerNow(lair, at);
    // Внутри области: логово у большого города заметно сильнее.
    expect(bigPower).toBeGreaterThan(smallPower * 1.5);
    expect(i.lairArmsAt(lair, at, bigPower)).toBe(smallArms);
    expect(i.treasury(lair, at)).toBeGreaterThan(smallGold);
  });
});

describe('старая партия узнаёт о росте логов строкой летописи', () => {
  it('сохранение мира версии 8 приводится к 9 и кладёт одну строку; девятое — ни одной', async () => {
    const w = makeWorld(7);
    await w.world.sync(profile());
    const fresh = JSON.parse(w.saved() as string) as WorldSave;
    expect(fresh.v).toBe(WORLD_SAVE_VERSION);

    const old = parseWorldSave(JSON.stringify({ ...fresh, v: 8, effects: [] }))!;
    expect(old.v).toBe(9);
    expect(old.effects.filter((e) => e.text === LAIRS_GREW_TEXT)).toHaveLength(1);
    expect(parseWorldSave(JSON.stringify(fresh))!.effects.some((e) => e.text === LAIRS_GREW_TEXT)).toBe(false);

    // И она доходит до летописи племени ровно один раз.
    const again = makeWorld(7);
    const back = new LocalWorld({
      seed: 7,
      now: () => again.now(),
      storage: { read: () => JSON.stringify({ ...fresh, v: 8, effects: [] }), write: () => {} },
    });
    const s = createInitialState();
    const first = await back.sync(playerProfile(s));
    applyEffects(s, first.effects);
    const second = await back.sync(playerProfile(s));
    applyEffects(s, second.effects);
    expect(s.log.filter((l) => l.text === LAIRS_GREW_TEXT)).toHaveLength(1);
  });
});

describe('пустой гарнизон в осаде — не тупик', () => {
  const panel = readFileSync(path.join(process.cwd(), 'src/ui/panels/SiegePanel.tsx'), 'utf8');

  it('погашенная вылазка говорит, кого нанять, и ведёт в казармы', () => {
    // Строка стоит ровно там, где вылазка погашена пустым гарнизоном.
    expect(panel).toMatch(/\{garrisonMen === 0 && <HireClubmen \/>\}/);
    const hint = panel.slice(panel.indexOf('function HireClubmen('), panel.indexOf('export function SiegePanel('));
    expect(hint).toMatch(/Наймите дубинщиков/);
    expect(hint).toMatch(/b\.type === 'barracks'/);
    expect(hint).toMatch(/openBuilding\(barracks\.id\)/);
  });
});
