import { describe, expect, it } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { armySize, commandCap, defense, soldierPower } from '@/game/derived';
import { applyExpedition, sendableUnits } from '@/game/sim/expedition';
import { LocalWorld } from './local/LocalWorld';
import { generateWorld } from './gen';
import { distance, marchSeconds, terrainAt, terrainFactor, travelSeconds } from './geo';
import { FEATURE, cellCost, dropGeography, featuresAt, landmasses, roadNet } from './geography';
import { TERRAIN_META } from './data/terrain';
import { CLAIM_REACH, claimsNear, claimsOf, ownerAt } from './territory';
import { precisionOf, readIntel } from './intel';
import { temperOf } from './diplomacy';
import { stackLosses } from './combat';
import { resolveField } from './battle';
import { garrisonOf } from './garrison';
import { defenseLock } from './store';
import { presetFormation, toArmySetup } from '@/game/battle/formation';
import type { ArmySetup, Stack } from '@/battle';
import { playerProfile, syncAway, toOutcome } from './bridge';
import { awayOf, homeOf } from './muster';
import { FogMap, fogSaveBytes } from './fog';
import { WORLD_SAVE_VERSION, createWorldSave, parseWorldSave } from './local/state';
import { castOfRecord, troopsOfKinds } from '@/game/battle/faces';
import { TROOP_IDS } from '@/game/data/troops';
import { SURVEY_MAX, SURVEY_STEPS } from '@/game/data/survey';
import { gearOfTroop, troopTotal } from '@/game/battle/kinds';
import {
  AI_WARNING_BASE,
  DEFENSE_FREEZE,
  AI_RANGE,
  HOME_SIGHT,
  INTEL_EXACT,
  INTEL_ROUGH,
  REVOLT_POWER_LOSS,
  INTEL_VAGUE,
  COST_BRIDGE,
  COST_FORD,
  COST_PASS,
  COST_RIDGE,
  COST_RIVER,
  COST_ROAD,
  PATH_SAMPLES_PER_CELL,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from './data/tuning';
import type { Coord, FigureView, Intel, MarchView, PlayerProfile, SettlementCard, SettlementView } from './types';

/**
 * Спящие случаи. Чужих дворов на карте не осталось ни одного: мир стал общим, а
 * замки на нём появятся при регистрации живых игроков. Механика цела — участников
 * у неё пока нет, и притворяться, что случай проверен, нельзя. Полный список:
 * `grep -rn waitsForPlayers src`.
 */
const waitsForPlayers = it.skip;

/**
 * Трактов на карте нет: они соединяли станы племён, а станов не осталось.
 * Прокладка цела — не хватает только концов. Вернутся вместе с городами.
 */
const waitsForCities = it.skip;

const START = 1_700_000_000_000;
const MINUTE = 60_000;

/** Мир с ручными часами и без сохранения: тесты не трогают localStorage. */
function makeWorld(seed = 7) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return {
    world,
    at: (t: number): void => {
      now = t;
    },
    advance: (ms: number): void => {
      now += ms;
    },
    now: (): number => now,
  };
}

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  // Выше AI_MIN_POP: посёлок нового масштаба, набеги ИИ по нему идут.
  pop: 120,
  defense: 30,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  // Вместимость отряда — работа Статуи. Без неё полководец не уведёт никого,
  // и это правильно: в тестах она задаётся так же, как её даёт здание.
  command: 60,
  stock: { food: 120, wood: 80 },
  stash: 0,
  ...over,
});

/** Ближайшее к дому чужое поселение — обычная цель первого похода. */
async function nearest(world: LocalWorld): Promise<SettlementView> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 24, y: info.home.y - 24, w: 48, h: 48 });
  const list = chunk.settlements.filter((s) => !s.mine);
  expect(list.length).toBeGreaterThan(0);
  return list.sort(
    (a, b) => distance(info.home, a) - distance(info.home, b),
  )[0];
}

const own = (marches: MarchView[]): MarchView[] => marches.filter((m) => m.own);

/**
 * Единственный способ ударить: довести полководца до цели и напасть. Отправки
 * набега «гонцом» в игре больше нет, поэтому и в тестах её быть не должно —
 * иначе они проверяли бы путь, которым игрок пройти не может.
 */
async function raidWith(
  w: ReturnType<typeof makeWorld>,
  target: { id: string; x: number; y: number },
  p: PlayerProfile,
  setup: ArmySetup | null = null,
) {
  await w.world.sync(p);
  expect(await w.world.setGarrison(p.army ?? {})).toBeNull();
  // Дружина собирается не мгновенно: ждём, пока она дойдёт до полководца.
  const gathering = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
  if (gathering.readyAt > w.now()) w.at(gathering.readyAt);
  await w.world.sync(p);
  expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
  const walking = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
  w.at(walking.arriveAt);
  await w.world.sync(p);
  const res = await w.world.attack({ setup });
  const pulse = await w.world.sync(p);
  return { res, pulse, walk: walking.arriveAt - walking.departAt };
}

describe('генерация мира', () => {
  it('воспроизводима по сиду', () => {
    const a = generateWorld(12345);
    const b = generateWorld(12345);
    expect(b.home).toEqual(a.home);
    expect(b.allyTribe).toBe(a.allyTribe);
    expect(b.tribes).toEqual(a.tribes);
    expect(b.settlements).toEqual(a.settlements);
  });

  it('другой сид даёт другой мир', () => {
    const a = generateWorld(1);
    const b = generateWorld(2);
    expect(b.settlements).not.toEqual(a.settlements);
  });

  it('ландшафт клетки зависит только от сида и координат', () => {
    for (const [x, y] of [
      [WORLD_ORIGIN.x + 3, WORLD_ORIGIN.y + 3],
      [WORLD_ORIGIN.x + 77, WORLD_ORIGIN.y + 120],
    ]) {
      expect(terrainAt(99, x, y)).toBe(terrainAt(99, x, y));
    }
  });

  it('деревня игрока стоит в обжитой области, а не в центре сетки', () => {
    const w = generateWorld(4242);
    const center = { x: WORLD_ORIGIN.x + WORLD_SIZE / 2, y: WORLD_ORIGIN.y + WORLD_SIZE / 2 };
    expect(w.home).not.toEqual(center);
    // Рядом обязательно есть соседи — иначе на карту незачем смотреть.
    const near = w.settlements.filter((s) => distance(s, w.home) <= 12);
    expect(near.length).toBeGreaterThan(0);
    // Но не на пороге: набег ИИ не должен приходить мгновенно.
    expect(w.settlements.every((s) => distance(s, w.home) >= 3)).toBe(true);
  });

  it('поселения не садятся в воду и не громоздятся в одной клетке', () => {
    const w = generateWorld(777);
    const seen = new Set<string>();
    for (const s of w.settlements) {
      expect(terrainAt(w.seed, s.x, s.y)).not.toBe('water');
      const key = `${s.x}|${s.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('география: реки, переходы, тракты', () => {
  const SEED = 4242;

  /** Клетки русла без переправы на прямой между точками — их и переходят вброд. */
  const swims = (seed: number, a: Coord, b: Coord): number => {
    const dist = distance(a, b);
    const samples = Math.max(3, Math.round(dist * PATH_SAMPLES_PER_CELL));
    let n = 0;
    for (let i = 0; i < samples; i++) {
      const t = (i + 0.5) / samples;
      const f = featuresAt(seed, Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t));
      if (f & FEATURE.river && !(f & (FEATURE.bridge | FEATURE.ford))) n++;
    }
    return n;
  };

  it('земля одна на все сиды, а переправы повторяются при том же сиде', () => {
    // Главное обещание поворота: мир общий. Тот же квадрат при другом сиде обязан
    // дать ту же сушу, тот же лес и те же русла — иначе «одна карта на всех» это
    // слова. Разводит сиды только выбор переправ, и то не обязан.
    const box = (seed: number, pick: (x: number, y: number) => unknown): unknown[] => {
      const out: unknown[] = [];
      for (let y = WORLD_ORIGIN.y + 300; y < WORLD_ORIGIN.y + 340; y++) {
        for (let x = WORLD_ORIGIN.x + 300; x < WORLD_ORIGIN.x + 340; x++) out.push(pick(x, y));
      }
      return out;
    };
    const before = box(SEED, (x, y) => featuresAt(SEED, x, y));
    // Кэш выброшен целиком: всё считается заново — и с другим сидом.
    dropGeography();
    const other = box(SEED + 1, (x, y) => featuresAt(SEED + 1, x, y));
    // Признаки клетки целиком, включая мосты и броды: у двоих игроков на одной
    // реке переправа обязана стоять в одном месте, иначе карта общая только
    // на картинке.
    expect(other).toEqual(before);
    dropGeography();
    expect(box(SEED, (x, y) => featuresAt(SEED, x, y))).toEqual(before);
  });

  it('на карте есть и реки, и переправы, и хребты с перевалами', () => {
    let river = 0;
    let crossing = 0;
    let ridge = 0;
    let pass = 0;
    for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y += 2) {
      for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x += 2) {
        const f = featuresAt(SEED, x, y);
        if (f & FEATURE.river) river++;
        if (f & (FEATURE.bridge | FEATURE.ford)) crossing++;
        if (f & FEATURE.ridge) ridge++;
        if (f & FEATURE.pass) pass++;
      }
    }
    expect(river).toBeGreaterThan(100);
    expect(ridge).toBeGreaterThan(20);
    // Переход — редкость: на нём и держится ценность моста.
    expect(crossing).toBeGreaterThan(0);
    expect(crossing * 4).toBeLessThan(river);
    expect(pass).toBeGreaterThan(0);
    expect(pass * 2).toBeLessThan(ridge);
  });

  it('река — преграда, а не просто дорогая клетка', () => {
    // Порядок обязан быть таким: дорога дешевле равнины, мост её почти не
    // замечает, брод заметен, а лезть в воду без переправы дорого по-настоящему.
    expect(COST_ROAD).toBeLessThan(1);
    expect(COST_BRIDGE).toBeLessThan(COST_FORD);
    expect(COST_FORD).toBeLessThan(COST_RIVER);
    expect(COST_RIVER).toBeGreaterThan(TERRAIN_META.water.cost * 2);
    expect(COST_PASS).toBeLessThan(COST_RIDGE);
  });

  it('вода дорога вдвое против прежнего, но плыть по-прежнему можно', () => {
    expect(TERRAIN_META.water.cost).toBeGreaterThanOrEqual(7);
    expect(TERRAIN_META.water.cost).toBeLessThanOrEqual(8);
    expect(TERRAIN_META.water.cost).toBeGreaterThan(TERRAIN_META.hills.cost * 4);
    // Река всё равно тяжелее моря: иначе переправа перестала бы что-то значить,
    // а озеро стало бы преградой наравне с руслом.
    expect(COST_RIVER).toBeGreaterThan(TERRAIN_META.water.cost * 2);
  });

  it('замок игрока стоит на большой земле, а не на скале посреди океана', () => {
    // Сорок процентов настоящей карты — море, и попасть замком на трёхклеточный
    // островок теперь легче лёгкого. Проверка настоящая: суша размечается на
    // связные куски, и замок обязан оказаться на самом большом из них.
    const land = landmasses(1);
    const biggest = Math.max(...land.sizes);
    for (const seed of [1, 7, 29, 33, 68, 101, 900, 4242]) {
      const world = generateWorld(seed);
      const home = land.at(world.home.x, world.home.y);
      expect(home, `сид ${seed}: замок на суше`).toBeGreaterThanOrEqual(0);
      expect(land.sizeOf(home), `сид ${seed}: замок на материке`).toBe(biggest);
      expect(terrainAt(seed, world.home.x, world.home.y), `сид ${seed}: не пустыня`).not.toBe('desert');
      // И до ближайшего логова добираются посуху, а не вплавь.
      const near = world.settlements
        .filter((s) => distance(world.home, s) <= 26)
        .sort((a, b) => distance(world.home, a) - distance(world.home, b));
      expect(near.length, `сид ${seed}: логово по соседству`).toBeGreaterThan(0);
      // И до ближайшего идут посуху, а не вплавь: прямая дешевле самой воды.
      const best = Math.min(...near.map((s) => terrainFactor(seed, world.home, s)));
      expect(best, `сид ${seed}: до логова посуху`).toBeLessThan(TERRAIN_META.water.cost);
    }
  });

  it('путь через мост заметно быстрее пути вплавь через ту же реку', () => {
    // Пример настоящий, а не выдуманный: мост берётся с карты — с Дуная, Рейна
    // или Луары, — а берега по разные стороны русла в стороне от него. Ищется
    // он по всей Европе, а не вокруг дома: замок теперь встаёт где угодно, и
    // привязывать проверку правил местности к его окрестностям нечестно.
    let checked = 0;
    for (let y = WORLD_ORIGIN.y + 200; y < WORLD_ORIGIN.y + 520 && checked < 3; y += 1) {
      for (let x = WORLD_ORIGIN.x + 260; x < WORLD_ORIGIN.x + 620 && checked < 3; x += 1) {
        if (!(featuresAt(SEED, x, y) & FEATURE.bridge)) continue;
        const bridge = { x, y };
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as [number, number][]) {
          // Русло берётся недалеко от моста: на большом отдалении крюк перестаёт
          // окупаться, и это правильно — река не бесконечно дорога.
          for (const away of [5, 6, 7, 8]) {
            const r = { x: x + dx * away, y: y + dy * away };
            const f = featuresAt(SEED, r.x, r.y);
            if (!(f & FEATURE.river) || f & (FEATURE.bridge | FEATURE.ford)) continue;
            for (const [nx, ny] of [[1, 0], [0, 1], [1, 1], [1, -1]] as [number, number][]) {
              const a = { x: r.x - nx * 4, y: r.y - ny * 4 };
              const b = { x: r.x + nx * 4, y: r.y + ny * 4 };
              if (terrainAt(SEED, a.x, a.y) === 'water' || terrainAt(SEED, b.x, b.y) === 'water') continue;
              if (swims(SEED, a, b) === 0) continue;
              if (swims(SEED, a, bridge) > 0 || swims(SEED, bridge, b) > 0) continue;
              const direct = travelSeconds(SEED, a, b, { warrior: 5 });
              const via = travelSeconds(SEED, a, bridge, { warrior: 5 }) + travelSeconds(SEED, bridge, b, { warrior: 5 });
              // Крюк длиннее по расстоянию — и всё равно быстрее по времени.
              expect(distance(a, bridge) + distance(bridge, b)).toBeGreaterThan(distance(a, b));
              expect(via).toBeLessThan(direct);
              checked++;
              break;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  waitsForCities('по тракту идут быстрее, чем по целине', () => {
    const net = roadNet(SEED);
    expect(net.edges.length).toBeGreaterThan(0);
    let sameCell = 0;
    for (const key of net.cells) {
      const x = WORLD_ORIGIN.x + Math.floor(key / 4096);
      const y = WORLD_ORIGIN.y + (key % 4096);
      expect(featuresAt(SEED, x, y) & FEATURE.road).toBeTruthy();
      // Тракт быстрее любой целины — и равнины тоже.
      expect(cellCost(SEED, x, y)).toBeLessThan(TERRAIN_META.plain.cost);
      sameCell++;
    }
    expect(sameCell).toBeGreaterThan(100);
  });

  waitsForCities('дорога, дошедшая до реки, ставит мост', () => {
    for (const key of roadNet(SEED).cells) {
      const x = WORLD_ORIGIN.x + Math.floor(key / 4096);
      const y = WORLD_ORIGIN.y + (key % 4096);
      const f = featuresAt(SEED, x, y);
      if (f & FEATURE.river) expect(f & FEATURE.bridge).toBeTruthy();
    }
  });

  it('поселения не садятся в русло и не громоздятся на хребте', () => {
    const w = generateWorld(SEED);
    for (const s of w.settlements) {
      expect(featuresAt(w.seed, s.x, s.y) & (FEATURE.river | FEATURE.ridge)).toBe(0);
    }
    expect(featuresAt(w.seed, w.home.x, w.home.y) & (FEATURE.river | FEATURE.ridge)).toBe(0);
  });
});

describe('зоны влияния племён', () => {
  waitsForPlayers('влияние затухает по расстоянию, а не рисуется границей', () => {
    const gen = generateWorld(4242);
    const claims = claimsOf(gen);
    const s = gen.settlements.find((x) => x.tribeId && x.capital);
    expect(s).toBeTruthy();
    const owner = ownerAt(claims, s!.x, s!.y);
    expect(owner).toBeGreaterThan(0);
    expect(gen.tribes[owner - 1].id).toBe(s!.tribeId);
    // Далеко от всех дворов земля ничья: пятно расплывается, а не кончается линией.
    let far = { x: s!.x, y: s!.y };
    for (const d of [CLAIM_REACH * 3, CLAIM_REACH * 5]) {
      far = { x: s!.x + d, y: s!.y + d };
      if (claimsNear(claims, far.x, far.y, far.x, far.y).length === 0) break;
    }
    expect(ownerAt(claims, far.x, far.y)).toBe(0);
  });

  waitsForPlayers('цвет племени не проступает в тумане', async () => {
    const { world } = makeWorld(4242);
    const info = await world.info();
    // Дальний угол карты никем не разведан: там не должно быть ни одного цвета,
    // хотя ландшафт и реки мир отдаёт — их игрок и так считает из сида.
    const far = { x: WORLD_ORIGIN.x, y: WORLD_ORIGIN.y, w: 24, h: 24 };
    const dark = await world.region(far);
    expect([...dark.explored].every((v) => v === 0)).toBe(true);
    expect([...dark.influence].every((v) => v === 0)).toBe(true);
    expect([...dark.terrain].some((v) => v !== 0)).toBe(true);

    // А вокруг своей деревни местность открыта — и владения соседей видны.
    const near = await world.region({ x: info.home.x - 12, y: info.home.y - 12, w: 24, h: 24 });
    expect([...near.explored].some((v) => v === 1)).toBe(true);
    expect([...near.influence].some((v) => v > 0)).toBe(true);
    // И ни одна закрашенная клетка не оказалась неразведанной.
    for (let i = 0; i < near.influence.length; i++) {
      if (near.influence[i] > 0) expect(near.explored[i]).toBe(1);
    }
  });

  it('отладочный обзор мира отдаёт всю землю — и только по флагу', async () => {
    const far = { x: WORLD_ORIGIN.x, y: WORLD_ORIGIN.y, w: 24, h: 24 };
    const closed = await new LocalWorld({ seed: 4242, now: () => START, storage: null }).region(far);
    expect([...closed.explored].every((v) => v === 0)).toBe(true);
    // Тот же угол карты, но мир создан с `reveal` — так открывается `?worldview=open`.
    const open = await new LocalWorld({ seed: 4242, now: () => START, storage: null, reveal: true }).region(far);
    expect([...open.explored].every((v) => v === 1)).toBe(true);
  });

  it('кусок карты несёт признаки местности вместе с ландшафтом', async () => {
    const { world } = makeWorld(4242);
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 16, y: info.home.y - 16, w: 32, h: 32 });
    expect(chunk.features.length).toBe(chunk.terrain.length);
    for (let y = 0; y < chunk.rect.h; y++) {
      for (let x = 0; x < chunk.rect.w; x++) {
        // То же самое, что считает проходимость: двух правд о клетке быть не должно.
        expect(chunk.features[y * chunk.rect.w + x]).toBe(featuresAt(info.seed, chunk.rect.x + x, chunk.rect.y + y));
      }
    }
  });
});

describe('время пути', () => {
  it('симметрично в обе стороны', () => {
    const seed = 31337;
    const pairs: [{ x: number; y: number }, { x: number; y: number }][] = [
      [{ x: 410, y: 710 }, { x: 455, y: 788 }],
      [{ x: 500, y: 800 }, { x: 501, y: 799 }],
      [{ x: 599, y: 899 }, { x: 400, y: 700 }],
      [{ x: 470, y: 730 }, { x: 470, y: 812 }],
    ];
    for (const [a, b] of pairs) {
      expect(travelSeconds(seed, a, b, { warrior: 3 })).toBe(travelSeconds(seed, b, a, { warrior: 3 }));
      expect(terrainFactor(seed, a, b)).toBe(terrainFactor(seed, b, a));
    }
  });

  it('считается по самому медленному юниту в отряде', () => {
    const dist = 20;
    const alone = marchSeconds(dist, 1, { scout: 2 });
    const together = marchSeconds(dist, 1, { scout: 2, warrior: 1 });
    expect(together).toBeGreaterThan(alone);
    expect(together).toBe(marchSeconds(dist, 1, { warrior: 1 }));
  });

  it('ландшафт замедляет отряд', () => {
    expect(marchSeconds(20, 1.5, { warrior: 1 })).toBeGreaterThan(marchSeconds(20, 1, { warrior: 1 }));
  });
});

describe('разведданные стареют', () => {
  const intel: Intel = { at: START, power: 100, pop: 40, loot: 60 };

  it('точность падает по расписанию', () => {
    expect(precisionOf(0)).toBe('exact');
    expect(precisionOf(INTEL_EXACT - 1)).toBe('exact');
    expect(precisionOf(INTEL_EXACT)).toBe('rough');
    expect(precisionOf(INTEL_ROUGH)).toBe('vague');
    expect(precisionOf(INTEL_VAGUE)).toBe('unknown');
  });

  it('сначала точное число, потом диапазон, потом ничего', () => {
    const fresh = readIntel(intel, START + 60_000);
    expect(fresh?.power.value).toBe(100);

    const rough = readIntel(intel, START + INTEL_EXACT + 1000);
    expect(rough?.power.value).toBeNull();
    expect(rough?.power.min).toBeLessThan(100);
    expect(rough?.power.max).toBeGreaterThan(100);

    const vague = readIntel(intel, START + INTEL_ROUGH + 1000);
    expect(vague?.power.max as number).toBeGreaterThan(rough?.power.max as number);

    expect(readIntel(intel, START + INTEL_VAGUE + 1)).toBeNull();
  });

  it('возраст данных считается от момента разведки', () => {
    const r = readIntel(intel, START + 120_000);
    expect(r?.ageSeconds).toBe(120);
  });
});

describe('бой', () => {
  const side = (kinds: Partial<Stack>) => ({
    kinds: { spear: 0, infantry: 0, archer: 0, cavalry: 0, ...kinds },
    setup: null,
  });

  it('один сид — один результат и один журнал', () => {
    const input = { seed: 987654, attacker: side({ infantry: 40 }), defender: side({ infantry: 30 }) };
    const a = resolveField(input);
    const b = resolveField(input);
    expect(b.result?.log).toEqual(a.result?.log);
    expect(b.won).toBe(a.won);
  });

  it('другой сид — другая расстановка быстрой атаки', () => {
    const army = side({ spear: 100, infantry: 100, archer: 60, cavalry: 40 });
    const presets = new Set<string | null>();
    for (let seed = 1; seed <= 40; seed++) {
      presets.add(resolveField({ seed, attacker: army, defender: side({ infantry: 200 }) }).preset.attacker);
    }
    expect(presets.size).toBeGreaterThan(1);
  });

  it('проигравший теряет много, но не всех: отряд отступает', () => {
    const out = resolveField({ seed: 5, attacker: side({ infantry: 5 }), defender: side({ infantry: 100 }) });
    expect(out.won).toBe(false);
    expect(out.attackerLoss).toBeLessThanOrEqual(1);
    const lost = stackLosses({ warrior: 10, scout: 2 }, Math.min(0.9, out.attackerLoss));
    expect(lost.warrior).toBeLessThan(10);
    // Разведчики держатся позади — их выбивает реже.
    expect(lost.scout ?? 0).toBeLessThan(lost.warrior as number);
  });

  it('пустая сторона в ядро не идёт: пришедший никем проигрывает', () => {
    const out = resolveField({ seed: 3, attacker: side({}), defender: side({ infantry: 10 }) });
    expect(out.won).toBe(false);
    expect(out.result).toBeNull();
  });
});

describe('армия в походе', () => {
  /** Армия — счётчик бойцов, а не жители с профессией: роли «воин» больше нет. */
  const withWarriors = (n: number): GameState => {
    const s = createInitialState();
    s.workers = {};
    s.freeJobs = {};
    s.army.spearman = n;
    return s;
  };

  it('не учитывается в обороне своей деревни', () => {
    const s = withWarriors(5);
    const full = defense(s);
    s.warriorsAway = 3;
    const left = defense(s);
    // Уходят бойцы, а не жители: жительская четвертинка обороны остаётся дома.
    expect(left).toBeCloseTo(full - 3 * soldierPower(s), 5);
    expect(left).toBeLessThan(full);
  });

  it('число ушедших выводится из списка походов', () => {
    const s = withWarriors(6);
    const marches: MarchView[] = [
      {
        id: 'm1',
        mission: 'raid',
        units: { warrior: 4, scout: 1 },
        own: true,
        hostile: false,
        phase: 'out',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        fromName: 'дом',
        toName: 'цель',
        targetId: 's1',
        departAt: START,
        arriveAt: START + 1000,
        loot: null,
        recallable: true,
      },
      {
        id: 'm2',
        mission: 'raid',
        units: { warrior: 99 },
        own: false,
        hostile: true,
        phase: 'out',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        fromName: 'чужие',
        toName: 'дом',
        targetId: 'home',
        departAt: START,
        arriveAt: START + 1000,
        loot: null,
        recallable: false,
      },
    ];
    expect(syncAway(s, marches)).toBe(true);
    // Чужой отряд в свои потери не записывается.
    expect(s.warriorsAway).toBe(4);
    expect(s.scoutsAway).toBe(1);
    expect(sendableUnits(s).warrior).toBe(2);
    // Повторный вызов ничего не меняет.
    expect(syncAway(s, marches)).toBe(false);
  });

  it('разведчики уходят из свободных жителей и не строят', () => {
    const s = createInitialState();
    const free = sendableUnits(s).scout;
    s.scoutsAway = free;
    expect(sendableUnits(s).scout).toBe(0);
  });
});

describe('походы в локальном мире', () => {
  it('полководец доводит армию до цели, бьёт и остаётся в поле', async () => {
    const w = makeWorld(11);
    const p = profile({ warriorPower: 4, army: { clubman: 8, spearman: 6 } });
    await w.world.sync(p);
    const target = await nearest(w.world);

    const { res, pulse, walk } = await raidWith(w, target, p);
    expect(walk).toBeGreaterThan(0);
    expect(res.error).toBeNull();
    expect(pulse.reports.some((r) => r.kind === 'raid')).toBe(true);
    expect(pulse.effects.length).toBeGreaterThan(0);

    // Уцелевшие остаются при полководце: в поле состав войска не меняется.
    const general = pulse.figures.find((f) => f.id === 'general') as FigureView;
    expect(general.phase === 'field' || general.phase === 'down').toBe(true);
    if (general.phase === 'field') expect(general.atId).toBe(target.id);
  });

  it('набег гонцом отправить нельзя: армию водит только полководец', async () => {
    const { world } = makeWorld(11);
    await world.sync(profile());
    const target = await nearest(world);
    const res = await world.send({ target: target.id, mission: 'raid', units: { warrior: 8 } });
    expect(res.error).toBeTruthy();
    expect(res.march).toBeNull();
  });

  it('один и тот же поход с одним сидом даёт один и тот же результат боя', async () => {
    const run = async () => {
      const w = makeWorld(2024);
      const p = profile({ warriorPower: 4, army: { clubman: 7 } });
      const target = await nearest(w.world);
      const { pulse } = await raidWith(w, target, p);
      return pulse.reports.find((r) => r.kind === 'raid');
    };
    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
  });

  it('отзыв возвращает отряд ровно за пройденное время', async () => {
    const { world, advance } = makeWorld(31);
    await world.sync(profile());
    const target = await nearest(world);
    const res = await world.send({ target: target.id, mission: 'scout', units: { scout: 3 } });
    const m = res.march as MarchView;

    advance(30_000);
    expect(await world.recall(m.id)).toBeNull();
    const back = own(await world.marches())[0];
    expect(back.phase).toBe('back');
    expect(back.arriveAt - back.departAt).toBe(30_000);
    expect(back.recallable).toBe(false);
  });

  it('разведка пишет свежие данные, и они стареют', async () => {
    const { world, at } = makeWorld(55);
    await world.sync(profile());
    const target = await nearest(world);
    const res = await world.send({ target: target.id, mission: 'scout', units: { scout: 3 } });
    const m = res.march as MarchView;

    expect((await world.settlement(target.id))?.power.precision).toBe('unknown');

    at(m.arriveAt);
    await world.sync(profile());
    const card = await world.settlement(target.id);
    expect(card?.power.precision).toBe('exact');
    expect(card?.intel?.ageSeconds).toBe(0);

    at(m.arriveAt + INTEL_EXACT + 1000);
    const older = await world.settlement(target.id);
    expect(older?.power.precision).toBe('rough');

    at(m.arriveAt + INTEL_VAGUE + 1000);
    const gone = await world.settlement(target.id);
    expect(gone?.power.precision).toBe('unknown');
    expect(gone?.intel).toBeNull();
  });

  it('своя деревня видна всегда и точно, чужая — нет', async () => {
    const { world } = makeWorld(8);
    await world.sync(profile({ defense: 42, pop: 17 }));
    const home = await world.settlement('home');
    expect(home?.mine).toBe(true);
    expect(home?.power.value).toBe(42);
    expect(home?.pop.value).toBe(17);
    expect(home?.can.open).toBe(true);
    expect(home?.can.raid).toBe(false);
  });

  it('пустой отряд и чужие люди в поход не уходят', async () => {
    const { world } = makeWorld(9);
    await world.sync(profile({ units: { warrior: 2, scout: 0 } }));
    const target = await nearest(world);
    expect((await world.send({ target: target.id, mission: 'raid', units: {} })).error).not.toBeNull();
    expect(
      (await world.send({ target: target.id, mission: 'raid', units: { warrior: 5 } })).error,
    ).not.toBeNull();
    expect(
      (await world.send({ target: target.id, mission: 'scout', units: { warrior: 1 } })).error,
    ).not.toBeNull();
    expect((await world.send({ target: 'home', mission: 'raid', units: { warrior: 1 } })).error).not.toBeNull();
  });

  it('поддержку принимают только союзники', async () => {
    const { world } = makeWorld(17);
    await world.sync(profile());
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
    const ally = chunk.settlements.find((s) => s.relation === 'ally');
    const other = chunk.settlements.find((s) => s.relation === 'neutral' || s.relation === 'barbarian');
    if (ally) expect((await world.send({ target: ally.id, mission: 'support', units: { warrior: 2 } })).error).toBeNull();
    if (other) {
      expect(
        (await world.send({ target: other.id, mission: 'support', units: { warrior: 2 } })).error,
      ).not.toBeNull();
    }
  });

  waitsForPlayers('набег поднимает враждебность всего племени', async () => {
    const w = makeWorld(23);
    const world = w.world;
    const p = profile({ warriorPower: 4, army: { clubman: 6 } });
    await world.sync(p);
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
    // Ищем среди того, что уже разведано: неоткрытых клеток карта не отдаёт.
    const target = chunk.settlements.find((s) => s.tribeId);
    expect(target).toBeTruthy();
    const before = (await world.tribes()).find((t) => t.id === target?.tribeId)?.hostility ?? 0;

    await raidWith(w, target as SettlementView, p);

    const after = (await world.tribes()).find((t) => t.id === target?.tribeId)?.hostility ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});

describe('замки', () => {
  /** Ближайший к дому замок. Флаг стоит в генерации, поэтому ищем его там же. */
  function nearestCastle(seed: number) {
    const gen = generateWorld(seed);
    const castles = gen.settlements.filter((s) => s.castle);
    expect(castles.length, 'в мире должны быть замки').toBeGreaterThan(0);
    return castles.sort((a, b) => distance(gen.home, a) - distance(gen.home, b))[0];
  }

  waitsForPlayers('замки видны на карте с первого дня', async () => {
    const w = makeWorld(11);
    const castle = nearestCastle(11);
    await w.world.sync(profile());
    expect((await w.world.settlement(castle.id))?.castle).toBe(true);
  });

  waitsForPlayers('набег на замок без достаточной армии не приносит золота и стоит потерь', async () => {
    const w = makeWorld(11);
    const castle = nearestCastle(11);
    // Отряд заведомо слабее гарнизона замка: пара дубинщиков против крепости.
    const weak = profile({ warriorPower: 1, units: { warrior: 2 }, army: { clubman: 2 } });
    const { pulse } = await raidWith(w, castle, weak);

    const raid = pulse.reports.find((r) => r.kind === 'raid');
    expect(raid, 'должен прийти отчёт о набеге').toBeTruthy();
    expect(raid!.won).toBe(false);
    expect(raid!.loot).toBeNull();
    // Потери настоящие, а добычи нет — ни ресурсов, ни золота.
    expect((raid!.lost.warrior ?? 0)).toBeGreaterThan(0);
    for (const e of pulse.effects) expect(e.resources.gold ?? 0).toBe(0);
    expect(pulse.effects.some((e) => (e.lost.warrior ?? 0) > 0)).toBe(true);
  });

  waitsForPlayers('сильный отряд берёт замок и привозит золото домой', async () => {
    const w = makeWorld(11);
    const castle = nearestCastle(11);
    const strong = profile({
      warriorPower: 40,
      units: { warrior: 40 },
      army: { legionary: 30, archer: 20, rider: 10, spearman: 20 },
      // Восемь десятков за собой уводит только высокая Статуя.
      command: 100,
    });
    const { pulse } = await raidWith(w, castle, strong);
    const raid = pulse.reports.find((r) => r.kind === 'raid');
    expect(raid?.won).toBe(true);
    expect(raid?.loot?.gold ?? 0, 'из замка должны везти золото').toBeGreaterThan(0);
    // Золото приезжает домой отдельным последствием — как и остальная добыча.
    const home = pulse.effects.find((e) => (e.resources.gold ?? 0) > 0);
    expect(home, 'золото должно доехать до деревни').toBeTruthy();

    const s = createInitialState();
    applyExpedition(s, toOutcome(home!));
    expect(s.gold).toBeGreaterThan(0);
  });

  it('обычное поселение золота не даёт', async () => {
    const w = makeWorld(11);
    const strong = profile({
      warriorPower: 40,
      units: { warrior: 40 },
      army: { legionary: 30, archer: 20, rider: 10, spearman: 20 },
      command: 100,
    });
    await w.world.sync(strong);
    const target = await nearest(w.world);
    const gen = generateWorld(11).settlements.find((x) => x.id === target.id);
    if (gen?.castle) return; // ближайшая цель оказалась замком — проверять нечего
    const { pulse } = await raidWith(w, target, strong);
    for (const e of pulse.effects) expect(e.resources.gold ?? 0).toBe(0);
  });
});

describe('мягкость мира', () => {
  it('набег ИИ приходит с запасом времени и не сильнее обороны', async () => {
    const { world, advance } = makeWorld(101);
    await world.sync(profile());
    // Ждём дольше самой длинной паузы между набегами.
    advance(40 * 60_000);
    const pulse = await world.sync(profile());
    const raid = pulse.marches.find((m) => m.hostile);
    if (!raid) return; // ближних соседей может не оказаться — это допустимо
    expect(raid.arriveAt - pulse.now).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it('набег виден заранее: либо он в круге, либо о нём донёс Дозор', async () => {
    // Живой обзор сжался до круга у деревни, но обещание про набег осталось
    // прежним: его видно за `AI_WARNING_BASE` до прихода, и это работа Дозора,
    // записанная в его определении. Без этого набег из дальнего двора входил
    // бы в круг уже за отметкой заморозки — и перехват в поле стал бы кнопкой,
    // которая не нажимается.
    for (const seed of [101, 303, 707, 909]) {
      const w = makeWorld(seed);
      // Дозор первого уровня стоит с первой секунды: 120 секунд сверх базы.
      const p = profile({ warning: 120 });
      await w.world.sync(p);
      const info = await w.world.info();

      let seenAt = 0;
      let raid: MarchView | null = null;
      for (let i = 0; i < 900 && !raid; i++) {
        w.advance(10_000);
        const pulse = await w.world.sync(p);
        const found = pulse.marches.find((m) => !m.own && m.phase === 'out');
        if (found) {
          raid = found;
          seenAt = pulse.now;
        }
      }
      if (!raid) continue; // ближних соседей может не оказаться — это допустимо

      const left = raid.arriveAt - seenAt;
      // Запас времени заметно длиннее заморозки обороны.
      expect(left, `сид ${seed}: запас времени`).toBeGreaterThan(DEFENSE_FREEZE);
      expect(left, `сид ${seed}: обещанное предупреждение`).toBeGreaterThan(
        AI_WARNING_BASE + 120_000 - 15_000,
      );

      // А чужой отряд, до которого ещё далеко по времени, не виден вовсе, если
      // он не в круге: пока он идёт по чужой земле, его там некому увидеть.
      const span = Math.max(1, raid.arriveAt - raid.departAt);
      const k = Math.min(1, Math.max(0, (seenAt - raid.departAt) / span));
      const at = { x: raid.from.x + (raid.to.x - raid.from.x) * k, y: raid.from.y + (raid.to.y - raid.from.y) * k };
      const far = distance(info.home, at) > HOME_SIGHT;
      if (far) {
        // Раз он ещё за кругом — значит, увидели его донесением, и ровно в срок.
        expect(left, `сид ${seed}: донесение приходит в срок`).toBeLessThanOrEqual(
          AI_WARNING_BASE + 120_000 + 15_000,
        );
      }
    }
  });

  it('набег, пришедшийся на отсутствие игрока, состоится — так же, как при игроке', async () => {
    // Правило отсутствия снято решением владельца (docs/DEFEAT_LADDER.md): враг
    // подходит и берёт город, в игре хозяин или нет. Проверяется не «что-то
    // случилось», а то, что случилось **то же самое**: один и тот же отряд доходит до
    // ворот в мире, куда игрок заглядывал каждые двадцать секунд, и в мире, куда он
    // не заглядывал вовсе, — и исход у обоих один.
    let checked = 0;
    for (const seed of [202, 404, 606]) {
      const online = makeWorld(seed);
      const offline = makeWorld(seed);
      await online.world.sync(profile());
      await offline.world.sync(profile());
      let raid: MarchView | undefined;
      for (let tries = 0; tries < 12 && !raid; tries++) {
        online.advance(20 * 60_000);
        offline.advance(20 * 60_000);
        const pulse = await online.world.sync(profile());
        await offline.world.sync(profile());
        // Граница области: отряд ещё в пути дольше одного пульса — иначе «отсутствия»
        // между последним взглядом и приходом не было бы вовсе.
        raid = pulse.marches.find((m) => m.hostile && m.phase === 'out' && m.arriveAt - online.now() > 60_000);
      }
      if (!raid) continue;
      const end = raid.arriveAt + 30 * 60_000;
      while (online.now() < end) {
        online.advance(20_000);
        await online.world.sync(profile());
      }
      offline.at(end);
      await offline.world.sync(profile());
      const about = (w: LocalWorld) =>
        w.reports().then((rs) => rs.filter((r) => r.id.startsWith(`${raid!.id}-`)).map((r) => ({ id: r.id, title: r.title, text: r.text })));
      const seen = await about(online.world);
      const missed = await about(offline.world);
      expect(missed.length, `сид ${seed}: отряд дошёл и без игрока`).toBeGreaterThan(0);
      expect(missed.some((r) => r.id.endsWith('-skip')), `сид ${seed}: «не состоялся» не бывает`).toBe(false);
      expect(missed[missed.length - 1], `сид ${seed}: исход без игрока тот же, что при нём`).toEqual(seen[seen.length - 1]);
      checked++;
    }
    expect(checked, 'хоть один мир дал набег в пути').toBeGreaterThan(0);
  }, 120_000);
});

describe('последствия для племени', () => {
  it('добыча ложится на склад, потери убирают бойцов', () => {
    const s = createInitialState();
    s.army.spearman = 3;
    const before = armySize(s);
    const villagersBefore = s.pop;
    const food = s.resources.food;

    applyExpedition(
      s,
      toOutcome({
        id: 'e1',
        lost: { warrior: 2 },
        resources: { food: 25 },
        prestige: 4,
        morale: 3,
        battle: 'won',
        text: 'Набег удался.',
        good: true,
      }),
    );

    expect(armySize(s)).toBe(before - 2);
    // Бойцы гибнут из армии, племя при этом не редеет.
    expect(s.pop).toBe(villagersBefore);
    expect(s.resources.food).toBeGreaterThan(food);
    expect(s.stats.battlesWon).toBe(1);
    expect(s.log[0].text).toContain('Не вернулись');
  });

  it('разграбление уносит ресурсы, но не уводит склад в минус', () => {
    const s = createInitialState();
    s.resources.wood = 10;
    applyExpedition(
      s,
      toOutcome({
        id: 'e2',
        lost: {},
        resources: { wood: -50 },
        prestige: 0,
        morale: -10,
        battle: 'lost',
        text: 'Разграбили.',
        good: false,
      }),
    );
    expect(s.resources.wood).toBe(0);
    expect(s.stats.battlesLost).toBe(1);
  });
});

describe('карта', () => {
  it('область отдаёт ландшафт и поселения куском', async () => {
    const { world } = makeWorld(64);
    const info = await world.info();
    await world.sync(profile());
    const chunk = await world.region({ x: info.home.x - 16, y: info.home.y - 16, w: 32, h: 32 });
    expect(chunk.terrain.length).toBe(chunk.rect.w * chunk.rect.h);
    expect(chunk.settlements.some((s) => s.mine)).toBe(true);
  });

  it('область за краем мира обрезается, а не выдумывается', async () => {
    const { world } = makeWorld(65);
    const chunk = await world.region({ x: WORLD_ORIGIN.x - 20, y: WORLD_ORIGIN.y - 20, w: 32, h: 32 });
    expect(chunk.rect.x).toBe(WORLD_ORIGIN.x);
    expect(chunk.rect.y).toBe(WORLD_ORIGIN.y);
    expect(chunk.terrain.length).toBe(chunk.rect.w * chunk.rect.h);
  });
});

describe('состав отряда и отчёт о бое', () => {
  it('поход несёт состав, и потери списываются теми же видами', async () => {
    const w = makeWorld(77);
    const army = { spearman: 6, archer: 4, clubman: 4 };
    const p = profile({ warriorPower: 4, units: { warrior: 14, scout: 4 }, army, militia: 10 });
    await w.world.sync(p);
    const target = await nearest(w.world);

    const { res, pulse } = await raidWith(w, target, p);
    expect(res.error).toBeNull();
    const raid = pulse.reports.find((r) => r.kind === 'raid');
    expect(raid, 'должен прийти отчёт о набеге').toBeTruthy();

    // Отчёт строится из журнала: он есть, он именованный и он про эти же числа.
    const battle = raid!.battle;
    expect(battle, 'у набега должен быть журнал боя').toBeTruthy();
    expect(battle!.us).toBe('attacker');
    expect(battle!.result.log.length).toBeGreaterThan(3);
    expect(battle!.result.ticks).toBeGreaterThanOrEqual(50);
    expect(battle!.result.ticks).toBeLessThanOrEqual(100);

    const effect = pulse.effects.find((e) => e.lostTroops);
    expect(effect, 'потери должны прийти по видам бойцов').toBeTruthy();
    for (const [id, n] of Object.entries(effect!.lostTroops ?? {})) {
      expect(n).toBeLessThanOrEqual((army as Record<string, number>)[id] ?? 0);
    }
  });

  it('быстрая атака и настроенная расстановка — разные бои с одного сида', async () => {
    const army = { spearman: 8, archer: 6 };
    const run = async (setup: ArmySetup | null) => {
      const w = makeWorld(4242);
      const p = profile({ warriorPower: 4, units: { warrior: 14, scout: 0 }, army });
      await w.world.sync(p);
      const target = await nearest(w.world);
      const { pulse } = await raidWith(w, target, p, setup);
      return pulse.reports.find((r) => r.kind === 'raid')!.battle!;
    };
    const quick = await run(null);
    const tuned = await run(toArmySetup(presetFormation(army, 'anti-cavalry')));
    // У быстрой атаки пресет назван, у настроенной — нет: расстановку задали руками.
    expect(quick.preset).not.toBeNull();
    expect(tuned.preset).toBeNull();
  });

  it('разведка показывает состав и построение, а с возрастом — только порядок величины', async () => {
    const w = makeWorld(88);
    const p = profile();
    await w.world.sync(p);
    const target = await nearest(w.world);
    const sent = await w.world.send({ target: target.id, mission: 'scout', units: { scout: 3 } });
    w.at((sent.march as MarchView).arriveAt);
    await w.world.sync(p);

    const fresh = await w.world.intel(target.id);
    expect(fresh?.kinds, 'свежая разведка знает состав').toBeTruthy();
    expect(fresh?.formation, 'и построение').toBeTruthy();
    expect(fresh?.style).toBeTruthy();
    expect(Object.keys(fresh!.formation!).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    // Резерв и план разведка не даёт: на этом держится вся неопределённость.
    expect(Object.keys(fresh!.formation!)).not.toContain('R');

    w.advance(INTEL_VAGUE - INTEL_ROUGH + 1000);
    const old = await w.world.intel(target.id);
    expect(old?.precision).toBe('vague');
    expect(old?.formation, 'старое построение не показывают как нынешнее').toBeNull();
  });
});

describe('снимок разведки несёт всё, что читает readIntel', () => {
  // Поле `keen` было объявлено, `readIntel` делил на него возраст снимка, Дозор
  // обещал «разведданные стареют медленнее» — а записать его в снимок забыли, и
  // заметил это только аудит зданий: читатель молча брал единицу. Тест проверяет
  // правило, а не одно поле: всё, что читает читатель, обязан писать каждый, кто
  // выпускает снимок, — разведчик походом, разведчик-фигура, лазутчик и бой.

  const saveOf = (w: LocalWorld): { intel: Record<string, Intel> } =>
    (w as unknown as { save: { intel: Record<string, Intel> } }).save;

  /**
   * Какие поля снимка читает `readIntel`. Не список руками: чтения записывает
   * прокси — на свежем, стареющем и старом снимке, потому что у разных возрастов
   * разные ветки чтения.
   */
  function fieldsRead(intel: Intel): Set<string> {
    const read = new Set<string>();
    const watched = new Proxy(intel, {
      get(target, key, receiver) {
        if (typeof key === 'string') read.add(key);
        return Reflect.get(target, key, receiver);
      },
    });
    for (const age of [0, INTEL_EXACT + 1000, INTEL_ROUGH + 1000, INTEL_VAGUE + 1000]) readIntel(watched, intel.at + age);
    return read;
  }

  /** Чего у снимка этого рода нет по устройству — и почему. Всё прочее обязано быть. */
  const ABSENT: Record<string, string[]> = {
    // Своими глазами: числа точные, вилки нет.
    'разведчик походом': ['spread'],
    'разведчик-фигура': ['spread'],
    бой: ['spread'],
    // Лазутчик считает головы из разговоров: вилка есть, построения он не видит.
    лазутчик: ['formation'],
  };

  /** Дозор посёлка: снимки обязаны запомнить именно его. */
  const KEEN = 1.7;

  async function snapshots(): Promise<Record<string, Intel>> {
    const out: Record<string, Intel> = {};
    const p = profile({ intelKeen: KEEN, army: { clubman: 2 }, warriorPower: 1 });

    // Разведчик походом.
    {
      const w = makeWorld(55);
      await w.world.sync(p);
      const target = await nearest(w.world);
      const sent = await w.world.send({ target: target.id, mission: 'scout', units: { scout: 3 } });
      w.at((sent.march as MarchView).arriveAt);
      await w.world.sync(p);
      out['разведчик походом'] = saveOf(w.world).intel[target.id];
    }

    // Разведчик-фигура: у ворот его могут схватить, поэтому ищется сид, где дошёл.
    for (const seed of [55, 56, 57, 58, 59, 60, 61, 62]) {
      const w = makeWorld(seed);
      await w.world.sync(p);
      const target = await nearest(w.world);
      if ((await w.world.moveFigure('scout', { x: target.x, y: target.y })) !== null) continue;
      const f = (await w.world.figures()).find((x) => x.id === 'scout') as FigureView;
      w.at(f.arriveAt);
      await w.world.sync(p);
      const snap = saveOf(w.world).intel[target.id];
      if (snap) {
        out['разведчик-фигура'] = snap;
        break;
      }
    }

    // Лазутчик: дело повторяется, пока донесение не придёт. Лазутчик смертен: погиб —
    // слепок называет следующего, и новый идёт к той же цели.
    {
      const w = makeWorld(67);
      let person = 0;
      const hired = (): PlayerProfile => ({ ...p, ...(person > 0 ? { agents: { spy: { person } } } : {}) });
      const walk = async (): Promise<void> => {
        await w.world.sync(hired());
        expect(await w.world.moveFigure('spy', { x: target.x, y: target.y })).toBeNull();
        const f = (await w.world.figures()).find((x) => x.id === 'spy') as FigureView;
        w.at(f.arriveAt);
        await w.world.sync(hired());
      };
      await w.world.sync(p);
      const target = await nearest(w.world);
      await walk();
      for (let i = 0; i < 25 && !out['лазутчик']; i++) {
        let spy = (await w.world.figures()).find((x) => x.id === 'spy') as FigureView;
        if (spy.place === 'vacant') {
          person++;
          await walk();
          spy = (await w.world.figures()).find((x) => x.id === 'spy') as FigureView;
        }
        if (spy.busyUntil > w.now()) w.at(spy.busyUntil);
        await w.world.sync(hired());
        const res = await w.world.order('probe', target.id);
        expect(res.error).toBeNull();
        if (res.accepted) out['лазутчик'] = saveOf(w.world).intel[target.id];
      }
    }

    // Бой полководца. Снимок берётся из отчёта: сожжённое логово свой снимок
    // из сохранения уносит, а отчёт о бое его хранит.
    {
      const w = makeWorld(2024);
      const target = await nearest(w.world);
      const { pulse } = await raidWith(w, target, p);
      const report = pulse.reports.find((r) => r.kind === 'raid');
      if (report?.intel) out['бой'] = report.intel;
    }
    return out;
  }

  /** Снимки собираются один раз на оба теста: каждый род снимка — свой мир, прожитый до разведки или боя. */
  let taken: Promise<Record<string, Intel>> | null = null;
  const collected = (): Promise<Record<string, Intel>> => (taken ??= snapshots());

  it('каждое поле, которое читает readIntel, есть в снимке разведчика, лазутчика и боя', async () => {
    const snaps = await collected();
    expect(Object.keys(snaps).sort(), 'все роды снимков получены').toEqual(Object.keys(ABSENT).sort());
    for (const [source, snap] of Object.entries(snaps)) {
      const read = fieldsRead(snap);
      expect(read.size, source).toBeGreaterThan(3);
      for (const field of read) {
        if (ABSENT[source].includes(field)) continue;
        expect((snap as unknown as Record<string, unknown>)[field], `${source}: поле «${field}» читается, но не пишется`).not.toBeUndefined();
      }
    }
  }, 60_000);

  it('Дозор держит обещание: снимок, собранный при Дозоре, стареет медленнее ровно во столько раз', async () => {
    const snaps = await collected();
    for (const [source, snap] of Object.entries(snaps)) {
      expect(snap.keen, source).toBe(KEEN);
      // Там, где без Дозора от снимка остался бы только порядок величины, с ним
      // он ещё примерный — и грубеет в срок, умноженный ровно на стойкость. Эта
      // ступень есть у всех четырёх родов: донесение лазутчика точным не бывает.
      expect(readIntel(snap, snap.at + INTEL_ROUGH + 1000)?.precision, source).toBe('rough');
      expect(readIntel(snap, snap.at + INTEL_ROUGH * KEEN - 1000)?.precision, source).toBe('rough');
      expect(readIntel(snap, snap.at + INTEL_ROUGH * KEEN + 1000)?.precision, source).toBe('vague');
      // У снимков своими глазами — и точная ступень тянется так же.
      if (!snap.spread) {
        expect(readIntel(snap, snap.at + INTEL_EXACT * KEEN - 1000)?.precision, source).toBe('exact');
        expect(readIntel(snap, snap.at + INTEL_EXACT * KEEN + 1000)?.precision, source).toBe('rough');
      }
    }
  }, 60_000);
});

describe('заморозка обороны', () => {
  const incoming = (arriveAt: number): MarchView => ({
    id: 'x',
    mission: 'raid',
    units: { warrior: 5 },
    own: false,
    hostile: true,
    phase: 'out',
    from: { x: 0, y: 0 },
    to: { x: 1, y: 1 },
    fromName: 'Чужие',
    toName: 'Наша деревня',
    targetId: 'home',
    departAt: 0,
    arriveAt,
    loot: null,
    recallable: false,
  });

  it('срабатывает ровно за пять минут', () => {
    const now = START;
    expect(defenseLock([incoming(now + DEFENSE_FREEZE + 1000)], now).frozen).toBe(false);
    expect(defenseLock([incoming(now + DEFENSE_FREEZE)], now).frozen).toBe(true);
    expect(defenseLock([incoming(now + 1000)], now).frozen).toBe(true);
    expect(DEFENSE_FREEZE).toBe(5 * 60_000);
  });

  it('окно на перестройку есть: предупреждение длиннее заморозки', () => {
    // Иначе набег появляется уже запертым, и панель обороны — замок на двери.
    // Проверяется база — то, что видно вообще без Дозора: он время только
    // прибавляет, укоротить предупреждение он не может.
    expect(AI_WARNING_BASE).toBeGreaterThan(DEFENSE_FREEZE);
    const now = START;
    const arriveAt = now + AI_WARNING_BASE;
    expect(defenseLock([incoming(arriveAt)], now).frozen).toBe(false);
    expect(defenseLock([incoming(arriveAt)], now).seconds).toBeGreaterThan(DEFENSE_FREEZE / 1000);
  });

  it('без чужих отрядов оборона открыта', () => {
    expect(defenseLock([], START).frozen).toBe(false);
    expect(defenseLock([], START).march).toBeNull();
  });

  /**
   * Прогон набега ИИ на деревню с заданной обороной. `switchAt` — момент, в
   * который игрок присылает другую расстановку: до отметки её обязаны принять,
   * после — нет. Пульсы идут часто: расстановку присылает слепок, и сменить её
   * можно только пульсом — редким опросом отметку заморозки не поймать.
   */
  async function defendWith(early: ArmySetup, late: ArmySetup, switchBeforeMs: number) {
    const w = makeWorld(303);
    const army = { spearman: 10, archer: 6 };
    const p = (setup: ArmySetup): PlayerProfile =>
      profile({ army, militia: 10, defenseSetup: setup, units: { warrior: 16, scout: 2 } });

    await w.world.sync(p(early));
    for (let i = 0; i < 200; i++) {
      w.advance(15_000);
      const pulse = await w.world.sync(p(early));
      const raid = pulse.marches.find((m) => m.hostile);
      if (!raid) continue;

      // Доводим до боя короткими шагами, меняя оборону в назначенный момент.
      while (w.now() < raid.arriveAt) {
        w.advance(15_000);
        const at = w.now();
        const setup = raid.arriveAt - at <= switchBeforeMs ? late : early;
        const pulse2 = await w.world.sync(p(setup));
        const report = pulse2.reports.find((r) => r.kind === 'defense' && r.battle);
        if (report) return report.battle!;
      }
      const last = await w.world.sync(p(late));
      const report = last.reports.find((r) => r.kind === 'defense' && r.battle);
      if (report) return report.battle!;
      return null;
    }
    return null;
  }

  it('расстановка, присланная после отметки, в бой не идёт', async () => {
    const army = { spearman: 10, archer: 6 };
    const early = toArmySetup(presetFormation(army, 'defense'), 10);
    const late = toArmySetup(presetFormation(army, 'center-punch'), 10);

    const held = await defendWith(early, late, DEFENSE_FREEZE - 30_000);
    const never = await defendWith(early, early, 0);
    const always = await defendWith(late, late, 0);
    expect(held, 'набег ИИ должен дойти до боя').toBeTruthy();
    expect(never).toBeTruthy();
    expect(always).toBeTruthy();
    if (!held || !never || !always) return;

    expect(held.us).toBe('defender');
    // Смена внутри пяти минут ничего не изменила: бой тот же, что без неё.
    expect(held.result.log).toEqual(never.result.log);
    // А если бы расстановка не значила ничего, проверять было бы нечего.
    expect(always.result.log).not.toEqual(never.result.log);
  });
});

describe('туман войны', () => {
  it('на старте видно своё поселение и есть куда идти', async () => {
    // Не на одном сиде: чёрный экран на входе недопустим в любом мире. Соседей
    // на общей карте больше нет — единственная цель первого дня это логово, и
    // мир обязан завести их у порога сам, а не через полчаса ожидания.
    for (const seed of [1, 7, 11, 23, 31, 42, 55, 88, 2024, 4242]) {
      const w = makeWorld(seed);
      await w.world.sync(profile());
      const info = await w.world.info();
      const chunk = await w.world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
      expect(chunk.settlements.some((s) => s.mine), `сид ${seed}: своё поселение`).toBe(true);
      const near = chunk.settlements.filter((s) => !s.mine);
      expect(near.length, `сид ${seed}: цель на старте`).toBeGreaterThan(0);
      // Ближайшая — в дневном переходе, а не «где-то там».
      expect(Math.min(...near.map((s) => distance(info.home, s))), `сид ${seed}`).toBeLessThanOrEqual(AI_RANGE);
    }
  });

  it('изученная Дозором округа открывает землю за кругом деревни', async () => {
    const w = makeWorld(11);
    const info = await w.world.info();
    // Первая ступень изучения обязана открывать больше, чем видит деревня сама:
    // ступень, не открывшая ни клетки, читалась бы как сломанная кнопка.
    expect(SURVEY_STEPS[0].radius).toBeGreaterThan(HOME_SIGHT);

    await w.world.sync(profile());
    const far = { x: info.home.x + HOME_SIGHT + 3, y: info.home.y };
    const dark = await w.world.region({ x: far.x, y: far.y, w: 1, h: 1 });
    expect(dark.explored[0], 'за кругом деревни земля тёмная').toBe(0);

    // Дозор изучил округу — тот же клочок открылся, и обратно не затянется.
    w.advance(MINUTE);
    await w.world.sync(profile({ survey: SURVEY_STEPS[0].radius }));
    const lit = await w.world.region({ x: far.x, y: far.y, w: 1, h: 1 });
    expect(lit.explored[0], 'изученная округа открыта').toBe(1);

    w.advance(MINUTE);
    await w.world.sync(profile());
    const still = await w.world.region({ x: far.x, y: far.y, w: 1, h: 1 });
    expect(still.explored[0], 'открытое не закрывается никогда').toBe(1);
  });

  it('неразведанного поселения на карте нет вовсе — ни точки, ни карточки', async () => {
    const w = makeWorld(11);
    await w.world.sync(profile());
    const info = await w.world.info();
    const far = generateWorld(11).settlements
      .filter((s) => distance(info.home, s) > HOME_SIGHT + 6)
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    expect(far, 'в мире должно быть что-то за пределами стартового обзора').toBeTruthy();
    const chunk = await w.world.region({ x: far.x - 2, y: far.y - 2, w: 5, h: 5 });
    expect(chunk.settlements.some((s) => s.id === far.id)).toBe(false);
    expect(await w.world.settlement(far.id)).toBeNull();
  });

  it('разведанная местность не затягивается обратно, а живые данные — да', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const info = await w.world.info();
    const far = generateWorld(11).settlements
      .filter((s) => distance(info.home, s) > HOME_SIGHT + 4)
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];

    // Живые данные за кругом деревни даёт один лазутчик, и только пока он
    // стоит наблюдателем. Обзор у него два, поэтому смотреть надо вплотную.
    expect(await w.world.moveFigure('spy', { x: far.x + 1, y: far.y })).toBeNull();
    const walk = (await w.world.figures()).find((f) => f.id === 'spy') as FigureView;
    w.at(walk.arriveAt);
    await w.world.sync(p);
    expect(await w.world.watch(true)).toBeNull();
    await w.world.sync(p);

    const near = async () => (await w.world.region({ x: far.x - 1, y: far.y - 1, w: 3, h: 3 })).settlements
      .find((s) => s.id === far.id);
    const seen = await near();
    expect(seen, 'пришли — увидели').toBeTruthy();
    expect(seen!.visible).toBe(true);
    expect(seen!.stale).toBe(false);
    expect(seen!.seenPop).toBeGreaterThan(0);

    // Уводим лазутчика домой и ждём. Местность остаётся открытой навсегда.
    expect(await w.world.recallFigure('spy')).toBeNull();
    const back = (await w.world.figures()).find((f) => f.id === 'spy') as FigureView;
    w.at(back.arriveAt + 60_000);
    await w.world.sync(p);

    const later = await near();
    expect(later, 'поселение с карты не пропадает').toBeTruthy();
    expect(later!.visible).toBe(false);
    expect(later!.stale, 'живые данные помечены устаревшими').toBe(true);
    expect(later!.seenAt).toBe(seen!.seenAt);
    expect(later!.seenPop).toBe(seen!.seenPop);
    // И давность видна: карточке есть что сказать про возраст данных.
    expect(w.now() - (later!.seenAt as number)).toBeGreaterThan(60_000);

    const chunk = await w.world.region({ x: far.x - 1, y: far.y - 1, w: 3, h: 3 });
    const ix = far.x - chunk.rect.x;
    const iy = far.y - chunk.rect.y;
    expect(chunk.explored[iy * chunk.rect.w + ix]).toBe(1);
  });

  it('изученный радиус открывает землю, но живого обзора не даёт', async () => {
    const w = makeWorld(11);
    const info = await w.world.info();
    // Поселение за кругом деревни, но внутри изученной округи.
    const far = generateWorld(11).settlements
      .filter((s) => {
        const d = distance(info.home, s);
        return d > HOME_SIGHT + 2 && d < SURVEY_STEPS[SURVEY_MAX - 1].radius - 2;
      })
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    expect(far, 'в мире должно быть поселение между кругом и краем изученного').toBeTruthy();

    await w.world.sync(profile({ survey: SURVEY_STEPS[SURVEY_MAX - 1].radius }));
    const card = await w.world.settlement(far.id);
    expect(card, 'изученная земля отдаёт карточку: место открыто').toBeTruthy();
    // Но это снимок, а не наблюдение: живого обзора там нет и быть не должно.
    expect(card!.visible, 'изученная округа не наблюдается').toBe(false);
    expect(card!.stale, 'данные помечены устаревшими').toBe(true);
    // Мощь гарнизона изучение не даёт вовсе: за ней по-прежнему идут разведкой.
    expect(card!.power.precision).toBe('unknown');
  });

  it('живой обзор есть только у деревни и вокруг наблюдающего лазутчика', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const info = await w.world.info();
    const far = generateWorld(11).settlements
      .filter((s) => distance(info.home, s) > HOME_SIGHT + 4)
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];

    const look = async (): Promise<SettlementView | undefined> =>
      (await w.world.region({ x: far.x - 1, y: far.y - 1, w: 3, h: 3 })).settlements.find((s) => s.id === far.id);

    // Разведчик у самых ворот: карту он открывает, но не наблюдает.
    expect(await w.world.moveFigure('scout', { x: far.x + 1, y: far.y })).toBeNull();
    const scout = (await w.world.figures()).find((f) => f.id === 'scout') as FigureView;
    w.at(scout.arriveAt);
    await w.world.sync(p);
    expect((await look())!.visible, 'разведчик живого обзора не даёт').toBe(false);
    expect((await look())!.stale).toBe(true);

    // Полководец с войском — тоже не наблюдатель.
    expect(await w.world.moveFigure('general', { x: far.x + 1, y: far.y + 1 })).toBeNull();
    const general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(general.arriveAt);
    await w.world.sync(p);
    expect((await look())!.visible, 'полководец живого обзора не даёт').toBe(false);

    // Лазутчик пришёл и залёг — вот теперь видно живьём.
    expect(await w.world.moveFigure('spy', { x: far.x + 1, y: far.y })).toBeNull();
    const spy = (await w.world.figures()).find((f) => f.id === 'spy') as FigureView;
    w.at(spy.arriveAt);
    await w.world.sync(p);
    expect((await look())!.visible, 'пришёл, но не залёг — не смотрит').toBe(false);
    expect(await w.world.watch(true)).toBeNull();
    await w.world.sync(p);
    expect((await look())!.visible, 'наблюдатель видит живьём').toBe(true);

    // Снял наблюдение — снова снимок с отметкой давности.
    expect(await w.world.watch(false)).toBeNull();
    w.advance(MINUTE);
    await w.world.sync(p);
    expect((await look())!.visible).toBe(false);
    expect((await look())!.stale).toBe(true);

    // И своя деревня видна всегда: тумана над собой не бывает.
    const home = await w.world.settlement('home');
    expect(home!.visible).toBe(true);
  });

  it('разведчик даёт донесение, а не наблюдение: число замирает, когда он ушёл', async () => {
    // Разница, которую легко потерять: у стоящего разведчика мощь точная и
    // свежая, но это снимок, переписываемый каждый пульс, а не чтение мира.
    // `readIntel` принимает только снимок и часы — мира она не видит. Проверяем
    // это поведением: гарнизон в мире растёт со временем, и число, взятое из
    // мира, поехало бы вверх после ухода разведчика.
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const info = await w.world.info();
    const far = generateWorld(11).settlements
      .filter((s) => distance(info.home, s) > HOME_SIGHT + 4)
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];

    expect(await w.world.moveFigure('scout', { x: far.x + 1, y: far.y })).toBeNull();
    const walk = (await w.world.figures()).find((f) => f.id === 'scout') as FigureView;
    w.at(walk.arriveAt);
    await w.world.sync(p);

    const here = (await w.world.settlement(far.id)) as SettlementCard;
    // Живого обзора он не даёт — и это главное.
    expect(here.visible, 'разведчик не наблюдает').toBe(false);
    // Зато считает войско: донесение точное и свежее.
    expect(here.power.precision).toBe('exact');
    expect(here.intel?.ageSeconds ?? 99).toBeLessThan(5);
    const counted = here.power.value as number;
    expect(counted).toBeGreaterThan(0);

    // Увели домой. Число обязано замереть на том, что он насчитал, и стареть.
    expect(await w.world.recallFigure('scout')).toBeNull();
    const back = (await w.world.figures()).find((f) => f.id === 'scout') as FigureView;
    w.at(back.arriveAt);
    await w.world.sync(p);
    const gone = (await w.world.settlement(far.id)) as SettlementCard;
    expect(gone.power.value, 'снимок замер, а не поехал вслед за миром').toBe(counted);
    expect(gone.intel?.ageSeconds ?? 0).toBeGreaterThan(0);

    // И истлевает: живые данные так себя не ведут.
    w.advance(INTEL_VAGUE + MINUTE);
    await w.world.sync(p);
    const old = (await w.world.settlement(far.id)) as SettlementCard;
    expect(old.intel, 'донесение истлело').toBeNull();
    expect(old.power.precision).toBe('unknown');
  });

  waitsForPlayers('наблюдающий лазутчик не разведывает и не бунтует', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const target = await nearest(w.world);
    expect(await w.world.moveFigure('spy', { x: target.x, y: target.y })).toBeNull();
    const spy = (await w.world.figures()).find((f) => f.id === 'spy') as FigureView;
    w.at(spy.arriveAt);
    await w.world.sync(p);

    // Пока не смотрит — приказы доступны.
    const free = await w.world.orders('spy', target.id);
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((o) => o.can), 'у ворот и свободен — приказы идут').toBe(true);

    expect(await w.world.watch(true)).toBeNull();
    const watching = await w.world.orders('spy', target.id);
    // Недоступное показано и объяснено, а не спрятано.
    expect(watching).toHaveLength(free.length);
    for (const o of watching) {
      expect(o.can, `приказ ${o.id} у наблюдателя`).toBe(false);
      expect(o.reason).toContain('наблюдателем');
    }
    const res = await w.world.order('probe', target.id);
    expect(res.error).toContain('наблюдателем');
    expect(res.accepted).toBe(false);

    // Снял наблюдение — работает снова.
    expect(await w.world.watch(false)).toBeNull();
    expect((await w.world.orders('spy', target.id)).every((o) => o.can)).toBe(true);
  });

  it('лазутчик, отправленный в путь, наблюдать перестаёт', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    expect(await w.world.watch(true)).toBeNull();
    expect((await w.world.figures()).find((f) => f.id === 'spy')!.watching).toBe(true);
    const info = await w.world.info();
    expect(await w.world.moveFigure('spy', { x: info.home.x + 6, y: info.home.y })).toBeNull();
    const spy = (await w.world.figures()).find((f) => f.id === 'spy') as FigureView;
    expect(spy.watching, 'пошёл — значит перестал смотреть').toBe(false);
    expect(spy.watchSight).toBe(0);
    // И в пути наблюдателем не станешь: наблюдают стоя.
    expect(await w.world.watch(true)).toContain('стоя');
  });

  it('размер сохранения: половина карты в маске — единицы килобайт', () => {
    const w = makeWorld(11);
    const fog = new FogMap();
    // Открываем ровно половину сетки — верхнюю.
    for (let y = 0; y < WORLD_SIZE / 2; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) fog.reveal(WORLD_ORIGIN.x + x, WORLD_ORIGIN.y + y);
    }
    expect(fog.count()).toBe((WORLD_SIZE * WORLD_SIZE) / 2);
    const bytes = fogSaveBytes(fog.toJSON());
    // Клетка — бит, кусок 32×32 — 128 байт, в base64 172 символа. Половина
    // настоящей карты это 320 000 клеток; списком строк вида «541|822» они дали
    // бы три мегабайта, маска даёт под шестьдесят килобайт. Потолок стоит рядом:
    // вырастет она вчетверо — тест обязан упасть, а не раздуть сохранение молча.
    expect(bytes).toBeGreaterThan(50_000);
    expect(bytes).toBeLessThan(70_000);
    expect(w.world.exploredCells()).toBeGreaterThan(0);
  });
});

describe('фигуры на карте', () => {
  const far = (seed: number, home: { x: number; y: number }) =>
    generateWorld(seed).settlements
      .filter((s) => distance(home, s) > HOME_SIGHT + 4)
      .sort((a, b) => distance(home, a) - distance(home, b))[0];

  it('дошедшая за офлайн фигура оказывается там же, где и при непрерывной игре', async () => {
    const info = await makeWorld(11).world.info();
    const target = far(11, info.home);

    // Непрерывная игра: пульс каждые полминуты всю дорогу.
    const live = makeWorld(11);
    await live.world.sync(profile());
    expect(await live.world.moveFigure('scout', { x: target.x + 3, y: target.y })).toBeNull();
    const trip = (await live.world.figures()).find((f) => f.id === 'scout') as FigureView;
    const end = trip.arriveAt + 5_000;
    for (let t = START; t < end; t += 30_000) {
      live.at(Math.min(t, end));
      await live.world.sync(profile());
    }
    live.at(end);
    const a = (await live.world.sync(profile())).figures.find((f) => f.id === 'scout') as FigureView;

    // Офлайн: один пульс в самом конце.
    const away = makeWorld(11);
    await away.world.sync(profile());
    expect(await away.world.moveFigure('scout', { x: target.x + 3, y: target.y })).toBeNull();
    away.at(end);
    const b = (await away.world.sync(profile())).figures.find((f) => f.id === 'scout') as FigureView;

    expect(b.at).toEqual(a.at);
    expect(b.phase).toBe(a.phase);
    expect(b.atId).toBe(a.atId);
    // И след в тумане тот же: коридор по дороге открыт в обоих случаях.
    const mid = { x: Math.round((info.home.x + target.x) / 2), y: Math.round((info.home.y + target.y) / 2) };
    const cell = async (world: LocalWorld) => {
      const c = await world.region({ x: mid.x, y: mid.y, w: 1, h: 1 });
      return c.explored[0];
    };
    expect(await cell(away.world)).toBe(1);
    expect(await cell(away.world)).toBe(await cell(live.world));
  });

  waitsForPlayers('погибшая фигура не теряется насовсем, а возвращается через положенное время', async () => {
    const w = makeWorld(11);
    const p = profile({ warriorPower: 1, units: { warrior: 1 }, army: { clubman: 1 } });
    const castle = generateWorld(11).settlements.filter((s) => s.castle)[0];
    // Один дубинщик против замка — полководца там и оставят.
    const { pulse } = await raidWith(w, castle, p);
    const down = pulse.figures.find((f) => f.id === 'general') as FigureView;
    expect(down.phase).toBe('down');
    expect(down.downUntil).toBeGreaterThan(w.now());

    w.at(down.downUntil + 1000);
    const back = (await w.world.sync(p)).figures.find((f) => f.id === 'general') as FigureView;
    expect(back.phase).toBe('home');
    expect(back.atHome).toBe(true);
    expect(back.downUntil).toBe(0);
  });

  it('полководец берёт и возвращает гарнизон только вплотную к своей деревне', async () => {
    const w = makeWorld(11);
    const p = profile({ warriorPower: 4, army: { clubman: 6, archer: 4 } });
    await w.world.sync(p);

    // Дома — можно, но не мгновенно: дружина идёт из казарм к полководцу.
    expect(await w.world.setGarrison({ clubman: 6, archer: 4 })).toBeNull();
    let general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    expect(general.readyAt, 'сбор занимает время').toBeGreaterThan(w.now());
    expect(general.troops, 'ушедшие из деревни числятся при нём сразу').toEqual({ clubman: 6, archer: 4 });
    expect(general.power).toBeGreaterThan(0);
    w.at(general.readyAt);
    await w.world.sync(p);

    // Больше, чем стоит дома, взять нельзя.
    expect(await w.world.setGarrison({ clubman: 99 })).toBeTruthy();

    // В поле — нельзя ни забрать, ни вернуть.
    const target = await nearest(w.world);
    expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
    general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(general.arriveAt);
    await w.world.sync(p);
    expect(await w.world.setGarrison({})).toBeTruthy();

    // Вернулся домой — снова можно, и войско уходит обратно в деревню.
    expect(await w.world.recallFigure('general')).toBeNull();
    general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(general.arriveAt);
    await w.world.sync(p);
    expect(await w.world.setGarrison(null)).toBeNull();
    general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    // Роспуск стоит того же времени, что и сбор: пока люди идут обратно, дома
    // их ещё нет и в строю уже нет.
    expect(general.readyAt).toBeGreaterThan(w.now());
    expect(troopTotal(general.troops), 'на дороге они числятся при нём').toBe(10);
    w.at(general.readyAt);
    await w.world.sync(p);
    general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    expect(troopTotal(general.troops), 'дошли — и полководец снова один').toBe(0);
    expect(general.readyAt).toBe(0);
  });

  it('пока армия при полководце в поле, дома её нет', async () => {
    const w = makeWorld(11);
    const s = createInitialState();
    s.army = { ...s.army, clubman: 10, spearman: 6 };
    const before = defense(s);

    await w.world.sync(playerProfile(s));
    expect(await w.world.setGarrison({ clubman: 10, spearman: 6 })).toBeNull();
    const target = await nearest(w.world);
    expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
    const pulse = await w.world.sync(playerProfile(s));

    // Число ушедших выводится из фигур и походов, как и раньше — из походов.
    syncAway(s, pulse.marches, pulse.figures);
    expect(s.warriorsAway).toBe(16);
    expect(defense(s)).toBeLessThan(before);
    // Дома остаётся ополчение: частокол, башня и сами жители.
    expect(defense(s)).toBeGreaterThan(0);
    expect(troopTotal(homeOf(s.army, awayOf(pulse.marches, pulse.figures)))).toBe(0);
  });

  it('дипломат подписывает договор, и племя перестаёт ходить в набеги', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const target = (await nearest(w.world));
    const card = await w.world.settlement(target.id);
    if (!card?.tribeId) return; // ближайшие оказались варварами — договариваться не с кем

    expect(await w.world.negotiate('truce'), 'до цели ещё надо дойти').toBeTruthy();
    expect(await w.world.moveFigure('diplomat', { x: target.x, y: target.y })).toBeNull();
    const walk = (await w.world.figures()).find((f) => f.id === 'diplomat') as FigureView;
    w.at(walk.arriveAt);
    await w.world.sync(p);

    expect(await w.world.negotiate('truce')).toBeNull();
    const deals = await w.world.deals();
    expect(deals.some((d) => d.id === 'truce' && d.tribeId === card.tribeId)).toBe(true);
    const again = await w.world.settlement(target.id);
    expect(again?.deals.some((d) => d.id === 'truce')).toBe(true);
  });
});

describe('запись боя: кто именно стоял в строю', () => {
  const army: Stack = { spear: 150, infantry: 200, archer: 150, cavalry: 100 };
  const result = () =>
    resolveField({
      seed: 21,
      attacker: { kinds: army, setup: null },
      defender: { kinds: army, setup: null },
    }).result!;

  it('старая запись без состава открывается, и состав ей достраивается', () => {
    const battle = { us: 'attacker' as const, preset: null, result: result() };
    // Ровно то, что лежало в сохранении до появления поля: `troops` там нет.
    const legacy = { ...battle } as Partial<typeof battle> & { troops?: unknown };
    delete legacy.troops;
    const home = { x: 4, y: 5 };
    const save = createWorldSave(99, home, null, 1000);
    save.reports = [
      {
        id: 'r1',
        at: 1000,
        kind: 'raid',
        title: 'Старый отчёт',
        target: { id: 's1', name: 'Соседи', x: 6, y: 7 },
        won: true,
        sent: {},
        lost: {},
        enemyPower: 100,
        enemyLost: 40,
        loot: null,
        intel: null,
        battle: legacy as never,
        text: 'из прошлой версии',
        read: false,
      },
    ];
    const back = parseWorldSave(JSON.stringify(save));
    expect(back).not.toBeNull();
    const rec = back!.reports[0].battle!;
    // Отчёт не потерян и не обнулён, а состав достроен из родов боя.
    expect(back!.reports[0].title).toBe('Старый отчёт');
    expect(rec.result.sides.attacker.total.initial).toBe(battle.result.sides.attacker.total.initial);
    expect(rec.troops).toBeTruthy();
    for (const side of ['attacker', 'defender'] as const) {
      const men = troopTotal(rec.troops[side]);
      expect(men).toBe(Math.round(rec.result.sides[side].total.initial));
      for (const id of Object.keys(rec.troops[side])) expect(TROOP_IDS).toContain(id);
    }
    // И ролик по такой записи собирается.
    const cast = castOfRecord(rec.result, rec.us, rec.troops, rec.militia);
    expect(cast.sectors.length).toBeGreaterThan(0);
  });

  it('новая запись состав не теряет и второй раз не достраивает', () => {
    const troops = { attacker: { legionary: 40 }, defender: { clubman: 90 } };
    const save = createWorldSave(99, { x: 1, y: 1 }, null, 1000);
    save.reports = [
      {
        id: 'r2',
        at: 1000,
        kind: 'raid',
        title: 'Свежий отчёт',
        target: { id: 's1', name: 'Соседи', x: 6, y: 7 },
        won: true,
        sent: {},
        lost: {},
        enemyPower: 100,
        enemyLost: 40,
        loot: null,
        intel: null,
        battle: { us: 'attacker', preset: null, result: result(), troops },
        text: '',
        read: false,
      },
    ];
    const back = parseWorldSave(JSON.stringify(save));
    expect(back!.reports[0].battle!.troops).toEqual(troops);
  });

  it('чужой гарнизон получает состав из своей мощи, ничего не теряя', () => {
    for (const power of [12, 40, 90]) {
      for (const castle of [false, true]) {
        const g = garrisonOf(777, 'sett-1', power, castle);
        const troops = troopsOfKinds(g.kinds, g.gear);
        expect(troopTotal(troops)).toBe(g.men);
        for (const id of Object.keys(troops)) expect(TROOP_IDS).toContain(id);
      }
    }
    // Замок кован лучше деревни — и это видно по тому, кто в нём стоит.
    const village = troopsOfKinds(garrisonOf(777, 'a', 10).kinds, garrisonOf(777, 'a', 10).gear);
    const keep = garrisonOf(777, 'b', 90, true);
    const castleTroops = troopsOfKinds(keep.kinds, keep.gear);
    const heaviest = (t: Record<string, number | undefined>): number =>
      Math.max(...Object.keys(t).map((id) => gearOfTroop(id as never)));
    expect(heaviest(castleTroops)).toBeGreaterThan(heaviest(village));
  });
});

describe('отношения с поселениями', () => {
  /** Ближайшее к дому поселение с племенем: с варварами не договариваются. */
  async function neighbour(world: LocalWorld) {
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 30, y: info.home.y - 30, w: 60, h: 60 });
    const list = chunk.settlements.filter((s) => !s.mine && s.tribeId);
    expect(list.length, 'у дома должен быть сосед с племенем').toBeGreaterThan(0);
    return list.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  }

  /** Довести дипломата до цели: приказы отдаются только у самых ворот. */
  async function bringDiplomat(w: ReturnType<typeof makeWorld>, p: PlayerProfile, to: Coord) {
    expect(await w.world.moveFigure('diplomat', { x: to.x, y: to.y })).toBeNull();
    const walk = (await w.world.figures()).find((f) => f.id === 'diplomat') as FigureView;
    w.at(walk.arriveAt);
    await w.world.sync(p);
  }

  /** Дождаться, пока дипломат освободится от прошлых переговоров. */
  async function freeDiplomat(w: ReturnType<typeof makeWorld>, p: PlayerProfile) {
    const f = (await w.world.figures()).find((x) => x.id === 'diplomat') as FigureView;
    if (f.busyUntil > w.now()) w.at(f.busyUntil);
    await w.world.sync(p);
  }

  const rich = (): PlayerProfile =>
    profile({ stock: { food: 100_000, wood: 100_000, stone: 100_000 } });

  waitsForPlayers('приказ отдаётся только у ворот, и недоступное объяснено словами', async () => {
    const w = makeWorld(31);
    const p = rich();
    await w.world.sync(p);
    const target = await neighbour(w.world);

    const far = await w.world.orders('diplomat', target.id);
    expect(far.length, 'приказы не прячутся, даже когда их нельзя отдать').toBe(5);
    for (const o of far) {
      expect(o.can, o.id).toBe(false);
      expect(o.reason, o.id).toMatch(/далеко/);
    }
    const res = await w.world.order('gift', target.id);
    expect(res.error).toMatch(/далеко/);

    await bringDiplomat(w, p, target);
    const near = await w.world.orders('diplomat', target.id);
    expect(near.find((o) => o.id === 'insult')?.can, 'оскорбить можно всегда').toBe(true);
    // Мира нет там, где нет войны, — и об этом сказано, а не спрятано.
    const peace = near.find((o) => o.id === 'peace');
    expect(peace?.can).toBe(false);
    expect(peace?.reason).toMatch(/войны/);
    // У дара видна цена, у всякого приказа — время.
    const gift = near.find((o) => o.id === 'gift');
    expect(Object.values(gift?.cost ?? {}).reduce((n, v) => n + (v ?? 0), 0)).toBeGreaterThan(0);
    expect(gift?.seconds).toBeGreaterThan(0);
  });

  waitsForPlayers('дипломат занят после приказа: приказы конкурируют за его время', async () => {
    const w = makeWorld(33);
    const p = rich();
    await w.world.sync(p);
    const target = await neighbour(w.world);
    await bringDiplomat(w, p, target);

    expect((await w.world.order('insult', target.id)).error).toBeNull();
    const busy = (await w.world.orders('diplomat', target.id)).find((o) => o.id === 'insult');
    expect(busy?.can).toBe(false);
    expect(busy?.reason).toMatch(/переговоры/);
    const f = (await w.world.figures()).find((x) => x.id === 'diplomat') as FigureView;
    expect(f.busyUntil).toBeGreaterThan(w.now());

    await freeDiplomat(w, p);
    expect((await w.world.orders('diplomat', target.id)).find((o) => o.id === 'insult')?.can).toBe(true);
  });

  waitsForPlayers('плата берётся только за принятое', async () => {
    const w = makeWorld(37);
    const p = rich();
    await w.world.sync(p);
    const target = await neighbour(w.world);
    await bringDiplomat(w, p, target);

    // Дарим, пока не примут: отвергнутый дар возвращается и склада не трогает.
    let refused = 0;
    let accepted = 0;
    for (let i = 0; i < 30 && accepted === 0; i++) {
      await freeDiplomat(w, p);
      const before = await w.world.orders('diplomat', target.id);
      const res = await w.world.order('gift', target.id);
      expect(res.error).toBeNull();
      const pulse = await w.world.sync(p);
      const eff = pulse.effects.find((e) => e.id.includes('gift'));
      const spent = Object.values(eff?.resources ?? {}).reduce((n, v) => n + Math.abs(v ?? 0), 0);
      const cost = Object.values(before.find((o) => o.id === 'gift')?.cost ?? {}).reduce(
        (n, v) => n + (v ?? 0),
        0,
      );
      if (res.accepted) {
        accepted++;
        expect(spent, 'принятый дар стоит ровно объявленного').toBe(cost);
      } else {
        refused++;
        expect(spent, 'отвергнутый дар со склада не уходит').toBe(0);
      }
    }
    expect(accepted, 'рано или поздно дар обязан быть принят').toBe(1);
    expect(refused + accepted).toBeGreaterThan(0);
  });

  waitsForPlayers('война объявляется сразу, а разрыв пакта — через сутки предупреждения', async () => {
    const w = makeWorld(41);
    const p = rich();
    await w.world.sync(p);
    const target = await neighbour(w.world);
    await bringDiplomat(w, p, target);

    // Сначала пакт: дарим, пока не согласятся.
    const signed = await pactWith(w, p, target.id);
    expect(signed, 'пакт должен был быть подписан').toBe(true);
    expect((await w.world.settlement(target.id))?.diplomacy?.standing).toBe('pact');

    await freeDiplomat(w, p);
    expect((await w.world.order('war', target.id)).error).toBeNull();
    const card = await w.world.settlement(target.id);
    expect(card?.diplomacy?.standing, 'бумага держит до срока').toBe('pact');
    expect(card?.diplomacy?.breakAt).toBeGreaterThan(w.now());

    w.at(card!.diplomacy!.breakAt);
    await w.world.sync(p);
    expect((await w.world.settlement(target.id))?.diplomacy?.standing).toBe('war');
  });

  /** Подписать пакт по-настоящему: дарить, пока сосед не согласится. */
  async function pactWith(
    w: ReturnType<typeof makeWorld>,
    p: PlayerProfile,
    id: string,
  ): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      await freeDiplomat(w, p);
      const opt = (await w.world.orders('diplomat', id)).find((o) => o.id === 'pact');
      if (opt?.can && (opt.chance ?? 0) >= 1) {
        const res = await w.world.order('pact', id);
        if (res.accepted) return true;
        continue;
      }
      await w.world.order('gift', id);
    }
    return false;
  }

  /**
   * Сколько набегов вышло за отрезок времени и сколько из них — из этой цели.
   * Считается прогоном, а не заявлением: поведение ботов и есть то, ради чего
   * вся дипломатия существует.
   */
  async function countRaids(
    w: ReturnType<typeof makeWorld>,
    p: PlayerProfile,
    from: string,
    hours: number,
  ): Promise<{ all: number; here: number }> {
    const seen = new Set<string>();
    let all = 0;
    let here = 0;
    const end = w.now() + hours * 3_600_000;
    while (w.now() < end) {
      w.advance(20_000);
      const pulse = await w.world.sync(p);
      for (const m of pulse.marches) {
        if (m.own || seen.has(m.id)) continue;
        seen.add(m.id);
        all++;
        if (m.fromName === from) here++;
      }
    }
    return { all, here };
  }

  waitsForPlayers('в пакте сосед не нападает, в войне нападает чаще, чем в нейтралитете', async () => {
    const SEED = 43;
    const HOURS = 5;

    const quiet = makeWorld(SEED);
    const p = rich();
    await quiet.world.sync(p);
    const target = await neighbour(quiet.world);
    const neutral = await countRaids(quiet, p, target.name, HOURS);

    const angry = makeWorld(SEED);
    await angry.world.sync(p);
    await bringDiplomat(angry, p, target);
    expect((await angry.world.order('war', target.id)).error).toBeNull();
    const war = await countRaids(angry, p, target.name, HOURS);

    const calm = makeWorld(SEED);
    await calm.world.sync(p);
    await bringDiplomat(calm, p, target);
    expect(await pactWith(calm, p, target.id), 'пакт должен быть подписан').toBe(true);
    const pact = await countRaids(calm, p, target.name, HOURS);

    expect(neutral.all, 'в мирной партии набеги всё-таки идут').toBeGreaterThan(0);
    expect(war.all, 'в войне набегов больше').toBeGreaterThan(neutral.all);
    expect(war.here, 'и метят они именно во врага').toBeGreaterThan(neutral.here);
    expect(pact.here, 'из-под пакта не выходит ни одного').toBe(0);
  });

  waitsForPlayers('набег роняет отношение с самим двором сильнее, чем с соседями по племени', async () => {
    const w = makeWorld(23);
    const p = profile({ warriorPower: 4, army: { clubman: 6 } });
    await w.world.sync(p);
    const info = await w.world.info();
    const chunk = await w.world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
    const target = chunk.settlements.find((s) => s.tribeId);
    const kin = chunk.settlements.find((s) => s.tribeId === target?.tribeId && s.id !== target?.id);
    expect(target).toBeTruthy();

    await raidWith(w, target as SettlementView, p);
    const hit = (await w.world.settlement((target as SettlementView).id))?.diplomacy?.attitude ?? 0;
    expect(hit).toBeLessThan(0);
    if (kin) {
      const near = (await w.world.settlement(kin.id))?.diplomacy?.attitude ?? 0;
      expect(near, 'соседям по племени тоже обидно').toBeLessThan(0);
      expect(hit, 'но самому двору обиднее всех').toBeLessThan(near);
    }
  });

  waitsForPlayers('характер владельца один на все его дворы и не хранится в сохранении', async () => {
    const w = makeWorld(51);
    await w.world.sync(profile());
    const gen = generateWorld(51);
    const owners = new Map<string, string[]>();
    for (const s of gen.settlements) {
      if (!s.owner) continue;
      owners.set(s.owner, [...(owners.get(s.owner) ?? []), s.id]);
    }
    const pair = [...owners.values()].find((ids) => ids.length > 1);
    expect(pair, 'у кого-то из ботов должно быть несколько дворов').toBeTruthy();
    expect(temperOf(51, gen.settlements.find((s) => s.id === pair![0])!.owner!)).toBe(
      temperOf(51, gen.settlements.find((s) => s.id === pair![1])!.owner!),
    );
  });
});

describe('сохранение мира приводится, а не выбрасывается', () => {
  it('версия 5 читается как есть', () => {
    const save = createWorldSave(5, { x: 410, y: 710 }, 't0', 1000);
    expect(save.v).toBe(WORLD_SAVE_VERSION);
    const back = parseWorldSave(JSON.stringify(save));
    expect(back?.seed).toBe(5);
    expect(back?.diplomacy).toEqual({});
  });

  it('сохранение прежней земли и прежнего дома отбрасывается целиком', () => {
    // Дважды подряд приводить было нечего, и по разным причинам. Семёрка
    // сменила землю под координатами: замок, стоявший на 541|822, оказался бы
    // посреди Бискайского залива. Восьмёрка сменила то, кто выбирает клетку:
    // дом теперь ставит общий реестр, а у старого сохранения он найден поиском
    // по сиду — и весь разведанный вокруг него туман оказался бы туманом чужой
    // округи. Мир в обоих случаях просто собирается заново.
    for (const v of [3, 4, 5, 6, 7]) {
      const old = { ...createWorldSave(9, { x: 410, y: 710 }, null, 1000), v };
      expect(parseWorldSave(JSON.stringify(old)), `версия ${v}`).toBeNull();
    }
    // А своё — открывается.
    const now = createWorldSave(9, generateWorld(9).home, null, 1000);
    expect(parseWorldSave(JSON.stringify(now))?.v).toBe(WORLD_SAVE_VERSION);
  });

});

describe('лазутчик в мире', () => {
  /** Ближайший к дому чужой двор с племенем. */
  async function neighbour(world: LocalWorld) {
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 30, y: info.home.y - 30, w: 60, h: 60 });
    const list = chunk.settlements.filter((s) => !s.mine && s.tribeId);
    expect(list.length).toBeGreaterThan(0);
    return list.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  }

  async function bringSpy(w: ReturnType<typeof makeWorld>, p: PlayerProfile, to: Coord) {
    expect(await w.world.moveFigure('spy', { x: to.x, y: to.y })).toBeNull();
    const f = (await w.world.figures()).find((x) => x.id === 'spy') as FigureView;
    w.at(f.arriveAt);
    await w.world.sync(p);
  }

  async function freeSpy(w: ReturnType<typeof makeWorld>, p: PlayerProfile) {
    const f = (await w.world.figures()).find((x) => x.id === 'spy') as FigureView;
    if (f.busyUntil > w.now()) w.at(f.busyUntil);
    await w.world.sync(p);
  }

  /** Повторяет приказ, пока не получит нужный исход: условия меняются сами. */
  async function until(
    w: ReturnType<typeof makeWorld>,
    p: PlayerProfile,
    action: 'probe' | 'revolt',
    id: string,
    want: boolean,
  ): Promise<boolean> {
    for (let i = 0; i < 25; i++) {
      await freeSpy(w, p);
      const res = await w.world.order(action, id);
      if (res.error) return false;
      if (res.accepted === want) return true;
    }
    return false;
  }

  waitsForPlayers('приказ отдаётся только у ворот, и недоступное объяснено словами', async () => {
    const w = makeWorld(61);
    const p = profile();
    await w.world.sync(p);
    const target = await neighbour(w.world);

    const far = await w.world.orders('spy', target.id);
    expect(far.length, 'оба приказа видны, даже когда их нельзя отдать').toBe(2);
    for (const o of far) {
      expect(o.can, o.id).toBe(false);
      expect(o.reason, o.id).toMatch(/далеко/);
      expect(o.chance, 'шанс виден до подтверждения').toBeGreaterThan(0);
    }
    expect((await w.world.order('probe', target.id)).error).toMatch(/далеко/);

    await bringSpy(w, p, target);
    const near = await w.world.orders('spy', target.id);
    expect(near.every((o) => o.can)).toBe(true);
    // У разведчика и полководца своих приказов пока нет — и пустой список честнее
    // выдуманных кнопок.
    expect((await w.world.orders('scout', target.id)).length).toBe(0);
  });

  it('в лагере бродяг бунтовать не против кого, а сосчитать их можно', async () => {
    const w = makeWorld(67);
    const p = profile();
    await w.world.sync(p);
    const info = await w.world.info();
    const chunk = await w.world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
    const camp = chunk.settlements.find((s) => !s.mine && !s.tribeId);
    if (!camp) return; // рядом не оказалось варваров — проверять нечего
    await bringSpy(w, p, camp);
    const opts = await w.world.orders('spy', camp.id);
    expect(opts.find((o) => o.id === 'probe')?.can).toBe(true);
    const revolt = opts.find((o) => o.id === 'revolt');
    expect(revolt?.can).toBe(false);
    expect(revolt?.reason).toMatch(/бродяг|недовольных/);
  });

  waitsForPlayers('провал не губит лазутчика: его задерживают и запоминают', async () => {
    const w = makeWorld(71);
    const p = profile();
    await w.world.sync(p);
    const target = await neighbour(w.world);
    await bringSpy(w, p, target);

    const before = (await w.world.settlement(target.id))?.diplomacy?.attitude ?? 0;
    expect(await until(w, p, 'probe', target.id, false), 'провал должен когда-то случиться').toBe(true);

    const f = (await w.world.figures()).find((x) => x.id === 'spy') as FigureView;
    expect(f.phase, 'лазутчик не гибнет никогда').not.toBe('down');
    expect(f.busyUntil, 'его задержали').toBeGreaterThan(w.now());
    // Задержанный не ходит: приказ движения ему сейчас не отдать.
    const err = await w.world.moveFigure('spy', { x: target.x + 3, y: target.y + 3 });
    expect(err).toMatch(/стражей/);
    const after = (await w.world.settlement(target.id))?.diplomacy?.attitude ?? 0;
    expect(after, 'и запомнили').toBeLessThan(before);
  });

  waitsForPlayers('донесение приходит вилкой и с датой, а не точным числом', async () => {
    const w = makeWorld(73);
    const p = profile();
    await w.world.sync(p);
    const target = await neighbour(w.world);
    await bringSpy(w, p, target);
    expect(await until(w, p, 'probe', target.id, true), 'донесение должно прийти').toBe(true);

    const reading = await w.world.intel(target.id);
    expect(reading).toBeTruthy();
    expect(reading?.hearsay, 'числа приблизительны с самого начала').toBe(true);
    expect(reading?.power.value, 'точного числа у донесения нет').toBeNull();
    expect(reading?.power.max).toBeGreaterThan(reading?.power.min ?? 0);
    expect(reading?.kinds, 'и какого вида войско — тоже вилкой').toBeTruthy();
    expect(reading?.formation, 'построения лазутчик не приносит').toBeNull();
    expect(reading?.ageSeconds).toBeLessThan(60);

    const width = (r: typeof reading): number => (r ? r.power.max - r.power.min : 0);
    const fresh = width(reading);
    w.advance(INTEL_ROUGH + MINUTE);
    expect(width(await w.world.intel(target.id)), 'со временем вилка шире').toBeGreaterThan(fresh);
  });

  waitsForPlayers('бунт останавливает производство и слабит гарнизон — прогоном, а не на слово', async () => {
    const SEED = 79;
    const p = profile();
    // Две одинаковые партии: в одной поднимаем бунт, в другой нет.
    const a = makeWorld(SEED);
    const b = makeWorld(SEED);
    await a.world.sync(p);
    await b.world.sync(p);
    const target = await neighbour(a.world);

    await bringSpy(a, p, target);
    await bringSpy(b, p, target);
    // Обе партии идут одинаково до самого приказа.
    expect(await until(a, p, 'revolt', target.id, true), 'бунт должен подняться').toBe(true);
    const card = await a.world.settlement(target.id);
    expect(card?.revolt, 'бунт виден в карточке').toBeTruthy();
    expect(card?.revolt?.until).toBeGreaterThan(a.now());

    // Второй раз бунтовать там же нельзя, и об этом сказано. Ждём, пока
    // лазутчика отпустят: первая помеха всегда та, что ближе.
    await freeSpy(a, p);
    const again = (await a.world.orders('spy', target.id)).find((o) => o.id === 'revolt');
    expect(again?.can).toBe(false);
    expect(again?.reason).toMatch(/и так бунт/);

    // Догоняем вторую партию по времени и смотрим, что стало с поселением.
    b.at(a.now());
    await b.world.sync(p);
    // Горизонт длиннее самого бунта: три часа простоя видны в населении только
    // тогда, когда обе партии успели ещё и пожить дальше.
    const horizon = 6 * 60 * MINUTE;
    a.advance(horizon);
    b.advance(horizon);
    await a.world.sync(p);
    await b.world.sync(p);

    const seen = async (w: ReturnType<typeof makeWorld>): Promise<number> =>
      (await w.world.settlement(target.id))?.seenPop ?? 0;
    expect(await seen(a), 'под бунтом поселение не растёт').toBeLessThan(await seen(b));

    // Гарнизон: сравниваем середины вилок двух донесений об одном и том же дворе.
    expect(await until(a, p, 'probe', target.id, true)).toBe(true);
    expect(await until(b, p, 'probe', target.id, true)).toBe(true);
    const mid = async (w: ReturnType<typeof makeWorld>): Promise<number> => {
      const r = await w.world.intel(target.id);
      return ((r?.power.min ?? 0) + (r?.power.max ?? 0)) / 2;
    };
    const under = await mid(a);
    const calm = await mid(b);
    expect(under, 'а гарнизон его заметно слабее').toBeLessThan(calm * (1 - REVOLT_POWER_LOSS / 2));

    // Бунт кончается сам, и после него поселение снова живёт.
    a.at((card?.revolt?.until ?? 0) + MINUTE);
    await a.world.sync(p);
    expect((await a.world.settlement(target.id))?.revolt).toBeNull();
  });

  waitsForPlayers('бунт не двигает прошлое: разбитый гарнизон под бунтом не отстраивается', async () => {
    const SEED = 83;
    const p = profile({ warriorPower: 4, army: { clubman: 8 } });
    const w = makeWorld(SEED);
    await w.world.sync(p);
    const target = await neighbour(w.world);
    await bringSpy(w, p, target);
    expect(await until(w, p, 'revolt', target.id, true)).toBe(true);
    // Час под бунтом — и это не отменяет ни одной прошлой отметки: мир по-прежнему
    // отвечает на вопросы, а не падает на отрицательном возрасте записей.
    w.advance(60 * MINUTE);
    await w.world.sync(p);
    const card = await w.world.settlement(target.id);
    expect(card).toBeTruthy();
    expect(card?.revolt).toBeTruthy();
  });
});

describe('отряд полководца', () => {
  /** Ближайший к дому чужой двор с племенем. */
  async function neighbour(world: LocalWorld) {
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 30, y: info.home.y - 30, w: 60, h: 60 });
    const list = chunk.settlements.filter((s) => !s.mine && s.tribeId);
    expect(list.length).toBeGreaterThan(0);
    return list.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  }

  const general = async (w: ReturnType<typeof makeWorld>): Promise<FigureView> =>
    (await w.world.figures()).find((f) => f.id === 'general') as FigureView;

  it('вместимость выводится из уровня Статуи и ниоткуда больше', async () => {
    const s = createInitialState();
    const statue = s.buildings.find((b) => b.type === 'statue');
    expect(statue, 'Статуя стоит в посёлке с первого дня').toBeTruthy();
    const first = commandCap(s);
    expect(first).toBeGreaterThan(0);
    statue!.level = 5;
    const higher = commandCap(s);
    expect(higher, 'выше статуя — больше дружины').toBeGreaterThan(first);
    statue!.level = 10;
    expect(commandCap(s)).toBeGreaterThan(higher);
    // Мир получает это число слепком и не спрашивает, откуда оно.
    expect(playerProfile(s).command).toBe(commandCap(s));
  });

  it('больше вместимости не увести, и об этом сказано числом', async () => {
    const w = makeWorld(11);
    const p = profile({ command: 8, army: { clubman: 20 } });
    await w.world.sync(p);
    const err = await w.world.setGarrison({ clubman: 20 });
    expect(err).toMatch(/8/);
    expect(troopTotal((await general(w)).troops)).toBe(0);
    // Ровно по вместимости — можно.
    expect(await w.world.setGarrison({ clubman: 8 })).toBeNull();
  });

  waitsForPlayers('передача занимает время в обе стороны, и в дороге войско не годится в бой', async () => {
    const w = makeWorld(11);
    const p = profile({ army: { clubman: 10, archer: 6 } });
    await w.world.sync(p);

    expect(await w.world.setGarrison({ clubman: 10, archer: 6 })).toBeNull();
    let g = await general(w);
    expect(g.readyAt, 'сбор идёт время').toBeGreaterThan(w.now());
    // Пока идут — второй приказ не принимается, и ударить нечем.
    expect(await w.world.setGarrison({ clubman: 4 })).toMatch(/в дороге/);
    const target = await neighbour(w.world);
    expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
    const walk = await general(w);
    w.at(Math.max(walk.arriveAt, w.now()));
    await w.world.sync(p);

    w.at(Math.max(w.now(), (await general(w)).readyAt));
    await w.world.sync(p);
    g = await general(w);
    expect(g.readyAt, 'дошли — и сбор кончился').toBe(0);
    expect(troopTotal(g.troops)).toBe(16);

    // Обратно — столько же: роспуск не мгновенный.
    expect(await w.world.recallFigure('general')).toBeNull();
    const back = await general(w);
    w.at(back.arriveAt);
    await w.world.sync(p);
    expect(await w.world.setGarrison(null)).toBeNull();
    g = await general(w);
    expect(g.readyAt, 'роспуск идёт время').toBeGreaterThan(w.now());
    w.at(g.readyAt);
    await w.world.sync(p);
    expect(troopTotal((await general(w)).troops)).toBe(0);
  });

  waitsForPlayers('под пактом нападать нельзя, и причина видна в карточке', async () => {
    const w = makeWorld(11);
    const p = profile({ army: { clubman: 10 }, stock: { food: 100_000, wood: 100_000, stone: 100_000 } });
    await w.world.sync(p);
    const target = await neighbour(w.world);

    // Подписываем пакт по-настоящему: дарим, пока не согласятся.
    expect(await w.world.moveFigure('diplomat', { x: target.x, y: target.y })).toBeNull();
    const dip = (await w.world.figures()).find((f) => f.id === 'diplomat') as FigureView;
    w.at(dip.arriveAt);
    await w.world.sync(p);
    let signed = false;
    for (let i = 0; i < 40 && !signed; i++) {
      const f = (await w.world.figures()).find((x) => x.id === 'diplomat') as FigureView;
      if (f.busyUntil > w.now()) w.at(f.busyUntil);
      await w.world.sync(p);
      const opt = (await w.world.orders('diplomat', target.id)).find((o) => o.id === 'pact');
      if (opt?.can && (opt.chance ?? 0) >= 1) signed = (await w.world.order('pact', target.id)).accepted;
      else await w.world.order('gift', target.id);
    }
    expect(signed, 'пакт должен быть подписан').toBe(true);

    // Ведём полководца с дружиной к тому же двору.
    expect(await w.world.setGarrison({ clubman: 10 })).toBeNull();
    w.at((await general(w)).readyAt);
    await w.world.sync(p);
    expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
    w.at((await general(w)).arriveAt);
    await w.world.sync(p);

    const card = await w.world.settlement(target.id);
    expect(card?.can.raid, 'под пактом удара нет').toBe(false);
    expect(card?.note).toMatch(/[Пп]акт/);
    // И это правило мира, а не подсказка панели.
    const res = await w.world.attack({ setup: null });
    expect(res.error).toMatch(/[Пп]акт/);
    expect(res.reportId).toBeNull();
  });

  it('полководец не теряется навсегда: разбитый возвращается сам', async () => {
    const w = makeWorld(5);
    // Горстка дубинщиков против целого поселения — заведомый разгром.
    const p = profile({ warriorPower: 1, army: { clubman: 2 }, command: 60 });
    await w.world.sync(p);
    const info = await w.world.info();
    const chunk = await w.world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
    const strongest = chunk.settlements
      .filter((s) => !s.mine)
      .sort((a, b) => (b.seenPop ?? 0) - (a.seenPop ?? 0))[0];

    expect(await w.world.setGarrison({ clubman: 2 })).toBeNull();
    w.at((await general(w)).readyAt);
    await w.world.sync(p);
    expect(await w.world.moveFigure('general', { x: strongest.x, y: strongest.y })).toBeNull();
    w.at((await general(w)).arriveAt);
    await w.world.sync(p);
    const res = await w.world.attack({ setup: null });
    expect(res.error).toBeNull();

    const g = await general(w);
    if (troopTotal(g.troops) > 0) return; // отряд уцелел — проверять нечего
    expect(g.phase, 'разбитый выбывает, а не пропадает').toBe('down');
    expect(g.downUntil).toBeGreaterThan(w.now());
    w.at(g.downUntil + 1000);
    await w.world.sync(p);
    const back = await general(w);
    expect(back.phase, 'и возвращается сам').not.toBe('down');
    expect(back.downUntil).toBe(0);
  });
});

describe('перехват в поле', () => {
  const general = async (w: ReturnType<typeof makeWorld>): Promise<FigureView> =>
    (await w.world.figures()).find((f) => f.id === 'general') as FigureView;

  /** Ждём, пока ИИ вышлет набег: он идёт с запасом времени, его и ловим. */
  async function waitRaid(w: ReturnType<typeof makeWorld>, p: PlayerProfile): Promise<MarchView> {
    for (let i = 0; i < 400; i++) {
      w.advance(20_000);
      const pulse = await w.world.sync(p);
      const raid = pulse.marches.find((m) => !m.own && m.phase === 'out');
      if (raid) return raid;
    }
    throw new Error('набега так и не было');
  }

  const army = { legionary: 30, spearman: 20, archer: 15, rider: 10 };
  const strong = (): PlayerProfile =>
    profile({ warriorPower: 30, army, command: 100, units: { warrior: 40, scout: 4 } });

  it('точка и время встречи известны до приказа, а не после', async () => {
    const w = makeWorld(101);
    const p = strong();
    await w.world.sync(p);
    expect(await w.world.setGarrison(army)).toBeNull();
    w.at((await general(w)).readyAt);
    await w.world.sync(p);
    const raid = await waitRaid(w, p);

    const plan = await w.world.interceptPlan(raid.id);
    expect(plan.can, plan.reason ?? '').toBe(true);
    expect(plan.at, 'клетка встречи известна заранее').toBeTruthy();
    expect(plan.seconds).toBeGreaterThan(0);
    expect(plan.men, 'и сколько их — тоже').toBeGreaterThan(0);
    expect(plan.targetSeconds, 'и сколько им осталось идти').toBeGreaterThan(0);
    // Встреча не позже, чем они дойдут: обещание, которое не сбудется, хуже отказа.
    expect(plan.seconds).toBeLessThanOrEqual(plan.targetSeconds + 1);

    expect(await w.world.intercept(raid.id)).toBeNull();
    const g = await general(w);
    expect(g.phase).toBe('moving');
    // Полководец идёт ровно туда и ровно к тому времени, что было обещано.
    expect(g.to.x).toBe(plan.at?.x);
    expect(g.to.y).toBe(plan.at?.y);
    expect(Math.abs(g.arriveAt - (w.now() + plan.seconds * 1000))).toBeLessThan(1500);
  });

  it('разбитый в поле набег до деревни не доходит', async () => {
    const w = makeWorld(101);
    const p = strong();
    await w.world.sync(p);
    expect(await w.world.setGarrison(army)).toBeNull();
    w.at((await general(w)).readyAt);
    await w.world.sync(p);
    const raid = await waitRaid(w, p);
    expect(await w.world.intercept(raid.id)).toBeNull();

    // Одним прыжком через время встречи и один пульс: никакой фоновой работы
    // для этого не нужно — исход выведен из времён, а не досчитан по дороге.
    const g = await general(w);
    w.at(g.arriveAt + 1000);
    const pulse = await w.world.sync(p);

    const report = (await w.world.reports()).find((r) => r.title.startsWith('Перехват'));
    expect(report, 'о перехвате должен быть отчёт').toBeTruthy();
    expect(report?.battle, 'и в нём настоящий журнал боя').toBeTruthy();
    // Набег слабее обороны игрока по правилу мира, а дружина тут вся целиком:
    // такой перехват обязан удаваться, иначе проверять нечего.
    expect(report?.won, 'семьдесят пять бойцов против набега — победа').toBe(true);
    expect(pulse.marches.some((m) => m.id === raid.id), 'разбитые дальше не идут').toBe(false);
    const defense = (await w.world.reports()).find((r) => r.kind === 'defense');
    expect(defense, 'до деревни они не дошли').toBeFalsy();
    const after = await general(w);
    expect(after.phase, 'полководец остаётся в поле').not.toBe('moving');
    expect(after.at, 'и стоит там, где была встреча').toEqual({ x: g.to.x, y: g.to.y });
  });

  it('не догнать — приказа нет, и сказано почему', async () => {
    const w = makeWorld(101);
    const p = strong();
    await w.world.sync(p);
    expect(await w.world.setGarrison(army)).toBeNull();
    w.at((await general(w)).readyAt);
    await w.world.sync(p);
    const raid = await waitRaid(w, p);

    // Уводим полководца в противоположную сторону, за край обзора.
    const info = await w.world.info();
    const far = { x: info.home.x + 30, y: info.home.y + 30 };
    expect(await w.world.moveFigure('general', far)).toBeNull();
    w.at((await general(w)).arriveAt);
    await w.world.sync(p);

    const plan = await w.world.interceptPlan(raid.id);
    if (plan.can) return; // с этого угла всё-таки успевает — проверять нечего
    expect(plan.at).toBeNull();
    expect(plan.reason).toMatch(/догнать|дойдут/);
    expect(await w.world.intercept(raid.id)).toMatch(/догнать|дойдут/);
  });

  it('без войска перехватывать нечем, и это сказано отдельно', async () => {
    const w = makeWorld(101);
    const p = strong();
    await w.world.sync(p);
    const raid = await waitRaid(w, p);
    const plan = await w.world.interceptPlan(raid.id);
    expect(plan.can).toBe(false);
    expect(plan.reason).toMatch(/[Вв]ойска/);
  });

  it('свой отряд перехватывать нечего, а исчезнувший — нельзя', async () => {
    const w = makeWorld(101);
    const p = strong();
    await w.world.sync(p);
    const target = (await w.world.region({ x: 0, y: 0, w: 0, h: 0 })).settlements[0];
    expect(target).toBeUndefined();
    const plan = await w.world.interceptPlan('нет-такого');
    expect(plan.can).toBe(false);
    expect(plan.reason).toMatch(/не догнать/i);
  });
});
