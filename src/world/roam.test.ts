// Ход и лагерь отряда бродяги (ПН-3, docs/gdd/path_of_sword.md, 3.5.1–3.5.3, 3.5.6; «Решения ПН-3») — дверь `world/roam`.
//
// Дверь чистая и сама выключателя не знает: её зовут только двери пути (мир бродяги, реестр сервера), а они стоят за `ROAM_ON` —
// это держат `roamworld.test.ts` и тесты сервера. Здесь — правила. Граница области каждого — утверждением в тесте: клетка правда
// вода (русло, гребень, суша), отряд правда идёт или стоит, руины правда в клетке, место правда занято соседями.
import { describe, expect, it } from 'vitest';
import { distance, terrainFactor, travelTime } from './geo';
import { warWalkMs, WAR_GROUND_SEED } from './pvp';
import { generalSpeed } from './data/gait';
import { GAIT_SPEED, gaitHaltMs, GAITS, type Gait } from './gait';
import { ENERGY_PRICE, ENERGY_CAMP, ENERGY_MAX, ENERGY_ROAD } from './data/energy';
import { energyAt, freshMark, roadCost } from './energy';
import { hasRidge, hasRiver, isWaterAt, settleable, type Spot } from './land';
import { fitToSettle, settleRandom } from './settle';
import { theatreIndexAt } from './theatre/theatre';
import { SICILY, inSicilyTheatre } from './spawn';
import { terrainAt } from './geography';
import { RUIN_SALT, dropRuins, ruinAt, ruinFit, ruinsIn } from './ruins';
import { hash2 } from './geography';
import { sideWorks, throughWorks } from './works';
import { emptyStack } from '@/battle';
import { PLAYER_CAMP_WOOD, WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';
import { realMs } from '@/game/pace';
import { ROAM_STUBS } from '@/game/roamstubs';
import {
  BAND_WOOD,
  campThrough,
  campWorks,
  forestEdge,
  isNewcomer,
  NEWCOMER_MS,
  placeBand,
  roamCamp,
  roamCell,
  roamGo,
  roamMoving,
  roamPlan,
  roamSeat,
  roamWalkMs,
  roamWhere,
  shelterAt,
  type RoamMove,
} from './roam';
import { readMove, wayGait } from './roammove';

const T0 = Date.UTC(2026, 9, 29, 12);
const HOME: Spot = SICILY[0];

/** Первая клетка в квадрате вокруг `at` радиусом `r`, где выполнено `ok`. */
function near(at: Spot, r: number, ok: (c: Spot) => boolean): Spot | null {
  for (let d = 0; d <= r; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const c = { x: at.x + dx, y: at.y + dy };
        if (ok(c)) return c;
      }
    }
  }
  return null;
}

/** Первая клетка мира с признаком — шагом по сетке, потом рядом (русла и гребни на Сицилии нет). */
function anywhere(ok: (c: Spot) => boolean): Spot {
  for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y += 7) {
    for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x += 7) if (ok({ x, y })) return { x, y };
  }
  throw new Error('нет такой клетки');
}

const LAND = near(HOME, 6, (c) => settleable(c.x, c.y) && !(c.x === HOME.x && c.y === HOME.y)) as Spot;
const SEA = near(HOME, 40, (c) => isWaterAt(c.x, c.y)) as Spot;
const RIVER = anywhere((c) => hasRiver(c.x, c.y) && !isWaterAt(c.x, c.y));
const RIDGE = anywhere((c) => hasRidge(c.x, c.y) && !isWaterAt(c.x, c.y) && !hasRiver(c.x, c.y));
/** Суша Италии далеко от дома — но в том же регионе; суша другого региона. */
const FAR = near(HOME, 30, (c) => settleable(c.x, c.y) && distance(c, HOME) > 20 && inSicilyTheatre(c)) as Spot;
const ABROAD = anywhere((c) => settleable(c.x, c.y) && theatreIndexAt(c.x, c.y) > 0 && !inSicilyTheatre(c));

const seated = (at: Spot = HOME, now = T0): RoamMove => roamSeat(at, now);

describe('приказ «Идти сюда»: любая клетка суши, вода и непроходимое — отказ словами', () => {
  it('клетки теста — те, о которых речь', () => {
    expect(settleable(HOME.x, HOME.y)).toBe(true);
    expect(settleable(LAND.x, LAND.y)).toBe(true);
    expect(isWaterAt(SEA.x, SEA.y)).toBe(true);
    expect(hasRiver(RIVER.x, RIVER.y)).toBe(true);
    expect(hasRidge(RIDGE.x, RIDGE.y)).toBe(true);
    expect(inSicilyTheatre(FAR)).toBe(true);
    expect(inSicilyTheatre(ABROAD)).toBe(false);
  });

  it('суша — идёт; вода, русло, гребень, край мира, чужой регион и своя клетка — отказ словами', () => {
    expect(typeof roamGo(seated(), LAND, 'normal', T0)).toBe('object');
    expect(roamGo(seated(), SEA, 'normal', T0)).toBe('Туда не пройти: там вода. Идут в клетку суши.');
    expect(roamGo(seated(), RIVER, 'normal', T0)).toBe('В русле реки не встать — выбери берег.');
    expect(roamGo(seated(), RIDGE, 'normal', T0)).toBe('На гребне хребта не встать — выбери склон.');
    expect(roamGo(seated(), { x: WORLD_ORIGIN.x - 5, y: HOME.y }, 'normal', T0)).toBe('За краем мира земли нет.');
    expect(roamGo(seated(), ABROAD, 'normal', T0)).toMatch(/за край своей земли походы не ходят/);
    expect(roamGo(seated(), HOME, 'normal', T0)).toBe('Отряд уже здесь.');
  });

  it('путь — дорога похода войны (`pvp.warWalkMs`): `geo.travelTime` по общей земле, скорость полководца в режиме марша', () => {
    for (const g of GAITS) {
      const ms = roamWalkMs(HOME, FAR, g);
      expect(ms, g).toBe(warWalkMs(HOME, FAR, g));
      expect(ms, g).toBe(Math.round(realMs(travelTime(distance(HOME, FAR), terrainFactor(WAR_GROUND_SEED, HOME, FAR), generalSpeed(g)))));
      const m = roamGo(seated(), FAR, g, T0) as RoamMove;
      expect(m.way.until - m.way.at, g).toBe(ms);
    }
    expect(roamWalkMs(HOME, FAR, 'light')).toBeLessThan(roamWalkMs(HOME, FAR, 'normal'));
    expect(roamWalkMs(HOME, FAR, 'train')).toBeGreaterThan(roamWalkMs(HOME, FAR, 'normal'));
  });
});

describe('положение — чистая функция «откуда, куда, когда вышел»', () => {
  it('в минуту выхода — в начале, на полпути — посередине, после прихода — в цели', () => {
    const m = roamGo(seated(), FAR, 'normal', T0) as RoamMove;
    const mid = (m.way.at + m.way.until) / 2;
    expect(roamWhere(m.way, m.way.at)).toEqual({ x: HOME.x, y: HOME.y });
    expect(roamWhere(m.way, mid).x).toBeCloseTo((HOME.x + FAR.x) / 2, 9);
    expect(roamWhere(m.way, m.way.until + 1)).toEqual({ x: FAR.x, y: FAR.y });
    expect(roamMoving(m.way, mid)).toBe(true);
    expect(roamMoving(m.way, m.way.until)).toBe(false);
  });

  it('офлайн = онлайн: опрос каждую минуту не двигает отряд — та же запись и минута дают то же место у клиента и у сервера', () => {
    const order = (): RoamMove => {
      // Два приказа: в путь, а на полдороге — повернуть в другую клетку.
      const a = roamGo(seated(), FAR, 'normal', T0) as RoamMove;
      const turn = (a.way.at + a.way.until) / 2;
      return roamGo(a, LAND, 'normal', turn) as RoamMove;
    };
    const client = order();
    // Клиент «онлайн» спрашивает положение каждую минуту, сервер — «офлайн» — раз, по записи из хранилища (JSON туда и обратно).
    const until = client.way.until + 60_000;
    const seen: string[] = [];
    for (let t = T0; t <= until; t += 60_000) seen.push(JSON.stringify(roamWhere(client.way, t)));
    const server = readMove(JSON.parse(JSON.stringify(order()))) as RoamMove;
    expect(server).toEqual(client);
    for (let t = T0, i = 0; t <= until; t += 60_000, i++) expect(JSON.stringify(roamWhere(server.way, t)), `минута ${i}`).toBe(seen[i]);
    expect(roamCell(server.way, until)).toEqual(LAND);
  });
});

describe('энергия — дверь world/energy: дорога уходит в темпе режима, в лагере копится', () => {
  it('та же дорога — та же энергия в любом режиме; к приходу ровно столько меньше', () => {
    for (const g of GAITS) {
      const m = roamGo(seated(), FAR, g, T0) as RoamMove;
      const road = roadCost(m.way.until - m.way.at, GAIT_SPEED[g]);
      expect(energyAt(m.energy, m.way.until), g).toBeCloseTo(ENERGY_MAX - road, 9);
      expect(road, g).toBeCloseTo(roadCost(roamWalkMs(HOME, FAR, 'normal'), 1), 3);
      // Стоит, дойдя: энергия не уходит.
      expect(energyAt(m.energy, m.way.until + 10 * realMs(60)), g).toBeCloseTo(ENERGY_MAX - road, 9);
    }
  });

  it('сил на дорогу нет — отказ словами с числами двери энергии', () => {
    const tired: RoamMove = { ...seated(), energy: { value: 1, at: T0, mode: 'hold' } };
    const need = roadCost(roamWalkMs(HOME, FAR, 'normal'), 1);
    // Граница области: дорога правда дороже запаса.
    expect(need).toBeGreaterThan(1);
    expect(roamGo(tired, FAR, 'normal', T0)).toBe(`Не хватит сил на дорогу: нужно ${Math.ceil(need)}, есть 1. В лагере силы копятся.`);
    const plan = roamPlan(tired, FAR, T0);
    expect(plan.block).toBeNull();
    expect(plan.legs.every((l) => l.block !== null)).toBe(true);
  });

  it('в лагере запас копится темпом осадного лагеря (`ENERGY_CAMP`), в поле без лагеря — стоит', () => {
    const empty: RoamMove = { ...seated(), energy: { value: 0, at: T0, mode: 'hold' } };
    const camp = roamCamp(empty, 'open', 10, T0) as RoamMove;
    expect(energyAt(camp.energy, T0 + ENERGY_CAMP / 2)).toBeCloseTo(ENERGY_MAX / 2, 6);
    expect(energyAt(empty.energy, T0 + ENERGY_CAMP / 2)).toBe(0);
    // Дорога за энергию лагеря: полный запас — `ENERGY_ROAD` дороги.
    expect(ENERGY_CAMP).toBeLessThan(ENERGY_ROAD);
  });
});

describe('режим марша — одно место правды: поле хода `way.gait`', () => {
  it('режим лежит в ходе и больше нигде; стоящий выбирает его даром, идущий — стоянкой и ценой', () => {
    const go = roamGo(seated(), FAR, 'train', T0) as RoamMove;
    expect(go.way.gait).toBe('train');
    expect(wayGait(go.way)).toBe('train');
    expect(wayGait((roamGo(seated(), FAR, 'normal', T0) as RoamMove).way), 'обычный — без поля').toBe('normal');
    expect(Object.keys((roamGo(seated(), FAR, 'normal', T0) as RoamMove).way)).not.toContain('gait');
    // Стоящий — даром: выход сразу, цены нет.
    expect(go.way.at).toBe(T0);
    expect(energyAt(go.energy, T0)).toBe(ENERGY_MAX);
    // Идущий меняет режим — стоянка и цена смены режима (как полководец в поле).
    const mid = (go.way.at + go.way.until) / 2;
    expect(roamMoving(go.way, mid)).toBe(true);
    const plan = roamPlan(go, FAR, mid);
    const light = plan.legs.find((l) => l.gait === 'light')!;
    const train = plan.legs.find((l) => l.gait === 'train')!;
    expect(light.price).toBe(ENERGY_PRICE.gait.price);
    expect(light.start - mid).toBe(gaitHaltMs());
    expect(train.price, 'тем же режимом — без стоянки').toBe(0);
    const turned = roamGo(go, FAR, 'light', mid) as RoamMove;
    expect(turned.way.at).toBe(mid + gaitHaltMs());
    expect(energyAt(turned.energy, mid)).toBeCloseTo(energyAt(go.energy, mid) - ENERGY_PRICE.gait.price, 9);
    expect(roamWhere(turned.way, mid + 1), 'на стоянке стоит').toEqual(roamWhere(turned.way, mid));
  });
});

describe('лагерь трёх видов — где угодно на суше; в руинах — у руин и до вместимости', () => {
  const RUIN = (() => {
    const list = ruinsIn(HOME.x - 40, HOME.y - 40, HOME.x + 40, HOME.y + 40).filter((r) => inSicilyTheatre(r));
    return list[0];
  })();
  const NO_RUIN = near(HOME, 10, (c) => settleable(c.x, c.y) && ruinAt(c.x, c.y) === null) as Spot;

  it('руины в округе есть, клетка без руин — без руин', () => {
    expect(RUIN).toBeDefined();
    expect(ruinAt(RUIN.x, RUIN.y)).toEqual(RUIN);
    expect(ruinAt(NO_RUIN.x, NO_RUIN.y)).toBeNull();
  });

  it('открытый и скрытый — на любой суше; лагерь в воде — отказ', () => {
    for (const kind of ['open', 'hidden'] as const) {
      const m = roamCamp(seated(NO_RUIN), kind, 12, T0) as RoamMove;
      expect(m.camp).toEqual({ kind, since: T0, builders: 12 });
    }
    expect(roamCamp(seated(SEA), 'open', 12, T0)).toBe('Здесь лагерь не поставить: вода под ногами. Дойди до суши.');
    expect(roamCamp(seated(NO_RUIN), 'ruin', 12, T0)).toBe('Здесь нет руин: в руинах встают у руин на карте.');
  });

  it('в руинах: помещается — встаёт, больше вместимости — отказ словами', () => {
    const cap = ROAM_STUBS.ruinCap.value;
    expect(RUIN.cap).toBe(cap);
    expect((roamCamp(seated(RUIN), 'ruin', cap, T0) as RoamMove).camp?.kind).toBe('ruin');
    expect(roamCamp(seated(RUIN), 'ruin', cap + 1, T0)).toBe(`В руинах помещается до ${cap} человек, а в отряде ${cap + 1}.`);
  });

  it('сменить вид на стоянке — рогатки стоят; идущий встаёт там, где застал приказ; снять — в поле', () => {
    const open = roamCamp(seated(NO_RUIN), 'open', 12, T0) as RoamMove;
    const later = T0 + 3_600_000;
    const hidden = roamCamp(open, 'hidden', 30, later) as RoamMove;
    expect(hidden.camp).toEqual({ kind: 'hidden', since: T0, builders: 12 });
    expect(roamCamp(hidden, 'hidden', 30, later)).toBe('Отряд уже стоит этим лагерем.');
    const go = roamGo(seated(), FAR, 'normal', T0) as RoamMove;
    const mid = (go.way.at + go.way.until) / 2;
    const stop = roamCamp(go, 'open', 6, mid);
    if (typeof stop === 'string') {
      // Застал на воде или в русле — отказ, и это тоже правило: проверяем, что клетка правда такая.
      const c = roamCell(go.way, mid);
      expect(settleable(c.x, c.y)).toBe(false);
    } else {
      expect(stop.way.to).toEqual(roamCell(go.way, mid));
      expect(roamMoving(stop.way, mid + 1)).toBe(false);
      expect(stop.camp?.since).toBe(mid);
    }
    const off = roamCamp(hidden, null, 30, later) as RoamMove;
    expect(off.camp).toBeNull();
    expect(roamCamp(off, null, 30, later)).toBe('Лагеря нет: отряд и так стоит в поле.');
  });

  it('рогатки — та же формула прохода `throughWorks`, что у осадного лагеря; древесина лагеря игрока — вся в поле', () => {
    expect(BAND_WOOD).toEqual({ front: 0, rear: PLAYER_CAMP_WOOD });
    const c = (roamCamp(seated(NO_RUIN), 'open', 20, T0) as RoamMove).camp!;
    const going = { ...emptyStack(), infantry: 60 };
    for (const dt of [0, 3_600_000, 86_400_000, 30 * 86_400_000]) {
      const at = T0 + dt;
      expect(campThrough(c, at, going)).toEqual(throughWorks('rear', 20, T0, at, going, undefined, BAND_WOOD));
      expect(campWorks(c, at)).toBe(sideWorks(T0, at, 'rear', BAND_WOOD));
    }
    // Граница: рогатки правда растут и правда режут проход.
    const ripe = T0 + 400 * 86_400_000;
    expect(campWorks(c, ripe)).toBe(1);
    expect(campThrough(c, ripe, going).passed).toBeLessThan(60);
    expect(campThrough(c, T0, going).passed, 'только встал — рогаток нет').toBe(60);
  });
});

describe('руины — общие точки мира постоянной солью', () => {
  it('одни и те же у всех: заново посчитанные — те же; каждая — на земле двора, в своём квадрате, с наименьшим хешем соли', () => {
    const rect = [HOME.x - 60, HOME.y - 60, HOME.x + 60, HOME.y + 60] as const;
    const a = ruinsIn(...rect);
    dropRuins();
    const b = ruinsIn(...rect);
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(10);
    const block = ROAM_STUBS.ruinBlock.value;
    for (const r of a) {
      expect(ruinFit(r.x, r.y)).toBe(true);
      const bx = Math.floor(r.x / block) * block;
      const by = Math.floor(r.y / block) * block;
      for (let y = by; y < by + block; y++)
        for (let x = bx; x < bx + block; x++) if (ruinFit(x, y)) expect(hash2(RUIN_SALT, x, y)).toBeGreaterThanOrEqual(hash2(RUIN_SALT, r.x, r.y));
    }
  });

  it('руины — не переправы: своя соль', () => {
    expect(RUIN_SALT).not.toBe(0x7e0d);
  });
});

describe('место выхода — у руин или опушки, вдали от замков и новичков', () => {
  it('новичок — меньше 48 настоящих часов', () => {
    expect(NEWCOMER_MS).toBe(48 * 3_600_000);
    expect(isNewcomer(T0, T0 + NEWCOMER_MS - 1)).toBe(true);
    expect(isNewcomer(T0, T0 + NEWCOMER_MS)).toBe(false);
  });

  it('укрытие, суша замка, не ближе заглушки к замкам и новичкам; тот же ключ — то же место', () => {
    const gap = ROAM_STUBS.spawnGap.value;
    const castles = SICILY.slice(0, 6);
    const fresh = [{ x: 790, y: 1335 }];
    for (const key of ['tg-1', 'tg-2', 'tg-3', 'tg-77']) {
      const at = placeBand(settleRandom(key), castles, fresh, inSicilyTheatre);
      expect(shelterAt(at), key).toBe(true);
      expect(fitToSettle(at), key).toBe(true);
      expect(inSicilyTheatre(at), key).toBe(true);
      for (const o of [...castles, ...fresh]) expect(distance(at, o), key).toBeGreaterThanOrEqual(gap);
      expect(placeBand(settleRandom(key), castles, fresh, inSicilyTheatre), key).toEqual(at);
    }
  });

  it('опушка — лес у земли без леса; руины — укрытие', () => {
    const edge = near(HOME, 60, (c) => forestEdge(c.x, c.y)) as Spot;
    expect(terrainAt(0, edge.x, edge.y)).toBe('forest');
    const ruin = ruinsIn(HOME.x - 30, HOME.y - 30, HOME.x + 30, HOME.y + 30)[0];
    expect(shelterAt(ruin)).toBe(true);
  });
});

describe('стоянка нового отряда', () => {
  it('стоит на клетке выхода, полный запас, лагеря нет', () => {
    const m = roamSeat(HOME, T0);
    expect(roamMoving(m.way, T0 + 1)).toBe(false);
    expect(roamCell(m.way, T0 + 1)).toEqual(HOME);
    expect(m.camp).toBeNull();
    expect(energyAt(m.energy, T0 + 1)).toBe(ENERGY_MAX);
    expect(m.energy).toEqual(freshMark(T0, 'hold'));
  });

  it('все режимы — из списка', () => {
    const all: Gait[] = ['light', 'normal', 'train'];
    expect([...GAITS]).toEqual(all);
  });
});
