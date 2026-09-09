// Разорение числами: срок, цена часа грабежа против часа хозяйства и потолок
// мести.
//
// Отчёт нужен ровно потому, что у этой петли три числа, которые нельзя выбрать
// на глаз, и каждое ломает её по-своему:
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
import { productionPerDay } from '@/game/derived';
import { DAY_LENGTH, RESOURCE_IDS, SACK_YIELD } from '@/game/constants';
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
console.log(`  Просадка одна на обе стороны: мир роняет мощь двора на ${Math.round(SACK_POWER_LOSS * 100)}%,`);
console.log(`  племя режет свою выработку до ${SACK_YIELD} — это то же число, и тест его сверяет.`);
console.log(`  Склад двора наполняется за ${n1(LOOT_REFILL / MIN)} мин его собственных часов, а они стоят.`);
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
    resources: { food: 2000, wood: 1500 },
    stock: { food: 2000, wood: 1500 },
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
    if (g.x !== target.x || g.y !== target.y) {
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
    loot += got;
    w.advance(30_000);
    await w.world.sync(p);
  }

  const wars = Object.values(save.diplomacy).filter((d) => d.standing === 'war').length;
  const spent = (w.now() - startAt) / HOUR;
  return { loot: loot / Math.max(0.01, spent), raids: raids / Math.max(0.01, spent), dry, wars };
}

console.log('=== ЧАС ГРАБЕЖА ПРОТИВ ЧАСА ХОЗЯЙСТВА ===');
console.log('Мерка одна и она честная: обе величины — единиц добра за реальный час.');
console.log('Игрок в прогоне не делает вообще ничего, кроме набегов: ходит от двора ко двору');
console.log('и бьёт, пока хватает часов. Это верхняя граница войны как заработка.');
console.log('');
console.log(`  Хозяйство: старт ${Math.round(perHour(0))} ед./ч, через 2 ч партии ${Math.round(perHour(2))} ед./ч.`);
console.log('');
console.log('  сид   набегов/ч   пустых   грабёж, ед./ч   к хозяйству   войн');

let sumLoot = 0;
let sumFarm = 0;
const farm = perHour(2);
for (const seed of SEEDS) {
  const r = await plunderRun(seed, HOURS);
  sumLoot += r.loot;
  sumFarm += farm;
  console.log(
    `  ${pad(seed, 4)}  ${pad(n1(r.raids), 9)}  ${pad(r.dry, 7)}  ${pad(Math.round(r.loot), 13)}  ${pad(`${Math.round((r.loot / farm) * 100)}%`, 12)}  ${pad(r.wars, 4)}`,
  );
}
console.log('');
console.log(
  `  В среднем грабёж даёт ${Math.round((sumLoot / sumFarm) * 100)}% часа хозяйства — и это у игрока,`,
);
console.log('  который хозяйством вообще не занимается и ходит от двора ко двору без передышки.');
console.log('  Читается это так: с разорением округа выбирается за один час, а дальше четыре');
console.log('  часа брать в ней нечего — набеги идут, а обоз возвращается пустым.');
console.log('');
console.log('  И вывод, который отсюда делать НЕ надо: поднять добычу. Добро в набеге и не было');
console.log('  наградой — наградой были оружие из логова и казна замка (см. docs/lairs.md).');
console.log('  Разорение не сделало войну беднее, оно сделало её невыгодной **дважды подряд**.');
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
console.log('  Проиграл — войска потеряны, двор обижен ровно так же и войну объявит так же,');
console.log('  а разорения нет: разоряет тот, кто взял двор. Гарнизон при этом всё равно');
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
