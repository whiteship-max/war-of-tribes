// Уведомления числами: что сервер смог бы сказать игроку, ушедшему в случайную минуту, и
// почему остальное сказать нельзя (docs/NOTIFY.md, раздел 9).
//
// Отчёт нужен потому, что правило «молчание вместо неправды» (src/world/notice.ts) имеет
// цену, и её не выбрать на глаз: осада, у которой до конца хлеба назначен пересчёт окна —
// свой отряд идёт домой, кончается сбор дружины, полководец идёт к воротам, — не даёт ни
// одного сообщения. Тесты держат, что это правда; здесь меряется, как часто так бывает у
// игрока, который играет, а не стоит.
//
// Три раздела:
//
//  1. **Уходы.** Партии играются автопилотом (разведка, сбор и роспуск дружины, выход
//     полководца в поле и обратно, перехват набега), и игрок уходит из игры в случайные
//     минуты. На каждом уходе — сколько черновиков, сколько из них сервер отправил бы
//     (правило «ушёл до новости»), сколько на уход приходится сообщений каждого вида.
//  2. **Осады.** Какая доля уходов посреди осады молчит об осаде и из-за какого разрыва.
//  3. **Отряд на подходе по уровням Дозора.** Окно ответа — от минуты, когда набег стал
//     бы виден, до минуты, когда полный сбор дружины ещё успевает (приход минус потолок
//     сбора с чертой, `LocalWorld.musterBy`; до поставки 2 боя — до заморозки обороны), и
//     то же за вычетом худшего опоздания прохода доставки (минута расписания). Пункты, у
//     которых полный сбор не успевает уже с минуты обнаружения, считаются отдельно: окна у
//     них нет, а пункт есть — годен до прихода, с пометкой (docs/battle_eu4.md, 14.27).
//
//   npx vite-node scripts/notify-report.ts
import { NotifyingWorld } from '@/world/local/NotifyingWorld';
import { distance } from '@/world/geo';
import { seeded } from '@/game/sim/random';
import { createInitialState } from '@/game/state';
import { warningSeconds } from '@/game/derived';
import { AI_WARNING_BASE, HANDOVER_MAX } from '@/world/data/tuning';
import type { Silence } from '@/world/notice';
import type { PlayerProfile, SettlementView } from '@/world/types';
import type { TroopStack } from '@/game/battle/kinds';
import { SEEN_GRACE } from '../netlify/lib/notify';
import { CLIENT_KINDS, type NoticeKind } from '../netlify/lib/contract';
import { shieldVillagers } from '@/world/lairs';
import { DAY_LENGTH, realMs, worldDays } from '@/game/pace';
import { PULSE_FLOOR } from './autopilot';

const MIN = 60_000;
const START = 1_700_000_000_000;
const SEEDS = [11, 42, 77, 101, 202, 303, 404, 505];
/**
 * Сколько **игрового** времени играем каждую партию. Шесть часов отчёт играл, пока игровой день
 * был настоящей минутой, то есть 360 игровых дней; после поворота шкалы те же шесть настоящих
 * часов стали двенадцатью игровыми днями — короче одной паузы между набегами, — и уходов посреди
 * осады не случилось ни одного (docs/time.md, раздел 18).
 */
const GAME_DAYS = 360;
/** Шаг мира: двадцать игровых секунд, но не чаще раза в настоящую минуту (`PULSE_FLOOR`). */
const STEP = Math.max(PULSE_FLOOR * 1000, realMs(20));
/**
 * Уход — в среднем раз в столько. Заход игрока — **настоящее** время: столько он в игре и сидит,
 * и от шкалы мира это не зависит. Отсюда и весь смысл раздела: уходят по своим часам, а осада
 * идёт по часам мира.
 */
const LEAVE_EVERY = 12 * MIN;
/** Худшее опоздание прохода доставки: расписание раз в минуту. */
const CRON_LAG = MIN;

const ARMY: TroopStack = { legionary: 40, spearman: 30, archer: 20 };
const DRUZHINA: TroopStack = { legionary: 20, spearman: 10 };

/**
 * Две деревни: крепкая (набег садится лагерем) и средняя (набег бьётся у стены). Садится ли отряд
 * лагерем, решает бой у стены (`LocalWorld.sitsDown`), а не число обороны, — поэтому у крепкой
 * ополчение, которое отобьёт любой такой набег, а у средней его нет.
 */
const TOWNS = [
  { name: 'крепкая', defense: 100_000, militia: 1000 },
  { name: 'средняя', defense: 220, militia: 0 },
];

const profile = (defense: number, warning = 120, militia = 0): PlayerProfile => ({
  name: 'Отчёт',
  // Жители выше порога защиты новичка: иначе логово деревню не замечает и набегов нет вовсе.
  pop: shieldVillagers(0.5),
  militia,
  defense,
  units: { warrior: 40, scout: 6 },
  army: { ...ARMY },
  warning,
  stock: { food: 900, wood: 600 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
});

interface Leave {
  town: string;
  items: number;
  wouldSend: number;
  byKind: Partial<Record<NoticeKind, number>>;
  /** Осада шла в минуту ухода. */
  siege: boolean;
  /** Какая осада: кто стоит и с какой минуты. */
  siegeKey: string | null;
  /** Почему нет осадного сообщения. null — оно есть. */
  siegeSilence: Silence | null;
  raid: boolean;
  raidSilence: Silence | null;
  /** Черновик набега есть и станет новостью позже ухода плюс две минуты — то есть уйдёт. */
  raidLater: boolean;
}

async function nearest(world: NotifyingWorld): Promise<SettlementView | null> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 30, y: info.home.y - 30, w: 60, h: 60 });
  const list = chunk.settlements.filter((s) => !s.mine);
  return list.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0] ?? null;
}

/** Одна партия автопилотом с уходами в случайные минуты. */
async function play(seed: number, town: (typeof TOWNS)[number]): Promise<Leave[]> {
  let now = START;
  const world = new NotifyingWorld({ seed, now: () => now, storage: null });
  const p = profile(town.defense, 120, town.militia);
  const rng = seeded(seed * 7919 + town.defense);
  const leaves: Leave[] = [];
  await world.sync(p);
  const target = await nearest(world);
  const end = START + worldDays(GAME_DAYS);
  let nextAct = now + realMs(3 * DAY_LENGTH);
  let nextLeave = now + rng() * 2 * LEAVE_EVERY;

  while (now < end) {
    now += STEP;
    const pulse = await world.sync(p);

    // Автопилот: игрок, который играет. Приказы, которые мир отвергает (осада, занятость),
    // просто не исполняются — ровно как у живого игрока.
    if (now >= nextAct) {
      nextAct = now + realMs((6 + rng() * 14) * DAY_LENGTH);
      const roll = rng();
      const general = pulse.figures.find((f) => f.id === 'general');
      if (roll < 0.35 && target) {
        await world.send({ target: target.id, mission: 'scout', units: { scout: 2 } });
      } else if (roll < 0.6 && general?.phase === 'home') {
        const has = Object.values(general.troops ?? {}).some((v) => (v ?? 0) > 0);
        await world.setGarrison(has ? null : { ...DRUZHINA });
      } else if (roll < 0.8 && general) {
        const info = await world.info();
        const out = general.phase === 'home';
        await world.moveFigure('general', out ? { x: info.home.x + 5, y: info.home.y + 2 } : info.home);
      } else {
        const raid = pulse.marches.find((m) => !m.own && m.phase === 'out');
        if (raid) await world.intercept(raid.id);
      }
    }

    if (now >= nextLeave) {
      nextLeave = now + rng() * 2 * LEAVE_EVERY;
      // Черновики — сразу после пульса, как у клиента; приказы автопилота этой минуты
      // уже в сохранении, поэтому пульс берётся заново.
      const fresh = await world.sync(p);
      const d = await world.notices();
      const byKind: Leave['byKind'] = {};
      for (const i of d.items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
      const siegeSilent = d.silent.find((s) => s.kind === 'siege-fall');
      const raidSilent = d.silent.find((s) => s.kind === 'raid');
      leaves.push({
        town: town.name,
        items: d.items.length,
        // Сервер не отправит того, что игрок видел своими глазами: созревшее раньше ухода
        // плюс две минуты. Остальное уйдёт, если игрок не вернётся раньше.
        wouldSend: d.items.filter((i) => i.fireAt >= now + SEEN_GRACE).length,
        byKind,
        siege: fresh.siege !== null,
        siegeKey: fresh.siege ? `${seed}:${town.name}:${fresh.siege.byId}:${fresh.siege.since}` : null,
        siegeSilence: fresh.siege && !byKind['siege-fall'] ? (siegeSilent?.why ?? 'passed') : null,
        raid: d.items.some((i) => i.kind === 'raid') || Boolean(raidSilent),
        raidSilence: raidSilent?.why ?? null,
        raidLater: d.items.some((i) => i.kind === 'raid' && i.fireAt >= now + SEEN_GRACE),
      });
    }
  }
  return leaves;
}

const pct = (a: number, b: number): string => (b === 0 ? '—' : `${((a / b) * 100).toFixed(0)}%`);
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const m = (ms: number): string => `${(ms / MIN).toFixed(1)} мин`;

console.log('=== Уведомления: что можно сказать ушедшему игроку ===');
console.log(`партий: ${SEEDS.length} сидов × ${TOWNS.length} деревни × ${GAME_DAYS} игровых дней, уход в среднем раз в ${m(LEAVE_EVERY)} настоящего времени`);

const all: Leave[] = [];
for (const town of TOWNS) for (const seed of SEEDS) all.push(...(await play(seed, town)));

console.log('');
console.log('--- 1. уходы ---');
console.log('деревня   уходов  черновиков/уход  ушло бы/уход   ' + CLIENT_KINDS.map((k) => k.padEnd(12)).join(''));
for (const town of TOWNS) {
  const part = all.filter((l) => l.town === town.name);
  console.log(
    `${town.name.padEnd(9)} ${String(part.length).padStart(6)}  ${avg(part.map((l) => l.items)).toFixed(2).padStart(15)}  ${avg(
      part.map((l) => l.wouldSend),
    )
      .toFixed(2)
      .padStart(12)}   ${CLIENT_KINDS.map((k) => avg(part.map((l) => l.byKind[k] ?? 0)).toFixed(2).padEnd(12)).join('')}`,
  );
}
const max = Math.max(0, ...all.map((l) => l.items));
console.log(`больше всего черновиков на одном уходе: ${max} (потолок устройства — 3)`);
if (max > 3) console.log('!!! черновиков на уход больше трёх — нарушен потолок устройства');

console.log('');
console.log('--- 2. осады: молчание вместо неправды ---');
const inSiege = all.filter((l) => l.siege);
const silent = inSiege.filter((l) => l.siegeSilence !== null);
console.log(`уходов посреди осады: ${inSiege.length}, из них без сообщения об осаде: ${silent.length} (${pct(silent.length, inSiege.length)})`);
const reasons = new Map<string, number>();
for (const l of silent) reasons.set(l.siegeSilence as string, (reasons.get(l.siegeSilence as string) ?? 0) + 1);
const WORDS: Record<string, string> = {
  'march-home': 'свой отряд идёт домой',
  handover: 'идёт сбор или роспуск дружины',
  'general-home': 'полководец идёт к своим воротам',
  strike: 'полководец идёт бить лагерь',
  chase: 'полководец в погоне',
  burn: 'свой поход идёт на логово набега',
  'no-window': 'окна нет',
};
const PASSED: Record<string, string> = {
  siege: 'хлеб уже кончился: «годно до» прошло',
  raid: 'полный сбор уже не успевает: «годно до» прошло',
};
const word = (why: string, kind: 'siege' | 'raid'): string => (why === 'passed' ? PASSED[kind] : (WORDS[why] ?? ''));
for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${pct(n, inSiege.length).padStart(4)}  ${why.padEnd(13)} ${word(why, 'siege')}`);
}
const lie = inSiege.filter((l) => l.siegeSilence === 'march-home');
console.log(`доля уходов посреди осады, где молчит свой отряд, идущий домой: ${pct(lie.length, inSiege.length)}`);
// По осадам, а не по уходам: осада, о которой промолчали хоть на одном уходе, и осада,
// о которой не сказали ни разу.
const sieges = new Map<string, Leave[]>();
for (const l of inSiege) sieges.set(l.siegeKey as string, [...(sieges.get(l.siegeKey as string) ?? []), l]);
const someSilent = [...sieges.values()].filter((ls) => ls.some((l) => l.siegeSilence !== null && l.siegeSilence !== 'passed'));
const allSilent = [...sieges.values()].filter((ls) => ls.every((l) => l.siegeSilence !== null));
console.log(
  `осад с уходом посреди: ${sieges.size}; молчали из-за разрыва хоть раз: ${someSilent.length} (${pct(someSilent.length, sieges.size)}); молчали на всех уходах: ${allSilent.length} (${pct(allSilent.length, sieges.size)})`,
);
const raids = all.filter((l) => l.raid);
const raidSilent = raids.filter((l) => l.raidSilence !== null);
console.log(`уходов при идущем набеге: ${raids.length}, без сообщения: ${raidSilent.length} (${pct(raidSilent.length, raids.length)})`);
for (const why of new Set(raidSilent.map((l) => l.raidSilence as string))) {
  const n = raidSilent.filter((l) => l.raidSilence === why).length;
  console.log(`  ${String(n).padStart(4)}  ${why.padEnd(13)} ${word(why, 'raid')}`);
}
// Набег, лежащий в сохранении в минуту ухода, чаще всего уже виден: дорога короче
// предупреждения, и отряд выходит сразу видимым. Сервер такой пункт не отправит — игрок
// его видел. Уходит только тот, что станет новостью позже ухода.
const raidItems = raids.filter((l) => l.raidSilence === null);
const later = raidItems.filter((l) => l.raidLater);
console.log(
  `черновиков набега на уходе: ${raidItems.length}; станут новостью после ухода (уйдут): ${later.length} (${pct(later.length, raidItems.length)})`,
);

console.log('');
console.log('--- 3. отряд на подходе: окно ответа по уровням Дозора ---');
console.log(`потолок сбора дружины (HANDOVER_MAX, без черты): ${m(HANDOVER_MAX)}; худшее опоздание прохода: ${m(CRON_LAG)}`);
console.log('Дозор  предупреждение  набегов  окно мин…макс        среднее  не успеет  после опоздания (мин)  виден с выхода');
for (const level of [1, 5, 10]) {
  const s = createInitialState(7);
  const watch = s.buildings.find((b) => b.type === 'watch');
  if (watch) watch.level = level;
  const warning = warningSeconds(s);
  const windows: number[] = [];
  let late = 0;
  let atBirth = 0;
  for (const seed of SEEDS) {
    let now = START;
    const world = new NotifyingWorld({ seed, now: () => now, storage: null });
    const p = profile(220, warning);
    await world.sync(p);
    const seen = new Set<string>();
    for (let t = 0; t < Math.ceil(worldDays(GAME_DAYS / 2) / STEP); t++) {
      now += STEP;
      await world.sync(p);
      const d = await world.notices();
      for (const i of d.items) {
        if (i.kind !== 'raid' || seen.has(i.key)) continue;
        seen.add(i.key);
        // С пометкой окна нет: полный сбор не успевает с минуты обнаружения, и пункт годен до прихода.
        if (i.p.late) late++;
        else windows.push(i.until - i.fireAt);
        // Ключ несёт минуту выхода: виден с неё — значит новостью стал в минуту рождения.
        if (i.fireAt <= Number(i.key.split(':')[2])) atBirth++;
      }
    }
  }
  const lo = windows.length > 0 ? Math.min(...windows) : 0;
  const hi = windows.length > 0 ? Math.max(...windows) : 0;
  console.log(
    `${String(level).padStart(4)}   ${m(AI_WARNING_BASE + warning * 1000).padStart(12)}  ${String(windows.length + late).padStart(7)}  ${m(lo).padStart(8)} … ${m(
      hi,
    ).padEnd(9)}  ${m(avg(windows)).padStart(8)}  ${String(late).padStart(9)}  ${m(lo - CRON_LAG).padStart(8)}              ${pct(
      atBirth,
      windows.length + late,
    )}`,
  );
}
