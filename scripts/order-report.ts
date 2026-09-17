// Невольники и порядок в городе — числами.
//
// Отчёт нужен затем же, зачем `sack:report` нужен грабежу: у механики пять чисел,
// которые нельзя выбрать на глаз, и каждое ломает её по-своему.
//
//  1. **Доля выработки невольника.** Много — невольник лучше вольного, и племя
//     перестаёт расти само, покупая руки; мало — его незачем кормить. Раздел
//     «работник» кладёт вольного и невольника на одно место рядом.
//  2. **Надзор.** Сколько невольников держат стража, дворы и спокойные горожане.
//     Раздел «надзор» печатает, сколько можно держать, прежде чем порядок поедет,
//     на каждом этапе партии — дома и с дружиной в поле.
//  3. **Цена на рынке.** Раздел «цена» меряет окупаемость мерой самой игры
//     (налог с человека) и мерой рынка — и говорит, какая из них честная.
//  4. **Война против хозяйства.** Раздел гоняет настоящий мир: полководец только
//     и делает, что берёт голодом логова, — сколько невольников за час это даёт
//     против того, что за тот же час покупает казна.
//  5. **Срок.** От первого предупреждения до мятежа — настоящими шагами
//     симуляции в четырёх положениях: покупка по партии в день, дружина ушла в
//     поле, кончилась еда — при дружине в поле и при дружине дома.
//
// Ещё два раздела — справка, а не подбор: что стоит мятеж, который стража не
// удержала, и скольких невольников уводит лагерь павшего города.
//
//   npm run order:report
//   HOURS=2 npm run order:report
import type { GameState, JobId, ResourceId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { tick } from '@/game/sim/tick';
import { seeded, setRandom } from '@/game/sim/random';
import {
  BONDED_OUTPUT,
  BUILDER_RATE,
  DAY_LENGTH,
  MAX_BUILDING_LEVEL,
  MORALE_BASE,
  MUTINY_ANSWER,
  MUTINY_CARRY,
  MUTINY_FUSE,
  MUTINY_SUPPRESS_FLEE,
  MUTINY_TOWN_LEAVE,
  ORDER_HOUSEHOLD,
  ORDER_PER_GUARD,
  ORDER_PER_TOWNSMAN,
  ORDER_UNREST,
  ORDER_WARN,
  RESOURCE_IDS,
  VILLAGER_DEFENSE,
} from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { BONDED_JOBS, JOB_BY_ID } from '@/game/data/jobs';
import {
  BONDED_GOOD,
  BONDED_PAYBACK_DAYS,
  BONDED_SALE,
  GOOD_BY_ID,
  batchCost,
  goodPrice,
  goodStock,
} from '@/game/data/market';
import { TAXES, TAX_PER_POP } from '@/game/data/policy';
import { MUTINY_EVENT } from '@/game/data/order';
import {
  buildingOfType,
  defense,
  hiddenStash,
  housingCapacity,
  moraleTarget,
  mutinyForecast,
  orderBreakdown,
  orderValue,
  rationOf,
  seasonMods,
  selfCost,
  storageCap,
  taxIncomePerDay,
  townHallBuildMult,
  workerMultiplier,
} from '@/game/derived';
import { LocalWorld } from '@/world/local/LocalWorld';
import { FATES, FATE_DEFAULT, HEAD_CARRY, lead, plunder } from '@/world/spoils';
import { FATE_META } from '@/world/data/fates';
import { stackEscort } from '@/world/data/units';
import { AI_BONDED_SHARE, LAIR_ANCHOR_FAR, LAIR_RIPE } from '@/world/data/tuning';
import { lairPower, lairRaid } from '@/world/lairs';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { PlayerProfile, SettlementView } from '@/world/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const HOURS = Number(process.env.HOURS ?? 3);
const SEEDS = [7, 11, 42, 51, 77];
const LEVELS = [1, 3, 5, 7, MAX_BUILDING_LEVEL];

const pad = (v: string | number, w: number): string => String(v).padStart(w);
const n1 = (v: number): string => v.toFixed(1);
const pct = (v: number): string => `${Math.round(v * 100)}%`;

setRandom(seeded(1));

/**
 * Посёлок этапа партии: все постройки нужного уровня, под крышей полно народу,
 * мораль устоявшегося племени и дружина в пятую часть горожан — копейщики.
 * Никто не стоит на местах: разделы расставляют людей сами, где это важно.
 */
function stage(level: number, armyShare = 0.2): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  for (const b of s.buildings) b.level = Math.min(BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL, level);
  s.pop = housingCapacity(s);
  s.morale = MORALE_BASE;
  s.workers = {};
  s.freeJobs = {};
  s.army.spearman = Math.round(s.pop * armyShare);
  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) s.resources[r] = cap;
  s.nextEventAt = 1e12;
  return s;
}

// ---------------------------------------------------------------- работник ---

console.log('=== РАБОТНИК: вольный и невольник на одном месте ===');
console.log(`Невольник даёт ${pct(BONDED_OUTPUT)} того, что вольный на том же месте (BONDED_OUTPUT), по той же`);
console.log('таблице профессии и с тем же множителем места, сезона, морали, веры и указа. Ест наравне:');
console.log('одна голова — одна порция в день, пайком и сезоном множится как у всех.');
console.log('Мораль — устоявшегося племени, весна. Числа — единиц добра за игровой день на одного.');
console.log('');
console.log(' ур   работа        вольный   невольник   ест   стройка, труд/с: вольный · невольник');
for (const level of [1, 5, MAX_BUILDING_LEVEL]) {
  const s = stage(level);
  // Весна: ни летнего поля, ни зимнего простоя — чтобы доля читалась сама по себе.
  s.time = 1;
  const mods = seasonMods(s);
  const eat = mods.food * rationOf(s).food;
  const build = BUILDER_RATE * mods.build * townHallBuildMult(s);
  for (const job of BONDED_JOBS) {
    const place = s.buildings.find((b) => BUILDING_BY_ID[b.type].job === job)!;
    const mult = workerMultiplier(s, job, place, mods);
    const units = RESOURCE_IDS.reduce((n, r) => n + (JOB_BY_ID[job].yield[r] ?? 0), 0) * mult;
    console.log(
      `  ${pad(level, 2)}  ${JOB_BY_ID[job].name.padEnd(12)} ${pad(n1(units), 8)}  ${pad(n1(units * BONDED_OUTPUT), 10)}  ${pad(n1(eat), 4)}   ${n1(build)} · ${n1(build * BONDED_OUTPUT)}`,
    );
  }
}
const bestTax = Math.max(...TAXES.map((t) => t.perPop)) * TAX_PER_POP;
console.log('');
console.log('Чего у невольника нет совсем, а у вольного есть:');
console.log(`  · налога: вольный приносит казне до ${bestTax} золота в день (высокий налог);`);
console.log(`  · обороны: вольный встаёт на стену ополченцем (${VILLAGER_DEFENSE} обороны на голову);`);
console.log('  · прироста: племя растёт от вольных, невольники не рождаются и не приходят сами.');
console.log('Чего у невольника нет, а у вольного есть в минус: жилья. Невольник крыши не занимает —');
console.log('в этом и есть его «дёшево»: руки сверх того, что держат крыши посёлка, и сразу, а не');
console.log('приростом. Платят за это едой, золотом рынка или войной — и порядком.');
console.log('');

// ------------------------------------------------------------------ надзор ---

console.log('=== НАДЗОР: сколько невольников можно держать ===');
console.log(
  `Держат дворы (${ORDER_HOUSEHOLD}), каждый боец дома (${ORDER_PER_GUARD}) и горожане (${ORDER_PER_TOWNSMAN} на голову при морали 100).`,
);
console.log('Порядок = 100 × надзор ÷ (надзор + невольники). Надзор равен невольникам — порядок 50.');
console.log(`Тревога с ${ORDER_WARN}, ропот и срок до мятежа — ниже ${ORDER_UNREST}.`);
console.log('');
console.log('Посёлок этапа: всё на этом уровне, крыши полны, мораль устоявшегося племени, дружина —');
console.log('пятая часть горожан, копейщики. «В поле» — полководец увёл всю дружину: потолка у Статуи нет.');
console.log('');
console.log(' ур   горожан  дружина   тревога с   ропот с   к горожанам   подавит до   в поле: тревога · ропот');
const unrestAt = (hold: number): number => Math.ceil((hold * (100 - ORDER_UNREST)) / ORDER_UNREST);
for (const level of LEVELS) {
  const s = stage(level);
  const home = orderBreakdown(s);
  const f = mutinyForecast(s);
  const away = stage(level);
  away.away = { ...away.army };
  const field = orderBreakdown(away);
  console.log(
    `  ${pad(level, 2)}  ${pad(s.pop, 7)}  ${pad(troopTotal(s.army), 7)}   ${pad(Math.floor(home.hold), 9)}   ${pad(unrestAt(home.hold), 7)}   ${pad(pct(home.hold / s.pop), 11)}   ${pad(f.crush, 10)}   ${pad(Math.floor(field.hold), 7)} · ${unrestAt(field.hold)}`,
  );
}
console.log('');
console.log('То же при недовольных горожанах (мораль 40):');
for (const level of LEVELS) {
  const s = stage(level);
  s.morale = 40;
  const o = orderBreakdown(s);
  console.log(`  ${pad(level, 2)}: тревога с ${Math.floor(o.hold)}, ропот с ${unrestAt(o.hold)}`);
}
console.log('');
console.log('Читается так. «Тревога с» — сколько невольников держит надзор: больше — порядок');
console.log('ниже пятидесяти, и об этом скажет строка. «Ропот с» — порог, после которого пошёл срок');
console.log(`до мятежа. «Подавит до» — стража дома (мощь ÷ ${VILLAGER_DEFENSE}, мятежник бьётся как житель на`);
console.log('стене): столько невольников она разгонит, если мятеж всё-таки случится.');
console.log('Главное число здесь — последний столбец: дружина в поле, и держать некому.');
console.log('');

// -------------------------------------------------------------------- цена ---

console.log('=== ЦЕНА: невольник на рынке и когда он окупается ===');
console.log('');
console.log(' ур рынка   первый   запас/день   весь запас дня   средняя   торговцы берут: цена · в день');
const sale = Math.floor(BONDED_GOOD.price * BONDED_SALE);
for (const level of [1, 5, MAX_BUILDING_LEVEL]) {
  const stock = goodStock(BONDED_GOOD, level);
  const full = batchCost(BONDED_GOOD, level, 0, stock);
  console.log(
    `  ${pad(level, 8)}   ${pad(goodPrice(BONDED_GOOD, level, 0), 6)}   ${pad(stock, 10)}   ${pad(full, 14)}   ${pad(n1(full / stock), 7)}   ${sale} · ${stock}`,
  );
}
console.log('');
console.log('Окупаемость меряется двумя мерками, и честная из них одна.');
console.log('');
console.log('Мерка игры: во что добро обходится своим трудом (`selfCost`). Человек на месте в');
console.log(`здании пятого уровня стоит казне столько же, сколько высокий налог с него — ${bestTax} золота`);
console.log('в день. Этой же меркой рынок меряет, дороже ли купить, чем сделать самим.');
console.log('');
console.log(' ур места   работа        добра/день   по мерке игры, зол./день   окупится первый, дней');
for (const level of [1, 5, MAX_BUILDING_LEVEL]) {
  const s = stage(level);
  s.time = 1;
  for (const job of ['farmer', 'woodcutter', 'miner'] as JobId[]) {
    const place = s.buildings.find((b) => BUILDING_BY_ID[b.type].job === job)!;
    const mult = workerMultiplier(s, job, place) * BONDED_OUTPUT;
    let gold = 0;
    let units = 0;
    for (const r of RESOURCE_IDS) {
      const y = (JOB_BY_ID[job].yield[r] ?? 0) * mult;
      units += y;
      gold += y * selfCost(GOOD_BY_ID[r]);
    }
    // Порция еды в день — тоже добро, и тоже по своей цене.
    gold -= selfCost(GOOD_BY_ID.food);
    console.log(
      `  ${pad(level, 8)}   ${JOB_BY_ID[job].name.padEnd(12)} ${pad(n1(units), 10)}   ${pad(gold.toFixed(2), 24)}   ${pad(Math.round(BONDED_GOOD.price / Math.max(0.001, gold)), 20)}`,
    );
  }
}
{
  // Самое выгодное положение, какое бывает: его и держит тест.
  const s = stage(MAX_BUILDING_LEVEL);
  s.morale = 100;
  s.decree = 'order';
  let fastest = Infinity;
  let where = '';
  for (let season = 0; season < 4; season++) {
    s.time = season * 5 * DAY_LENGTH + 1;
    for (const job of BONDED_JOBS) {
      const place = s.buildings.find((b) => BUILDING_BY_ID[b.type].job === job)!;
      const mult = workerMultiplier(s, job, place) * BONDED_OUTPUT;
      let gold = -selfCost(GOOD_BY_ID.food);
      for (const r of RESOURCE_IDS) gold += (JOB_BY_ID[job].yield[r] ?? 0) * mult * selfCost(GOOD_BY_ID[r]);
      if (gold > 0 && BONDED_GOOD.price / gold < fastest) {
        fastest = BONDED_GOOD.price / gold;
        where = `${JOB_BY_ID[job].name.toLowerCase()}, сезон ${season + 1}`;
      }
    }
  }
  console.log('');
  console.log(
    `  Самое выгодное положение (10 ур., мораль 100, строгий указ, лучший сезон — ${where}): ${n1(fastest)} дней;`,
  );
  console.log(`  обещано не быстрее ${BONDED_PAYBACK_DAYS} (BONDED_PAYBACK_DAYS), держит тест.`);
}
console.log('');
console.log('Игровой день — реальная минута: «сорок дней» — это сорок минут игры.');
console.log('');
console.log('Мерка рынка: сколько стоило бы то же добро, купи его у торговцев. По ней невольник');
console.log('окупается за считанные дни — и это не довод, а ловушка мерки: рынок нарочно продаёт');
console.log(`в десятки раз дороже своего труда (еда — ${GOOD_BY_ID.food.price} золота при своей цене ${selfCost(GOOD_BY_ID.food).toFixed(3)}),`);
console.log('и сравнивать с ним — сравнивать с тем, чего никто в здравом уме каждый день не покупает.');
console.log('Честная мерка — первая: невольник возвращает своё золото работой за десятки минут игры,');
console.log('а не за одну.');
console.log('');

// -------------------------------------------------------- война и хозяйство ---

const HOST: TroopStack = { legionary: 30, spearman: 24, archer: 16 };

const host = (): PlayerProfile => ({
  name: 'Отчёт',
  pop: 400,
  defense: 900,
  units: { warrior: 70, scout: 6 },
  army: { ...HOST },
  warning: 120,
  stock: { food: 9000, wood: 900 },
  stash: 0,
  food: 90000,
  foodPerHour: 600,
  soldierFoodPerHour: 30,
});

async function nearest(world: LocalWorld, skip: Set<string>): Promise<SettlementView | null> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 26, y: info.home.y - 26, w: 53, h: 53 });
  const list = chunk.settlements.filter((x) => !x.mine && !x.ruin && !skip.has(x.id));
  list.sort((a, b) => Math.hypot(a.x - info.home.x, a.y - info.home.y) - Math.hypot(b.x - info.home.x, b.y - info.home.y));
  return list[0] ?? null;
}

/**
 * Полководец, который не делает ничего, кроме осад: доводит дружину до
 * ближайшего живого логова, обкладывает, ждёт голода, идёт к следующему. Это
 * верхняя граница войны как источника невольников.
 */
async function siegeRun(seed: number, hours: number) {
  let now = 1_700_000_000_000;
  const world = new LocalWorld({ seed, now: () => now, storage: null, reveal: true });
  const p = host();
  await world.sync(p);
  await world.setGarrison({ ...HOST });
  const g0 = (await world.figures()).find((f) => f.id === 'general');
  now = Math.max(now, g0?.readyAt ?? now);
  await world.sync(p);
  const start = now;
  const end = start + hours * HOUR;
  let captives = 0;
  let sieges = 0;
  const immune = new Set<string>();
  while (now < end) {
    const target = await nearest(world, immune);
    if (!target) break;
    const moved = await world.moveFigure('general', { x: target.x, y: target.y });
    if (moved) {
      immune.add(target.id);
      continue;
    }
    const walking = (await world.figures()).find((f) => f.id === 'general');
    now = Math.max(now, walking?.arriveAt ?? now);
    await world.sync(p);
    const err = await world.besiege('captives');
    if (err) {
      immune.add(target.id);
      now += MIN;
      await world.sync(p);
      continue;
    }
    for (let i = 0; i < 400 && now < end; i++) {
      now += 20_000;
      const pulse = await world.sync(p);
      for (const e of pulse.effects) if ((e.bonded ?? 0) > 0) captives += e.bonded ?? 0;
      if (pulse.reports.some((r) => r.title.startsWith('Город взят голодом'))) {
        sieges++;
        break;
      }
      const fig = (await world.figures()).find((f) => f.id === 'general');
      if (!fig?.besieging) break;
    }
    // Павший город не осадить снова, пока держится неприкосновенность: к следующему.
    immune.add(target.id);
  }
  const spent = Math.max(0.01, (now - start) / HOUR);
  return { captives: captives / spent, sieges: sieges / spent, perSiege: captives / Math.max(1, sieges) };
}

console.log('=== ВОЙНА ПРОТИВ ХОЗЯЙСТВА: откуда невольники дешевле ===');
console.log('Мерка одна — невольников за реальный час. Полководец в прогоне ничего не делает, кроме');
console.log('осад: идёт к ближайшему логову, берёт его голодом, идёт дальше. Это верхняя граница войны.');
console.log(`У бота невольники — доля его людей (AI_BONDED_SHARE = ${AI_BONDED_SHARE}). Полководец объявляет ступень`);
console.log(`«увести людей» (FATES.captives): уводит невольников логова и ${pct(FATES.captives.ledPop)} его людей, скольких`);
console.log(`устережёт дружина, и за каждого увозит на ${HEAD_CARRY} добра меньше. «Ограбить» не увёл бы никого.`);
console.log('');
console.log('  сид   осад/ч   невольников за осаду   невольников/ч');
let warTotal = 0;
for (const seed of SEEDS) {
  const r = await siegeRun(seed, HOURS);
  warTotal += r.captives;
  console.log(`  ${pad(seed, 3)}   ${pad(n1(r.sieges), 6)}   ${pad(n1(r.perSiege), 20)}   ${pad(n1(r.captives), 13)}`);
}
const warAvg = warTotal / SEEDS.length;
console.log('');
console.log(' ур посёлка   казна/ч при высоком налоге   купит за час   предел ряда за час');
for (const level of [1, 5, MAX_BUILDING_LEVEL]) {
  const s = stage(level);
  s.tax = 'high';
  const goldHour = taxIncomePerDay(s) * (3600 / DAY_LENGTH);
  const market = buildingOfType(s, 'market')!.level;
  const stock = goodStock(BONDED_GOOD, market);
  const perDay = batchCost(BONDED_GOOD, market, 0, stock);
  // Сколько купит за час, если тратить весь сбор на невольников и брать дневной
  // запас целиком по нарастающей цене.
  const days = 3600 / DAY_LENGTH;
  const affordDays = Math.min(days, goldHour / Math.max(1, perDay));
  console.log(
    `  ${pad(level, 10)}   ${pad(Math.round(goldHour), 26)}   ${pad(Math.round(affordDays * stock), 12)}   ${pad(days * stock, 18)}`,
  );
}
console.log('');
console.log(`  Война в среднем: ${n1(warAvg)} невольников за час — у полководца, который больше ничего не делает.`);
if (warAvg === 0) {
  console.log('  Ноль — не сбой прогона, а ступень «ограбить»: невольников она не уводит ни у кого.');
  console.log('  Рынок остаётся единственным источником невольников. Сколько давала война, пока падение');
  console.log('  голодом уводило их всегда, — docs/order.md, раздел 6.');
} else {
  console.log('  Сравнивать — с колонкой «купит за час» того уровня посёлка, у которого полководец уводит людей: логово растёт');
  console.log('  от жителей города (docs/lair_growth.md), и чем больше город, тем больше людей в логове. Полководец всё это время');
  console.log('  не бьёт и не ловит, а дружина стоит под чужими стенами.');
}
console.log('');

// ------------------------------------------------------ срок до мятежа ---

interface Marks {
  warn: number | null;
  unrest: number | null;
  mutiny: number | null;
  silence: number | null;
}

/** Шагает настоящей симуляцией и отмечает первые минуты тревоги, ропота и мятежа. */
function watch(s: GameState, seconds: number, each?: (s: GameState, t: number) => void): Marks {
  const marks: Marks = { warn: null, unrest: null, mutiny: null, silence: null };
  for (let t = 0; t <= seconds; t += 0.5) {
    each?.(s, t);
    const settled = tick(s, 0.5);
    const v = orderValue(s);
    if (marks.warn === null && s.bonded > 0 && v < ORDER_WARN) marks.warn = t;
    if (marks.unrest === null && s.bonded > 0 && v < ORDER_UNREST) marks.unrest = t;
    if (marks.mutiny === null && s.activeEvent?.defId === MUTINY_EVENT) marks.mutiny = t;
    if (settled) {
      marks.silence = t;
      break;
    }
  }
  return marks;
}

const mm = (t: number | null): string => {
  if (t === null) return '—';
  const sec = Math.round(t);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const span = (a: number | null, b: number | null): string => (a === null || b === null ? '—' : mm(b - a));

console.log('=== СРОК: от первого предупреждения до мятежа ===');
console.log(`Ропот длится ${MUTINY_FUSE / 60} мин игры при игроке (MUTINY_FUSE), окно мятежа ждёт ответа ${MUTINY_ANSWER} с`);
console.log('(MUTINY_ANSWER). Офлайн не двигает ни того, ни другого. Всё ниже — настоящими шагами');
console.log('симуляции при игроке, посёлок пятого уровня.');
console.log('');
console.log('  положение                               тревога   ропот   мятеж   сама   тревога → мятеж');

{
  // 1. Покупают по партии в день, пока порядок не поедет.
  const s = stage(5);
  s.morale = moraleTarget(s);
  const hold = orderBreakdown(s).hold;
  const batch = Math.max(1, Math.round(hold / 8));
  const m = watch(s, 60 * 60, (st, t) => {
    if (t % DAY_LENGTH === 0 && st.activeEvent === null) st.bonded += batch;
  });
  console.log(
    `  покупка по ${pad(batch, 3)} в день                   ${pad(mm(m.warn), 7)}   ${pad(mm(m.unrest), 5)}   ${pad(mm(m.mutiny), 5)}   ${pad(mm(m.silence), 4)}   ${span(m.warn, m.mutiny)}`,
  );
}
{
  // 2. Невольников держали с запасом, и полководец увёл дружину в поле.
  const s = stage(5);
  s.morale = moraleTarget(s);
  s.bonded = Math.round(orderBreakdown(s).hold * 0.9);
  const m = watch(s, 20 * 60, (st, t) => {
    if (t === 30) st.away = { ...st.army };
  });
  console.log(
    `  дружина ушла в поле на 0:30                ${pad(mm(m.warn), 7)}   ${pad(mm(m.unrest), 5)}   ${pad(mm(m.mutiny), 5)}   ${pad(mm(m.silence), 4)}   ${span(m.warn, m.mutiny)}`,
  );
}
{
  // 3. Дружина давно в поле, невольников держали впритык к тому, что держат дворы
  // и горожане, — и кончилась еда. Мораль ползёт вниз, спокойных горожан всё
  // меньше, голод забирает и самих горожан: порядок падает медленно, а не разом.
  const s = stage(5);
  s.away = { ...s.army };
  s.morale = moraleTarget(s);
  s.bonded = Math.round(orderBreakdown(s).hold * 0.95);
  s.resources.food = 0;
  const m = watch(s, 60 * 60);
  console.log(
    `  дружина в поле, кончилась еда              ${pad(mm(m.warn), 7)}   ${pad(mm(m.unrest), 5)}   ${pad(mm(m.mutiny), 5)}   ${pad(mm(m.silence), 4)}   ${span(m.warn, m.mutiny)}`,
  );
}
{
  // 4. Та же еда, но дружина дома: голод ропота не поднимает — стражу он не трогает.
  const s = stage(5);
  s.morale = moraleTarget(s);
  s.bonded = Math.round(orderBreakdown(s).hold * 0.95);
  s.resources.food = 0;
  const m = watch(s, 60 * 60);
  console.log(
    `  дружина дома, кончилась еда                ${pad(mm(m.warn), 7)}   ${pad(mm(m.unrest), 5)}   ${pad(mm(m.mutiny), 5)}   ${pad(mm(m.silence), 4)}   ${span(m.warn, m.mutiny)}`,
  );
}
console.log('');
console.log('«Тревога → мятеж» — сколько у игрока времени с первой строки тревоги до окна мятежа.');
console.log(`Самый короткий случай — провал разом ниже ропота: тогда это ровно ${MUTINY_FUSE / 60} мин, и ещё`);
console.log(`${MUTINY_ANSWER} с на ответ в самом окне. Рычаги на этот срок: отпустить часть и продать — сразу,`);
console.log('пир — за полминуты (мораль идёт к цели плавно), дружина домой — сколько идти.');
console.log('');

// ------------------------------------------------------ цена мятежа ---

console.log('=== ЧТО СТОИТ МЯТЕЖ ===');
console.log(`Стража не удержала: уходит ${pct(MUTINY_TOWN_LEAVE)} горожан (MUTINY_TOWN_LEAVE) и все невольники, склад делит общее`);
console.log(`правило (всё, кроме тайника, сколько унесут; ${MUTINY_CARRY} на уходящего). Удержала: сбегает`);
console.log(`${pct(MUTINY_SUPPRESS_FLEE)} невольников. Невольников взято ровно на пороге ропота.`);
console.log('');
console.log(' ур   горожан  невольников   уйдут   унесут   доля склада   дома: подавит?   в поле: подавит?');
for (const level of LEVELS) {
  const s = stage(level);
  const bonded = unrestAt(orderBreakdown(s).hold);
  s.bonded = bonded;
  const f = mutinyForecast(s);
  const stock: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_IDS) stock[r] = Math.floor(s.resources[r]);
  const total = RESOURCE_IDS.reduce((n, r) => n + (stock[r] ?? 0), 0);
  const spoils = plunder(stock, hiddenStash(s), (f.leave + bonded) * MUTINY_CARRY);
  const away = stage(level);
  away.bonded = bonded;
  away.away = { ...away.army };
  console.log(
    `  ${pad(level, 2)}  ${pad(s.pop, 7)}  ${pad(bonded, 11)}   ${pad(f.leave, 5)}   ${pad(spoils.takenTotal, 6)}   ${pad(pct(spoils.takenTotal / total), 11)}   ${pad(f.holds ? 'да' : 'нет', 14)}   ${pad(mutinyForecast(away).holds ? 'да' : 'нет', 16)}`,
  );
}
console.log('');
console.log('Горожане возвращаются приростом, добро — хозяйством; невольников заново покупают. Дома, при');
console.log('дружине, мятеж подавляется почти всегда: самая жёсткая потеря случается тогда, когда');
console.log('дружина ушла, невольников держали впритык и на ропот не ответили ничем.');
console.log('');

// ---------------------------------------------------------- падение ---

console.log('=== ПАДЕНИЕ ГОРОДА: скольких увёл бы лагерь ===');
console.log(`На ступени «${FATE_META[FATE_DEFAULT].name.toLowerCase()}» — никого, и так берут город логова: другой ступени они не объявляют.`);
console.log('Таблица — конвой лагеря, то есть предел ступени «увести людей», если её объявит тот, кто осадил.');
console.log('Лагерь садится под стенами, только когда штурм не удался бы (`LocalWorld.sitsDown`), и он не сильнее');
console.log('набега, из которого встал: самого крупного — дозревшего дальнего логова при жителях этого посёлка');
console.log(`(\`lairs.lairRaid\`). Отряд — один воин на три мощи; ведёт каждый ${stackEscort({ warrior: 1 })} невольников.`);
console.log('');
console.log(' ур   оборона дома   самый крупный лагерь, воинов   увёл бы до   невольников на пороге тревоги');
for (const level of LEVELS) {
  const s = stage(level);
  const camp = lairRaid(lairPower(LAIR_ANCHOR_FAR, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, s.pop), s.pop);
  const men = Math.max(1, Math.round(camp / 3));
  const hold = Math.floor(orderBreakdown(s).hold);
  const led = lead(hold, stackEscort({ warrior: men }));
  console.log(
    `  ${pad(level, 2)}   ${pad(Math.round(defense(s)), 12)}   ${pad(men, 29)}   ${pad(led.taken, 10)}   ${pad(hold, 29)}`,
  );
}
console.log('');
console.log('Сколько уведут, решает конвой лагеря: логово растёт вместе с городом, и сторожей у него столько,');
console.log('сколько воинов. Правило одно и у нас, и у бота (`world/spoils.lead`), и зовёт его');
console.log('только дверь участи — на той ступени, что уводит людей.');
