// Заселение мира. Земля больше не генерируется — она приходит из атласа
// (`atlas/`), одна на всех. Здесь остаётся только то, что на этой земле стоит:
// логова и замок игрока.
//
// Поселений ботов больше нет ни одного, и это не «выключено», а следствие
// поворота: мир становится общим, а замки на нём появляются при регистрации
// живых игроков. Код племён, дипломатии, писем и осад при этом на месте —
// разбирать его будем отдельно; здесь просто некому в нём участвовать.
//
// Расстановка по-прежнему детерминирована по сиду: один сид — те же логова и тот
// же замок. **Порядок обращений к `rng` — часть мира.** Мир не хранится, он
// пересобирается из сида на каждой загрузке: переставь здесь два вызова местами,
// и у всех, кто уже играет, логова окажутся в других местах.
import type { ResourceId } from '@/game/types';
import { seeded } from '@/game/sim/random';
import type { Coord, SettlementId, TribeId } from './types';
import { coordKey, distance, terrainFactor } from './geo';
import { buildable, reachableLand, terrainAt } from './geography';
import {
  AI_RANGE,
  BARBARIAN_BLOCK,
  HOME_SIGHT,
  BARBARIAN_CHANCE,
  HOME_LAND_RADIUS,
  HOME_LAND_SHARE,
  LAIR_ANCHOR_HOME,
  LAIR_ANCHOR_FAR,
  LAIR_ANCHOR_RANGE,
  LAIR_HOME_GAP,
  LAIR_NEAR_CAP,
  LAIR_REACH_FACTOR,
  LAIR_SETTLE_GAP,
  MAINLAND_MIN,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from './data/tuning';
import { BARBARIAN_NAMES } from './data/meta';

export interface GenTribe {
  id: TribeId;
  name: string;
  color: string;
  center: Coord;
}

export interface GenSettlement {
  id: SettlementId;
  x: number;
  y: number;
  name: string;
  /** null — варварский лагерь без владельца. */
  tribeId: TribeId | null;
  owner: string | null;
  /** Мощь и население на момент создания мира; со временем растут (см. powerOf). */
  basePower: number;
  basePop: number;
  /** Доля прироста мощи за час. */
  growth: number;
  /** Что здесь можно взять. */
  lootMix: ResourceId[];
  capital: boolean;
  /** Замок: крепкая цель с казной. */
  castle: boolean;
}

export interface WorldGen {
  seed: number;
  size: number;
  origin: Coord;
  tribes: GenTribe[];
  settlements: GenSettlement[];
  byKey: Map<string, GenSettlement>;
  /** Свободная клетка в обжитой области — там встанет деревня игрока. */
  home: Coord;
  /** Ближайшее племя начинает союзником: иначе «поддержать» некого. */
  allyTribe: TribeId;
}

const lo = WORLD_ORIGIN;
const hi = { x: WORLD_ORIGIN.x + WORLD_SIZE, y: WORLD_ORIGIN.y + WORLD_SIZE };

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Клетка внутри мира и пригодна под двор: не вода, не русло, не хребет. */
const habitable = (seed: number, x: number, y: number): boolean =>
  x >= lo.x && y >= lo.y && x < hi.x && y < hi.y && buildable(seed, x, y);

export function generateWorld(seed: number): WorldGen {
  const rng = seeded(seed);
  const int = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

  // Племён нет: их станы держали дороги и поселения ботов, а нет ни того, ни
  // другого. Список остаётся пустым, а не удаляется — на него смотрит половина
  // мира, и подменять его на `undefined` значило бы править эту половину.
  const tribes: GenTribe[] = [];
  const settlements: GenSettlement[] = [];
  const byKey = new Map<string, GenSettlement>();
  let counter = 1;

  const addLair = (x: number, y: number): GenSettlement => {
    const s = makeLair(`b${counter++}`, x, y, BARBARIAN_NAMES[int(0, BARBARIAN_NAMES.length - 1)]);
    settlements.push(s);
    byKey.set(coordKey(s.x, s.y), s);
    return s;
  };

  // 1. Логова — редкой сыпью по всей карте. Блок крупный нарочно: мир вырос
  // вчетверо по стороне, и прежний шаг дал бы полторы тысячи лагерей, то есть
  // полторы тысячи объектов в каждом переборе мира.
  for (let by = lo.y; by < hi.y; by += BARBARIAN_BLOCK) {
    for (let bx = lo.x; bx < hi.x; bx += BARBARIAN_BLOCK) {
      if (rng() > BARBARIAN_CHANCE) continue;
      const x = bx + int(0, BARBARIAN_BLOCK - 1);
      const y = by + int(0, BARBARIAN_BLOCK - 1);
      if (!habitable(seed, x, y) || byKey.has(coordKey(x, y))) continue;
      addLair(x, y);
    }
  }

  // 2. Замок игрока. Прежде он вставал рядом с чужим двором — обжитая область
  // была видна с первого взгляда. Дворов не осталось, поэтому правило другое и
  // выражено через саму землю: место должно быть пригодным и стоять на **суше**,
  // а не на островке в три клетки. Иначе первая партия начиналась бы на скале
  // посреди Атлантики, и добраться оттуда было бы некуда.
  let home: Coord | null = null;
  for (let attempt = 0; attempt < 400 && !home; attempt++) {
    const x = Math.round(lo.x + rng() * (WORLD_SIZE - 1));
    const y = Math.round(lo.y + rng() * (WORLD_SIZE - 1));
    if (!habitable(seed, x, y)) continue;
    if (terrainAt(seed, x, y) === 'desert') continue;
    // Сначала дешёвая мерка по кругу, и только на прошедших — обход суши: он
    // стоит тысячи клеток, и гонять его на каждую пробу из четырёхсот незачем.
    if (landShare(seed, x, y) < HOME_LAND_SHARE) continue;
    if (reachableLand(seed, x, y, MAINLAND_MIN) < MAINLAND_MIN) continue;
    if (settlements.some((s) => distance(s, { x, y }) < LAIR_HOME_GAP)) continue;
    home = { x, y };
  }
  // Не нашлось за четыреста попыток — берём первую пригодную клетку материка.
  // Молча вставать в геометрический центр сетки нельзя: там может быть море.
  if (!home) home = firstMainland(seed);

  // 3. Логова у порога. Мир и так заводит их по ходу партии (`spawnLair`), но
  // ждать за это первые полчаса нечего: без ботов логово — единственная цель на
  // карте, и её надо видеть с первого взгляда.
  //
  // Первое ставится **внутри круга обзора деревни**, а не просто в округе. Иначе
  // первый день выглядит так: чёрная карта, своё поселение посередине и ничего
  // больше. Остальные расходятся до `AI_RANGE` — их находит разведчик.
  for (let n = 0; n < LAIR_NEAR_CAP - 1; n++) {
    const far = n === 0 ? HOME_SIGHT - 2 : AI_RANGE;
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = LAIR_HOME_GAP + rng() * (far - LAIR_HOME_GAP);
      const x = Math.round(home.x + Math.cos(a) * r);
      const y = Math.round(home.y + Math.sin(a) * r);
      if (!habitable(seed, x, y) || byKey.has(coordKey(x, y))) continue;
      if (distance({ x, y }, home) < LAIR_HOME_GAP) continue;
      if (settlements.some((o) => distance(o, { x, y }) < LAIR_SETTLE_GAP)) continue;
      // До первой цели идут посуху. На настоящей карте у замка на берегу
      // ближайшее место через залив: по прямой десять клеток, по времени полчаса.
      if (terrainFactor(seed, home, { x, y }) >= LAIR_REACH_FACTOR) continue;
      addLair(x, y);
      break;
    }
  }

  // Союзного племени нет, потому что нет племён. Поле остаётся ради договора с
  // остальным миром: он спрашивает его в десятке мест и переживёт пустую строку.
  return { seed, size: WORLD_SIZE, origin: { ...WORLD_ORIGIN }, tribes, settlements, byKey, home, allyTribe: 't0' };
}

/**
 * Доля суши вокруг клетки. Ею и меряется «стоит на материке, а не на скале»:
 * считать связные куски земли (`landmasses`) ради одной проверки — это полный
 * обход шестисот сорока тысяч клеток на каждую генерацию мира.
 */
function landShare(seed: number, x: number, y: number): number {
  let land = 0;
  let all = 0;
  const r = HOME_LAND_RADIUS;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      all++;
      if (terrainAt(seed, x + dx, y + dy) !== 'water') land++;
    }
  }
  return all > 0 ? land / all : 0;
}

/** Первая пригодная клетка материка. Запасной путь, и он обязан быть на земле. */
function firstMainland(seed: number): Coord {
  for (let y = lo.y; y < hi.y; y++) {
    for (let x = lo.x; x < hi.x; x++) {
      if (!habitable(seed, x, y)) continue;
      if (reachableLand(seed, x, y, MAINLAND_MIN) < MAINLAND_MIN) continue;
      return { x, y };
    }
  }
  throw new Error('Атлас мира: материка не нашлось ни в одной клетке.');
}

/**
 * Мощь поселения сейчас. Чужих дворов на карте не осталось, и звать её пока
 * некому, кроме логова через `lairPower`; удалять не надо — она вернётся вместе
 * с замками живых игроков.
 */
export function powerOf(s: GenSettlement, elapsedMs: number, cap: number): number {
  const hours = Math.max(0, elapsedMs) / 3_600_000;
  return s.basePower * Math.min(cap, 1 + s.growth * hours);
}

/** Население растёт медленнее мощи — стадия меняется не каждые пять минут. */
export function popOf(s: GenSettlement, elapsedMs: number, cap: number): number {
  const hours = Math.max(0, elapsedMs) / 3_600_000;
  return Math.round(s.basePop * Math.min(cap, 1 + s.growth * hours * 0.5));
}

export const clampCoord = (c: Coord): Coord => ({
  x: clamp(Math.round(c.x), lo.x, hi.x - 1),
  y: clamp(Math.round(c.y), lo.y, hi.y - 1),
});

/**
 * Логово — варварский лагерь. Признак один и выводится из данных: племени у
 * логова нет и быть не может. Второго поля под это заводить нельзя — оно тут же
 * разошлось бы с `tribeId` в первом же месте, где о лагере спрашивают.
 */
export const isLair = (s: GenSettlement): boolean => s.tribeId === null;

/**
 * Опора логова: от неё выводятся и начальная сила, и потолок роста
 * (`world/lairs.ts`). Раньше её давала мощь чужих дворов вокруг — логово среди
 * станов росло крепче, чем в глухом углу. Дворов не осталось, и опору теперь
 * задаёт единственное, что на этой карте ещё есть: расстояние до замка игрока.
 *
 * Правило то же, каким мир испокон веку делал ближние цели слабее дальних, и
 * числа те же по порядку. Дальше `LAIR_ANCHOR_RANGE` опора не растёт: у логова
 * обязан быть потолок, иначе вернувшийся через три дня игрок застанет стену.
 *
 * Тихого запасного значения здесь нет и быть не должно. Прежняя единица при
 * пустом списке соседей превращала логово в бутафорию — один боец, две души,
 * четыре добра, — и не писала об этом никуда.
 */
export function lairAnchor(home: Coord, at: Coord): number {
  const t = Math.min(1, distance(home, at) / LAIR_ANCHOR_RANGE);
  return LAIR_ANCHOR_HOME + (LAIR_ANCHOR_FAR - LAIR_ANCHOR_HOME) * t;
}

/**
 * Логово как поселение мира. Одна кухня и для генерации, и для тех, что
 * заводятся по ходу партии: две сборки одного и того же разошлись бы ровно в
 * тот день, когда у логова появится новое поле.
 *
 * Мощь и население здесь не хранятся: их считает `world/lairs.ts` от времени
 * появления. Поля `basePower`/`basePop` остаются нулями нарочно — увидит их
 * кто-то в обход, и промах будет громким, а не тихим.
 */
export function makeLair(id: SettlementId, x: number, y: number, name: string): GenSettlement {
  return {
    id,
    x,
    y,
    name,
    tribeId: null,
    owner: null,
    basePower: 0,
    basePop: 0,
    growth: 0,
    // Строительные материалы и оружие: разбойники живут тем, что отняли у
    // проезжих, а не тем, что вырастили.
    lootMix: ['wood', 'stone'],
    capital: false,
    // Варвары живут в шалашах: казны у них нет.
    castle: false,
  };
}
