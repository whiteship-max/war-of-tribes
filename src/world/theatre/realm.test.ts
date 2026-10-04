import '@/game/pace.minute';
// Регион игрока в мире (docs/map_tw.md, 0.−2): логова — только в его регионе, походы и приказы за край — отказ
// миром, а не только картой. Дома — у самых рубежей (Альпы, Пиренеи, Карпаты, Сьерра-Морена): только там часть
// кольца логов лежит в чужом регионе, и правило вообще что-то решает; это утверждается в каждом тесте.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from '../local/LocalWorld';
import type { WorldSave } from '../local/state';
import { type GenSettlement, type WorldGen, generateWorld, isLair, makeLair } from '../gen';
import { coordKey, distance } from '../geo';
import { cellOf } from '../atlas/project';
import { AI_RANGE, LAIR_HOME_GAP, WORLD_ORIGIN } from '../data/tuning';
import { settleable } from '../land';
import { fitToSettle } from '../settle';
import { seeded } from '@/game/sim/random';
import type { Coord, PlayerProfile } from '../types';
import { beyondNote, homeTheatre, inHomeTheatre, theatreIndexAt } from './theatre';

const START = 1_700_000_000_000;

/** Ближайшая к долготе и широте клетка, где может встать город, — и в нужном регионе. */
function homeNear(lon: number, lat: number, region: string): Coord {
  const p = cellOf(lon, lat);
  const c = { x: WORLD_ORIGIN.x + Math.floor(p.col), y: WORLD_ORIGIN.y + Math.floor(p.row) };
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const at = { x: c.x + dx, y: c.y + dy };
        if (fitToSettle(at) && homeTheatre(at)?.id === region) return at;
      }
    }
  }
  throw new Error(`Нет места под город у ${lon}, ${lat} в регионе ${region}.`);
}

/** Дома у рубежей: кольцо логов задевает соседний регион. */
const HOMES: [string, Coord][] = [
  ['Инсбрук, Германия у Альп', homeNear(11.4, 47.26, 'germany')],
  ['Перпиньян, Франция у Пиренеев', homeNear(2.9, 42.7, 'france')],
  ['Кошице, Венгрия у Карпат', homeNear(21.26, 48.72, 'hungary')],
  ['Линарес, Аль-Андалус у Сьерра-Морены', homeNear(-3.63, 38.09, 'andalus')],
];

/** Доля мест под логово в кольце у дома, лежащих в чужом регионе: область, где правило что-то решает. */
function foreignShare(home: Coord): number {
  let spots = 0;
  let out = 0;
  for (let dy = -AI_RANGE; dy <= AI_RANGE; dy++) {
    for (let dx = -AI_RANGE; dx <= AI_RANGE; dx++) {
      const d = Math.hypot(dx, dy);
      if (d < LAIR_HOME_GAP || d > AI_RANGE) continue;
      if (!settleable(home.x + dx, home.y + dy)) continue;
      spots++;
      if (!inHomeTheatre(home, { x: home.x + dx, y: home.y + dy })) out++;
    }
  }
  return spots ? out / spots : 0;
}

const profile = (): PlayerProfile =>
  ({
    name: 'Тест',
    pop: 300,
    defense: 900,
    units: { warrior: 40, scout: 6 },
    army: { legionary: 40, spearman: 30, archer: 20 },
    warning: 120,
    stock: { food: 900, wood: 600 },
    stash: 0,
    food: 9000,
    foodPerHour: 6000,
    soldierFoodPerHour: 40,
  }) as PlayerProfile;

interface Inside {
  gen: WorldGen;
  save: WorldSave;
  byId: Map<string, GenSettlement>;
  spawnLair(at: number, rng: () => number): boolean;
}
const inside = (w: LocalWorld): Inside => w as unknown as Inside;

describe('логова — только в регионе игрока', () => {
  it('дома у рубежей: часть кольца логов лежит в чужом регионе', () => {
    for (const [name, home] of HOMES) expect(foreignShare(home), name).toBeGreaterThan(0.1);
  });

  it('генерация: ни одного логова за краем региона — ни сыпью, ни у порога', () => {
    let near = 0;
    let all = 0;
    for (const [name, home] of HOMES) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const gen = generateWorld(seed, home);
        expect(gen.home).toEqual(home);
        for (const s of gen.settlements) {
          if (!isLair(s)) continue;
          all++;
          if (distance(s, home) <= AI_RANGE) near++;
          expect(inHomeTheatre(home, s), `${name}, сид ${seed}: ${s.id} у ${s.x}|${s.y}`).toBe(true);
        }
      }
    }
    // Логова есть и у порога: правило не опустошило округу.
    expect(near).toBeGreaterThan(HOMES.length * 6);
    expect(all).toBeGreaterThan(near);
  });

  it('генерация: свои логова сыпи — те же место, имя и номер, что и без правила', () => {
    // Номер логова лежит в сохранении: не своё тянет номер и имя, и счёт у своих не сдвигается. Сверка — с миром
    // без дома в регионе (дом на ничьей земле: рамки нет) того же сида: всё, что там стоит в регионе, кроме логов
    // у порога, стоит и здесь буква в букву.
    const home = HOMES[0][1];
    const t = theatreIndexAt(home.x, home.y);
    const sea = { x: WORLD_ORIGIN.x + 5, y: WORLD_ORIGIN.y + 5 };
    expect(theatreIndexAt(sea.x, sea.y), 'дом-сверка — на ничьей земле').toBe(0);
    let compared = 0;
    for (const seed of [1, 2, 3]) {
      const wide = generateWorld(seed, sea).settlements.filter(
        (s) => theatreIndexAt(s.x, s.y) === t && distance(s, home) >= LAIR_HOME_GAP && distance(s, sea) >= LAIR_HOME_GAP,
      );
      const mine = new Map(generateWorld(seed, home).settlements.map((s) => [s.id, s]));
      compared += wide.length;
      for (const s of wide) expect(mine.get(s.id), `${s.id}`).toEqual(s);
    }
    expect(compared, 'в регионе есть логова сыпи').toBeGreaterThan(10);
  });

  it('по ходу партии: мир заводит логово только в регионе игрока', () => {
    let made = 0;
    for (const [name, home] of HOMES) {
      const world = new LocalWorld({ seed: 7, home, now: () => START, storage: null });
      const w = inside(world);
      const before = w.gen.settlements.length;
      for (let k = 0; k < 200; k++) w.spawnLair(START, seeded(1000 + k));
      const born = w.gen.settlements.slice(before);
      made += born.length;
      for (const s of born) expect(inHomeTheatre(home, s), `${name}: ${s.id} у ${s.x}|${s.y}`).toBe(true);
    }
    expect(made, 'мир заводил логова').toBeGreaterThan(HOMES.length * 5);
  });

  it('сохранение с логовом за краем (до правила): такое логово в мир не встаёт', () => {
    const home = HOMES[0][1];
    let json: string | null = null;
    const storage = { read: () => json, write: (s: string) => void (json = s) };
    const first = new LocalWorld({ seed: 7, home, now: () => START, storage });
    const save = inside(first).save;
    const beyond = { x: home.x, y: home.y + 14 };
    expect(inHomeTheatre(home, beyond), 'клетка за краем').toBe(false);
    const ok = inside(first).gen.settlements.find((s) => isLair(s) && inHomeTheatre(home, s))!;
    const within = { x: ok.x + 1, y: ok.y };
    save.spawned.push({ id: 'l90', x: beyond.x, y: beyond.y, name: 'Чужое' }, { id: 'l91', x: within.x, y: within.y, name: 'Своё' });
    void first.persist();
    const second = inside(new LocalWorld({ seed: 7, home, now: () => START, storage }));
    expect(second.byId.has('l91'), 'своё логово из сохранения на месте').toBe(true);
    expect(second.byId.has('l90'), 'логово за краем').toBe(false);
  });
});

describe('походы и приказы за край — отказ миром', () => {
  /** Мир у Инсбрука и чужое место в Италии за Альпами, вложенное в мир в обход генерации (так стоял бы чужой двор). */
  async function setup() {
    const home = HOMES[0][1];
    const world = new LocalWorld({ seed: 7, home, now: () => START, storage: null, reveal: true });
    const w = inside(world);
    // Две клетки чужой суши у дома: под чужое место и голая земля.
    const spots: Coord[] = [];
    for (let r = LAIR_HOME_GAP; r <= AI_RANGE && spots.length < 2; r++) {
      for (let a = 0; a < 64 && spots.length < 2; a++) {
        const c = { x: Math.round(home.x + Math.cos((a / 64) * Math.PI * 2) * r), y: Math.round(home.y + Math.sin((a / 64) * Math.PI * 2) * r) };
        if (spots.some((o) => distance(o, c) < 3)) continue;
        if (settleable(c.x, c.y) && !inHomeTheatre(home, c) && theatreIndexAt(c.x, c.y) > 0 && !w.gen.byKey.has(coordKey(c.x, c.y))) spots.push(c);
      }
    }
    expect(spots.length, 'чужая суша у дома').toBe(2);
    const far = makeLair('x1', spots[0].x, spots[0].y, 'За Альпами');
    w.gen.settlements.push(far);
    w.gen.byKey.set(coordKey(far.x, far.y), far);
    w.byId.set(far.id, far);
    const own = w.gen.settlements.filter((s) => isLair(s) && s.id !== 'x1').sort((a, b) => distance(home, a) - distance(home, b))[0];
    expect(own, 'своё логово у дома').toBeTruthy();
    await world.sync(profile());
    return { world, home, far, land: spots[1], own };
  }

  it('разведка и поддержка за край не уходят; в своём регионе — уходят', async () => {
    const { world, home, far, own } = await setup();
    const out = await world.send({ target: far.id, mission: 'scout', units: { scout: 1 } });
    expect(out.error).toBe(beyondNote(home));
    expect(out.march).toBe(null);
    const ok = await world.send({ target: own.id, mission: 'scout', units: { scout: 1 } });
    expect(ok.error).toBe(null);
    expect(ok.march?.to).toEqual({ x: own.x, y: own.y });
  });

  it('агента за край не отправить — ни на место, ни на голую землю; к своей цели — идёт', async () => {
    const { world, home, far, land, own } = await setup();
    expect(await world.moveFigure('scout', { x: far.x, y: far.y })).toBe(beyondNote(home));
    expect(await world.moveFigure('general', land)).toBe(beyondNote(home));
    expect(await world.moveFigure('scout', { x: own.x, y: own.y })).toBe(null);
  });

  it('приказ лазутчику и дипломату у места за краем — с причиной «за краем»', async () => {
    const { world, home, far } = await setup();
    for (const agent of ['spy', 'diplomat'] as const) {
      const opts = await world.orders(agent, far.id);
      expect(opts.length, agent).toBeGreaterThan(0);
      for (const o of opts) {
        expect(o.can, `${agent}: ${o.id}`).toBe(false);
        expect(o.reason, `${agent}: ${o.id}`).toBe(beyondNote(home));
      }
    }
    expect((await world.order('probe', far.id)).error).toBe(beyondNote(home));
  });
});
