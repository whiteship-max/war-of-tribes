// Приборы времени (docs/time.md) и держава (docs/dynasty.md). У каждого раздела один вопрос:
//
//  1. СКЛАД ПРОТИВ ОТЛУЧКИ — за сколько игровых дней наполняется склад и что игрок находит,
//     вернувшись через D игровых дней: сколько выработки пропало о полный склад, сколько долга
//     набежало войску. От этого выводятся ступень замедления и потолок догона офлайна.
//  2. СЛУЖБА АГЕНТА — за сколько часов службы берётся пятый уровень, и значит, каким должен быть
//     год жизни. Прежде это число жило щупом в scratchpad (docs/AGENTS.md, раздел 11).
//  3. ЦЕНА ЖИВОГО ПРОГОНА — что держит цену: шаг племени, решения игрока или пульс мира. От этого
//     зависит, во сколько обойдётся перемер после поворота шкалы.
//  4. ВЕРНУВШИЙСЯ — что находит игрок после 8, 24 и 48 часов отлучки при нынешней шкале.
//  5. АЛМАЗ — цена достройки как доля настоящих суток: она от шкалы не зависит.
//  6. ДЕРЖАВА — очки правителя, потолок, цена уровня технологии и военная лестница, выведенная из
//     работы вещей кузницы. Прибор шага 4 (docs/dynasty.md, пачка 0): чистая арифметика, прогона нет.
//
// Всё, что про хозяйство, печатается в ИГРОВЫХ ДНЯХ: это единица, которая переживает поворот шкалы.
// Настоящие часы стоят рядом пересчётом — при нынешнем дне в минуту и при дне в полчаса.
//
//   npm run time:report
//   AGENTS_DAYS=12 AGENTS_SEEDS=7,42,101 npm run time:report
//   YEARS=1 npm run time:report   — ещё и проверка года жизни прогоном (дорого, в приёмку не входит)
//   SECTIONS=13 npm run time:report — только названные разделы
import type { GameState, ResourceId, TroopId } from '@/game/types';
import type { FigureId, FigureView } from '@/world/types';
import type { WorldSave } from '@/world/local/state';
import { createInitialState } from '@/game/state';
import { seeded, setRandom } from '@/game/sim/random';
import { DAY_LENGTH, MAX_BUILDING_LEVEL, MAX_OFFLINE_DAYS, RESOURCE_IDS, RESOURCE_META, TEST_GEMS } from '@/game/constants';
import {
  armySize,
  buildingOfType,
  netPerDay,
  orderValue,
  payGraceDays,
  productionPerDay,
  storageCap,
  taxIncomePerDay,
  wagesPerDay,
} from '@/game/derived';
import { AGENT_AGE0, AGENT_YEAR, MAX_AGENT_LEVEL, RETIRE_AGE, levelOf } from '@/game/data/agents';
import { YEAR_DAYS } from '@/game/data/seasons';
import { hireAgent } from '@/game/sim/hire';
import { generateWorld, isLair } from '@/world/gen';
import { lairPhase } from '@/world/lairs';
import { distance } from '@/world/geo';
import { AI_RANGE } from '@/world/data/tuning';
import { START, armyAt, away, gone, pilot, played, player, stackOf, type Cost, type Inside } from './autopilot';
// Этот отчёт меряет настоящим временем — службу агента, отлучку, заходы, — поэтому часы и минуты у него
// настоящие (`game/time`), а не единицы автопилота, которые после поворота шкалы стали игровыми днями.
import { HOUR_MS as HOUR, MINUTE_MS as MIN } from '@/game/time';
import { measure } from './lib/measured';
import { dayRealSeconds, gameDaysPerHour, gameSeconds, setTimeScale } from '@/game/pace';
import {
  ADMIN_LEVELS,
  BRANCH_NAME,
  DIPLO_LEVELS,
  MAX_RULER_SKILL,
  MEAN_RULER_SKILL,
  MIN_RULER_SKILL,
  POINTS_CAP,
  POINTS_PER_SKILL_PER_DAY,
  REALM_BRANCHES,
  WAR_CAPTIVES_LEVEL,
  WAR_GEAR_ORDER,
  WAR_LEVELS,
  mastersAt,
  branchPrice,
  levelPrice,
  levelsOf,
  pointsPerDay,
  startingPoints,
  warLevelOfGear,
  warLevelOfTroop,
} from '@/game/data/realm';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { KIND_OF, gearOfTroop } from '@/game/battle/kinds';
import { realSpan } from '@/game/span';
import { GEM_DAY_SHARE, GEM_REAL_SECONDS, GEM_REF_RATE, rushPrice, rushWork } from '@/game/sim/gems';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { SILENCE_PREFIX } from '@/game/sim/mail';
import { MUTINY_EVENT } from '@/game/data/order';
import { ageOf } from '@/game/sim/agents';

const pad = (x: string | number, w: number): string => String(x).padStart(w);
const n1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '∞');
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const clone = (s: GameState): GameState => structuredClone(s);

/** Настоящих секунд в игровом дне сегодня и при шкале, принятой условно (docs/time.md, раздел 3). */
const SCALE_NEXT = 30;
const hoursAt = (days: number, scale: number): number => (days * DAY_LENGTH * scale) / 3600;

// ---------- 1. Склад против отлучки ----------

const WORLD = 7;
const STEP = 15;
/** Этапы партии в игровых днях: те же, что у `pop:report`, «Содержание войска», плюс потолок уровней. */
const STAGES: [string, number][] = [
  ['новичок', 20],
  ['начало', 60],
  ['середина', 120],
  ['потолок жилья', 300],
  ['потолок уровней', 600],
];
/** Отлучки, игровых дней. Восемь — нынешний потолок догона при дне в полчаса; 48 — сутки, 144 — трое суток. */
const ABSENCES = [8, 16, 24, 48, 96, 144];

async function stages(): Promise<GameState[]> {
  setRandom(seeded(1));
  // Сид партии закреплён: вести приходят по сетке от `s.seed` (`sim/mail.awayArrival`), а без сида партия
  // берёт его у устройства (`freshSeed`) — и два прогона одного кода расходились (docs/time.md, раздел 16.10).
  const s = createInitialState(7);
  s.tutorialDone = true;
  const out: GameState[] = [];
  await pilot({
    g: s,
    seconds: STAGES[STAGES.length - 1][1] * DAY_LENGTH,
    player: player(null),
    world: { seed: WORLD, pulse: STEP, raids: false },
    economy: 'live',
    tick: 1,
    decide: STEP,
    watch: {
      after: ({ g, now }) => {
        const t = Math.round(now / 1000);
        for (const [, day] of STAGES) if (t === day * DAY_LENGTH) out.push(clone(g));
      },
    },
  });
  return out;
}

/** Припасы, которые посёлок добывает с излишком: только они наполняют склад. */
const rising = (s: GameState): ResourceId[] => RESOURCE_IDS.filter((r) => netPerDay(s)[r] > 0);

function fillSection(towns: GameState[]): void {
  console.log('=== 1. СКЛАД ПРОТИВ ОТЛУЧКИ ===');
  console.log('Общий автопилот, мир тихий, войска нет (как `pop:report`). Единица — игровой день; настоящие часы —');
  console.log(`пересчёт: сегодня день длится ${DAY_LENGTH} с, при шкале ×${SCALE_NEXT} — ${(DAY_LENGTH * SCALE_NEXT) / 60} мин.`);
  console.log(`Потолок догона офлайна — ${MAX_OFFLINE_DAYS} игровых дней при любой шкале: это ${n1((MAX_OFFLINE_DAYS * dayRealSeconds()) / 3600)} ч настоящего времени сегодня и ${n1((MAX_OFFLINE_DAYS * DAY_LENGTH * SCALE_NEXT) / 3600)} ч при ×${SCALE_NEXT}.`);
  console.log('');
  console.log('За сколько игровых дней чистая выработка наполняет ПУСТОЙ склад — по припасам с излишком.');
  console.log('«еда» — амбар: у еды излишек самый большой, и тратить её, кроме войска, не на что; «первый» — самый быстрый из');
  console.log('остальных припасов: с этого дня начинает пропадать добро; «медиана» и «последний» — по ним же; «сумма» — вся');
  console.log('вместимость к сумме излишков, с едой (мерка docs/DEFEAT_LADDER.md: «полный склад за четверть часа»).');
  console.log('  этап             | день | люди | вмещает |    еда |           первый | медиана | последний | сумма');
  const first: number[] = [];
  const sums: number[] = [];
  for (let i = 0; i < towns.length; i++) {
    const s = towns[i];
    const cap = storageCap(s);
    const net = netPerDay(s);
    const goods = rising(s)
      .filter((r) => r !== 'food')
      .sort((a, b) => net[b] - net[a]);
    const full = goods.map((r) => cap / net[r]);
    const food = net.food > 0 ? cap / net.food : Infinity;
    const sum = (cap * rising(s).length) / rising(s).reduce((a, r) => a + net[r], 0);
    first.push(full[0]);
    sums.push(sum);
    console.log(
      `  ${STAGES[i][0].padEnd(16)} | ${pad(STAGES[i][1], 4)} | ${pad(s.pop, 4)} | ${pad(cap, 7)} | ${pad(n1(food), 6)} | ${`${n1(full[0])} ${RESOURCE_META[goods[0]].name.toLowerCase()}`.padStart(16)} | ${pad(n1(median(full)), 7)} | ${pad(n1(full[full.length - 1]), 9)} | ${pad(n1(sum), 5)}`,
    );
  }
  console.log('');
  const rule = (name: string, xs: number[]): void => {
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    // Правило вывода ступени: отлучка в настоящие сутки равна складу. Потолок догона ступень больше не
    // выводит — он сам задан в игровых днях и от шкалы не зависит.
    const DAY_REAL = 24 * 3600;
    console.log(
      `  по мерке «${name}» склад — ${n1(lo)}…${n1(hi)} игровых дней (потолок догона — ${MAX_OFFLINE_DAYS}); настоящие сутки отлучки равны складу при дне в ` +
        `${n1(DAY_REAL / 60 / hi)}…${n1(DAY_REAL / 60 / lo)} мин — шкала ×${Math.round(DAY_REAL / hi / DAY_LENGTH)}…×${Math.round(DAY_REAL / lo / DAY_LENGTH)}.`,
    );
  };
  console.log('Правило вывода ступени (docs/time.md, разделы 3 и 12): отлучка в настоящие сутки равна складу.');
  rule('первый припас, кроме еды', first);
  rule('сумма', sums);
  console.log('');

  console.log('Что находит вернувшийся: отлучка D игровых дней офлайн-догоном (`catchUp`, шаг 2 с), по игровому дню.');
  console.log('«пропало» — доля валовой выработки отлучки, не лёгшая на склад: выработка дня (по сезону этого дня) минус');
  console.log('то, что легло. В ячейке два числа: всё вместе · без еды и дров. Еда и дрова расходуются, и у полного амбара');
  console.log('«пропавшее» — излишек над расходом; остальные пять припасов в отлучке только копятся. Две строки на этап:');
  console.log('склад этапа как есть (автопилот копит) и склад, потраченный перед уходом (всё, кроме еды, в ноль).');
  console.log(`  этап             | склад     | ${ABSENCES.map((d) => `D=${d}`.padStart(11)).join(' | ')}`);
  const GOODS = RESOURCE_IDS.filter((r) => r !== 'food' && r !== 'wood');
  for (let i = 0; i < towns.length; i++) {
    for (const spent of [false, true]) {
      const s = clone(towns[i]);
      s.nextEventAt = Infinity;
      if (spent) for (const r of RESOURCE_IDS) if (r !== 'food') s.resources[r] = 0;
      let gross = 0;
      let kept = 0;
      let goodsGross = 0;
      let goodsKept = 0;
      const cells: string[] = [];
      for (let day = 1; day <= ABSENCES[ABSENCES.length - 1]; day++) {
        const before = s.profile.totals.produced;
        const stock = GOODS.reduce((a, r) => a + s.resources[r], 0);
        const prod = productionPerDay(s);
        gross += RESOURCE_IDS.reduce((a, r) => a + prod[r], 0);
        goodsGross += GOODS.reduce((a, r) => a + prod[r], 0);
        away(s, DAY_LENGTH, 2);
        kept += s.profile.totals.produced - before;
        goodsKept += GOODS.reduce((a, r) => a + s.resources[r], 0) - stock;
        const lost = (k: number, g: number): number => Math.round(Math.max(0, 1 - k / g) * 100);
        if (ABSENCES.includes(day)) cells.push(`${lost(kept, gross)} % · ${lost(goodsKept, goodsGross)} %`.padStart(11));
      }
      console.log(`  ${STAGES[i][0].padEnd(16)} | ${(spent ? 'потрачен' : 'как есть').padEnd(9)} | ${cells.join(' | ')}`);
    }
  }
  console.log(`  в настоящих часах: ${ABSENCES.map((d) => `D=${d} — ${n1(hoursAt(d, 1) * 60)} мин сегодня, ${n1(hoursAt(d, SCALE_NEXT))} ч при ×${SCALE_NEXT}`).join('; ')}.`);
  console.log('');

  console.log('Войско в отлучке: войско мерки (`armyAt` по среднему уровню, состав `MIX`), склад и казна этапа, умеренный и');
  console.log('высокий налог; догон по игровому дню, до ' + ABSENCES[ABSENCES.length - 1] + ' дней. «казна пуста» — первый день отлучки, на котором вырос долг;');
  console.log('«амбар пуст» — первый день без еды. Уход сегодня идёт только при игроке, и в догоне копится один долг;');
  console.log('«ушли бы с дня» — казна пуста плюс терпение Статуи: с этого дня отлучки войско уходило бы, если бы уход');
  console.log('зрел по времени, а не по присутствию (docs/time.md, решение 3). «—» — за весь срок не случилось.');
  console.log('  этап             | налог     | войско | казна | жалованье/д | доход/д | терпение, дн | казна пуста | амбар пуст | ушли бы с дня');
  for (let i = 0; i < towns.length; i++) {
    for (const tax of ['moderate', 'high'] as const) {
      const s = clone(towns[i]);
      s.tax = tax;
      const level = s.buildings.reduce((a, b) => a + b.level, 0) / s.buildings.length;
      const army = stackOf(armyAt(Math.max(1, Math.round(level))));
      for (const [id, k] of Object.entries(army)) s.army[id as keyof typeof s.army] = k ?? 0;
      s.nextEventAt = Infinity;
      const size = Object.values(army).reduce((a: number, b) => a + (b ?? 0), 0);
      const head = `  ${STAGES[i][0].padEnd(16)} | ${(tax === 'high' ? 'высокий' : 'умеренный').padEnd(9)} | ${pad(size, 6)} | ${pad(Math.round(s.gold), 5)} | ${pad(Math.round(wagesPerDay(s)), 11)} | ${pad(Math.round(taxIncomePerDay(s)), 7)} | ${pad(n1(payGraceDays(s)), 12)}`;
      const grace = payGraceDays(s);
      let broke: number | null = null;
      let hungry: number | null = null;
      for (let day = 1; day <= ABSENCES[ABSENCES.length - 1]; day++) {
        const debt = s.pay.debt;
        away(s, DAY_LENGTH, 2);
        if (broke === null && s.pay.debt > debt + 1e-6) broke = day;
        if (hungry === null && s.resources.food <= 0) hungry = day;
      }
      const first = [broke, hungry].filter((x): x is number => x !== null);
      const leave = first.length ? n1(Math.min(...first) + grace) : '—';
      console.log(`${head} | ${pad(broke ?? '—', 11)} | ${pad(hungry ?? '—', 10)} | ${pad(leave, 13)}`);
    }
  }
  console.log('');
}

// ---------- 2. Служба агента ----------

const AGENTS_DAYS = Number(process.env.AGENTS_DAYS ?? 12);
const AGENTS_SEEDS = (process.env.AGENTS_SEEDS ?? '7,42,101').split(',').map(Number);
/** Заход игрока, мин. Раз в три часа — «два-три раза в день» с запасом в сторону частого. */
const VISIT = 180;
/** Шаг прогона: пульс мира, шаг племени и решения, с. Племя здесь — только часы службы. */
const AGENTS_STEP = 120;
const GARRISON = { legionary: 40, spearman: 30, archer: 20 };
type Style = 'careful' | 'careless';
const SEATS = ['scout', 'spy', 'general'] as const;
type Seat = (typeof SEATS)[number];

interface Career {
  /** Часы службы до пятого уровня у каждого, кто его взял. */
  toTop: number[];
  /** Наивысший уровень каждого человека, ушедшего или стоящего в конце. */
  tops: number[];
  deeds: number;
  deaths: number;
  retired: number;
}
const career = (): Career => ({ toTop: [], tops: [], deeds: 0, deaths: 0, retired: 0 });

const saveOf = (w: Inside): WorldSave => w.save;

function liveLairs(w: Inside, now: number): { id: string; x: number; y: number }[] {
  const save = saveOf(w);
  return [...generateWorld(save.seed).settlements.filter(isLair), ...save.spawned]
    .filter((l) => distance(l, save.home) <= AI_RANGE)
    .filter((l) => lairPhase(save.lairs[l.id] ?? { bornAt: save.createdAt, burnedAt: 0 }, now) === 'alive')
    .map((l) => ({ id: l.id, x: l.x, y: l.y }));
}

/**
 * Партия агентов заходами. `yearSeconds` — год жизни подстановкой: `Infinity` — покоя нет (меряем часы
 * до пятого уровня), `null` — год игры. Подстановка правит возраст прихода так, будто год длится столько.
 */
async function agentsRun(seed: number, style: Style, yearSeconds: number | null): Promise<Record<Seat, Career>> {
  setRandom(seeded(seed));
  const s = createInitialState(seed);
  s.tutorialDone = true;
  s.pop = 300;
  s.gold = 1e9;
  s.faith.id = 'catholic';
  Object.assign(s.army, GARRISON);
  buildingOfType(s, 'statue')!.level = 10;
  buildingOfType(s, 'watch')!.level = 3;
  // Партия, которой меряют карьеру, — сыгранная: посёлок на 300 душ с гарнизоном и
  // Статуей десятого уровня. Значит и места агентов у неё есть, а ступень им засчитывает
  // та же дверь, что и ступень сохранения (решение владельца 12). Иначе гейт закрыл бы
  // место лазутчика у мерки, и раздел мерил бы деревню, которой не бывает.
  played(s);

  const out: Record<Seat, Career> = { scout: career(), spy: career(), general: career() };
  const top: Record<Seat, number> = { scout: 1, spy: 1, general: 1 };
  const since: Record<Seat, number> = { scout: 0, spy: 0, general: 0 };
  const who: Record<Seat, number> = { scout: s.agents.scout.person, spy: s.agents.spy.person, general: s.agents.general.person };
  const got: Record<Seat, boolean> = { scout: false, spy: false, general: false };
  const rot = { scout: 0, spy: 0 };
  let nextVisit = 0;
  let mustered = false;

  await pilot({
    g: s,
    // Срок прогона автопилот берёт игровым временем; сутки службы — настоящие.
    seconds: gameSeconds(AGENTS_DAYS * 24 * 3600),
    player: player(null, {
      build: false,
      sortie: false,
      also: (g) => {
        g.gold = 1e9;
        if (yearSeconds === null) return;
        for (const id of ['scout', 'spy', 'general', 'diplomat'] as FigureId[]) {
          const p = g.agents[id];
          p.age0 = AGENT_AGE0 + (g.time - p.bornAt) * ((Number.isFinite(yearSeconds) ? 1 / yearSeconds : 0) - 1 / AGENT_YEAR);
        }
      },
    }),
    world: { seed, pulse: AGENTS_STEP, raids: false, reveal: true },
    economy: 'live',
    tick: AGENTS_STEP,
    decide: AGENTS_STEP,
    watch: {
      landed: (e, g) => {
        const gone = e.fell ?? e.retired;
        if (!gone || gone.agent === 'diplomat') return;
        const id = gone.agent as Seat;
        if (who[id] !== gone.person) return;
        if (e.fell) out[id].deaths++;
        else out[id].retired++;
        out[id].tops.push(top[id]);
        top[id] = 1;
        void g;
      },
      after: async ({ g, world, now, figures }) => {
        const w: Inside = world;
        for (const id of SEATS) {
          // Уровень считается только у человека на месте: опыт погибшего лежит на пустом месте до
          // найма, и приписать его преемнику значило бы завысить уровни.
          if (g.agents[id].vacant) continue;
          if (g.agents[id].person !== who[id]) {
            who[id] = g.agents[id].person;
            since[id] = now;
            got[id] = false;
            top[id] = 1;
          }
          const level = levelOf(g.agents[id].xp);
          top[id] = Math.max(top[id], level);
          if (!got[id] && level >= MAX_AGENT_LEVEL) {
            got[id] = true;
            out[id].toTop.push((now - since[id]) / HOUR);
          }
        }
        if (!mustered) {
          mustered = true;
          await w.setGarrison(GARRISON);
        }
        if (now < nextVisit) return;
        nextVisit = now + VISIT * MIN;
        for (const id of SEATS) if (g.agents[id].vacant && !g.agents[id].hiring) hireAgent(g, id);

        const at = START + now;
        const live = liveLairs(w, at);
        if (live.length === 0) return;
        const home = saveOf(w).home;
        const fig = (id: FigureId): FigureView => figures.find((f) => f.id === id)!;

        // Полководец жжёт ближайшее логово — мир живёт, как в партии.
        const gen = fig('general');
        let genTarget: string | null = null;
        if (gen.place === 'map' && gen.phase !== 'moving' && gen.readyAt <= at) {
          if (gen.atHome && Object.values(gen.troops).every((k) => !k)) {
            await w.setGarrison(GARRISON);
          } else {
            const here = gen.atId ? live.find((l) => l.id === gen.atId) : undefined;
            if (here) {
              if (!(await w.attack({ setup: null })).error) out.general.deeds++;
            } else {
              const t = [...live].sort((a, b) => distance(a, gen.at) - distance(b, gen.at))[0];
              genTarget = t.id;
              await w.moveFigure('general', { x: t.x, y: t.y });
            }
          }
        }
        // Разведчик и лазутчик ходят к логовам, которых полководец не жжёт: иначе цель сгорает раньше дела.
        const others = live.filter((l) => l.id !== genTarget && l.id !== gen.atId);
        if (others.length === 0) return;

        const sc = fig('scout');
        if (sc.place === 'map' && sc.phase !== 'moving' && !sc.held) {
          let target = others[rot.scout++ % others.length];
          if (style === 'careful') {
            const plans: { l: (typeof others)[number]; peril: number }[] = [];
            for (const l of others) plans.push({ l, peril: (await w.leadPlan('scout', { x: l.x, y: l.y })).peril });
            plans.sort((a, b) => a.peril - b.peril || distance(a.l, home) - distance(b.l, home));
            target = plans[0].l;
          }
          const plan = await w.leadPlan('scout', { x: target.x, y: target.y });
          if (!(await w.moveFigure('scout', { x: target.x, y: target.y }, plan.at))) out.scout.deeds++;
        }

        const sp = fig('spy');
        if (sp.place === 'map' && sp.phase !== 'moving' && sp.busyUntil <= at) {
          const here = sp.atId ? others.find((l) => l.id === sp.atId) : undefined;
          if (here) {
            const opt = (await w.orders('spy', here.id)).find((o: Inside) => o.id === 'probe');
            // Осторожный ждёт, пока гибель не опустится до четырёх процентов (ночь, осень), и уходит
            // оттуда, где бывал дважды; неосторожный делает дело всегда.
            const seen = (saveOf(w).visited?.[here.id] ?? []).filter((x) => at - x < 3 * HOUR).length;
            const safe = style === 'careless' || ((opt?.peril ?? 1) <= 0.04 && seen < 2);
            if (opt?.can && safe) {
              if (!(await w.order('probe', here.id, opt.at)).error) out.spy.deeds++;
            } else if (style === 'careful' && seen >= 2) {
              const next = others.filter((l) => l.id !== here.id)[rot.spy++ % Math.max(1, others.length - 1)];
              if (next) await w.moveFigure('spy', { x: next.x, y: next.y });
            }
          } else {
            const next = others[rot.spy++ % others.length];
            await w.moveFigure('spy', { x: next.x, y: next.y });
          }
        }
      },
    },
  });
  for (const id of SEATS) if (!s.agents[id].vacant) out[id].tops.push(top[id]);
  return out;
}

async function agentsTable(yearSeconds: number | null): Promise<Record<Style, Record<Seat, Career>>> {
  const sum = { careful: { scout: career(), spy: career(), general: career() }, careless: { scout: career(), spy: career(), general: career() } };
  for (const style of ['careful', 'careless'] as const) {
    for (const seed of AGENTS_SEEDS) {
      const one = await agentsRun(seed, style, yearSeconds);
      for (const id of SEATS) {
        const a = sum[style][id];
        const b = one[id];
        a.toTop.push(...b.toTop);
        a.tops.push(...b.tops);
        a.deeds += b.deeds;
        a.deaths += b.deaths;
        a.retired += b.retired;
      }
    }
  }
  return sum;
}

const STYLE_NAME: Record<Style, string> = { careful: 'осторожный', careless: 'неосторожный' };
const SEAT_NAME: Record<Seat, string> = { scout: 'разведчик', spy: 'лазутчик', general: 'полководец' };

function printCareers(sum: Record<Style, Record<Seat, Career>>): void {
  console.log('  игрок        | агент      | дел/сут | гибелей | покоев | людей по уровню 1·2·3·4·5 | часы службы до 5-го уровня');
  for (const style of ['careful', 'careless'] as const) {
    for (const id of SEATS) {
      const c = sum[style][id];
      const hist = [1, 2, 3, 4, 5].map((lv) => c.tops.filter((x) => x === lv).length).join('·');
      const hours = c.toTop.length ? c.toTop.map((h) => h.toFixed(0)).sort((a, b) => Number(a) - Number(b)).join(', ') : '—';
      console.log(
        `  ${STYLE_NAME[style].padEnd(12)} | ${SEAT_NAME[id].padEnd(10)} | ${pad(n1(c.deeds / AGENTS_SEEDS.length / AGENTS_DAYS), 7)} | ${pad(c.deaths, 7)} | ${pad(c.retired, 6)} | ${hist.padStart(25)} | ${hours}`,
      );
    }
  }
}

async function agentsSection(): Promise<void> {
  const service = RETIRE_AGE - AGENT_AGE0;
  console.log('=== 2. СЛУЖБА АГЕНТА ===');
  console.log(`Мир → последствия → партия настоящим пульсом, миры ${AGENTS_SEEDS.join(', ')}, ${AGENTS_DAYS} суток на мир, заход раз в ${VISIT / 60} ч,`);
  console.log(`шаг прогона ${AGENTS_STEP} с. Статуя 10, Дозор 3, дружина ${Object.values(GARRISON).reduce((a, b) => a + b, 0)}; пустое место нанимается на первом же заходе. Полководец жжёт`);
  console.log('ближайшее логово, разведчик ходит к логовам по кругу, лазутчик выведывает у логова, где стоит.');
  console.log('Осторожный выбирает разведчику цель с наименьшей гибелью, лазутчика пускает при гибели ≤ 4 % и уводит');
  console.log('оттуда, где бывали дважды; неосторожный делает дело всегда. Часы — настоящие: дела идут по часам мира.');
  console.log('');
  console.log(`Год игры сегодня — ${YEAR_DAYS} игровых дней (${AGENT_YEAR / 60} мин), служба — ${service} лет (${n1((service * AGENT_YEAR) / 3600)} ч).`);
  console.log('');
  console.log('Без покоя (год бесконечный) — сколько часов службы стоит пятый уровень:');
  const free = await agentsTable(Infinity);
  printCareers(free);
  console.log('');
  for (const style of ['careful', 'careless'] as const) {
    const all = SEATS.flatMap((id) => free[style][id].toTop);
    if (all.length === 0) {
      console.log(`  ${STYLE_NAME[style]}: пятого уровня не взял никто за ${AGENTS_DAYS} суток — год не выводится.`);
      continue;
    }
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    console.log(
      `  ${STYLE_NAME[style]}: пятый уровень за ${lo.toFixed(0)}…${hi.toFixed(0)} ч службы → год не короче ${n1(hi / service)} ч, чтобы дойти к старости; ` +
        `пожить на пятом половину службы — ${n1((2 * hi) / service)} ч.`,
    );
    console.log(
      `    в игровых днях при году в ${YEAR_DAYS} дней: день ${n1((hi / service / YEAR_DAYS) * 60)}…${n1(((2 * hi) / service / YEAR_DAYS) * 60)} мин — шкала ×${Math.round((hi / service / YEAR_DAYS) * 3600 / DAY_LENGTH)}…×${Math.round(((2 * hi) / service / YEAR_DAYS) * 3600 / DAY_LENGTH)}.`,
    );
  }
  console.log('');
  if (process.env.YEARS) {
    console.log('При годе игры (покой в 60) — что выходит сегодня:');
    printCareers(await agentsTable(null));
    console.log('');
    for (const hours of [5.5, 13]) {
      console.log(`Проверка прогоном: год ${hours} ч.`);
      printCareers(await agentsTable(hours * 3600));
      console.log('');
    }
  } else {
    console.log('Год игры как есть и проверка выведенного года прогоном (5.5 и 13 ч) — YEARS=1 npm run time:report: втрое дороже.');
    console.log('');
  }
}

// ---------- 3. Цена живого прогона ----------

const perHour = (ms: number, hours: number): string => measure((ms / hours / 1000).toFixed(2));

async function costSection(towns: GameState[]): Promise<void> {
  console.log('=== 3. ЦЕНА ЖИВОГО ПРОГОНА ===');
  console.log('Секунд машины на час прогона, порознь: шаг племени (tick 1 с), решения игрока (раз в 15 с), пульс мира.');
  console.log('Прогон — 1 ч, мир с набегами и дозревшими логовами, игрок нанимает по средствам; посёлок — этап из раздела 1.');
  console.log('Числа машины — замер, в сверку не входят; сравнивается форма таблицы.');
  console.log('  посёлок          | пульс, с | пульсов | шаг племени | решения | пульс мира | доля пульса');
  const rows: { name: string; pulse: number; cost: Cost }[] = [];
  for (const [i, pulse] of [
    [0, 15],
    [4, 15],
    [4, 2],
    [4, 60],
    [4, 450],
  ] as const) {
    const g = clone(towns[i]);
    setRandom(seeded(1));
    const flown = await pilot({
      g,
      seconds: 3600,
      player: player('means', { tax: 'high' }),
      world: { seed: WORLD, pulse, raids: true, ripe: true },
      economy: 'live',
      tick: 1,
      decide: 15,
    });
    rows.push({ name: STAGES[i][0], pulse, cost: flown.cost });
  }
  for (const r of rows) {
    const c = r.cost;
    const all = c.tick + c.decide + c.pulse;
    console.log(
      `  ${r.name.padEnd(16)} | ${pad(r.pulse, 8)} | ${pad(c.pulses, 7)} | ${perHour(c.tick, 1).padStart(11)} | ${perHour(c.decide, 1).padStart(7)} | ${perHour(c.pulse, 1).padStart(10)} | ${measure(`${Math.round((c.pulse / all) * 100)} %`).padStart(11)}`,
    );
  }
  const base = rows[1].cost;
  const perPulse = base.pulse / base.pulses;
  const perTick = base.tick / base.ticks;
  const perDecide = base.decide / (base.ticks / 15);
  console.log('');
  console.log(`  Один пульс мира стоит ${measure(perPulse.toFixed(3))} мс, один шаг племени — ${measure(perTick.toFixed(3))} мс, одно решение — ${measure(perDecide.toFixed(3))} мс (потолок уровней, пульс 15 с).`);
  // Прогон после поворота: тот же счёт игровых дней — значит, столько же шагов племени и решений,
  // а настоящих секунд мира в N раз больше. Пульс раз в 15 настоящих секунд — в N раз больше пульсов.
  const today = base.tick + base.decide + base.pulse;
  const factor = (pulseSeconds: number): string => measure(((base.tick + base.decide + perPulse * ((3600 * SCALE_NEXT) / pulseSeconds)) / today).toFixed(1));
  console.log(`  Тот же прогон в игровых днях при ×${SCALE_NEXT} (шагов племени и решений столько же, настоящих секунд мира в ${SCALE_NEXT} раз больше):`);
  console.log(`  пульс раз в 15 настоящих секунд — в ${factor(15)} раза дороже, раз в 60 — в ${factor(60)}, раз в 120 — в ${factor(120)};`);
  console.log(`  пульс раз в 15 игровых секунд (${(15 * SCALE_NEXT) / 60} настоящих минут) — в ${factor(15 * SCALE_NEXT)}, но мир между пульсами слеп на ${(15 * SCALE_NEXT) / 60} мин.`);
  console.log('');
}

// ---------- 4. Вернувшийся ----------

/** Отлучки, настоящих часов. Потолок догона — сутки: двое суток догоняются как одни. */
const RETURNS = [8, 24, 48];
const T_LEAVE = START;

/**
 * Что находит игрок, вернувшись через 8, 24 и 48 настоящих часов — **при шкале, принятой условно**
 * (×30): это единственное место в `scripts/`, где шкала подменяется, и затем отчёт и заведён —
 * померить игру после поворота до поворота. Считает настоящая дверь отлучки (`sim/tick.absence`):
 * догон под потолком, терпение и уход войска, ропот, вести. Величины мира в замере не участвуют.
 */
function returnSection(towns: GameState[]): void {
  console.log('=== 4. ВЕРНУВШИЙСЯ: 8, 24 И 48 ЧАСОВ ОТЛУЧКИ ПРИ ШКАЛЕ ×' + SCALE_NEXT + ' ===');
  setTimeScale(SCALE_NEXT);
  try {
    console.log(`Дверь отлучки как в игре (\`sim/tick.absence\`), шкала ×${SCALE_NEXT}: игровой день — ${dayRealSeconds() / 60} мин, потолок догона —`);
    console.log(`${MAX_OFFLINE_DAYS} игровых дней (${n1((MAX_OFFLINE_DAYS * dayRealSeconds()) / 3600)} ч). Посёлок — этап из раздела 1, войско мерки, склад потрачен перед уходом (всё, кроме еды).`);
    console.log('Три игрока: «казна этапа» — золото автопилота, налог партии; «пустая казна» — золота нет, налог умеренный,');
    console.log('жалованье выше дохода; «с невольниками» — то же и невольников четыре десятых от жителей (без места).');
    console.log('«войско» — осталось из скольких; «долг» — золота; «склад» — припасов из семи у потолка; «порядок» — число и');
    console.log('ждёт ли мятеж на столе; «почта» — вестей на столе · решилось молчанием; «агент» — на сколько лет постарел полководец.');
    console.log('  этап             | игрок           | отлучка | войско        |  долг | склад | порядок        | почта | агент');
    for (const i of [2, 4]) {
      for (const who of ['казна этапа', 'пустая казна', 'с невольниками'] as const) {
        for (const hours of RETURNS) {
          const s = clone(towns[i]);
          const level = s.buildings.reduce((a, b) => a + b.level, 0) / s.buildings.length;
          for (const [id, k] of Object.entries(stackOf(armyAt(Math.max(1, Math.round(level)))))) s.army[id as keyof typeof s.army] = k ?? 0;
          for (const r of RESOURCE_IDS) if (r !== 'food') s.resources[r] = 0;
          if (who !== 'казна этапа') {
            s.gold = 0;
            s.tax = 'moderate';
          }
          if (who === 'с невольниками') s.bonded = Math.round(s.pop * 0.4);
          s.inbox = [];
          const army0 = armySize(s);
          const age0 = ageOf(s, 'general');
          const silent0 = s.log.filter((e) => e.text.includes(SILENCE_PREFIX)).length;
          gone(s, T_LEAVE, T_LEAVE + hours * HOUR);
          const cap = storageCap(s);
          const capped = RESOURCE_IDS.filter((r) => s.resources[r] >= cap - 1e-6).length;
          const silent = s.log.filter((e) => e.text.includes(SILENCE_PREFIX)).length - silent0;
          const mutiny = s.inbox.some((e) => e.defId === MUTINY_EVENT);
          const mail = s.inbox.filter((e) => e.defId !== MUTINY_EVENT).length;
          console.log(
            `  ${STAGES[i][0].padEnd(16)} | ${who.padEnd(15)} | ${pad(hours, 5)} ч | ${`${armySize(s)} из ${army0}`.padStart(13)} | ${pad(Math.round(s.pay.debt), 5)} | ${pad(capped, 5)} | ${`${Math.round(orderValue(s))}${mutiny ? ', мятеж ждёт' : ''}`.padEnd(14)} | ${`${mail} · ${silent}`.padStart(5)} | ${pad(n1(ageOf(s, 'general') - age0), 5)}`,
          );
        }
      }
    }
    console.log('');
  } finally {
    setTimeScale();
  }
}

/**
 * Алмаз — доля настоящих суток, а не игровые секунды (решение владельца, docs/time.md, раздел 16).
 * Раздел печатает вывод доли и цены достройки при обеих шкалах — и рядом то, что было бы, останься
 * алмаз десятью игровыми секундами: столько же алмазов, в тридцать раз больше снятого ожидания.
 */
function gemSection(): void {
  console.log('');
  console.log('=== 5. АЛМАЗ: ДОЛЯ НАСТОЯЩИХ СУТОК ===');
  console.log(`Один алмаз снимает ${GEM_REAL_SECONDS} с настоящего нормативного ожидания — долю 1/${Math.round(1 / GEM_DAY_SHARE)} настоящих суток (GEM_DAY_SHARE). Доля выведена из`);
  console.log('прежней цены: десять секунд при дне в минуту — десять настоящих секунд из 86 400. Норматив — труд улучшения на GEM_REF_RATE, как у цены.');
  console.log(`«алмазов» — цена достройки целого улучшения (rushPrice); «ждать» — нормативное ожидание настоящим временем; «было бы» — цена, останься алмаз`);
  console.log(`десятью игровыми секундами: при ×${SCALE_NEXT} те же алмазы снимали бы в ${SCALE_NEXT} раз больше ожидания. Тестовый запас новой партии — ${TEST_GEMS} алмазов.`);
  console.log('  улучшение              | шкала 1: алмазов · ждать | ×' + SCALE_NEXT + ': алмазов · ждать     | было бы при ×' + SCALE_NEXT + ': алмазов · с ожидания на алмаз');
  const base = createInitialState();
  const rows: [string, number][] = [
    ['Жилища 1→2', 1],
    ['Рынок 1→2', 1],
    ['Жилища 5→6', 5],
    ['Рынок 9→10', 9],
  ];
  let whole = { one: 0, slow: 0 };
  for (const [name, level] of rows) {
    const b = structuredClone(base.buildings.find((x) => x.type === (name.startsWith('Рынок') ? 'market' : 'houses'))!);
    b.level = level;
    const norm = rushWork(b) / GEM_REF_RATE;
    const one = rushPrice(b);
    setTimeScale(SCALE_NEXT);
    const slow = rushPrice(b);
    setTimeScale();
    const old = Math.max(1, Math.ceil(norm / 10));
    console.log(
      `  ${name.padEnd(22)} | ${pad(one, 8)} · ${realSpan(norm).padStart(12)} | ${pad(slow, 8)} · ${realSpan(norm * SCALE_NEXT).padStart(12)} | ${pad(old, 8)} · ${pad(n1((norm * SCALE_NEXT) / old), 6)}`,
    );
  }
  // Вся лестница уровней всех построек: сколько алмазов стоит достроить партию целиком.
  for (const b0 of base.buildings) {
    const max = Math.min(BUILDING_BY_ID[b0.type].maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
    for (let level = 1; level < max; level++) {
      const b = structuredClone(b0);
      b.level = level;
      whole.one += rushPrice(b);
      setTimeScale(SCALE_NEXT);
      whole.slow += rushPrice(b);
      setTimeScale();
    }
  }
  console.log(`  все уровни всех построек: ${whole.one} алмазов при шкале 1 и ${whole.slow} при ×${SCALE_NEXT} (×${n1(whole.slow / whole.one)}); тестовый запас — ${n1((TEST_GEMS / whole.one) * 100)} % и ${n1((TEST_GEMS / whole.slow) * 100)} % этого пути,`);
  console.log(`  и те же ${realSpan(TEST_GEMS * GEM_REAL_SECONDS)} настоящего ожидания при любой шкале.`);

  // Из чего выведен тестовый запас: он существует затем, чтобы трату можно было проверить, — а
  // проверить её нельзя, не достроив ни одного улучшения целиком. Мерка поэтому серединная, а не
  // самая дешёвая: дешевле всех Костёр, у которого труда почти нет, и сорока алмазов хватало
  // ровно на него одного. Цена в алмазах от шкалы не зависит (алмаз — доля настоящих суток).
  const first = base.buildings
    .map((b0) => ({ name: BUILDING_BY_ID[b0.type].name, price: rushPrice({ ...structuredClone(b0), level: 1 }) }))
    .sort((a, b) => a.price - b.price);
  const mid = first[Math.floor(first.length / 2)];
  const reach = first.filter((r) => r.price <= TEST_GEMS).length;
  console.log(
    `  достройка 1→2 новой партии: дешевле всех ${first[0].name} — ${first[0].price}, середина ${mid.name} — ${mid.price}, ` +
      `дороже всех ${first[first.length - 1].name} — ${first[first.length - 1].price} алмазов.`,
  );
  console.log(
    `  тестовый запас ${TEST_GEMS} берёт ${reach} из ${first.length} первых улучшений; мерка запаса — серединное (${mid.price}): ` +
      `${TEST_GEMS >= mid.price ? 'хватает' : 'НЕ ХВАТАЕТ'}. Цена в алмазах от шкалы не зависит — алмаз есть доля настоящих суток.`,
  );
}

/**
 * Раздел 6: очки правителя, потолок, цена уровня, военная лестница. Прибор шага 4
 * (docs/dynasty.md, пачка 0): до него все эти числа жили в документе расчётом, а правило 12
 * требует закоммиченной команды.
 *
 * Своих чисел у раздела нет ни одного — всё считает `game/data/realm.ts`, а он выводит их из
 * `MAX_OFFLINE_DAYS`, верха агентской лестницы, работы вещей кузницы и снаряжения видов. Раздел
 * поэтому чистая арифметика: ни прогона, ни машинного времени, ни `measure()` — весь его вывод
 * обязан совпадать буква в букву, пока не тронут одно из этих четырёх мест.
 */
function realmSection(): void {
  console.log('=== 6. ДЕРЖАВА: ОЧКИ ПРАВИТЕЛЯ И ЦЕНА УРОВНЯ ===');
  const perHour = gameDaysPerHour();
  console.log(
    `Приток: ${POINTS_PER_SKILL_PER_DAY} очко в игровой день на кружок навыка; навык ${MIN_RULER_SKILL}…${MAX_RULER_SKILL}, ` +
      `средний правитель ${MEAN_RULER_SKILL}. Игровой день — ${n1(dayRealSeconds() / 60)} настоящей минуты,`,
  );
  console.log(`настоящий час — ${n1(perHour)} игровых дня, то есть средний правитель даёт ${pointsPerDay(MEAN_RULER_SKILL) * perHour} очков в настоящий час.`);
  console.log(
    `Потолок: MAX_OFFLINE_DAYS (${MAX_OFFLINE_DAYS}) × верхний навык (${MAX_RULER_SKILL}) = ${POINTS_CAP} очков на вид — ` +
      'полная отлучка самого сильного правителя. Нового числа нет.',
  );

  // ----- отлучка против потолка -----
  const skills = [MIN_RULER_SKILL, MEAN_RULER_SKILL, MAX_RULER_SKILL];
  const gaps: [string, number][] = [
    ['ночь, 8 ч', 8],
    ['день, 12 ч', 12],
    ['сутки, 24 ч', 24],
    ['двое суток, 48 ч', 48],
    ['неделя, 168 ч', 168],
  ];
  console.log('\n  ОТЛУЧКА ПРОТИВ ПОТОЛОКА: сгорает ли что-нибудь');
  console.log(`  промежуток       | игр. дн. | ${skills.map((k) => `навык ${k}`).join(' | ')} | что режет`);
  let nightBurns = false;
  let dayBurns = false;
  for (const [name, hours] of gaps) {
    const days = hours * perHour;
    // Догон офлайна зажимает `s.time` (`sim/tick.awayGameSeconds`), поэтому за одну отлучку
    // притока больше, чем за `MAX_OFFLINE_DAYS`, не бывает и без потолка очков.
    const paid = Math.min(days, MAX_OFFLINE_DAYS);
    const cells = skills.map((k) => {
      const got = Math.min(POINTS_CAP, paid * pointsPerDay(k));
      const full = days * pointsPerDay(k);
      if (got < full) {
        if (hours === 8) nightBurns = true;
        if (hours === 24) dayBurns = true;
      }
      return pad(`${got} (${Math.round((got / POINTS_CAP) * 100)} %)`, 9);
    });
    const cut = paid < days ? `догон режет до ${MAX_OFFLINE_DAYS} дн.` : 'ничего';
    console.log(`  ${name.padEnd(16)} | ${pad(n1(days), 8)} | ${cells.join(' | ')} | ${cut}`);
  }
  console.log(`  Ночь не сжигает ни очка ни у одного правителя: ${nightBurns ? 'НЕТ' : 'да'}`);
  console.log(`  Сутки отлучки не сжигают ни очка ни у одного правителя: ${dayBurns ? 'НЕТ' : 'да'}`);
  const week = 168 * perHour * pointsPerDay(MEAN_RULER_SKILL);
  console.log(
    `  Неделя отлучки приносит среднему правителю ${week} очков, доезжает ${POINTS_CAP} — ${Math.round((POINTS_CAP / week) * 100)} %: мешка технологий нет.`,
  );

  // ----- цена уровня -----
  console.log(`\n  ЦЕНА УРОВНЯ: P(L) = ${POINTS_CAP} × (L−1)/(N−1), первый уровень — состояние новой партии и бесплатен`);
  console.log('  ветвь            | N | цены уровней 2…N                     | ветвь | старт | при навыке 3');
  let dearest = 0;
  for (const b of REALM_BRANCHES) {
    const n = levelsOf(b);
    const prices: number[] = [];
    for (let l = 2; l <= n; l++) prices.push(levelPrice(b, l));
    dearest = Math.max(dearest, ...prices);
    const whole = branchPrice(b);
    const days = whole / pointsPerDay(MEAN_RULER_SKILL);
    console.log(
      `  ${BRANCH_NAME[b].padEnd(16)} | ${pad(n, 1)} | ${prices.join(' ').padEnd(36)} | ${pad(whole, 5)} | ${pad(startingPoints(b), 5)} | ` +
        `${pad(n1(days), 5)} игр. дн. = ${n1(days / perHour)} ч`,
    );
  }
  console.log(`  Ни один уровень не дороже потолка: ${dearest <= POINTS_CAP ? 'да' : 'НЕТ'} (дороже всех ${dearest} из ${POINTS_CAP})`);
  console.log('  Дуга посёлка, с которой это сравнивают, — `npm run pop:report`, строка «Все здания на потолке».');

  // ----- военная лестница -----
  console.log('\n  ВОЕННАЯ ЛЕСТНИЦА: выведена из работы вещей кузницы и снаряжения видов');
  console.log('  ур | цена | вещь     | работа | открывает                 | род ядра и ступень     | новое в бою');
  const pairOf = (t: TroopId): string => `${KIND_OF[t]}-${gearOfTroop(t)}`;
  const seen = new Set<string>();
  const riders: string[] = [];
  let emptyLevels = 0;
  for (let l = 1; l <= WAR_LEVELS; l++) {
    const item = l >= 2 && l - 2 < WAR_GEAR_ORDER.length ? WAR_GEAR_ORDER[l - 2] : null;
    const here = TROOPS.filter((t) => warLevelOfTroop(t.id) === l);
    const pairs = here.map((t) => pairOf(t.id));
    const fresh = pairs.filter((p) => !seen.has(p));
    for (const p of pairs) seen.add(p);
    for (const t of here) if (!fresh.includes(pairOf(t.id))) riders.push(`${t.name.toLowerCase()} (ур. ${l})`);
    const opens = l === WAR_CAPTIVES_LEVEL ? 'участь «увести людей»' : here.map((t) => t.name.toLowerCase()).join(', ');
    const news = l === WAR_CAPTIVES_LEVEL ? 'участь' : fresh.length > 0 ? 'да' : 'НЕТ';
    if (news === 'НЕТ') emptyLevels++;
    console.log(
      `  ${pad(l, 2)} | ${pad(levelPrice('war', l), 4)} | ${(item ? EQUIPMENT_BY_ID[item].name : '—').padEnd(8)} | ${pad(item ? EQUIPMENT_BY_ID[item].work : '—', 6)} | ` +
        `${opens.padEnd(25)} | ${(l === WAR_CAPTIVES_LEVEL ? '—' : [...new Set(pairs)].join(', ')).padEnd(22)} | ${news}`,
    );
  }
  console.log(`  Уровней, открывающих только то, что в бою уже есть: ${emptyLevels}`);
  console.log(`  Виды-попутчики (тот же род и ступень открыты раньше): ${riders.length > 0 ? riders.join(', ') : 'нет'}`);
  console.log(`  Родов открыто по уровням: ${Array.from({ length: WAR_LEVELS }, (_, i) => new Set(TROOPS.filter((t) => warLevelOfTroop(t.id) <= i + 1).map((t) => KIND_OF[t.id])).size).join(' ')}`);
  console.log(
    `  Доспех — на уровне ${warLevelOfGear('armor')}, и он же открывает латную конницу: ` +
      'уровень конюшни для этого больше не нужен (решение 3, docs/stable.md 8.7 отменено).',
  );

  // ----- сроки при среднем правителе -----
  console.log(`\n  КОГДА НАКОПИТСЯ, ПРИ СРЕДНЕМ ПРАВИТЕЛЕ (навык ${MEAN_RULER_SKILL}): настоящих часов от начала партии, накопительно`);
  for (const b of REALM_BRANCHES) {
    const row: string[] = [];
    let cum = 0;
    for (let l = 2; l <= levelsOf(b); l++) {
      cum += levelPrice(b, l);
      row.push(`ур${l} ${n1(cum / pointsPerDay(MEAN_RULER_SKILL) / perHour)}ч`);
    }
    console.log(`  ${BRANCH_NAME[b].padEnd(16)} | ${row.join(' · ')}`);
  }
  console.log(`  Места наёмных мастеров по уровням административной ветви: ${Array.from({ length: ADMIN_LEVELS }, (_, i) => mastersAt(i + 1)).join(' ')}`);
  console.log(`  Ступеней: военная ${WAR_LEVELS}, административная ${ADMIN_LEVELS}, дипломатическая ${DIPLO_LEVELS}; видов бойцов ${TROOPS.length}, вещей кузницы ${WAR_GEAR_ORDER.length}.`);
  console.log(`  Самый дорогой вид — ${TROOP_BY_ID.legionary.name.toLowerCase()} — открывается на ${warLevelOfTroop('legionary')} уровне из ${WAR_LEVELS}.`);
  console.log('  Что мастера делают с перекосом войска и посёлка — `npm run pop:report`, раздел «Спор за золото».');
}

async function main(): Promise<void> {
  const towns = await stages();
  if (towns.length !== STAGES.length) throw new Error(`этапов снято ${towns.length} из ${STAGES.length}`);
  // SECTIONS=13 — только названные разделы: для работы над отчётом, приёмкой не является.
  const on = (k: string): boolean => (process.env.SECTIONS ?? '123456').includes(k);
  if (on('1')) fillSection(towns);
  if (on('2')) await agentsSection();
  if (on('3')) await costSection(towns);
  if (on('4')) returnSection(towns);
  if (on('5')) gemSection();
  if (on('6')) realmSection();
}

await main();
process.exit(0);
