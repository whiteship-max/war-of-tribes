// Война числами: что прячет тайник, что уносит победитель, сколько стоит час
// грабежа против часа хозяйства и где потолок мести.
//
// Отчёт нужен ровно потому, что у этой петли пять чисел, которые нельзя выбрать
// на глаз, и каждое ломает её по-своему:
//
//  0. **Вместимость тайника.** Мало — тайник не стоит того, чтобы его строить;
//     много — склад становится неуязвимым, и пропадают разом и риск копить, и
//     смысл нападать. Раздел «тайник» печатает таблицу рядом с двумя мерками, из
//     которых она выведена: полный склад того же уровня и цена улучшения.
//
//  0б. **Склад чужого двора.** Это и есть ответ на «зачем нападать»: победитель
//     забирает его целиком, кроме тайника. Раздел «час грабежа» меряет, во что
//     это обходится в единицах хозяйства.
//
//  1. **Срок.** Игровой день у нас — реальная минута, поэтому «сутки игрового
//     времени» это двадцать четыре минуты: игрок ушёл за чаем и вернулся к
//     целому соседу. Раздел «срок» переводит выбранное число в обе шкалы разом
//     и ставит его рядом с двумя другими сроками этого мира.
//
//  2. **Выгода войны.** Разорение обязано сделать второй набег бессмысленным —
//     и не должно при этом сделать бессмысленным первый. Раздел «час грабежа
//     против часа хозяйства» гоняет настоящий `LocalWorld` с игроком, который
//     ничего, кроме набегов, не делает, и кладёт его добычу рядом с тем, что
//     посёлок добывает сам за то же время.
//
//  3. **Потолок мести.** Сосед обязан отвечать — и не обязан превращаться в
//     бесконечную кару. Раздел «месть» печатает, сколько войн разом бывает,
//     как часто и какой силы из них выходят набеги и чем это кончается.
//
//  4. **Цена взятого города.** На складе лежит добра на минуты выработки (это лежащее добро, а не
//     срок наполнения склада — тот меряет `time:report`, раздел 1), люди удваиваются
//     за двадцать минут, и до пяти построек по уровню грабёж не стоил
//     проигравшему ничего. Раздел «лестница» меряет, чем он стал, на семи этапах
//     партии общим автопилотом (`scripts/autopilot.ts`, мир тихий), и сколько уходит казны
//     (docs/DEFEAT_LADDER.md).
//
// Лазарет жил здесь до перемера на мире, где бой стоит людей; теперь он раздел `raid-hiring:report`
// (`raid-infirmary.ts`): он читает те же прогоны, что «Найм».
//
//   npx vite-node scripts/sack-report.ts
//
// Ручки `HOURS=` больше нет: окно прогона грабежа выведено из круга похода,
// а не задаётся снаружи (`RAID_WINDOW_MS` ниже).
import { lairPower, lairRaid } from '@/world/lairs';
import { troopPower } from '@/game/battle/price';
import { LocalWorld, HOME_ID } from '@/world/local/LocalWorld';
import { distance, marchSeconds, terrainFactor } from '@/world/geo';
import { generateWorld, isLair } from '@/world/gen';
import {
  AI_ATTACK_MAX,
  AI_ATTACK_MIN,
  AI_RANGE,
  LAIR_ANCHOR_MID,
  LAIR_NEAR_CAP,
  LAIR_RIPE,
  AI_WAR_PACE,
  AI_WAR_WEIGHT,
  AI_NEUTRAL_QUIET,
  ATTACK_ATTITUDE,
  ATTITUDE_MIN,
  LAIR_RUIN,

  AI_STASH_SHARE,
  LOOT_PER_POP,
  LOOT_REFILL,
  REVENGE_ATTITUDE,
  REVENGE_WARS_MAX,
  FALL_BUILDINGS,
  FALL_LEVELS,
  REVOLT_DURATION,
  SACK_DURATION,
  SACK_POWER_LOSS,
  SIEGE_IMMUNE,
  BURN_IMMUNE,
} from '@/world/data/tuning';
import { createInitialState } from '@/game/state';
import { autoAssign } from '@/game/sim/workers';
import {
  maxLevelFor,
  netPerDay,
  productionPerDay,
  stashAt,
  taxIncomePerDay,
  storageCap,
  upgradeCost,
} from '@/game/derived';
import { BUILDINGS } from '@/game/data/buildings';
import { BASE_STORAGE_CAP, RESOURCE_IDS, UPGRADE_GROWTH } from '@/game/constants';
import { FATE_DEFAULT, FATE_IDS, HEAD_CARRY, fallSeed, fate, homeLoss, plunder } from '@/world/spoils';
import { FATE_META } from '@/world/data/fates';
import { bondedTotal } from '@/game/derived';
import type { Fate } from '@/world/types';
import { playerProfile } from '@/world/bridge';
import { seeded, setRandom } from '@/game/sim/random';
import type { GameState, ResourceId } from '@/game/types';
import { land, pilot, playedFor, player, readyToStrike } from './autopilot';
import { stackCarry } from '@/world/data/units';
import type { WorldSave } from '@/world/local/state';
import type { HomeEffect, Loot, PlayerProfile, SettlementView } from '@/world/types';
import { DAY_LENGTH, dayRealSeconds, gameDaysOfMs, gameDaysPerHour, realMs, realSeconds } from '@/game/pace';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Сутки игрока: окна защиты меряются его временем, и округляются тоже ими. */
const DAY = 24 * HOUR;
const START = 1_700_000_000_000;
const SEEDS = [7, 11, 42, 51, 77];

/**
 * Круг похода к ближайшему логову и обратно, игровых дней — медиана по сидам.
 * Меряется, а не пишется числом: после того, как время пути пошло игровыми часами
 * (docs/time.md, раздел 19), круг вырос в тридцать раз, и записанное число молча
 * устарело бы. Тот же вывод и той же меркой стоит в `npm run lair:report`.
 */
const ROUND_DAYS = ((): number => {
  const trips: number[] = [];
  for (const seed of SEEDS) {
    const gen = generateWorld(seed);
    const lairs = gen.settlements.filter((x) => isLair(x) && distance(x, gen.home) <= AI_RANGE);
    if (lairs.length === 0) continue;
    const near = lairs.sort((a, b) => distance(a, gen.home) - distance(b, gen.home))[0];
    trips.push((2 * marchSeconds(distance(near, gen.home), terrainFactor(seed, gen.home, near), { warrior: 1 })) / DAY_LENGTH);
  }
  trips.sort((a, b) => a - b);
  return trips.length > 0 ? trips[Math.floor(trips.length / 2)] : 0;
})();

/**
 * Окно прогона грабежа: **два обхода всей округи**, то есть вдвое больше кругов
 * похода, чем округа держит живых логов (`LAIR_NEAR_CAP`). Число это выведено, а
 * не выбрано, и выведено из двух свойств сразу: одного обхода мало, потому что
 * раздел обещает показать, как добыча убывает («за набег» против «первого двора»),
 * а это видно только на повторном заходе в ту же округу.
 *
 * **Прежде тут стояло `HOURS = 3` настоящих часа, и окно сломалось молча.** Круг
 * похода — 2.5 настоящего часа (`lair:report`), то есть в окно не помещался даже
 * один набег: таблица показала 0.0 набегов у четырёх сидов из пяти и «грабёж даёт
 * 0% часа хозяйства». Мерка, записанная настоящими часами, пережила поворот шкалы
 * времени и не пережила перевод дороги на игровые часы.
 */
const CIRCLES = 2 * LAIR_NEAR_CAP;
const RAID_WINDOW_MS = Math.round(realMs(ROUND_DAYS * CIRCLES * DAY_LENGTH));
/** Шаг, которым прогон двигает мир, пока полководец идёт. */
const RAID_STEP = 30_000;

const n1 = (v: number): string => v.toFixed(1);
/**
 * Доля часа хозяйства. Печатается десятыми, пока она меньше процента: после того, как
 * время пути пошло игровыми часами, набегов в настоящий час стало втридцатеро меньше, и
 * целые проценты схлопывали живое число в «0%» — читается это как «война не кормит вовсе»,
 * а означает «кормит на полпроцента».
 */
const share = (v: number): string => (v < 0.01 ? (v * 100).toFixed(1) : String(Math.round(v * 100)));
const pad = (v: string | number, w: number): string => String(v).padStart(w);
const saveOf = (w: LocalWorld): WorldSave => (w as unknown as { save: WorldSave }).save;
const total = (loot: Loot | null): number =>
  loot ? Object.values(loot).reduce((n, v) => n + Math.abs(v ?? 0), 0) : 0;

// ------------------------------------------------------------------ срок ---

console.log('=== СРОК: в чём он меряется и почему ===');
console.log(`  Разорение держится ${n1(SACK_DURATION / HOUR)} ч реального времени.`);
console.log(
  `  Это же в игровых днях (день = ${dayRealSeconds()} с настоящего времени): ${Math.round(gameDaysOfMs(SACK_DURATION))}.`,
);
console.log('  Отсюда и мерка: «неделя игрового времени» — семь минут, а перерыв между');
console.log('  заходами игрок меряет своими часами. Четырёх хватает на вечернюю отлучку и');
console.log('  половину рабочего дня, но не на ночь: к утру округа отстроилась.');
console.log('');
console.log('  Лестница трёх сроков этого мира:');
console.log(`    бунт лазутчика   ${n1(REVOLT_DURATION / HOUR)} ч — люди отказались работать`);
console.log(`    разорение        ${n1(SACK_DURATION / HOUR)} ч — сожжено хозяйство, выбит гарнизон`);
console.log(`    пепелище         ${n1(LAIR_RUIN / HOUR)} ч — места больше нет, след остывает`);
console.log('');
console.log(`  Мощь разорённого двора просажена на ${Math.round(SACK_POWER_LOSS * 100)}%.`);
console.log(`  Склад двора наполняется за ${n1(LOOT_REFILL / MIN)} мин его собственных часов, а они стоят.`);
console.log('');

// ---------------------------------------------------------------- тайник ---

const storageDef = BUILDINGS.find((b) => b.id === 'storage')!;
const capAt = (level: number): number =>
  BASE_STORAGE_CAP + (storageDef.storage ?? 0) + (level - 1) * (storageDef.perLevel?.storage ?? 0);
/** Самая дорогая статья среднего улучшения этого уровня: ею и меряется тайник. */
const upgradeItem = (level: number): number => {
  const items = BUILDINGS.map((d) => {
    const c = upgradeCost(d, level);
    return Math.max(...RESOURCE_IDS.map((r) => c[r] ?? 0));
  }).sort((a, b) => a - b);
  return items[Math.floor(items.length / 2)];
};

console.log('=== ТАЙНИК: сколько прячет по уровням и из чего это выведено ===');
console.log('Прячется столько **каждого** припаса. Всё, что сверх, победитель уносит целиком.');
console.log('');
console.log('Мерки две, и обе в таблице рядом:');
console.log('  · полный склад того же уровня — отвечает на «заметная ли это доля»;');
console.log('  · самая дорогая статья среднего улучшения того же уровня — отвечает на');
console.log('    «во что это переводится»: хватает ли спрятанного, чтобы утром поднять здание.');
console.log('');
console.log(' ур   прячет   склад целиком   доля   среднее улучшение   хватает на него');
for (let level = 1; level <= maxLevelFor('cache'); level++) {
  const hide = stashAt(level);
  const cap = capAt(level);
  const item = upgradeItem(level);
  console.log(
    `  ${pad(level, 2)}  ${pad(hide, 7)}  ${pad(cap, 14)}  ${pad(`${Math.round((hide / cap) * 100)}%`, 5)}  ${pad(item, 18)}  ${pad(hide >= item ? `да (×${(hide / item).toFixed(2)})` : 'нет', 15)}`,
  );
}
console.log('');
console.log(
  `  Растёт тайник геометрически, множителем ${UPGRADE_GROWTH} — тем же, каким дорожают улучшения.`,
);
console.log('  Это и есть вся таблица: обещание «хватает на одно среднее улучшение своего');
console.log('  уровня» держится на всех десяти, а не на одном. Прежняя линейная прибавка');
console.log('  (400 и +500 за уровень) давала ×1.43 на первом и ×0.85 на десятом — то есть');
console.log('  к потолку тайник переставал покрывать даже среднее улучшение.');
console.log('');
console.log(
  `  Доля полного склада идёт от ${Math.round((stashAt(1) / capAt(1)) * 100)}% к ${Math.round((stashAt(10) / capAt(10)) * 100)}%: склад растёт линейно, тайник — нет.`,
);
console.log('  Первый уровень спасает мелочь, десятый — заметную часть, и ни на каком');
console.log('  уровне не весь склад: неуязвимый склад убил бы и риск копить, и смысл нападать.');
console.log('');

// ------------------------------------ час грабежа против часа хозяйства ---

/**
 * Что посёлок добывает за реальный час: сколько в нём игровых дней, говорит дверь времени. `hours` партии играет
 * общий автопилот в тихом мире; выработка меряется на посёлке, расставленном `autoAssign`.
 */
async function perHour(hours: number): Promise<number> {
  const s = await playedFor(hours);
  const per = productionPerDay(s);
  return RESOURCE_IDS.reduce((n, r) => n + Math.max(0, per[r] ?? 0), 0) * gameDaysPerHour();
}

const raider = (): PlayerProfile =>
  ({
    name: 'Отчёт',
    pop: 600,
    defense: 4000,
    units: { warrior: 200, scout: 8 },
    army: { legionary: 120, spearman: 90, archer: 60 },
    warning: 120,
    stock: { food: 2000, wood: 1500 },
    stash: 0,
    food: 20000,
    foodPerHour: 9000,
    soldierFoodPerHour: 60,
  }) as PlayerProfile;

function makeWorld(seed: number) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null, reveal: true });
  return {
    world,
    at: (t: number) => {
      now = t;
    },
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

async function neighbours(world: LocalWorld): Promise<SettlementView[]> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 26, y: info.home.y - 26, w: 53, h: 53 });
  return chunk.settlements.filter((s) => !s.mine && s.relation !== 'barbarian' && !s.ruin);
}

/**
 * Игрок, который не делает ничего, кроме набегов: доводит полководца до
 * ближайшего целого двора, бьёт, идёт к следующему. Возвращает всё, что он
 * привёз за отпущенные часы, и заодно счёт объявленных ему войн.
 */
async function plunderRun(seed: number) {
  const w = makeWorld(seed);
  const p = raider();
  await w.world.sync(p);
  await w.world.setGarrison({ legionary: 120, spearman: 90, archer: 60 });
  for (let i = 0; i < 200; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.readyAt === 0) break;
  }
  const startAt = w.now();
  const deadline = startAt + RAID_WINDOW_MS;
  const save = saveOf(w.world);
  let loot = 0;
  let raids = 0;
  let dry = 0;
  // Добыча самого первого набега — это округа до того, как её тронули. С ней и
  // сравнивается средняя: иначе про «добыча убывает» говорить нечем.
  let first = 0;

  while (w.now() < deadline) {
    const info = await w.world.info();
    const list = await neighbours(w.world);
    if (list.length === 0) break;
    // Цель выбирается так, как выбрал бы игрок: сначала целые дворы, потом (если
    // целых нет) ближайший — разорённые он уже обчистил, и это видно на карте.
    const whole = list.filter((s) => !s.sacked);
    const pool = whole.length > 0 ? whole : list;
    const target = pool.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (!g || g.phase === 'down') {
      w.advance(MIN);
      await w.world.sync(p);
      continue;
    }
    if (g.at.x !== target.x || g.at.y !== target.y) {
      await w.world.moveFigure('general', { x: target.x, y: target.y });
      // Шагов ровно столько, сколько их в самом окне: меньше — и прогон бросил бы
      // полководца на полпути, а строка вышла бы ложным нулём.
      for (let i = 0; i < RAID_WINDOW_MS / RAID_STEP && w.now() < deadline; i++) {
        w.advance(RAID_STEP);
        await w.world.sync(p);
        const f = (await w.world.figures()).find((v) => v.id === 'general');
        if (f && f.phase !== 'moving') break;
      }
      if (w.now() >= deadline) break;
    }
    // Двор бьют полной дружиной: уставшая стоит у цели, пока не отдохнёт (`readyToStrike`).
    const ready = (await w.world.figures()).find((f) => f.id === 'general');
    if (ready && !readyToStrike(ready)) {
      w.advance(MIN);
      await w.world.sync(p);
      continue;
    }
    const res = await w.world.attack({});
    if (res.error) {
      w.advance(MIN);
      await w.world.sync(p);
      continue;
    }
    raids++;
    const got = total((await w.world.reports()).find((r) => r.id === res.reportId)?.loot ?? null);
    if (got === 0) dry++;
    if (raids === 1) first = got;
    loot += got;
    w.advance(RAID_STEP);
    await w.world.sync(p);
  }

  const wars = Object.values(save.diplomacy).filter((d) => d.standing === 'war').length;
  const spent = (w.now() - startAt) / HOUR;
  return {
    loot: loot / Math.max(0.01, spent),
    raids: raids / Math.max(0.01, spent),
    perRaid: loot / Math.max(1, raids),
    first,
    dry,
    wars,
  };
}

console.log('=== ЧАС ГРАБЕЖА ПРОТИВ ЧАСА ХОЗЯЙСТВА ===');
console.log('Мерка одна и она честная: обе величины — единиц добра за реальный час.');
console.log('Игрок в прогоне не делает вообще ничего, кроме набегов: ходит от двора ко двору');
console.log('и бьёт, пока хватает часов. Это верхняя граница войны как заработка.');
console.log('');
console.log(
  `Окно прогона — два обхода округи: ${CIRCLES} кругов похода (потолок живых логов ${LAIR_NEAR_CAP} × 2), ` +
    `круг ${n1(ROUND_DAYS)} игр. дн. — ${n1(realSeconds(ROUND_DAYS * DAY_LENGTH) / 3600)} ч настоящего времени.`,
);
console.log(
  `Всего окно ${n1(RAID_WINDOW_MS / HOUR)} ч настоящего времени. Меньше одного круга в окне — и таблица` +
    ' показывает нули, которые читаются как «война не кормит», а означают «полководец не дошёл».',
);
console.log('');
console.log(
  `Склад двора — ${LOOT_PER_POP} ед. на жителя, из них ${Math.round(AI_STASH_SHARE * 100)}% лежит в его тайнике.`,
);
console.log('Победитель забирает остальное целиком — столько, сколько поднимет отряд.');
console.log('');
console.log(`  Хозяйство: старт ${Math.round(await perHour(0))} ед./ч, через 2 ч партии ${Math.round(await perHour(2))} ед./ч (общий автопилот, мир тихий).`);
console.log('');
console.log('  сид   набегов/ч   за набег   первый двор   грабёж, ед./ч   к хозяйству   войн');

let sumLoot = 0;
let sumFarm = 0;
const farm = await perHour(2);
for (const seed of SEEDS) {
  const r = await plunderRun(seed);
  sumLoot += r.loot;
  sumFarm += farm;
  console.log(
    `  ${pad(seed, 4)}  ${pad(n1(r.raids), 9)}  ${pad(Math.round(r.perRaid), 8)}  ${pad(Math.round(r.first), 11)}  ${pad(Math.round(r.loot), 13)}  ${pad(`${share(r.loot / farm)}%`, 12)}  ${pad(r.wars, 4)}`,
  );
}
console.log('');
console.log(
  `  В среднем грабёж даёт ${share(sumLoot / sumFarm)}% часа хозяйства — и это у игрока,`,
);
console.log('  который хозяйством вообще не занимается и ходит от двора ко двору без передышки.');
console.log('');
console.log('  Читать это надо не как «что выгоднее». Хозяйство работает, пока армия в поле,');
console.log('  и одно другого не отменяет: война — **надбавка** к часу хозяйства, а не замена.');
console.log('  Надбавка эта платная: полководец теряет людей, а округа наживает войны (столбец');
console.log('  «войн»). И она убывает: сравни «за набег» с «первым двором» — это одна и та же');
console.log('  округа до того, как её тронули, и после. Разница и есть работа разорения.');
console.log('');
console.log('  Чего в этих числах НЕ видно и обещать нельзя: что обоз возвращается совсем');
console.log('  пустым. Округа большая, разорённые дворы стоят вперемешку с целыми, и');
console.log('  полководец всегда находит хоть что-то. Пустых набегов за прогон единицы —');
console.log('  падает средняя добыча, а не обнуляется. Совсем пустым двор бывает только');
console.log('  при повторном ударе по нему же — раздел ниже.');
console.log('');

// ------------------------------------------------------- второй набег ---

console.log('=== ВТОРОЙ НАБЕГ ПОДРЯД ===');
console.log('Один и тот же двор, полководец от него не отходит.');
console.log('');
console.log('  сид   1-й набег   2-й   3-й (через час)   4-й (после срока)');

for (const seed of SEEDS) {
  const w = makeWorld(seed);
  const p = raider();
  await w.world.sync(p);
  await w.world.setGarrison({ legionary: 120, spearman: 90, archer: 60 });
  for (let i = 0; i < 200; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.readyAt === 0) break;
  }
  const info = await w.world.info();
  const list = await neighbours(w.world);
  if (list.length === 0) continue;
  const target = list.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  await w.world.moveFigure('general', { x: target.x, y: target.y });
  for (let i = 0; i < 600; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.phase !== 'moving') break;
  }
  const hits: number[] = [];
  for (const wait of [0, MIN, HOUR, 0]) {
    if (wait > 0) {
      w.advance(wait);
      await w.world.sync(p);
    }
    if (hits.length === 3) {
      const until = saveOf(w.world).sacks[target.id]?.until ?? w.now();
      w.at(until + LOOT_REFILL * 2);
      await w.world.sync(p);
    }
    const res = await w.world.attack({});
    if (res.error) {
      hits.push(-1);
      continue;
    }
    hits.push(total((await w.world.reports()).find((r) => r.id === res.reportId)?.loot ?? null));
  }
  console.log(
    `  ${pad(seed, 4)}  ${pad(hits[0], 9)}  ${pad(hits[1], 3)}  ${pad(hits[2], 16)}  ${pad(hits[3], 17)}`,
  );
}
console.log('');
console.log('  Второй и третий — крохи: часы двора стоят, и склад по ним не наполняется.');
console.log('  Четвёртый снят уже после срока, и он же ответ на «восстанавливается вместе');
console.log('  с поселением»: отстроился двор — вернулся и его склад.');
console.log('');

// --------------------------------------- что унесёт прорвавшийся набег ---

console.log('=== ЧТО УНЕСЁТ ПРОРВАВШИЙСЯ НАБЕГ ===');
console.log('Полный склад, набег прорвался. Уносится ровно то, что не спрятано, и не больше,');
console.log('чем поднимет чужой отряд, — а он не сильнее объявленной доли нашей обороны.');
console.log('');
console.log('**Прорваться набег может и без игрока.** Правило отсутствия снято решением владельца');
console.log('(docs/DEFEAT_LADDER.md): отряд, чей приход пришёлся на время без пульса, доходит и');
console.log('разбирается тем же боем, что при игроке. Так что таблица читается и как «столько');
console.log('теряют за ночь» — если за ночь дошёл отряд, способный прорваться.');
console.log('');
console.log(' уровни   склад целиком   тайник   открыто   обоз набега   унесут   доля склада');

for (const level of [1, 3, 5, 7, 10]) {
  const s = createInitialState(7);
  for (const b of s.buildings) if (b.type === 'storage' || b.type === 'cache') b.level = level;
  const cap = storageCap(s);
  // Полный склад: за ночь производство упирается в потолок по каждому припасу.
  const stock: Loot = {};
  for (const r of RESOURCE_IDS) stock[r] = cap;
  const total = cap * RESOURCE_IDS.length;
  const hide = stashAt(level);
  // Оборона считается по настоящему посёлку этого уровня, а не берётся на глаз:
  // ополчение, частокол и башня без дружины — то есть случай «армия в поле».
  s.pop = Math.round(115 * (1 + (level - 1) * 0.7));
  autoAssign(s);
  // Мощь набега — дозревшее логово медианной опоры при жителях этого посёлка (`lairs.lairRaid`),
  // а отряд из неё — тем же курсом, что и в мире (`scheduleAi`): один воин на три единицы мощи.
  const raid = lairRaid(lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, s.pop), s.pop, troopPower(s.army));
  const open = plunder(stock, hide, Infinity).takenTotal;
  if (raid <= 0) {
    // Посёлок слаб и жителями, и войском: логово его не замечает, набега нет вовсе.
    console.log(`  ${pad(level, 5)}   ${pad(total, 13)}  ${pad(hide * RESOURCE_IDS.length, 7)}  ${pad(open, 7)}  набега нет: ${s.pop} жителей — посёлок ниже порога защиты слабого`);
    continue;
  }
  const men = Math.max(1, Math.round(raid / 3));
  const carry = stackCarry({ warrior: men });
  const spoils = plunder(stock, hide, carry);
  console.log(
    `  ${pad(level, 5)}   ${pad(total, 13)}  ${pad(hide * RESOURCE_IDS.length, 7)}  ${pad(open, 7)}  ${pad(Math.round(carry), 12)}  ${pad(spoils.takenTotal, 7)}  ${pad(`${Math.round((spoils.takenTotal / total) * 100)}%`, 10)}`,
  );
}
console.log('');
console.log('  «Обоз набега» — грузоподъёмность набега дозревшего логова медианной опоры при жителях');
console.log('  этого посёлка (`lairs.lairRaid`), переведённого в людей тем же курсом, что в мире. Посёлок —');
console.log('  **без дружины**, то есть в самом уязвимом положении: армия в поле, дома ополчение, частокол и башня.');
console.log('  Сила набега от обороны не зависит, поэтому обоз не меняется оттого, стоит ли дружина дома.');
console.log('');
console.log('  «Открыто» — всё, что не влезло в тайник: это и есть верхняя граница потери, и её уносит');
console.log('  прорвавшийся набег, когда обоз больше открытого. Именно это и значит «теряешь ровно то,');
console.log('  что не спрятал», и именно поэтому копить рискованно.');
console.log('');
console.log('  Читается так: тайник спасает не всё и не должен. Тем, кто не хочет терять,');
console.log('  игра предлагает не тайник, а второе решение — потратить: заложить улучшение,');
console.log('  поставить заказ в кузницу, набрать бойцов. Потраченного не унесут.');
console.log('');
console.log('  Второй путь к складу — осада: лагерь садится и доедает город, в игре хозяин или');
console.log('  нет. Что это стоит — npm run siege:report, раздел «цена падения», и docs/siege.md.');
console.log('');

// ------------------------------------------------------------- месть ---

console.log('=== МЕСТЬ: чем отвечает сосед и где у ответа потолок ===');
console.log(`  Набег роняет отношение двора на ${Math.abs(ATTACK_ATTITUDE)}; дно шкалы — ${ATTITUDE_MIN}.`);
console.log(
  `  Война объявляется на ${REVENGE_ATTITUDE}, то есть на третьем набеге по одному двору (${ATTACK_ATTITUDE} · 2 = ${ATTACK_ATTITUDE * 2}).`,
);
console.log('');
console.log('  Потолков четыре, и три из них стояли до этой задачи:');
console.log(`    1. объявленных войн разом не больше ${REVENGE_WARS_MAX} (REVENGE_WARS_MAX, новое);`);
console.log(`    2. шкала отношения заперта снизу на ${ATTITUDE_MIN}: злее некуда;`);
console.log(
  '    3. набег на нас один за раз и не сильнее логова, из которого вышел;',
);
console.log(
  `    4. чаще, чем раз в ${n1((AI_ATTACK_MIN * AI_WAR_PACE) / MIN)}–${n1((AI_ATTACK_MAX * AI_WAR_PACE) / MIN)} мин, из очереди набегов ничего не выходит.`,
);
console.log('');
console.log(
  `  Вес двора в очереди: пакт — 0, нейтралитет — ${AI_NEUTRAL_QUIET}..${n1(AI_NEUTRAL_QUIET + 2)}, война — ${AI_WAR_WEIGHT}.`,
);
console.log('  Выход один и он есть: дипломат заключает мир, война сменяется нейтралитетом,');
console.log('  и освободившееся место в потолке может занять другой обиженный.');
console.log('');
console.log('  Сколько войн игрок нажил за прогон выше — в столбце «войн»: это и есть');
console.log('  ответ мира тому, кто живёт грабежом.');
console.log('');

// ------------------------------------------------- проигранный набег ---

console.log('=== ПРОИГРАННЫЙ НАБЕГ ===');
console.log('  Решение, а не побочный эффект: отношения роняет **нападение**, а не победа.');
console.log('  Проиграл — войска потеряны, двор обижен ровно так же (видно ниже), и войну');
console.log('  он объявит так же — `avenge` зовётся до исхода; это держит тест, не прогон.');
console.log('  Разорения при этом нет: разоряет тот, кто взял двор. Гарнизон всё равно');
console.log('  побит на ту долю, что снёс бой (`damage`), и чинится он своим чередом —');
console.log('  часы двора не стоят, потому что стоять их заставляет только разорение.');
console.log('');

const w = makeWorld(11);
const weak = raider();
weak.army = { clubman: 3 };
weak.defense = 40;
weak.pop = 60;
await w.world.sync(weak);
await w.world.setGarrison({ clubman: 3 });
for (let i = 0; i < 200; i++) {
  w.advance(MIN);
  await w.world.sync(weak);
  const g = (await w.world.figures()).find((f) => f.id === 'general');
  if (g && g.readyAt === 0) break;
}
{
  const info = await w.world.info();
  const list = await neighbours(w.world);
  const target = list.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  await w.world.moveFigure('general', { x: target.x, y: target.y });
  for (let i = 0; i < 600; i++) {
    w.advance(MIN);
    await w.world.sync(weak);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.phase !== 'moving') break;
  }
  const before = saveOf(w.world).diplomacy[target.id]?.attitude ?? 0;
  const res = await w.world.attack({});
  const save = saveOf(w.world);
  console.log(`  Цель: ${target.name}. Исход: ${res.won ? 'победа' : 'поражение'}.`);
  console.log(`  Отношение: ${before} → ${save.diplomacy[target.id].attitude}.`);
  console.log(`  Разорение двора: ${save.sacks[target.id] ? 'есть' : 'нет'}.`);
  console.log(`  Разорение нашей деревни: ${save.sacks[HOME_ID] ? 'есть' : 'нет'}.`);
}
console.log('');

// ------------------------------------------------ лестница: взятый город ---

/**
 * Во что обходится взятый город — тем же способом, каким мерился расчёт
 * docs/DEFEAT_LADDER.md: автопилот `pop:report` ведёт партию, на семи этапах с
 * неё снимается копия, к копии применяется участь, и автопилот ведёт её дальше.
 * Участь применяется настоящим путём — слепок деревни (`playerProfile`), дверь
 * участи (`spoils.fate`), поля последствия (`homeLoss`) и `applyEffects`, — а не
 * своей арифметикой: отчёт, считающий участь сам, мерил бы свою копию правила.
 *
 * Отставание — насколько позже тронутая партия дошла до того, где нетронутая
 * стояла через час (сумма уровней и люди). Сид событий у обеих копий один, поэтому
 * ноль значит «не стоило ничего», а минуты в минус — шум автопилота.
 */
const LADDER_STAGES = [0, 0.5, 1, 2, 3, 4.5, 6.5];
/** Шаг симуляции автопилота, с: как в расчёте документа (у pop:report — 1). */
const LADDER_SIM = 3;
const LADDER_STEP = 15;
const LADDER_GOAL = 3600;
const LADDER_HORIZON = 5 * 3600;
/** Соли выбора пяти построек на этап: цена зависит от того, какие попались. */
const LADDER_SEEDS = [1, 2, 3, 4, 5];
/** Мир лестницы — тихий: набегов нет, он называет посёлку веру и больше ничего не делает. */
const LADDER_WORLD = 7;

/**
 * Партия общим автопилотом: живая игра при игроке, ответы на события, вера мира. Решает раз в
 * `LADDER_STEP`, шаг симуляции `LADDER_SIM`, пульс тихого мира — тем же тактом. `until` — цель.
 */
const ladderRun = async (s: GameState, seconds: number, until?: (x: GameState) => boolean): Promise<void> => {
  if (seconds <= 0) return;
  await pilot({
    g: s,
    seconds,
    player: player(null),
    world: { seed: LADDER_WORLD, pulse: LADDER_STEP, raids: false },
    economy: 'live',
    tick: LADDER_SIM,
    decide: LADDER_STEP,
    until,
  });
};
const levelSum = (s: GameState): number => s.buildings.reduce((n, b) => n + b.level, 0);

type Blow = { stock: boolean; levels: boolean; morale: number; sacked?: number; fate?: Fate };

/** Применить к копии участь взятого города — ту, что сейчас в игре, частями или целиком. */
function strike(s: GameState, blow: Blow, seed: number): { fell: number; rebuild: number; narrow: number } {
  const p = playerProfile(s);
  // Чистая выработка до удара — ею и меряется отстройка: сколько минут копить узкий припас.
  const net = netPerDay(s);
  const r = fate({
    fate: blow.fate ?? FATE_DEFAULT,
    stock: blow.stock ? p.stock : {},
    gold: blow.stock ? (p.gold ?? 0) : 0,
    stash: p.stash,
    pop: p.pop,
    bonded: p.bonded ?? 0,
    // Обоз не мешает: отряд, взявший город, уносит всё открытое (docs/sack.md).
    carry: Infinity,
    escort: Infinity,
    levels: blow.levels ? p.levels : undefined,
    seed,
  });
  const before = new Map(s.buildings.map((b) => [b.id, b.level]));
  const effect: HomeEffect = {
    id: 'лестница',
    lost: {},
    prestige: 0,
    morale: blow.morale,
    battle: blow.sacked ? 'lost' : null,
    sacked: blow.sacked,
    text: 'Город взят.',
    good: false,
    ...homeLoss(r),
  };
  land(s, [effect]);
  let fell = 0;
  let rebuild = 0;
  const need: Partial<Record<ResourceId, number>> = {};
  for (const b of s.buildings) {
    const was = before.get(b.id) ?? b.level;
    for (let l = b.level + 1; l <= was; l++) {
      fell++;
      const c = upgradeCost(BUILDINGS.find((d) => d.id === b.type)!, l);
      for (const r of RESOURCE_IDS) {
        need[r] = (need[r] ?? 0) + (c[r] ?? 0);
        rebuild += c[r] ?? 0;
      }
    }
  }
  // Выработка — за игровой день; в настоящих минутах день длится `dayRealSeconds() / 60`.
  const narrow = Math.max(0, ...RESOURCE_IDS.map((r) => (((need[r] ?? 0) / Math.max(1, net[r])) * dayRealSeconds()) / 60));
  return { fell, rebuild, narrow };
}

/** Через сколько секунд после копии тронутая партия догнала цель; null — не догнала за горизонт. */
async function reach(s: GameState, goalLevels: number, goalPop: number, stageSeed: number): Promise<number | null> {
  setRandom(seeded(stageSeed));
  const t0 = s.time;
  let hit: number | null = null;
  await ladderRun(s, LADDER_HORIZON, (x) => {
    if (levelSum(x) >= goalLevels && x.pop >= goalPop) hit = Math.round(x.time - t0);
    return hit !== null;
  });
  return hit;
}

const lagText = (sec: number | null): string =>
  sec === null ? `>${LADDER_HORIZON / 3600 - 1} ч` : `${Math.round((sec - LADDER_GOAL) / 60)} мин`;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const stageName = (h: number): string => (h === 0 ? '0' : h < 1 ? `${h * 60} мин` : `${h} ч`);

console.log('=== ЛЕСТНИЦА: ЧТО СТОИТ ВЗЯТЫЙ ГОРОД ===');
console.log('Ступеней три, и выбирает её победитель приказом. Отставание ниже меряется на первой —');
console.log(`«ограбить»: склад и казна до тайника, сколько унесёт обоз, и ${FALL_BUILDINGS} построек (кроме тайника)`);
console.log(`теряют по ${FALL_LEVELS} уровню, не ниже первого; невольники остаются. Цену всех трёх ступеней на тех же`);
console.log('этапах — таблица «три ступени» в конце раздела. Общий автопилот (мир тихий), копия на этапе, участь');
console.log('настоящим путём (слепок → spoils.fate → homeLoss → последствие), игра дальше тем же сидом событий.');
console.log('Отставание — насколько позже тронутая партия дошла до того, где нетронутая стояла');
console.log('через час. Ноль — не стоило ничего; минуты в минус — шум автопилота.');
console.log('');

/** Что город потерял на одной ступени — замером на копии посёлка. */
type StepLoss = { fate: Fate; goods: number; gold: number; ledPop: number; ledBonded: number; scatter: number; levels: number; works: number };

/**
 * Три ступени на одной копии этапа: слепок, дверь участи, поля последствия, применение —
 * и потеря, замеренная на посёлке. Обоз и конвой не мешают: так документ считал и
 * «уведено горожан», и «ресурсов на отстройку».
 */
function ladderSteps(snap: GameState, seed: number): StepLoss[] {
  return FATE_IDS.map((f) => {
    const s = structuredClone(snap);
    const p = playerProfile(s);
    const r = fate({
      fate: f,
      stock: p.stock,
      gold: p.gold ?? 0,
      stash: p.stash,
      pop: p.pop,
      bonded: p.bonded ?? 0,
      carry: Infinity,
      escort: Infinity,
      levels: p.levels,
      seed,
    });
    const goods0 = RESOURCE_IDS.reduce((n, x) => n + s.resources[x], 0);
    const gold0 = s.gold;
    const pop0 = s.pop;
    const bonded0 = bondedTotal(s);
    const levels0 = s.buildings.reduce((n, b) => n + b.level, 0);
    const works0 = s.buildings.filter((b) => b.workRequired > 0).length;
    land(s, [{ id: 'лестница', lost: {}, prestige: 0, morale: 0, battle: null, text: 'Город взят.', good: false, ...homeLoss(r) }]);
    const popLost = pop0 - s.pop;
    const bondedLost = bonded0 - bondedTotal(s);
    return {
      fate: f,
      goods: Math.round(goods0 - RESOURCE_IDS.reduce((n, x) => n + s.resources[x], 0)),
      gold: gold0 - s.gold,
      ledPop: Math.min(popLost, r.ledPop.taken),
      ledBonded: Math.min(bondedLost, r.ledBonded.taken),
      scatter: popLost - Math.min(popLost, r.ledPop.taken) + bondedLost - Math.min(bondedLost, r.ledBonded.taken),
      levels: levels0 - s.buildings.reduce((n, b) => n + b.level, 0),
      works: works0 - s.buildings.filter((b) => b.workRequired > 0).length,
    };
  });
}

type LadderRow = {
  stage: number;
  levelAvg: number;
  pop: number;
  open: number;
  stash: number;
  goldHour: number;
  plunderOnly: number | null;
  levelsLag: number[];
  fell: number[];
  rebuild: number[];
  narrow: number[];
  /** Узкий припас на отстройку каждой ступени, минут чистой выработки: 'plunder' | 'captives' | 'burn'. */
  stepNarrow: Record<Fate, number>;
  hunger: number | null;
  raid: number | null;
  steps: StepLoss[];
};
const ladder: LadderRow[] = [];
{
  setRandom(seeded(1));
  // Сид партии закреплён: с пачки 3 приход вестей — функция сида (`sim/mail.awayArrival`), а
  // `createInitialState()` без довода берёт его у устройства. Два прогона на одном коде
  // расходились рядами лестницы, и «СДВИНУЛСЯ» в приёмке частью был этим шумом — та же
  // находка, что у `pop:report` (docs/time.md, раздел 16.10), только `sack` тогда не поправили.
  const base = createInitialState(7);
  base.tutorialDone = true;
  let clock = 0;
  for (const h of LADDER_STAGES) {
    const stage = h * 3600;
    setRandom(seeded(7 + stage));
    await ladderRun(base, stage - clock);
    clock = stage;
    const snap = structuredClone(base);
    const stageSeed = 1000 + stage;
    const free = structuredClone(snap);
    setRandom(seeded(stageSeed));
    await ladderRun(free, LADDER_GOAL);
    const goalL = levelSum(free);
    const goalP = free.pop;
    const p = playerProfile(snap);
    const tryBlow = async (blow: Blow, seed: number) => {
      const c = structuredClone(snap);
      const hit = strike(c, blow, seed);
      return { ...hit, lag: await reach(c, goalL, goalP, stageSeed) };
    };
    const levels = [];
    for (const k of LADDER_SEEDS) levels.push(await tryBlow({ stock: false, levels: true, morale: 0 }, fallSeed(k, stage * 1000)));
    const moderate = { ...snap, tax: 'moderate' } as GameState;
    ladder.push({
      stage: h,
      levelAvg: levelSum(snap) / snap.buildings.length,
      pop: snap.pop,
      open: fate({ fate: FATE_DEFAULT, stock: p.stock, gold: 0, stash: p.stash, pop: 0, bonded: 0, carry: Infinity, escort: 0, seed: 0 }).takenTotal,
      steps: ladderSteps(snap, fallSeed(1, stage * 1000)),
      stash: p.stash,
      goldHour: taxIncomePerDay(moderate) * gameDaysPerHour(),
      plunderOnly: (await tryBlow({ stock: true, levels: false, morale: 0 }, 0)).lag,
      levelsLag: levels.map((x) => (x.lag === null ? Infinity : x.lag)),
      fell: levels.map((x) => x.fell),
      rebuild: levels.map((x) => x.rebuild),
      narrow: levels.map((x) => x.narrow),
      hunger: (await tryBlow({ stock: true, levels: true, morale: -12 }, fallSeed(1, stage * 1000))).lag,
      raid: (await tryBlow({ stock: true, levels: true, morale: -10, sacked: 1 }, fallSeed(1, stage * 1000))).lag,
      // Последним полем нарочно: `strike` тратит общую кость, и замер, вставленный раньше,
      // сдвинул бы числа лестницы, которые считаются до него. Следующий этап кость пересевает.
      stepNarrow: Object.fromEntries(
        FATE_IDS.map((f) => [f, strike(structuredClone(snap), { stock: false, levels: true, morale: 0, fate: f }, fallSeed(1, stage * 1000)).narrow]),
      ) as Record<Fate, number>,
    });
  }
}

console.log(' этап     ур.ср   люди   открыто склада   только склад   пять уровней (медиана, мин–макс)   голод целиком   набег целиком');
for (const r of ladder) {
  const lags = r.levelsLag.map((x) => (x === Infinity ? null : x));
  const shown = lags.map((x) => (x === null ? Infinity : Math.round((x - LADDER_GOAL) / 60)));
  const med = median(shown);
  console.log(
    `  ${pad(stageName(r.stage), 6)}  ${pad(r.levelAvg.toFixed(1), 5)}  ${pad(r.pop, 5)}  ${pad(r.open, 15)}  ${pad(lagText(r.plunderOnly), 13)}  ${pad(`${med === Infinity ? '—' : `${med} мин`} (${Math.min(...shown)}…${Math.max(...shown)})`, 32)}  ${pad(lagText(r.hunger), 14)}  ${pad(lagText(r.raid), 14)}`,
  );
}
console.log('');
console.log('  «Только склад» — участь без падения уровней: это ровно та цена, которую взятый');
console.log('  город стоил до пяти построек (казна автопилоту не нужна и отставания не даёт).');
console.log('  «Голод» и «набег» — участь целиком: склад, казна, пять построек и мораль (−12 и −10);');
console.log('  у набега ещё и разбежавшиеся со всех трёх дворов за стеной работники (разор 1.0).');
console.log('  Сверка с расчётом документа: сожжение (−2 уровня всем, 80 % людей) там стоило');
console.log('  25–154 мин на тех же этапах — пять построек по уровню обязаны быть заметно легче.');
console.log('');

console.log('  Что стоят пять уровней в добре:');
console.log(' этап     снято уровней (по солям)   ресурсов на отстройку (медиана)   узкий припас, минут чистой выработки (по солям)');
for (const r of ladder) {
  const cost = median(r.rebuild);
  console.log(
    `  ${pad(stageName(r.stage), 6)}  ${pad(r.fell.join(' '), 25)}  ${pad(cost, 32)}  ${pad(r.narrow.map((m) => m.toFixed(0)).join(' '), 30)}`,
  );
}
console.log('');
console.log('  «Снято уровней» меньше пяти там, где удар пришёлся на постройку первого уровня:');
console.log('  у новичка всё на первом, отнимать нечего. Отстройка — сумма цен снятых улучшений.');
console.log('  Держит её не сумма, а узкий припас — камень, железо или дерево: сколько минут его');
console.log('  чистой выработки нужно накопить на все снятые уровни. Столбец и есть порядок отставания');
console.log('  на потолке; очередь стройки на пять заказов при этом — одна–две минуты.');
console.log('');

console.log('  Казна: игрок копил час умеренного налога, город взят.');
console.log(' этап     налог умеренный, зол./ч   казна   тайник   унесено   минут налога на возврат');
for (const r of ladder) {
  const gold = Math.round(r.goldHour);
  const took = fate({ fate: FATE_DEFAULT, stock: {}, gold, stash: r.stash, pop: 0, bonded: 0, carry: Infinity, escort: 0, seed: 0 }).taken.gold ?? 0;
  console.log(
    `  ${pad(stageName(r.stage), 6)}  ${pad(gold, 24)}  ${pad(gold, 6)}  ${pad(r.stash, 7)}  ${pad(took, 8)}  ${pad(Math.round((took / Math.max(1, r.goldHour)) * 60), 22)}`,
  );
}
console.log('');
console.log('  Тайник прячет столько же золота, сколько каждого припаса, и уносится остальное —');
console.log('  той же дверью, тем же обозом. Час налога возвращается за час налога минус тайник;');
console.log('  копивший сутки теряет сутки. Потолка у этой потери нет, и это единственное место');
console.log('  участи, где цена зависит от того, как игрок жил (docs/DEFEAT_LADDER.md, 3.2).');
console.log('');

console.log('  Три ступени на тех же этапах: что город потерял, замером на копии посёлка.');
console.log('  Обоз и конвой победителя не мешают. «Добро» — склад без казны; «ушло» — горожане и');
console.log('  невольники, разошедшиеся без победителя; «стройка» — сгоревших улучшений в работе.');
console.log(`  «Тяжелее» — ступень стоит городу не меньше предыдущей по каждой мере; вторая против первой —`);
console.log(`  в мере лестницы, где уведённый человек — ${HEAD_CARRY} добра (место в обозе).`);
console.log(' этап     ступень         добро    казна   уведено горож./невольн.   ушло   уровней   стройка   тяжелее');
let ladderMonotone = true;
for (const r of ladder) {
  let prev: StepLoss | null = null;
  for (const st of r.steps) {
    let heavier = '—';
    if (prev) {
      const ppl = (x: StepLoss): number => x.ledPop + x.ledBonded + x.scatter;
      const common = ppl(st) >= ppl(prev) && st.levels >= prev.levels && st.works >= prev.works;
      const goods =
        FATE_IDS.indexOf(st.fate) === 1
          ? st.goods + st.gold + HEAD_CARRY * (st.ledPop + st.ledBonded) >= prev.goods + prev.gold
          : st.goods + st.gold >= prev.goods + prev.gold;
      heavier = common && goods ? 'да' : 'НЕТ';
      if (heavier !== 'да') ladderMonotone = false;
    }
    console.log(
      `  ${pad(prev ? '' : stageName(r.stage), 6)}  ${FATE_META[st.fate].name.padEnd(14)}  ${pad(st.goods, 7)}  ${pad(st.gold, 6)}  ${pad(`${st.ledPop}/${st.ledBonded}`, 24)}  ${pad(st.scatter, 5)}  ${pad(st.levels, 8)}  ${pad(st.works, 8)}  ${pad(heavier, 8)}`,
    );
    prev = st;
  }
}
console.log('');
console.log(`  Лестница монотонна на всех этапах: ${ladderMonotone ? 'да' : 'НЕТ — смотри строки выше'}.`);
console.log('  Невольников у автопилота нет — он их не покупает, — поэтому уведены только горожане.');
console.log('  Казна у автопилота — то, что он не потратил: копившему игроку разница выше (таблица казны).');
console.log('');
// ------------------------------------------------- окна защиты после удара ---
//
// Два окна защиты игрока стоят от одной минуты падения: `SIEGE_IMMUNE` — после любого
// падения, `BURN_IMMUNE` — после сожжения, и второе закрывает цепочку сожжений. Числа у
// них были равны (настоящие сутки), и равенство это не выведенное, а совпавшее: сутки
// взяли у почты — «время прийти и ответить», — а `BURN_IMMUNE` был сутками ещё до
// поворота шкалы. Равные окна означают, что длинное не значит ничего: у своего города
// второго падения внутри суток не бывает вовсе, и понижение «сжечь» до «ограбить» не
// спрашивается никогда (docs/time.md, раздел 18.3).
//
// **Правило вывода: окно — отстройка снятого, округлённая вверх до суток игрока.** Мера
// отстройки та же, какой её меряет лестница выше, — узкий припас, минут чистой выработки:
// не сумма ресурсов, а то, чего не хватает дольше всего. Берётся наибольшее по этапам:
// окно обязано покрывать отстройку везде, а не в среднем. Округление — до суток, потому
// что окно меряется временем игрока, а не мира.
//
// **Правило проверяется на известной точке.** Окно после грабежа владелец назначил сам —
// настоящие сутки, — и то же правило, приложенное к отстройке после грабежа, обязано дать
// их же. Если не даёт, вывод неверен, и отчёт говорит это строкой.

console.log('=== ОКНА ЗАЩИТЫ: СКОЛЬКО ГОРОД ОТСТРАИВАЕТСЯ ПОСЛЕ КАЖДОЙ СТУПЕНИ ===');
console.log('Узкий припас, минут чистой выработки до удара — та же мера, что в лестнице выше.');
console.log('У грабежа пять построек выбирает соль события: берётся медиана тех же пяти солей,');
console.log('какими лестница мерит отставание. Сожжение соли не знает — оно снимает всем по два.');
console.log('');
console.log(' этап     ограбить, мин   сжечь, мин   сжечь/ограбить');
const rebuildMin: Record<'plunder' | 'burn', number[]> = { plunder: [], burn: [] };
for (const r of ladder) {
  const base = median(r.narrow);
  const burn = r.stepNarrow.burn;
  if (base > 0) {
    rebuildMin.plunder.push(base);
    rebuildMin.burn.push(burn);
  }
  console.log(
    `  ${pad(stageName(r.stage), 6)}  ${pad(base.toFixed(0), 13)}  ${pad(burn.toFixed(0), 11)}  ${pad(base > 0 ? `×${(burn / base).toFixed(1)}` : '—', 16)}`,
  );
}
console.log('');
/** Окно по правилу: наибольшая отстройка по этапам, округлённая вверх до суток игрока. */
const windowOf = (mins: number[]): { hours: number; days: number } => {
  const worst = mins.length > 0 ? Math.max(...mins) : 0;
  const hours = worst / 60;
  return { hours, days: Math.max(1, Math.ceil((hours * HOUR) / DAY)) };
};
const wPlunder = windowOf(rebuildMin.plunder);
const wBurn = windowOf(rebuildMin.burn);
console.log(
  `  Наибольшая отстройка: после грабежа ${wPlunder.hours.toFixed(1)} ч, после сожжения ${wBurn.hours.toFixed(1)} ч.`,
);
console.log(
  `  Правило даёт: окно после грабежа ${wPlunder.days} сут, окно после сожжения ${wBurn.days} сут (${(wBurn.days * DAY) / HOUR} ч).`,
);
const decided = Math.round(SIEGE_IMMUNE / DAY);
console.log(
  `  Проверка правила на известной точке: окно после грабежа назначено владельцем в ${decided} сут —` +
    ` ${wPlunder.days === decided ? 'правило даёт их же' : 'ПРАВИЛО ИХ НЕ ДАЁТ, вывод неверен'}.`,
);
const want = wBurn.days * DAY;
console.log(
  `  В коде (data/tuning.BURN_IMMUNE): ${(BURN_IMMUNE / HOUR).toFixed(0)} ч` +
    `${BURN_IMMUNE === want ? '' : ' — РАСХОДИТСЯ'}.`,
);
console.log('');
console.log('  Окно после сожжения обязано быть длиннее окна после падения: иначе второе окно');
console.log('  накрыто первым, и ступень «сжечь → ограбить» не спрашивается ни разу.');
console.log('');
