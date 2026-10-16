/**
 * Щуп добычи (docs/minigames.md, 18): игроки-автоматы трёх рук — новичок, середняк и умелый — играют все четыре
 * промысла по правилам, без сцены и без часов, и отдают долю, которую приняло бы начисление (`rules.shareOf`).
 *
 * ЗАЧЕМ. Этап 6 добавил промыслам час, редкую добычу и серию удач с одним условием владельца: средний выход не выше
 * прежнего. Выход — доля потолка (`sim/minigames.harvest`), потолок не тронут, значит сравнивать надо долю: прежние
 * правила против новых на одном наборе зёрен и одной руке. Это делает `yieldTable` — её держит тест
 * (`yield.test.ts`) и печатает стенд (`BUDGET=1 npm run mini:shots`, раздел «добыча за выход»).
 *
 * РУКА — НЕ ИГРОК, А МЕРКА. Автомат ходит по прямой, видит сквозь затылок и не путает кусты; живой игрок хуже его в
 * каждом деле. Поэтому числа долей здесь — не «сколько берёт игрок», а сравнение одного и того же умения на двух
 * сводах правил. Рук три, чтобы прибавка, которую берёт только умелый, не спряталась за средним.
 *
 * Ни одной случайности устройства: разброс руки (промах лучника, медлительность подсечки) — генератор от зерна игры.
 * Модуль в игру не входит: его зовут тест и стенд.
 */
import { WALK_SPEED } from '@/prologue/glade';
import { SEASON_DAYS } from '@/game/data/seasons';
import { dayPartAt } from '@/game/derived';
import { DAY_LENGTH } from '@/game/pace';
import { mixSeed } from '@/game/sim/random';
import type { Season } from '@/game/types';
import type { Zone } from '@/render/climate';
import { BUSH_KINDS, Basket, STRAWBERRY_WORTH, berryBonusMax, layBerries, yieldOf, type Bush } from './berries';
import { BEASTS, Feed, HAY, herdBonusMax, herdOf, roamAt } from './herd';
import { DEER_BODY, DRAW_S, EYE_Y, HOUR_EAR, Hunt, NOCK_AHEAD, SNEAK, START, V_FULL, aimFor, clearSight, type HuntTwists } from './hunt';
import { CAST_MAX, CAST_MIN, Fishing, HOUR_BITE, castPoint, spotAt, type Shore } from './fishing';
import { GAME_SECONDS, HOURS, REACH, hourOf, seeded, shareOf, type Hour } from './rules';
import type { MinigameId } from '@/game/data/minigames';

/** Рука автомата. */
export interface Hand {
  name: string;
  /** Сколько секунд от решения до дела: найти глазами, повернуться, нажать. */
  react: number;
  /** Доля полного шага, которой ходит. */
  pace: number;
  /** «Ягоды»: какую долю спелых ждёт на кусте, прежде чем обобрать. */
  patience: number;
  /** «Охота»: разброс прицела, рад, и ошибка глазомера дали, доля. Подкрадывается ли к ближней кучке. */
  aim: number;
  range: number;
  sneak: boolean;
  /** «Рыбалка»: секунды до подсечки после поклёвки; доля подсечек на ложную дрожь; до какого натяжения держит
   *  катушку; ведёт ли удилище против рывка; обходит ли траву и корягу. */
  strike: number;
  jumpy: number;
  hold: number;
  rod: boolean;
  wary: boolean;
}

export const HANDS: readonly Hand[] = [
  { name: 'новичок', react: 1.6, pace: 0.6, patience: 0.5, aim: 0.03, range: 0.25, sneak: false, strike: 0.45, jumpy: 0.25, hold: 0.9, rod: false, wary: false },
  { name: 'середняк', react: 0.9, pace: 0.8, patience: 0.75, aim: 0.015, range: 0.12, sneak: false, strike: 0.3, jumpy: 0.1, hold: 0.8, rod: false, wary: true },
  { name: 'умелый', react: 0.4, pace: 1, patience: 0.95, aim: 0.006, range: 0.04, sneak: true, strike: 0.18, jumpy: 0, hold: 0.72, rod: true, wary: true },
];

/** Что сверх прежнего: час, редкая добыча, серия. `CLASSIC` — прежние правила, с ними и сравнивают. */
export interface Twists {
  hour: Hour;
  rare: boolean;
  streaks: boolean;
}

export const CLASSIC: Twists = { hour: 'dawn', rare: false, streaks: false };

/** Нормальный разброс от генератора: сумма двенадцати равномерных минус шесть. */
const normal = (rnd: () => number): number => {
  let n = 0;
  for (let i = 0; i < 12; i++) n += rnd();
  return n - 6;
};

// ---------- «Ягоды» ----------

/** Обойти поляну: идёт к кусту, который на подходе будет спел на `patience`, — дороже земляника; нет такого — ждёт ближайший. */
export function playBerries(seed: number, hand: Hand, tw: Twists): number {
  const field = layBerries(seed, { rare: tw.rare });
  const basket = new Basket(tw.streaks);
  const END = GAME_SECONDS.berries;
  const speed = WALK_SPEED * hand.pace;
  let t = 0;
  let x = 0;
  let z = 0;
  const gapTo = (b: Bush): number => Math.max(0, Math.hypot(b.x - x, b.z - z) - BUSH_KINDS[b.kind].r - REACH * 0.9);
  const ripeShare = (b: Bush, at: number): number => yieldOf(b, at).ripe / b.berries.length;
  const worth = (b: Bush): number => (b.kind === 'strawberry' ? STRAWBERRY_WORTH : 1) * b.berries.length;
  while (t < END) {
    const left = field.bushes.filter((b) => !basket.isPicked(b.id));
    if (!left.length) break;
    let best: Bush | null = null;
    let bestAt = Infinity;
    let bestScore = -Infinity;
    for (const b of left) {
      const at = t + gapTo(b) / speed + hand.react;
      if (at >= END || ripeShare(b, at) < hand.patience) continue;
      // Ближнее и дорогое — первым: ценность за секунду пути.
      const score = worth(b) / (at - t + 1);
      if (score > bestScore) {
        best = b;
        bestAt = at;
        bestScore = score;
      }
    }
    if (!best) {
      // Ждать того, кто раньше всех дойдёт до своего «спело на `patience`».
      for (const b of left) {
        const at = t + gapTo(b) / speed + hand.react;
        const ts = b.berries.map((q) => q.ripeAt).sort((p, q) => p - q);
        const need = ts[Math.max(0, Math.ceil(hand.patience * ts.length) - 1)];
        const pick = Math.min(Math.max(at, need), END - 0.05);
        if (at < END && pick < bestAt) {
          best = b;
          bestAt = pick;
        }
      }
      if (!best) break;
    }
    const d = Math.hypot(best.x - x, best.z - z);
    const k = d > 0 ? gapTo(best) / d : 0;
    x += (best.x - x) * k;
    z += (best.z - z) * k;
    t = bestAt;
    basket.pick(best, t);
  }
  return shareOf({ got: basket.got, total: field.total, bonus: basket.bonus, bonusMax: berryBonusMax(field, tw.streaks) });
}

// ---------- «Скот» ----------

/** Носит охапки: от стога к ближнему голодному, догоняя его по ходу. */
export function playHerd(seed: number, hand: Hand, tw: Twists): number {
  const herd = herdOf(seed, { rare: tw.rare });
  const feed = new Feed(herd);
  const flock = roamAt(herd, herd.beasts[0], 0);
  const a = Math.atan2(flock.z, flock.x) + Math.PI / 2;
  let x = Math.cos(a) * (HAY.r + 1.1);
  let z = Math.sin(a) * (HAY.r + 1.1);
  const END = GAME_SECONDS.herd;
  const dt = 0.05;
  const speed = WALK_SPEED * hand.pace;
  let wait = 0;
  for (let t = 0; t < END; t += dt) {
    if (wait > 0) {
      wait -= dt;
      continue;
    }
    let tx = HAY.x;
    let tz = HAY.z;
    let r = HAY.r;
    let id = -1;
    if (feed.carrying) {
      let near = Infinity;
      herd.beasts.forEach((b, i) => {
        if (feed.sated(i)) return;
        const p = feed.at(i, t);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < near) {
          near = d;
          tx = p.x;
          tz = p.z;
          r = BEASTS[b.kind].r;
          id = i;
        }
      });
      if (id < 0) break;
    }
    const len = Math.hypot(tx - x, tz - z);
    if (len - r <= REACH * 0.9) {
      if (id < 0) feed.take();
      else feed.feed(id, t);
      wait = hand.react;
      continue;
    }
    const step = Math.min(speed * dt, len - r);
    x += ((tx - x) / len) * step;
    z += ((tz - z) / len) * step;
  }
  return shareOf({ got: feed.got, total: herd.total, bonus: feed.bonus, bonusMax: herdBonusMax(herd) });
}

// ---------- «Охота» ----------

/**
 * Лучник: умелый крадётся к ближней кучке (шагом тише слуха) до двадцати метров, остальные бьют со старта. Цель —
 * ближний стоящий олень на виду; прицел — поправка дуги по дали, ошибка глазомера и дрожь руки — от зерна.
 */
export function playHunt(seed: number, hand: Hand, tw: Twists): number {
  const twists: HuntTwists = { hour: tw.hour, rare: tw.rare };
  const h = new Hunt(seed, twists);
  const rnd = seeded(mixSeed(seed >>> 0, 0xb07));
  const END = GAME_SECONDS.hunt;
  // Кадр в двадцатую секунды: охота от кадра не зависит (тест повторяемости в `hunt.test.ts`), а щуп втрое быстрее.
  const dt = 1 / 20;
  let x = START.x;
  let z = START.z;
  let walking = 0;
  let target = -1;
  let look = 0;
  let drawAt = -1;
  let next = hand.react;
  const standing = (i: number, t: number): boolean => {
    const p = h.pose(i, t);
    return p.kind === 'graze' || p.kind === 'alert';
  };
  // Ближний стоящий олень на виду: от ближнего к дальнему, первый, кого не закрывает укрытие.
  const pickTarget = (t: number): number => {
    const near = h.field.deer
      .map((_, i) => ({ i, p: h.pose(i, t) }))
      .filter((o) => (o.p.kind === 'graze' || o.p.kind === 'alert') && Math.hypot(o.p.x - x, o.p.z - z) <= 42)
      .sort((a, b) => Math.hypot(a.p.x - x, a.p.z - z) - Math.hypot(b.p.x - x, b.p.z - z));
    return near.find((o) => clearSight(h.field.cover, x, EYE_Y, z, o.p.x, DEER_BODY.y, o.p.z))?.i ?? -1;
  };
  for (let t = dt; t <= END + 1e-9; t += dt) {
    h.advance(t, { x, z, walking });
    if (h.over(t)) break;
    if (h.quiver <= 0) continue;
    if (drawAt < 0) {
      if (t < next) continue;
      // Глазами — раз в четверть секунды, а не каждый кадр: цель выбирают взглядом, а не тиком.
      if (t >= look) {
        target = pickTarget(t);
        look = t + 0.25;
      }
      if (target >= 0 && !standing(target, t)) target = -1;
      if (target < 0) continue;
      const p = h.pose(target, t);
      const d = Math.hypot(p.x - x, p.z - z);
      // Подкрасться: шагом тише слуха, пока ближняя кучка дальше двадцати метров.
      if (hand.sneak && d > 20) {
        walking = SNEAK * 0.9;
        const step = (WALK_SPEED * walking * dt) / d;
        x += (p.x - x) * step;
        z += (p.z - z) * step;
        continue;
      }
      walking = 0;
      h.pull(t);
      drawAt = t;
      continue;
    }
    if (t - drawAt < DRAW_S + hand.react * 0.5) continue;
    // Выстрел: поправка дуги по глазомеру и дрожь руки.
    const p = h.pose(target, t);
    const dx = p.x - x;
    const dz = p.z - z;
    const d = Math.hypot(dx, dz);
    const judged = d * (1 + hand.range * normal(rnd));
    const el = (aimFor(Math.max(1, judged - NOCK_AHEAD), DEER_BODY.y - EYE_Y, V_FULL) ?? 0) + hand.aim * normal(rnd);
    const yaw = Math.atan2(dx, dz) + hand.aim * normal(rnd);
    h.loose(t, { x, y: EYE_Y, z }, { x: Math.cos(el) * Math.sin(yaw), y: Math.sin(el), z: Math.cos(el) * Math.cos(yaw) });
    drawAt = -1;
    target = -1;
    next = t + hand.react;
  }
  return shareOf(h.tally());
}

// ---------- «Рыбалка» ----------

/**
 * Рыбак: бросает в пределах дуги на среднюю даль (осторожный — мимо травы и коряги), подсекает через `strike` после
 * поклёвки (дёрганый — иногда на ложную дрожь), держит катушку до `hold` натяжения и ведёт удилище против рывка.
 */
export function playFish(seed: number, hand: Hand, tw: Twists, place: { shore: Shore; zone: Zone; season: Season }): number {
  const g = new Fishing(seed, { ...place, hour: tw.hour }, tw.streaks);
  const rnd = seeded(mixSeed(seed >>> 0, 0xf15));
  const END = GAME_SECONDS.fish;
  // Кадр в тридцатую: правило идёт своим шагом (`fishing.STEP`), кадр решает только, когда рука нажмёт.
  const dt = 1 / 30;
  let strikeAt = -1;
  let castAt = hand.react;
  let charged = -1;
  let aim = { power: 0.5, yaw: 0 };
  for (let t = dt; t <= END + 1e-9; t += dt) {
    g.advance(t);
    for (const e of g.takeEvents()) {
      if (e.kind === 'bite') strikeAt = t + hand.strike * (0.7 + 0.6 * rnd());
      if (e.kind === 'nibble' && rnd() < hand.jumpy) strikeAt = t + hand.strike;
    }
    switch (g.phase) {
      case 'idle':
        if (t < castAt) break;
        for (let k = 0; k < 8; k++) {
          aim = { power: 0.35 + 0.45 * rnd(), yaw: (rnd() - 0.5) * 1.2 };
          const at = castPoint(aim.power, aim.yaw);
          if (!hand.wary || !spotAt(g.field, at.x, at.z).hang) break;
        }
        g.press(t);
        charged = t;
        break;
      case 'charge':
        if (t - charged >= 0.4 + (aim.power * (CAST_MAX - CAST_MIN)) / 40) g.release(t, aim.power, aim.yaw);
        break;
      case 'wait':
        if (strikeAt >= 0 && t >= strikeAt) {
          g.press(t);
          strikeAt = -1;
        }
        break;
      case 'fight': {
        const L = g.line;
        if (!L) break;
        const want = L.tension < hand.hold;
        if (want !== L.reeling) {
          if (want) g.press(t);
          else g.release(t, 0, 0);
        }
        const rod = hand.rod && L.surge ? -L.surge.side : 0;
        if (Math.abs(rod - L.rod) > 0.01) g.steer(t, rod);
        break;
      }
      default:
        strikeAt = -1;
        castAt = t + hand.react;
        break;
    }
  }
  return shareOf(g.tally());
}

// ---------- Таблица ----------

/** Где ловят автоматы: река умеренного пояса летом и тёплое море — два берега с разными рыбами. */
export const FISH_PLACES = [
  { shore: 'river', zone: 'land', season: 'summer' },
  { shore: 'sea', zone: 'med', season: 'summer' },
] as const;

/**
 * Доля суток города в каждом часе промысла — по году: четыре сезона, сутки каждого, шагом в сотую суток. По ней
 * усредняется выход новых правил: заходят в промысел в любой час, и средний выход — за сутки, а не за зорьку.
 */
export function hourWeights(): Record<Hour, number> {
  const w: Record<Hour, number> = { dawn: 0, day: 0, dusk: 0, night: 0 };
  let n = 0;
  for (let season = 0; season < 4; season++) {
    for (let k = 0; k < 100; k++) {
      const time = (season * SEASON_DAYS + 1) * DAY_LENGTH + ((k + 0.5) / 100) * DAY_LENGTH;
      w[hourOf(dayPartAt(time))] += 1;
      n += 1;
    }
  }
  for (const h of HOURS) w[h] /= n;
  return w;
}

export interface YieldRow {
  game: MinigameId;
  hand: string;
  /** Средняя доля на прежних правилах и на новых (усреднена по часам суток). */
  before: number;
  after: number;
  /** Доля на новых правилах в каждый час. */
  byHour: Record<Hour, number>;
}

/** Зёрна щупа: одни и те же у прежних и новых правил. */
export const yieldSeeds = (n: number): number[] => Array.from({ length: n }, (_, i) => mixSeed(0x5eed6, i) >>> 0);

const PLAYERS: Record<MinigameId, (seed: number, hand: Hand, tw: Twists) => number> = {
  berries: playBerries,
  herd: playHerd,
  hunt: playHunt,
  fish: (seed, hand, tw) => FISH_PLACES.reduce((n, p) => n + playFish(seed, hand, tw, p), 0) / FISH_PLACES.length,
};

/** Чем час меняет игру: множитель слуха оленя, ожидания поклёвки; у «Ягод» и «Скота» — ничем. */
const HOUR_KEY: Record<MinigameId, (h: Hour) => number> = {
  berries: () => 0,
  herd: () => 0,
  hunt: (h) => HOUR_EAR[h],
  fish: (h) => HOUR_BITE[h],
};

/** Средняя доля на наборе зёрен: прежние правила против новых — по каждой игре и руке. */
export function yieldTable(seeds: readonly number[], games: readonly MinigameId[] = ['berries', 'herd', 'hunt', 'fish']): YieldRow[] {
  const weights = hourWeights();
  const rows: YieldRow[] = [];
  for (const game of games) {
    const play = PLAYERS[game];
    for (const hand of HANDS) {
      const mean = (tw: Twists): number => seeds.reduce((n, s) => n + play(s, hand, tw), 0) / seeds.length;
      const before = mean(CLASSIC);
      const byHour = { dawn: 0, day: 0, dusk: 0, night: 0 } as Record<Hour, number>;
      // Часы с одним и тем же множителем игры играются один раз: у «Ягод» и «Скота» час — только свет.
      const seen = new Map<number, number>();
      let after = 0;
      for (const h of HOURS) {
        const key = HOUR_KEY[game](h);
        if (!seen.has(key)) seen.set(key, mean({ hour: h, rare: true, streaks: true }));
        byHour[h] = seen.get(key)!;
        after += byHour[h] * weights[h];
      }
      rows.push({ game, hand: hand.name, before, after, byHour });
    }
  }
  return rows;
}
