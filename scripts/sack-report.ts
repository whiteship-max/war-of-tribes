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
//   npx vite-node scripts/sack-report.ts
//   HOURS=3 npx vite-node scripts/sack-report.ts
import { LocalWorld, HOME_ID } from '@/world/local/LocalWorld';
import { distance } from '@/world/geo';
import {
  AI_ATTACK_MAX,
  AI_ATTACK_MIN,
  AI_POWER_VS_DEFENSE,
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
  REVOLT_DURATION,
  SACK_DURATION,
  SACK_POWER_LOSS,
} from '@/world/data/tuning';
import { createInitialState } from '@/game/state';
import { catchUp } from '@/game/sim/tick';
import { autoAssign } from '@/game/sim/workers';
import {
  defense,
  maxLevelFor,
  productionPerDay,
  stashAt,
  storageCap,
  upgradeCost,
} from '@/game/derived';
import { BUILDINGS } from '@/game/data/buildings';
import { BASE_STORAGE_CAP, DAY_LENGTH, RESOURCE_IDS, UPGRADE_GROWTH } from '@/game/constants';
import { plunder } from '@/world/spoils';
import { stackCarry } from '@/world/data/units';
import type { WorldSave } from '@/world/local/state';
import type { Loot, PlayerProfile, SettlementView } from '@/world/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = 1_700_000_000_000;
const SEEDS = [7, 11, 42, 51, 77];
const HOURS = Number(process.env.HOURS ?? 3);

const n1 = (v: number): string => v.toFixed(1);
const pad = (v: string | number, w: number): string => String(v).padStart(w);
const saveOf = (w: LocalWorld): WorldSave => (w as unknown as { save: WorldSave }).save;
const total = (loot: Loot | null): number =>
  loot ? Object.values(loot).reduce((n, v) => n + Math.abs(v ?? 0), 0) : 0;

// ------------------------------------------------------------------ срок ---

console.log('=== СРОК: в чём он меряется и почему ===');
console.log(`  Разорение держится ${n1(SACK_DURATION / HOUR)} ч реального времени.`);
console.log(
  `  Это же в игровых днях (день = ${DAY_LENGTH} с): ${Math.round(SACK_DURATION / 1000 / DAY_LENGTH)}.`,
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

/** Что посёлок добывает за реальный час: игровой день — минута, значит их 60. */
function perHour(hours: number): number {
  const s = createInitialState();
  autoAssign(s);
  if (hours > 0) catchUp(s, hours * 3600);
  autoAssign(s);
  const per = productionPerDay(s);
  return RESOURCE_IDS.reduce((n, r) => n + Math.max(0, per[r] ?? 0), 0) * (3600 / DAY_LENGTH);
}

const raider = (): PlayerProfile =>
  ({
    name: 'Отчёт',
    pop: 600,
    defense: 4000,
    warriorPower: 14,
    units: { warrior: 200, scout: 8 },
    army: { legionary: 120, spearman: 90, archer: 60 },
    command: 2000,
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
async function plunderRun(seed: number, hours: number) {
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
  const deadline = startAt + hours * HOUR;
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
      for (let i = 0; i < 600 && w.now() < deadline; i++) {
        w.advance(30_000);
        await w.world.sync(p);
        const f = (await w.world.figures()).find((v) => v.id === 'general');
        if (f && f.phase !== 'moving') break;
      }
      if (w.now() >= deadline) break;
    }
    const res = await w.world.attack({ setup: null });
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
    w.advance(30_000);
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
  `Склад двора — ${LOOT_PER_POP} ед. на жителя, из них ${Math.round(AI_STASH_SHARE * 100)}% лежит в его тайнике.`,
);
console.log('Победитель забирает остальное целиком — столько, сколько поднимет отряд.');
console.log('');
console.log(`  Хозяйство: старт ${Math.round(perHour(0))} ед./ч, через 2 ч партии ${Math.round(perHour(2))} ед./ч.`);
console.log('');
console.log('  сид   набегов/ч   за набег   первый двор   грабёж, ед./ч   к хозяйству   войн');

let sumLoot = 0;
let sumFarm = 0;
const farm = perHour(2);
for (const seed of SEEDS) {
  const r = await plunderRun(seed, HOURS);
  sumLoot += r.loot;
  sumFarm += farm;
  console.log(
    `  ${pad(seed, 4)}  ${pad(n1(r.raids), 9)}  ${pad(Math.round(r.perRaid), 8)}  ${pad(Math.round(r.first), 11)}  ${pad(Math.round(r.loot), 13)}  ${pad(`${Math.round((r.loot / farm) * 100)}%`, 12)}  ${pad(r.wars, 4)}`,
  );
}
console.log('');
console.log(
  `  В среднем грабёж даёт ${Math.round((sumLoot / sumFarm) * 100)}% часа хозяйства — и это у игрока,`,
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
    const res = await w.world.attack({ setup: null });
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
console.log('**Прорваться набег может только при игроке**, и это не оговорка, а условие');
console.log('таблицы. Набег, чей приход пришёлся на время без пульса, не состоится вовсе');
console.log('(`AWAY_GRACE`, 20 с от прошлого пульса): марш снимается, взамен ложится отчёт');
console.log('«Набег не состоялся». Так что читать таблицу как «столько теряют за ночь»');
console.log('нельзя — она про игрока, который в игре и бой проиграл.');
console.log('');
console.log(' уровни   склад целиком   тайник   открыто   обоз набега   унесут   доля склада');

for (const level of [1, 3, 5, 7, 10]) {
  const s = createInitialState();
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
  // Мощь набега упирается в долю обороны, а отряд из неё — тем же курсом, что
  // и в мире (`scheduleAi`): один воин на три единицы мощи.
  const men = Math.max(1, Math.round((defense(s) * AI_POWER_VS_DEFENSE) / 3));
  const carry = stackCarry({ warrior: men });
  const spoils = plunder(stock, hide, carry);
  const open = plunder(stock, hide, Infinity).takenTotal;
  console.log(
    `  ${pad(level, 5)}   ${pad(total, 13)}  ${pad(hide * RESOURCE_IDS.length, 7)}  ${pad(open, 7)}  ${pad(Math.round(carry), 12)}  ${pad(spoils.takenTotal, 7)}  ${pad(`${Math.round((spoils.takenTotal / total) * 100)}%`, 10)}`,
  );
}
console.log('');
console.log('  «Обоз набега» — грузоподъёмность отряда, которого хватило бы прорваться:');
console.log(`  ${Math.round(AI_POWER_VS_DEFENSE * 100)}% нашей обороны, переведённые в людей тем же курсом, что в мире.`);
console.log('  Оборона взята по настоящему посёлку этого уровня и **без дружины** — то есть');
console.log('  в самом уязвимом положении: армия в поле, дома ополчение, частокол и башня.');
console.log('  Отсюда и калибровка обоза: отряд, которого едва хватило прорваться, уносит');
console.log('  большую часть незапрятанного, но не всё.');
console.log('');
console.log('  «Открыто» — всё, что не влезло в тайник: это и есть верхняя граница потери.');
console.log('  Дружина дома — оборона выше, отряд больше, и обоз перестаёт мешать: тогда');
console.log('  уносят ровно эту колонку, то есть от 75 до 92 % полного склада. Именно это и');
console.log('  значит «теряешь ровно то, что не спрятал», и именно поэтому копить рискованно.');
console.log('');
console.log('  Читается так: тайник спасает не всё и не должен. Тем, кто не хочет терять,');
console.log('  игра предлагает не тайник, а второе решение — потратить: заложить улучшение,');
console.log('  поставить заказ в кузницу, набрать бойцов. Потраченного не унесут.');
console.log('');
console.log('  Мимо защиты отсутствия ведёт ровно один путь, и он не набег: осада, которая');
console.log('  началась при игроке и доела город без него (`homeFalls` — единственный');
console.log('  вызов дележа, куда `prevSeen` не передаётся). Что это стоит и почему так');
console.log('  оставлено — npm run siege:report, раздел «цена падения», и docs/siege.md.');
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
  `    3. набег на нас один за раз и не сильнее ${Math.round(AI_POWER_VS_DEFENSE * 100)}% нашей обороны;`,
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
weak.command = 20;
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
  const res = await w.world.attack({ setup: null });
  const save = saveOf(w.world);
  console.log(`  Цель: ${target.name}. Исход: ${res.won ? 'победа' : 'поражение'}.`);
  console.log(`  Отношение: ${before} → ${save.diplomacy[target.id].attitude}.`);
  console.log(`  Разорение двора: ${save.sacks[target.id] ? 'есть' : 'нет'}.`);
  console.log(`  Разорение нашей деревни: ${save.sacks[HOME_ID] ? 'есть' : 'нет'}.`);
}
console.log('');
