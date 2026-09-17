// Запас времени на перехват: сколько остаётся у игрока от мига, когда чужой
// отряд стал виден, до его прихода — и хватает ли этого, чтобы собрать дружину
// и выйти навстречу.
//
// Отчёт нужен ровно потому, что живой обзор сжался до круга у деревни. Набег
// больше не виден с первого своего шага: он либо входит в круг, либо о нём
// доносит Дозор — что случится раньше. Если этого запаса мало, перехват в
// поле — лучшее, что есть на карте, — превращается в кнопку, которая никогда
// не нажимается. Проверяется это прогоном, а не на глаз.
//
// Меряются два случая: полководец дома с дружиной при нём (так играет тот, кто
// ждёт набега) и холодный старт — полководец пустой, войско надо забрать из
// гарнизона, а передача идёт время.
//
//   npx vite-node scripts/raid-report.ts
//
// Раздел «рост логова» (от чего растёт сила набега, осада по сухому прогону, защита новичка,
// логово как цель) живёт в `raid-lair-growth.ts` и печатается в конце. Прежний раздел «потолок
// набегов» мерил отвергнутый вариант «набег = оборона × k» и ушёл вместе с потолком: его числа —
// снимок на коммите aec1117 (docs/raid_ceiling.md). Раздел «Оборона по составу» (долг среднего бойца: где он решает
// сегодня и что станет с правилом «мощь дома — сумма мощи тех, кто дома») — `raid-defense-mix.ts`, последним.
import { LocalWorld } from '@/world/local/LocalWorld';
import { distance } from '@/world/geo';
import {
  AI_WARNING_BASE,
  DEFENSE_FREEZE,
  HANDOVER_MAX,
  HOME_SIGHT,
  AI_RANGE,
} from '@/world/data/tuning';
import type { MarchView, PlayerProfile } from '@/world/types';
import { lairGrowthSection } from './raid-lair-growth';
import { hiringSection } from './raid-hiring';
import { defenseMixSection } from './raid-defense-mix';

const MIN = 60_000;
const SEEDS = [11, 42, 77, 101, 202, 303, 404, 505, 606, 707, 808, 909, 1234, 2024, 4242, 7919];

/** Дружина, с которой играют всерьёз: сотня бойцов и Статуя, которая их пускает. */
const ARMY = { legionary: 40, spearman: 30, archer: 20, rider: 10 };
const MEN = Object.values(ARMY).reduce((n, v) => n + v, 0);

/**
 * Дозор первого уровня стоит в посёлке с первой секунды — как и всё остальное,
 * — поэтому «без Дозора» в игре не бывает, и мерить надо с его 120 секундами.
 * Второй прогон — с Дозором десятого уровня (480 секунд).
 */
const WATCH = [
  { name: 'Дозор 1 ур.', warning: 120 },
  { name: 'Дозор 10 ур.', warning: 480 },
];

const profile = (warning: number): PlayerProfile => ({
  name: 'Отчёт',
  pop: 300,
  defense: 220,
  units: { warrior: 60, scout: 6 },
  army: { ...ARMY },
  warning,
  stock: { food: 400, wood: 300 },
  stash: 0,
});

interface Clocked {
  world: LocalWorld;
  now: () => number;
  at: (t: number) => void;
  advance: (ms: number) => void;
}

function makeWorld(seed: number): Clocked {
  let now = 1_700_000_000_000;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return { world, now: () => now, at: (t) => (now = t), advance: (ms) => (now += ms) };
}

/** Ждём, пока набег станет виден, шагом в пять секунд: это и есть «заметил». */
async function waitVisibleRaid(w: Clocked, p: PlayerProfile): Promise<{ raid: MarchView; seenAt: number } | null> {
  for (let i = 0; i < 2000; i++) {
    w.advance(5_000);
    const pulse = await w.world.sync(p);
    const raid = pulse.marches.find((m) => !m.own && m.phase === 'out');
    if (raid) return { raid, seenAt: pulse.now };
  }
  return null;
}

interface Row {
  watch: string;
  seed: number;
  /** Откуда шли, клеток от дома. */
  dist: number;
  /** Вся дорога набега, мс. */
  travel: number;
  /** Сколько он виден, мс. */
  visible: number;
  /** Успел ли перехват, когда войско уже при полководце. */
  readySeconds: number | null;
  readyOk: boolean;
  /** То же, когда дружину ещё надо забрать из гарнизона. */
  coldSeconds: number | null;
  coldOk: boolean;
  /** Сколько ушло на сбор и дорогу от мига, когда набег стал виден, мс. */
  coldSpent: number;
  coldNote: string;
}

const rows: Row[] = [];

for (const watch of WATCH) for (const seed of SEEDS) {
  // --- Вариант «готов»: полководец дома, войско уже при нём.
  const a = makeWorld(seed);
  const p = profile(watch.warning);
  await a.world.sync(p);
  await a.world.setGarrison({ ...ARMY });
  const g0 = (await a.world.figures()).find((f) => f.id === 'general');
  a.at(g0?.readyAt ?? a.now());
  await a.world.sync(p);
  const hit = await waitVisibleRaid(a, p);
  if (!hit) continue;
  const info = await a.world.info();
  const dist = distance(info.home, hit.raid.from);
  const planA = await a.world.interceptPlan(hit.raid.id);

  // --- Вариант «холодный»: полководец дома пустой, дружину надо собрать.
  const b = makeWorld(seed);
  const pb = profile(watch.warning);
  await b.world.sync(pb);
  const hitB = await waitVisibleRaid(b, pb);
  let coldSeconds: number | null = null;
  let coldOk = false;
  let coldSpent = Infinity;
  let coldNote = 'набега не дождались';
  if (hitB) {
    await b.world.setGarrison({ ...ARMY });
    const gb = (await b.world.figures()).find((f) => f.id === 'general');
    const readyAt = gb?.readyAt ?? b.now();
    if (readyAt >= hitB.raid.arriveAt) {
      coldNote = 'дружина собирается дольше, чем идёт набег';
    } else {
      b.at(readyAt);
      await b.world.sync(pb);
      const planB = await b.world.interceptPlan(hitB.raid.id);
      coldSeconds = planB.can ? planB.seconds : null;
      coldOk = planB.can;
      if (planB.can) coldSpent = readyAt - hitB.seenAt + planB.seconds * 1000;
      coldNote = planB.can
        ? `сбор ${((readyAt - hitB.seenAt) / 1000).toFixed(0)} с, потом ход ${planB.seconds.toFixed(0)} с`
        : planB.reason ?? 'не догнать';
    }
  }

  rows.push({
    watch: watch.name,
    seed,
    dist,
    travel: hit.raid.arriveAt - hit.raid.departAt,
    visible: hit.raid.arriveAt - hit.seenAt,
    readySeconds: planA.can ? planA.seconds : null,
    readyOk: planA.can,
    coldSeconds,
    coldOk,
    coldSpent,
    coldNote,
  });
}

const m = (ms: number): string => `${(ms / MIN).toFixed(1)} мин`;
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log('=== Запас времени на перехват ===');
console.log(`круг у деревни (HOME_SIGHT): ${HOME_SIGHT} клеток`);
console.log(`дальше этого боты не ходят (AI_RANGE): ${AI_RANGE} клеток`);
console.log(`обещанное предупреждение (AI_WARNING_BASE): ${m(AI_WARNING_BASE)}`);
console.log(`заморозка обороны (DEFENSE_FREEZE): ${m(DEFENSE_FREEZE)}`);
console.log(`сбор дружины из ${MEN} бойцов: потолок ${m(HANDOVER_MAX)}`);
for (const watch of WATCH) {
  const part = rows.filter((r) => r.watch === watch.name);
  if (part.length === 0) continue;
  console.log('');
  console.log(`--- ${watch.name} (предупреждение ${m(AI_WARNING_BASE + watch.warning * 1000)}) ---`);
  console.log('сид   откуда  вся дорога  видно      готов        холодный старт');
  for (const r of part) {
    console.log(
      `${String(r.seed).padStart(5)}  ${r.dist.toFixed(1).padStart(5)}  ${m(r.travel).padStart(10)}  ${m(
        r.visible,
      ).padStart(9)}  ${(r.readyOk ? `да, ${r.readySeconds?.toFixed(0)} с` : 'нет').padStart(12)}  ${
        r.coldOk ? `да · ${r.coldNote}` : `нет · ${r.coldNote}`
      }`,
    );
  }
  const vis = part.map((r) => r.visible);
  console.log(`видно набег: ${m(Math.min(...vis))} … ${m(Math.max(...vis))}, в среднем ${m(avg(vis))}`);
  console.log(`худший запас сверх заморозки: ${m(Math.min(...vis) - DEFENSE_FREEZE)}`);
  console.log(`перехват с готовым войском: ${part.filter((r) => r.readyOk).length} из ${part.length}`);
  console.log(`перехват с холодного старта: ${part.filter((r) => r.coldOk).length} из ${part.length}`);
  const slack = part.filter((r) => r.coldOk).map((r) => r.visible - r.coldSpent);
  if (slack.length > 0) {
    console.log(`запас после сбора и хода: ${m(Math.min(...slack))} … ${m(Math.max(...slack))}`);
  }
  const worst = part.filter((r) => !r.coldOk);
  if (worst.length > 0) console.log(`не успели: сиды ${worst.map((r) => r.seed).join(', ')}`);
}

await lairGrowthSection();
await hiringSection();
await defenseMixSection();
