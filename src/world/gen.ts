// Генерация мира. Полностью детерминирована по сиду: один сид — одна и та же карта,
// те же соседи, та же деревня игрока. Ничего не хранится, кроме результата генерации,
// поэтому серверу достаточно будет знать сид, чтобы получить ровно этот же мир.
import type { ResourceId } from '@/game/types';
import { seeded } from '@/game/sim/random';
import { pickName } from '@/game/data/names';
import type { Coord, SettlementId, TribeId } from './types';
import { coordKey, distance } from './geo';
import { buildable, tribeCenters } from './geography';
import {
  BARBARIAN_BLOCK,
  BARBARIAN_CHANCE,
  CASTLE_CHANCE,
  CASTLE_MIN_DISTANCE,
  CASTLE_POP,
  CASTLE_POWER,
  BOTS_MAX,
  BOTS_MIN,
  HOME_NEAR_MAX,
  HOME_NEAR_MIN,
  POWER_GROWTH_PER_HOUR,
  POWER_PER_TILE,
  SETTLEMENTS_MAX,
  SETTLEMENTS_MIN,
  TRIBE_RADIUS,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from './data/tuning';
import { BARBARIAN_NAMES, PLACE_FIRST, PLACE_SECOND, TRIBE_COLORS, TRIBE_NAMES } from './data/meta';

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

/**
 * Ищет свободную сушу рядом с точкой: сама точка, потом кольца вокруг.
 * Возвращает null, если вокруг всё занято или залито водой.
 */
function freeSpot(
  seed: number,
  taken: Map<string, GenSettlement>,
  x: number,
  y: number,
  radius = 3,
): Coord | null {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = x + dx;
        const py = y + dy;
        if (!habitable(seed, px, py)) continue;
        if (taken.has(coordKey(px, py))) continue;
        return { x: px, y: py };
      }
    }
  }
  return null;
}

export function generateWorld(seed: number): WorldGen {
  const rng = seeded(seed);
  const int = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

  const tribes: GenTribe[] = [];
  const settlements: GenSettlement[] = [];
  const byKey = new Map<string, GenSettlement>();
  let counter = 1;

  // 1. Центры племён приходят из географии: между ними проложены тракты, и
  // считать их здесь во второй раз нельзя — дороги пошли бы не к тем станам.
  for (const [i, center] of tribeCenters(seed).entries()) {
    tribes.push({
      id: `t${i}`,
      name: TRIBE_NAMES[i % TRIBE_NAMES.length],
      color: TRIBE_COLORS[i % TRIBE_COLORS.length],
      center,
    });
  }

  // 2. Боты и их поселения вокруг центра своего племени.
  for (const tribe of tribes) {
    const bots = int(BOTS_MIN, BOTS_MAX);
    for (let b = 0; b < bots; b++) {
      const owner = pickName(rng() < 0.5 ? 'm' : 'f', rng);
      const count = int(SETTLEMENTS_MIN, SETTLEMENTS_MAX);
      for (let k = 0; k < count; k++) {
        // Ближе к центру плотнее: два случайных числа дают спад к краю.
        const r = TRIBE_RADIUS * Math.min(rng(), rng());
        const a = rng() * Math.PI * 2;
        const spot = freeSpot(
          seed,
          byKey,
          Math.round(tribe.center.x + Math.cos(a) * r),
          Math.round(tribe.center.y + Math.sin(a) * r),
        );
        if (!spot) continue;
        const capital = k === 0 && b === 0;
        // Замок или обычное поселение решается здесь, до всякого знания о доме:
        // мир детерминирован по сиду, а расстояние до дома отсеивается ниже.
        const castle = rng() < CASTLE_CHANCE;
        const name = capital
          ? `${tribe.name.split(' ').pop()}, стан`
          : `${PLACE_FIRST[int(0, PLACE_FIRST.length - 1)]} ${PLACE_SECOND[int(0, PLACE_SECOND.length - 1)]}`;
        const s: GenSettlement = {
          id: `s${counter++}`,
          x: spot.x,
          y: spot.y,
          name,
          tribeId: tribe.id,
          owner,
          basePower: capital ? 48 + rng() * 34 : 22 + rng() * 26,
          basePop: capital ? 32 + rng() * 30 : 14 + rng() * 18,
          growth: POWER_GROWTH_PER_HOUR * (0.5 + rng()),
          lootMix: ['wood', 'stone', 'food'],
          capital,
          castle,
        };
        settlements.push(s);
        byKey.set(coordKey(s.x, s.y), s);
      }
    }
  }

  // 3. Варварские лагеря — редкой сыпью по всей карте, подальше от чужих стен.
  for (let by = lo.y; by < hi.y; by += BARBARIAN_BLOCK) {
    for (let bx = lo.x; bx < hi.x; bx += BARBARIAN_BLOCK) {
      if (rng() > BARBARIAN_CHANCE) continue;
      const x = bx + int(0, BARBARIAN_BLOCK - 1);
      const y = by + int(0, BARBARIAN_BLOCK - 1);
      if (!habitable(seed, x, y) || byKey.has(coordKey(x, y))) continue;
      if (settlements.some((s) => s.tribeId && distance(s, { x, y }) < 4)) continue;
      const s: GenSettlement = {
        id: `b${counter++}`,
        x,
        y,
        name: BARBARIAN_NAMES[int(0, BARBARIAN_NAMES.length - 1)],
        tribeId: null,
        owner: null,
        basePower: 6 + rng() * 11,
        basePop: 5 + rng() * 12,
        growth: POWER_GROWTH_PER_HOUR * 0.4,
        lootMix: ['food', 'hides', 'bones'],
        capital: false,
        // Варвары живут в шалашах: казны у них нет.
        castle: false,
      };
      settlements.push(s);
      byKey.set(coordKey(s.x, s.y), s);
    }
  }

  // 4. Деревня игрока — не в центре сетки, а рядом со случайным чужим поселением:
  // партия начинается в обжитой области, соседи видны с первого взгляда на карту.
  let home: Coord | null = null;
  const anchors = settlements.filter((s) => s.tribeId);
  for (let attempt = 0; attempt < 60 && !home && anchors.length > 0; attempt++) {
    const anchor = anchors[Math.floor(rng() * anchors.length)];
    const a = rng() * Math.PI * 2;
    const r = HOME_NEAR_MIN + rng() * (HOME_NEAR_MAX - HOME_NEAR_MIN);
    const spot = freeSpot(seed, byKey, Math.round(anchor.x + Math.cos(a) * r), Math.round(anchor.y + Math.sin(a) * r), 2);
    // Слишком близко к чужому порогу — нечестно: набег ИИ приходил бы почти мгновенно.
    if (!spot || settlements.some((s) => distance(s, spot) < 3)) continue;
    home = spot;
  }
  if (!home) home = { x: Math.round(lo.x + WORLD_SIZE / 2), y: Math.round(lo.y + WORLD_SIZE / 2) };

  // 5. Ближние цели слабее дальних — так у игрока есть, с чего начать.
  // Ближние замки при этом разжалуют в обычные поселения: первая цель на карте
  // не должна оказаться крепостью, в которую отряд уйдёт и не вернётся.
  for (const s of settlements) {
    const d = Math.min(60, distance(s, home));
    if (s.castle && distance(s, home) < CASTLE_MIN_DISTANCE) s.castle = false;
    s.basePower = Math.round((s.basePower + d * POWER_PER_TILE) * 10) / 10;
    s.basePop = Math.round(s.basePop + d * 0.25);
    if (s.castle) {
      s.basePower = Math.round(s.basePower * CASTLE_POWER * 10) / 10;
      s.basePop = Math.round(s.basePop * CASTLE_POP);
    }
  }

  // 6. Соседнее племя начинает союзным: поддержку должно быть кому нести с первого дня.
  let allyTribe = tribes[0]?.id ?? 't0';
  let best = Infinity;
  for (const t of tribes) {
    const d = distance(t.center, home);
    if (d < best) {
      best = d;
      allyTribe = t.id;
    }
  }

  return { seed, size: WORLD_SIZE, origin: { ...WORLD_ORIGIN }, tribes, settlements, byKey, home, allyTribe };
}

/** Мощь поселения сейчас: база растёт со временем и упирается в потолок. */
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
