// Логова числами: как быстро растут, чем кончается победа и что делается с
// картой за несколько часов игры.
//
// Отчёт нужен ровно потому, что у этой петли четыре числа, которые нельзя
// выбрать на глаз, и каждое ломает её по-своему:
//
//  1. **Потолок роста.** Слишком низкий — логово перестаёт быть целью на второй
//     день; слишком высокий — вернувшийся после перерыва игрок застаёт под
//     боком стену. Раздел «рост» печатает силу логова на трёх сроках рядом с
//     мощью соседей вокруг него: их и надо сравнивать, а не любоваться кривой.
//
//  2. **Срок жизни пепелища.** Игровой день у нас — реальная минута, поэтому
//     «неделя игрового времени» это семь минут, и руин не увидел бы никто.
//     Раздел «пепелище» переводит выбранный срок в обе шкалы разом.
//
//  3. **Добыча.** Она обязана быть заметной и обязана не заменять хозяйство.
//     Раздел «добыча» кладёт её рядом с тем, что посёлок добывает за время
//     самого похода, — сравнивать надо именно с этим, а не с дневной выработкой.
//
//  4. **Темп восстановления.** Мир не должен ни вычищаться в пустошь, ни
//     зарастать быстрее, чем игрок успевает. Раздел «карта за несколько часов»
//     гоняет настоящий `LocalWorld` с игроком, который жжёт логова при первой
//     возможности, и печатает, что осталось на карте к концу.
//
//   npx vite-node scripts/lair-report.ts
//   HOURS=8 npx vite-node scripts/lair-report.ts
import { LocalWorld } from '@/world/local/LocalWorld';
import { generateWorld, isLair, lairAnchor } from '@/world/gen';
import { lairArms, lairArmsBase, lairGold, lairLoot, lairPhase, lairPop, lairPower, shieldVillagers } from '@/world/lairs';
import { distance, marchSeconds, terrainFactor } from '@/world/geo';
import {
  AI_RANGE,
  LAIR_CAP,
  LAIR_NEAR_CAP,
  LAIR_RIPE,
  LAIR_RUIN,
  LAIR_SPAWN_MAX,
  LAIR_SPAWN_MIN,
  LAIR_START,
} from '@/world/data/tuning';
import { createInitialState } from '@/game/state';
import { playedFor, readyToStrike } from './autopilot';
import { assignWorker } from '@/game/sim/workers';
import { buildingOfType, buildingSlots, defense, forgeRate, productionPerDay, storageCap } from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { ARMS_TROPHY } from '@/game/sim/expedition';
import type { WorldSave } from '@/world/local/state';
import type { PlayerProfile } from '@/world/types';
import { DAY_LENGTH, dayRealSeconds, gameDaysOfMs, gameSeconds, realSeconds } from '@/game/pace';

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = 1_700_000_000_000;
const SEEDS = [7, 11, 42, 51, 77, 101, 202, 303, 404, 505];
const HOURS = Number(process.env.HOURS ?? 8);

const n1 = (v: number): string => v.toFixed(1);
const pad = (v: string | number, w: number): string => String(v).padStart(w);

/** Типичное логово в округе игрока: по нему и судят. */
function sampleAnchor(seed: number): { anchor: number; away: number } | null {
  const gen = generateWorld(seed);
  const lairs = gen.settlements.filter((x) => isLair(x) && distance(x, gen.home) <= AI_RANGE);
  if (lairs.length === 0) return null;
  const l = lairs.sort((a, b) => distance(a, gen.home) - distance(b, gen.home))[Math.floor(lairs.length / 2)];
  return { anchor: lairAnchor(gen.home, l), away: distance(l, gen.home) };
}

// ------------------------------------------------------------------- рост ---

/** Жители, при которых логово выходит в набег полной силой (`lairs.shieldVillagers`): по ним рост и добыча. */
const GROWTH_VILLAGERS = shieldVillagers(1);

console.log('=== РОСТ: логово по возрасту и по жителям города ===');
console.log('Опора — расстояние до замка игрока (`lairAnchor`): у порога слабее, вдали крепче. Сила — от возраста');
console.log('и от жителей города (`lairs.lairPower`): ниже — при жителях, с которых логово выходит в полную силу.');
console.log(`Жителей: ${GROWTH_VILLAGERS}. Оборона стартовой деревни без дружины — ${defense(createInitialState()).toFixed(0)}.`);
console.log('');
console.log('  сид   опора   свежее   полсрока   потолок   до замка, кл');

for (const seed of SEEDS) {
  const sample = sampleAnchor(seed);
  if (sample === null) continue;
  const { anchor, away } = sample;
  const rec = { bornAt: 0, burnedAt: 0 };
  const fresh = lairPower(anchor, rec, 0, GROWTH_VILLAGERS);
  const half = lairPower(anchor, rec, LAIR_RIPE / 2, GROWTH_VILLAGERS);
  const ripe = lairPower(anchor, rec, LAIR_RIPE, GROWTH_VILLAGERS);
  console.log(
    `  ${pad(seed, 4)}  ${pad(n1(anchor), 6)}  ${pad(n1(fresh), 7)}  ${pad(n1(half), 9)}  ${pad(n1(ripe), 8)}  ${pad(n1(away), 13)}`,
  );
}
console.log('');
console.log(`  Потолок по возрасту = ${LAIR_CAP} полной силы, начало = ${LAIR_START}; дорасти — ${n1(LAIR_RIPE / HOUR)} ч реального времени.`);
console.log('  Потолок и есть обещание: сколько бы игрок ни отсутствовал, выше этой строки логово не станет, пока город');
console.log('  не вырос; растёт город — растёт и потолок.');
console.log('');

// --------------------------------------------------------------- пепелище ---

console.log('=== ПЕПЕЛИЩЕ: в чём меряется срок ===');
console.log(`  Срок жизни: ${n1(LAIR_RUIN / HOUR)} ч реального времени.`);
console.log(`  Это же в игровых днях (день = ${dayRealSeconds()} с настоящего времени): ${Math.round(gameDaysOfMs(LAIR_RUIN))}.`);
console.log('  «Неделя игрового времени» — семь минут: пепелища не увидел бы никто, и просьба');
console.log('  убила бы сама себя. Мерка обязана быть реальной, потому что реален перерыв.');
console.log('');

// ----------------------------------------------------------------- добыча ---

/** Что посёлок добывает за игровой день (он же реальная минута) на разных сроках: партия общего автопилота в тихом мире. */
async function production(hours: number): Promise<number> {
  const s = await playedFor(hours);
  const per = productionPerDay(s);
  return RESOURCE_IDS.reduce((n, r) => n + Math.max(0, per[r] ?? 0), 0);
}

/** Сколько предметов кузница первого уровня делает за час, если посадить в неё всех. */
function forgePerHour(): number {
  const s = createInitialState();
  const sm = buildingOfType(s, 'smithy');
  if (!sm) return 0;
  assignWorker(s, sm.id, buildingSlots(sm));
  const avg = ARMS_TROPHY.reduce((n, id) => n + EQUIPMENT_BY_ID[id].work, 0) / ARMS_TROPHY.length;
  return (gameSeconds(3600) * forgeRate(s)) / avg;
}

/** Во что обошлись бы взятые предметы, если ковать их самому. */
function armsCost(count: number): number {
  const per =
    ARMS_TROPHY.reduce(
      (n, id) => n + RESOURCE_IDS.reduce((k, r) => k + (EQUIPMENT_BY_ID[id].cost[r] ?? 0), 0),
      0,
    ) / ARMS_TROPHY.length;
  return Math.round(per * count);
}

/**
 * Круг набега в игровых днях: довести полководца до ближайшего логова и вернуться. **Меряется,
 * а не пишется числом.** Стояло здесь «4 минуты» — при дне в минуту это были те же четыре
 * игровых дня, что и настоящая дорога, и число сходилось по совпадению. После поворота шкалы
 * четыре настоящие минуты стали 0.13 игрового дня, а с переводом дороги в игровое время
 * (docs/time.md, раздел 19) настоящий круг — единицы игровых дней: сравнение разъехалось в
 * пятьдесят раз, и «война — надбавка» перевернулось на бумаге, не сдвинувшись в игре.
 *
 * Считается той же `marchSeconds`, какой мир ведёт полководца: медиана по тем же сидам, по
 * которым отчёт берёт опору, дорога туда и обратно.
 */
const ROUND_DAYS = ((): number => {
  const trips: number[] = [];
  for (const seed of SEEDS) {
    const gen = generateWorld(seed);
    const lairs = gen.settlements.filter((x) => isLair(x) && distance(x, gen.home) <= AI_RANGE);
    if (lairs.length === 0) continue;
    const near = lairs.sort((a, b) => distance(a, gen.home) - distance(b, gen.home))[0];
    const d = distance(near, gen.home);
    // Состав на скорость не влияет: `stackSpeed` берёт самого медленного из видов, а вид один.
    trips.push((2 * marchSeconds(d, terrainFactor(seed, gen.home, near), { warrior: 1 })) / DAY_LENGTH);
  }
  trips.sort((a, b) => a - b);
  return trips.length > 0 ? trips[Math.floor(trips.length / 2)] : 0;
})();

const perDay0 = await production(0);
const perDay2 = await production(2);
const forgeHour = forgePerHour();

console.log('=== ДОБЫЧА: слабое логово / среднее / у потолка ===');
console.log('Мерка одна: что хозяйство наработает за время самого похода — не за игровой день и не');
console.log(`за настоящий час: и то и другое мерило чужое. Игровой день длится ${dayRealSeconds()} секунд.`);
console.log('');
console.log(`  Хозяйство: старт ${n1(perDay0)} ед./день, через 2 ч партии ${n1(perDay2)}.`);
console.log(
  `  За круг похода к ближайшему логову и обратно (${n1(ROUND_DAYS)} игр. дн., ` +
    `${n1(realSeconds(ROUND_DAYS * DAY_LENGTH) / 3600)} ч настоящего времени — медиана по сидам) это ` +
    `${Math.round(perDay0 * ROUND_DAYS)} и ${Math.round(perDay2 * ROUND_DAYS)} ед.`,
);
console.log(`  Склад стартовой деревни: ${storageCap(createInitialState())}. Кузница 1-го уровня: ${Math.round(forgeHour)} предметов в час.`);
console.log('');
console.log('  логово          мощь   народу   добра   золота   оружия   оружие своей ковкой        доля круга');

const anchor51 = sampleAnchor(51)?.anchor ?? 50;
for (const [name, k] of [
  ['свежее', 0],
  ['полсрока', 0.5],
  ['у потолка', 1],
] as [string, number][]) {
  const power = lairPower(anchor51, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE * k, GROWTH_VILLAGERS);
  const loot = lairLoot(power);
  const gold = lairGold(power);
  // Оружие — своя дверь: от опоры и возраста, жители его не растят (`lairs.lairArmsBase`).
  const arms = lairArms(lairArmsBase(anchor51, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE * k));
  const worth = loot + armsCost(arms);
  const mins = arms / (forgeHour / 60);
  console.log(
    `  ${name.padEnd(14)}${pad(n1(power), 6)}  ${pad(lairPop(power), 7)}  ${pad(loot, 6)}  ${pad(gold, 7)}  ${pad(arms, 7)}   ${`${armsCost(arms)} ед. и ${n1(mins)} мин горна`.padEnd(24)}  ${pad(`${Math.round((worth / (perDay2 * ROUND_DAYS)) * 100)}%`, 5)}`,
  );
}
console.log('');
console.log('  «Золота» — казна логова до тайника и обоза; сколько дней налога она стоит — `pop:report`.');
console.log('  «Доля круга» — вся награда (добро плюс материалы взятого оружия) против того,');
console.log('  что хозяйство даёт за это же время. Пока она заметно меньше половины, набег');
console.log('  остаётся вылазкой за снаряжением, а не заменой производству.');
console.log('');

// ------------------------------------------------ карта за несколько часов ---

const profile = (): PlayerProfile =>
  ({
    name: 'Отчёт',
    pop: 300,
    defense: 600,
    units: { warrior: 40, scout: 6 },
    army: { legionary: 40, spearman: 30, archer: 20 },
    warning: 120,
    stock: { food: 900, wood: 600 },
    stash: 0,
    food: 9000,
    foodPerHour: 6000,
    soldierFoodPerHour: 40,
  }) as PlayerProfile;

/** Настоящее состояние мира. Отчёт — прибор, ему положено видеть больше панели. */
const saveOf = (w: LocalWorld): WorldSave => (w as unknown as { save: WorldSave }).save;

/**
 * Где стоят логова на самом деле. По карточкам их не собрать: поселение, до
 * которого ни разу не доходил живой обзор, показывается нейтральным — это второй
 * слой тумана, и прибору он мешает так же, как игроку.
 */
function lairSpots(w: LocalWorld): Map<string, { x: number; y: number }> {
  const save = saveOf(w);
  const out = new Map<string, { x: number; y: number }>();
  for (const x of generateWorld(save.seed).settlements) if (isLair(x)) out.set(x.id, { x: x.x, y: x.y });
  for (const x of save.spawned) out.set(x.id, { x: x.x, y: x.y });
  return out;
}

function lairCounts(w: LocalWorld, now: number): { alive: number; ruins: number } {
  const save = saveOf(w);
  let alive = 0;
  let ruins = 0;
  for (const [id, at] of lairSpots(w)) {
    if (distance(at, save.home) > AI_RANGE) continue;
    const phase = lairPhase(save.lairs[id] ?? { bornAt: save.createdAt, burnedAt: 0 }, now);
    if (phase === 'alive') alive++;
    else if (phase === 'ruin') ruins++;
  }
  return { alive, ruins };
}

function nearestLair(
  world: LocalWorld,
  now: number,
  from: { x: number; y: number },
): { x: number; y: number } | null {
  const save = saveOf(world);
  const live: { x: number; y: number }[] = [];
  for (const [id, at] of lairSpots(world)) {
    if (distance(at, save.home) > AI_RANGE) continue;
    if (lairPhase(save.lairs[id] ?? { bornAt: save.createdAt, burnedAt: 0 }, now) !== 'alive') continue;
    live.push(at);
  }
  if (live.length === 0) return null;
  live.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
  return { ...live[0] };
}

interface Run {
  /** Сколько логов мир завёл за прогон. */
  spawned: number;
  burned: number;
  left: number;
  ruins: number;
  /** Сколько минут занимает круг: дорога до логова и бой. */
  round: number;
  /** Сколько логов стояло в округе в среднем за прогон. */
  standing: number;
}

/**
 * Прогон партии. `restMinutes` — сколько игрок занимается посёлком между
 * набегами: ноль это охотник, который не делает больше ничего, полчаса —
 * обычная игра, где карта одно дело из многих.
 */
async function play(seed: number, restMinutes: number): Promise<Run> {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null, reveal: true });
  const p = profile();
  await world.sync(p);
  let burned = 0;
  let spentMs = 0;
  let goingSince = 0;
  let restUntil = 0;
  let samples = 0;
  let standing = 0;

  const step = async (ms: number): Promise<void> => {
    now += Math.max(1000, Math.round(ms));
    await world.sync(p);
    samples++;
    standing += lairCounts(world, now).alive;
  };

  // Дружина к полководцу: без войска бить нечем, а передача идёт время.
  await world.setGarrison({ legionary: 40, spearman: 30, archer: 20 });
  for (let i = 0; i < 60; i++) {
    await step(MIN);
    const g = (await world.figures()).find((f) => f.id === 'general');
    if (g && g.readyAt === 0) break;
  }

  const until = START + HOURS * HOUR;
  for (let guard = 0; guard < 4000 && now < until; guard++) {
    if (now < restUntil) {
      await step(Math.min(MIN, restUntil - now));
      continue;
    }
    const g = (await world.figures()).find((f) => f.id === 'general');
    if (!g || g.phase === 'down') {
      await step(MIN);
      continue;
    }
    if (g.phase === 'moving') {
      await step(Math.min(MIN, g.arriveAt - now + 1000));
      continue;
    }
    const target = nearestLair(world, now, g.at);
    if (!target) {
      await step(5 * MIN);
      continue;
    }
    if (g.at.x !== target.x || g.at.y !== target.y) {
      if (goingSince === 0) goingSince = now;
      const err = await world.moveFigure('general', target);
      if (err) {
        goingSince = 0;
        await step(MIN);
      }
      continue;
    }
    // Логово бьют полной дружиной: уставшая стоит у цели, пока не отдохнёт (`readyToStrike`).
    if (!readyToStrike(g)) {
      await step(MIN);
      continue;
    }
    const res = await world.attack({});
    if (res.won) {
      burned++;
      spentMs += now - (goingSince || now);
      restUntil = now + restMinutes * MIN;
    }
    goingSince = 0;
    await step(30_000);
  }
  const end = lairCounts(world, now);
  return {
    spawned: saveOf(world).spawned.length,
    burned,
    left: end.alive,
    ruins: end.ruins,
    round: burned > 0 ? spentMs / burned / MIN : 0,
    standing: samples > 0 ? standing / samples : 0,
  };
}

console.log('=== КАРТА ЗА НЕСКОЛЬКО ЧАСОВ: не пустеет и не зарастает ===');
console.log(`Потолок живых логов в округе — ${LAIR_NEAR_CAP}, пауза между новыми ${LAIR_SPAWN_MIN / MIN}..${LAIR_SPAWN_MAX / MIN} мин.`);
console.log('Две дороги на одном и том же мире: охотник, который не делает больше ничего,');
console.log('и обычная игра, где на карту заходят между делом (полчаса на посёлок после');
console.log('каждого набега). Первая отвечает, есть ли у мира предел, вторая — как он');
console.log('выглядит в настоящей партии.');

for (const [style, rest] of [
  ['охотник (без передышки)', 0],
  ['обычная игра (полчаса на посёлок)', 30],
] as [string, number][]) {
  console.log('');
  console.log(`  ${style}`);
  console.log(`  сид   было   заведено   сожжено за ${HOURS} ч   стояло в среднем   осталось   круг, мин`);
  const burnedAll: number[] = [];
  const standingAll: number[] = [];
  for (const seed of SEEDS.slice(0, 6)) {
    const first = lairCounts(new LocalWorld({ seed, now: () => START, storage: null }), START).alive;
    const r = await play(seed, rest);
    burnedAll.push(r.burned);
    standingAll.push(r.standing);
    console.log(
      `  ${pad(seed, 4)}  ${pad(first, 5)}  ${pad(r.spawned, 9)}  ${pad(r.burned, 15)}  ${pad(n1(r.standing), 17)}  ${pad(r.left, 8)}  ${pad(r.round > 0 ? n1(r.round) : '—', 9)}`,
    );
  }
  console.log(
    `  Сожжено ${Math.min(...burnedAll)}..${Math.max(...burnedAll)}; логов в округе в среднем ${n1(Math.min(...standingAll))}..${n1(Math.max(...standingAll))} из ${LAIR_NEAR_CAP}.`,
  );
}
console.log('');
console.log('  Выше потолка живых логов не бывает никогда — это держит LAIR_NEAR_CAP. Сколько сжигает охотник, решает');
console.log('  его войско: оно здесь не пополняется, а логово растёт от жителей города (docs/lair_growth.md).');
