// Осада числами: как часто она случается, стоит ли выходить на вылазку и что
// даёт лагерю его готовность.
//
// Отчёт нужен ровно потому, что у осады два числа, которые нельзя выбрать на
// глаз, и оба меняют игру целиком:
//
//  1. **Частота.** Осада случается там, где штурм безнадёжен, — то есть тем
//     чаще, чем крепче деревня. Без ограничителя из этого следует, что
//     развитый игрок видит лагерь вместо набега почти всегда, и вложение в
//     стену наказывается исчезновением набега как события. Раздел «частота»
//     печатает распределение «набег / осада» для слабой, средней и крепкой
//     деревни — и до правки, и после: старое правило («садятся всегда, когда
//     можно») считается на тех же самых пришедших отрядах, поэтому сравнение
//     честное, а не по двум разным прогонам.
//
//  2. **Укрепления лагеря.** Без них вылазка — бесплатная кнопка: лагерь и так
//     слабее обороны, иначе он бы штурмовал, а настоящие осады стоят против
//     гарнизона в семь–сто семьдесят раз больше лагеря. Укрепления сужают
//     проход (`world/works`): раздел «проход» печатает долю побед от пропуска на
//     человека лагеря, раздел «во времени» гоняет настоящий мир и вылазку от
//     минуты постановки лагеря, раздел «частые вылазки» проверяет, не стачивают
//     ли лагерь малыми заходами (от ответа зависит, нужен ли откат).
//
//   npx vite-node scripts/siege-report.ts
import { LocalWorld } from '@/world/local/LocalWorld';
import { resolveField } from '@/world/battle';
import { menOfPower, raidingParty } from '@/world/garrison';
import { campPass, passKinds, sideWorks } from '@/world/works';
import { awayOf, homeOf } from '@/world/muster';
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import { kindsOf, powerOf } from '@/game/battle/price';
import { stackTotal } from '@/battle';
import {
  AI_ATTACK_MAX,
  AI_ATTACK_MIN,
  CAMP_GATE_CLEAR,
  CAMP_WOOD,
  CAMP_WORKS_PASS,
  CAMP_WORKS_RIPE,
  SIEGE_CHANCE,
  SIEGE_COOLDOWN,
  SIEGE_RELIEF_AT,
  SIEGE_ROUT,
  SIEGE_SORTIE_RATIO,
} from '@/world/data/tuning';
import type { PlayerProfile, Report, WorldPulse } from '@/world/types';
import { militiaArchers, militiaMen, playerProfile } from '@/world/bridge';
import { FATE_META } from '@/world/data/fates';
import { createInitialState } from '@/game/state';
import { autoAssign } from '@/game/sim/workers';
import { buildingStat, defense, housingCapacity, productionPerDay, storageCap, hiddenStash, towerSeats, upgradeCost, wageOf } from '@/game/derived';
import { BUILDINGS } from '@/game/data/buildings';
import { RESOURCE_IDS, SIEGE_YIELD } from '@/game/constants';
import type { EngineId, GameState } from '@/game/types';
import { ENGINE_BY_ID } from '@/game/data/engines';
import { archerPerSiege, archerRecruit, crewFor, enginePrice } from './lib/engines';
import { dayRealSeconds, gameDaysOfMs, gameDaysPerHour, realMs, worldDays } from '@/game/pace';
import { PULSE_FLOOR } from './autopilot';

const MIN = 60_000;
const SEEDS = [11, 42, 77, 101, 202, 303];
/**
 * Сколько **игрового** времени крутим на каждой деревне. Восемь часов этот отчёт крутил, пока
 * игровой день был настоящей минутой; после поворота шкалы те же восемь настоящих часов стали
 * шестнадцатью игровыми днями — короче одной паузы между набегами, — и раздел «частота» не
 * дождался ни одного прихода (docs/time.md, раздел 17.2). Горизонт теперь идёт через дверь
 * времени и означает то же, что означал: 480 игровых дней.
 */
const GAME_DAYS = 480;
/**
 * Шаг мира — тоже игровым временем, с полом в настоящую минуту (`PULSE_FLOOR`, как у автопилота):
 * иначе тот же горизонт стоил бы в тридцать раз больше шагов. Десять игровых секунд — пять
 * настоящих минут при ×30, и это грубее пола, поэтому пол ни на что не влияет; он стоит затем,
 * чтобы при шкале 1 шаг остался прежним.
 *
 * `PULSE` — ручка замера, настоящих секунд, и не приёмки: ею проверяют, не меняет ли выводов более
 * редкий пульс мира (docs/time.md, раздел 18.10). Имя то же, что у автопилота.
 */
const STEP_MS = (Number(process.env.PULSE) > 0 ? Number(process.env.PULSE) : Math.max(PULSE_FLOOR, realMs(10) / 1000)) * 1000;
/**
 * Сколько шагов покрывают `days` игровых дней при шаге `STEP_MS`. Ждать осады отчёт ждёт игровым
 * временем: осада приходит из паузы между набегами (`AI_ATTACK_MIN..MAX`, игровые дни), а до
 * поворота шкалы эти ожидания стояли числами настоящих шагов — и после поворота не дожидались
 * ничего (docs/time.md, раздел 18).
 */
const stepsFor = (days: number): number => Math.ceil(worldDays(days) / STEP_MS);
/** Горизонт ожидания осады: столько же игрового времени, сколько отчёт ждал при дне в минуту. */
const WAIT_DAYS = 360;
/**
 * Срок мира в **игровых днях**. Всё, чем меряется осада, объявлено игровым временем —
 * рогатки, остывание, паузы набегов, выручка, проход, — и печатать их настоящими минутами
 * после поворота шкалы значит называть одно число тридцатью разными (docs/time.md, раздел 18).
 */
const gd = (ms: number): number => gameDaysOfMs(ms);

// ---------------------------------------------------------------- частота ---

/**
 * Три деревни: слабая, средняя и крепкая. Разница — в войске дома: осаду решает бой у стены
 * (`LocalWorld.sitsDown`), а число обороны в нём не участвует. Жителей у всех поровну, поэтому и
 * набег из логова у всех один и тот же.
 */
const TOWNS = [
  { name: 'слабая', defense: 60, army: { clubman: 12 } as TroopStack },
  { name: 'средняя', defense: 220, army: { spearman: 20, archer: 10 } as TroopStack },
  { name: 'крепкая', defense: 900, army: { legionary: 40, spearman: 30, archer: 20 } as TroopStack },
];

const profile = (defense: number, army: TroopStack): PlayerProfile => ({
  name: 'Отчёт',
  pop: 400,
  defense,
  units: { warrior: 40, scout: 6 },
  army: { ...army },
  warning: 120,
  stock: { food: 900, wood: 600 },
  stash: 0,
  // Часы голода: полтора часа на пустой гарнизон, меньше — с полным.
  food: 9000,
  foodPerHour: 6000,
  soldierFoodPerHour: 40,
});

interface Counts {
  /** Отрядов дошло до ворот. */
  came: number;
  /** Из них сели лагерем. */
  sieges: number;
  /** Из них **могли бы** сесть — штурм не удался бы (сели лагерем или отбиты), без доли и остывания. */
  couldOld: number;
}

async function frequency(seed: number, defense: number, army: TroopStack): Promise<Counts> {
  let now = 1_700_000_000_000;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  const p = profile(defense, army);
  const out: Counts = { came: 0, sieges: 0, couldOld: 0 };
  const seen = new Set<string>();
  const end = now + worldDays(GAME_DAYS);
  await world.sync(p);
  while (now < end) {
    now += STEP_MS;
    const pulse = await world.sync(p);
    for (const r of pulse.reports as Report[]) {
      if (r.kind !== 'defense' || seen.has(r.id)) continue;
      seen.add(r.id);
      const siege = r.title === 'Город в осаде';
      // Прорвавшийся набег называется по объявленной участи; логова объявляют «ограбить».
      const battle = r.title === 'Нападение отбито' || Object.values(FATE_META).some((m) => m.title === r.title);
      if (!siege && !battle) continue;
      out.came++;
      if (siege) out.sieges++;
      // Могли сесть все, кого отбили бы: и севшие лагерем, и отбитые у стены.
      if (siege || r.title === 'Нападение отбито') out.couldOld++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- вылазка ---

/**
 * Один бой у рогаток — теми же функциями, что строит мир: отряд проходит через
 * пропуск (`passKinds`), лагерь — ровно те, кто в нём стоит (`raidingParty`).
 * Своей арифметики прохода у отчёта нет.
 */
function sortieOnce(seed: number, going: TroopStack, campPower: number, pass: number): boolean {
  const party = raidingParty(seed, `camp${seed}`, campPower);
  const field = resolveField({
    seed,
    // Снаряжение вылазки пришло в бой весом — людьми строя (`price.kindsOf`, путь П2): ступени в бою нет.
    attacker: { kinds: passKinds(kindsOf(going), pass) },
    defender: { kinds: party.kinds },
  });
  return field.won;
}

/**
 * Пропорция вылазки: копья, латники, лучники. Числа — доли, а не головы: в
 * бойцов строя их переводит `kindsOf`, и только после этого отряд сравним с
 * лагерем (мир меряет войско бойцами строя, см. `BATTLE_MAN`).
 */
const MIX: TroopStack = { spearman: 4, legionary: 3, archer: 3 };
const MIX_MEN = stackTotal(kindsOf(MIX));

/** Отряд на вылазку в заданное число бойцов строя. */
const party = (men: number): TroopStack => {
  const k = Math.max(1, Math.round(men / MIX_MEN));
  const out: TroopStack = {};
  for (const [id, n] of Object.entries(MIX) as [keyof TroopStack, number][]) out[id] = n * k;
  return out;
};

/**
 * Мощь лагерей — те, что встречались в игре до роста логов: лагеря под стенами стояли силой 10…22 (5…11 бойцов строя) на
 * любом уровне Статуи. Нынешние лагеря — сотни бойцов строя (раздел «во времени»); сетка меряет правило прохода в малом бою.
 */
const CAMP_POWERS = [10, 16, 22];
/**
 * Пропуск на человека лагеря: бесконечность — рогаток нет. Сетка своя, а не от числа игры: число игры выводится из неё
 * (`CAMP_WORKS_PASS` — первое значение, при котором вылазка ни разу не выигрывает) и отмечено в ней строкой «дозрели».
 */
const PASSES = [...new Set([Infinity, 1.6, 1.25, 1, 0.8, 0.6, 0.4, CAMP_WORKS_PASS])].sort((a, b) => b - a);
const TRIES = 40;

// ------------------------------------------------------------------ печать ---

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/**
 * Клетка кривой по минутам (docs/weights.md, место 2): кривая читается одной — «прошло время», — только пока в каждом
 * столбце тот же набор осад. Осада, у которой окно голода кончилось раньше, и вариант, потерявший осаду до минуты
 * вылазки, из столбца выпадают, и доля в нём — уже про другой набор. Такой столбец помечен «*», а сколько боёв в каждом
 * столбце, печатает строка `boutsRow`.
 */
const curveCell = (won: number, n: number, full: number): string => (n ? `${pct(won, n)}${n < full ? '*' : ''}` : '—').padStart(5);
const boutsRow = (label: string, ns: readonly number[]): string => `  ${label}${ns.map((n) => String(n).padStart(5)).join('')}`;
const CURVE_NOTE = '«*» — в столбце не весь набор (окно голода кончилось раньше или вариант потерял осаду): доля про другой набор; строка «боёв» — сколько боёв в столбце';

console.log('=== Осада числами ===');
console.log(
  `порог осады: штурм не удался бы (сухой прогон боя у стены) · доля попыток (SIEGE_CHANCE): ${SIEGE_CHANCE} · ` +
    `остывание (SIEGE_COOLDOWN): ${gd(SIEGE_COOLDOWN)} игр. дн.`,
);
console.log(`пауза между набегами ИИ: ${gd(AI_ATTACK_MIN)}…${gd(AI_ATTACK_MAX)} игр. дн.`);

console.log('');
console.log(`--- частота: набег или осада (${GAME_DAYS} игровых дней на деревню, ${SEEDS.length} сидов) ---`);
console.log('«могли» — штурм не удался бы (сели лагерем или отбиты у стены); «сели» — с долей и остыванием.');
console.log('деревня   пришло   осад (могли → сели)   доля осад: могли → сели');
let totalCame = 0;
let totalOld = 0;
let totalNew = 0;
for (const town of TOWNS) {
  let came = 0;
  let sieges = 0;
  let old = 0;
  for (const seed of SEEDS) {
    const c = await frequency(seed, town.defense, town.army);
    came += c.came;
    sieges += c.sieges;
    old += c.couldOld;
  }
  totalCame += came;
  totalOld += old;
  totalNew += sieges;
  console.log(
    `${town.name.padEnd(9)} ${String(came).padStart(6)}   ${String(old).padStart(5)} → ${String(
      sieges,
    ).padStart(3)}          ${pct(old, came).padStart(5)} → ${pct(sieges, came)}`,
  );
}
console.log(`всего:    ${totalCame} прихода, осад могло быть ${totalOld} (${pct(totalOld, totalCame)}), село ${totalNew} (${pct(totalNew, totalCame)})`);

console.log('');
console.log(`--- проход через рогатки: доля побед вылазки (дозревшие рогатки — ${CAMP_WORKS_PASS} на человека) ---`);
console.log('пропуск на человека  ' + CAMP_POWERS.map((p) => `лагерь ${p}`.padStart(11)).join(''));
for (const per of PASSES) {
  const cells: string[] = [];
  for (const power of CAMP_POWERS) {
    const men = menOfPower(power);
    // Отряд заведомо больше пропуска — вдесятеро больше лагеря, как у настоящих осад.
    const going = party(men * 10);
    const pass = per === Infinity ? Infinity : Math.max(1, Math.round(men * per));
    let won = 0;
    for (let i = 0; i < TRIES; i++) if (sortieOnce(1000 + i * 7 + power, going, power, pass)) won++;
    cells.push(pct(won, TRIES).padStart(11));
  }
  const mark = per === CAMP_WORKS_PASS ? ' ← дозрели' : per === Infinity ? ' ← рогаток нет' : '';
  console.log(`${(per === Infinity ? '∞' : String(per)).padEnd(20)} ${cells.join('')}${mark}`);
}
console.log('строки — сколько бойцов строя нападающих входит в бой на человека лагеря;');
console.log('столбцы — мощь лагеря; вылазка вдесятеро больше лагеря, лишние стоят у рогаток.');

// ------------------------------------------------ укрепления во времени ---
//
// Настоящий мир и настоящая вылазка (`LocalWorld.sortie`): для каждого уровня
// Статуи мир крутится до первой осады, сохранение замораживается, и дальше для
// каждой задержки мир поднимается из того же сохранения заново. Лагерь, гарнизон
// и еда в каждой пробе одни и те же; меняется только время.

const LEVELS = [1, 5, 10];
const DELAYS = [0, 4, 8, 12, 16, 20, 24, 28, 36, 44, 52, 60];
const TOWN_SEEDS = [11, 42, 77, 101, 202, 303, 404, 505];
const VARIANTS = 3;
const TOWN_MIX: TroopStack = { spearman: 4, archer: 3, legionary: 2, rider: 1 };

/**
 * Мерка войска посёлка этапа: 20 бойцов на первом уровне и по 10 за каждый следующий.
 * Это прежняя вместимость Статуи — правилом игры она больше не является (войско держит
 * цена), но все замеры осады сняты на этих составах, и сравниваются они между
 * прогонами. Правило здесь — мерка отчёта, а не игры.
 */
const armyUnit = (level: number): number => 20 + 10 * (level - 1);

/** Посёлок уровня L: жильё на 90%, склад полон, войско — две мерки. */
function townAt(level: number): GameState {
  const g = createInitialState(7);
  for (const b of g.buildings) b.level = level;
  g.pop = Math.round(housingCapacity(g) * 0.9);
  const n = armyUnit(level) * 2;
  let left = n;
  const ids = Object.keys(TOWN_MIX) as (keyof TroopStack)[];
  ids.forEach((id, i) => {
    const k = i === ids.length - 1 ? left : Math.round((n * (TOWN_MIX[id] ?? 0)) / 10);
    g.army[id] = k;
    left -= k;
  });
  autoAssign(g);
  for (const r of RESOURCE_IDS) g.resources[r] = storageCap(g);
  return g;
}

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

interface Frozen {
  seed: number;
  save: string;
  since: number;
  starvesAt: number;
  campPower: number;
  g: GameState;
}

async function freezeSiege(seed: number, level: number, engine: EngineId | null = null): Promise<Frozen | null> {
  const g = townAt(level);
  // Орудие готово с первой минуты: башня уровня L, расчёт — лучники гарнизона (TOWN_MIX).
  if (engine) g.engine = { id: engine, until: 0 };
  let now = 1_700_000_000_000;
  const store = memory();
  const world = new LocalWorld({ seed, now: () => now, storage: store });
  for (let i = 0; i < stepsFor(WAIT_DAYS); i++) {
    now += STEP_MS;
    const r = await world.sync(playerProfile(g));
    if (!r.siege) continue;
    const save = store.read() as string;
    const parsed = JSON.parse(save);
    const camp = parsed.marches.find((x: { id: string }) => x.id === parsed.sieges.home.campId);
    return { seed, save, since: r.siege.since, starvesAt: r.siege.starvesAt, campPower: camp.power, g };
  }
  return null;
}

/** Поднять замороженный мир на минуте `at`. Сид боя сдвигается номером варианта. */
async function thaw(fz: Frozen, at: number, variant: number) {
  let now = at;
  const save = JSON.parse(fz.save);
  save.nextMarch = (save.nextMarch ?? 0) + variant * 7;
  const world = new LocalWorld({ seed: fz.seed, now: () => now, storage: memory(JSON.stringify(save)) });
  const pulse = await world.sync(playerProfile(fz.g));
  return {
    world,
    pulse,
    garrison: homeOf(fz.g.army, awayOf(pulse.marches, pulse.figures)),
    later: (ms: number): void => {
      now += ms;
    },
    now: (): number => now,
  };
}

/** Часть гарнизона по видам — чтобы в строю было около `men` бойцов строя. */
function sliceOf(g: TroopStack, men: number): TroopStack {
  const f = Math.min(1, men / Math.max(1, stackTotal(kindsOf(g))));
  const out: TroopStack = {};
  let most: keyof TroopStack | null = null;
  for (const [id, n] of Object.entries(g) as [keyof TroopStack, number][]) {
    const k = Math.round((n ?? 0) * f);
    if (k > 0) out[id] = k;
    if ((n ?? 0) > 0 && (most === null || (n ?? 0) > (g[most] ?? 0))) most = id;
  }
  // Отряд меньше одного бойца не выходит: выходит один — самого многочисленного вида.
  if (Object.keys(out).length === 0 && most !== null) out[most] = 1;
  return out;
}

/**
 * Самый малый отряд из гарнизона, который заполняет проход целиком: наборы в
 * пропорции посёлка, пока в строю не станет не меньше пропуска.
 */
function fillPass(g: TroopStack, pass: number): TroopStack {
  for (let k = 1; ; k++) {
    const out: TroopStack = {};
    for (const [id, n] of Object.entries(TOWN_MIX) as [keyof TroopStack, number][]) {
      const take = Math.min(g[id] ?? 0, n * k);
      if (take > 0) out[id] = take;
    }
    if (stackTotal(kindsOf(out)) >= pass || stackTotal(kindsOf(out)) >= stackTotal(kindsOf(g))) return out;
  }
}

console.log('');
console.log(`--- укрепления во времени: вылазка от постановки лагеря (рогатки дозревают за ${gd(CAMP_WORKS_RIPE)} игр. дн.) ---`);
console.log('настоящий мир, LocalWorld.sortie; «весь» — весь гарнизон, «×2» — отряд вдвое больше лагеря');
const frozenByLevel = new Map<number, Frozen[]>();
/** Строка «весь» по уровням — с ней сравниваются орудия башни в настоящем мире. */
const wholeRow = new Map<number, string[]>();
for (const level of LEVELS) {
  const frozen: Frozen[] = [];
  for (const seed of TOWN_SEEDS) {
    const fz = await freezeSiege(seed, level);
    if (fz) frozen.push(fz);
  }
  frozenByLevel.set(level, frozen);
  if (frozen.length === 0) {
    console.log(`Статуя L${level}: осады не случилось`);
    continue;
  }
  const pw = frozen.map((f) => f.campPower);
  const win = frozen.map((f) => gd(f.starvesAt - f.since));
  const gMen = stackTotal(kindsOf(homeOf(frozen[0].g.army, awayOf([], []))));
  console.log(
    `Статуя L${level}: осад ${frozen.length}, лагеря ${Math.min(...pw).toFixed(1)}…${Math.max(...pw).toFixed(1)} мощи ` +
      `(${menOfPower(Math.min(...pw))}…${menOfPower(Math.max(...pw))} бойцов строя), гарнизон ${gMen}, ` +
      `окно голода ${Math.min(...win).toFixed(1)}…${Math.max(...win).toFixed(1)} игр. дн.`,
  );
  console.log('  Δ, игр. дн.' + DELAYS.map((d) => String(d).padStart(5)).join(''));
  const full = frozen.length * VARIANTS;
  for (const kind of ['весь', '×2'] as const) {
    const cells: string[] = [];
    const bouts: number[] = [];
    for (const d of DELAYS) {
      let won = 0;
      let n = 0;
      for (const fz of frozen) {
        const at = fz.since + worldDays(d);
        if (at >= fz.starvesAt) continue;
        for (let v = 0; v < VARIANTS; v++) {
          const t = await thaw(fz, at, v);
          if (!t.pulse.siege) continue;
          const going = kind === 'весь' ? t.garrison : sliceOf(t.garrison, 2 * menOfPower(fz.campPower));
          const res = await t.world.sortie(going);
          if (res.error) throw new Error(res.error);
          n++;
          if (res.won) won++;
        }
      }
      cells.push(curveCell(won, n, full));
      bouts.push(n);
    }
    console.log(`  ${kind.padEnd(6)} ${cells.join('')}`);
    if (kind === 'весь') {
      wholeRow.set(level, cells);
      console.log(boutsRow('боёв   ', bouts));
    }
  }
}
console.log(CURVE_NOTE);

// ------------------------------------------------- удар полководца с тыла ---
//
// У лагеря две стороны: вылазка и выручка лезут со стороны города, полководец из
// поля — с тыла, и проход у каждой свой. Здесь меряется, что это даёт обороняющемуся:
// настоящий мир, полководец с дружиной (вместимость Статуи) стоит в поле в трёх
// клетках от ворот, когда лагерь садится, а гарнизон — две вместимости — в городе.
// Для каждой минуты мир поднимается из того же сохранения, и приказ отдаётся так,
// чтобы полководец пришёл к этой минуте.
//
// Строки: «вылазка» — весь гарнизон со стороны города; «с тыла» — одна дружина;
// «с гарнизоном» — совместный удар, бой один. Сравнивать «с тыла» с «вылазкой» —
// и есть вопрос о поблажке ботам: тыл, закрытый так же, как фронт, делает удар
// полководца таким же безнадёжным, как вылазку.

const FIELD_DELAYS = [0, 4, 8, 12, 16, 20, 24, 28, 36];

async function freezeField(seed: number, level: number): Promise<Frozen | null> {
  const g = townAt(level);
  // Войско — три мерки: одна уходит в дружину, две остаются гарнизоном.
  const cap = armyUnit(level);
  const ids = Object.keys(TOWN_MIX) as (keyof TroopStack)[];
  const split = (n: number): TroopStack => {
    const out: TroopStack = {};
    let left = n;
    ids.forEach((id, i) => {
      const k = i === ids.length - 1 ? left : Math.round((n * (TOWN_MIX[id] ?? 0)) / 10);
      out[id] = k;
      left -= k;
    });
    return out;
  };
  const all = split(cap * 3);
  for (const id of ids) g.army[id] = all[id] ?? 0;
  let now = 1_700_000_000_000;
  const store = memory();
  const world = new LocalWorld({ seed, now: () => now, storage: store });
  await world.sync(playerProfile(g));
  const err = await world.setGarrison(split(cap));
  if (err) throw new Error(err);
  now = Math.max(now, (await world.figures()).find((f) => f.id === 'general')!.readyAt);
  await world.sync(playerProfile(g));
  const info = await world.info();
  const moveErr = await world.moveFigure('general', { x: info.home.x + 3, y: info.home.y + 2 });
  if (moveErr) throw new Error(moveErr);
  now = (await world.figures()).find((f) => f.id === 'general')!.arriveAt;
  await world.sync(playerProfile(g));
  for (let i = 0; i < stepsFor(WAIT_DAYS); i++) {
    now += STEP_MS;
    const r = await world.sync(playerProfile(g));
    if (!r.siege) continue;
    const save = store.read() as string;
    const parsed = JSON.parse(save);
    const camp = parsed.marches.find((x: { id: string }) => x.id === parsed.sieges.home.campId);
    return { seed, save, since: r.siege.since, starvesAt: r.siege.starvesAt, campPower: camp.power, g };
  }
  return null;
}

interface FieldOutcomeRow {
  n: number;
  won: number;
}

/** Чем кончился проваленный совместный удар: что стало с городом. */
interface JointFail {
  runs: number;
  fails: number;
  garrisonWent: number;
  garrisonFell: number;
  townLeft: number;
  townEmpty: number;
  druzhinaHome: number;
  generalDown: number;
}

const woodLine = `древесина лагеря (CAMP_WOOD): фронт ${CAMP_WOOD.front}, тыл ${CAMP_WOOD.rear} стороны за ${gd(CAMP_WORKS_RIPE)} игр. дн.; фронт дозревает к ${gd(CAMP_WORKS_RIPE).toFixed(0)}-му дню, тыл — к ${(gd(CAMP_WORKS_RIPE) * (CAMP_WOOD.rear >= CAMP_WOOD.front ? 1 / CAMP_WOOD.rear : 2 / (CAMP_WOOD.front + CAMP_WOOD.rear))).toFixed(1)}-му`;

console.log('');
console.log('--- стороны лагеря: вылазка со стороны города, удар полководца с тыла (настоящий мир) ---');
console.log(woodLine);
console.log('«приход» — игровой день, в который полководец приходит к лагерю (приказ отдан из поля в трёх клетках); «вылазка» — весь гарнизон в тот же день');
const travels = new Map<Frozen, number>();
// Провал совместного удара — строкой на уровень (docs/weights.md, место 4): гарнизоны уровней разные, и среднее «на
// провал» по трём уровням сразу не значило бы ничего ни на одном.
const jointFails = new Map<number, JointFail>();
for (const level of LEVELS) {
  const jointFail: JointFail = { runs: 0, fails: 0, garrisonWent: 0, garrisonFell: 0, townLeft: 0, townEmpty: 0, druzhinaHome: 0, generalDown: 0 };
  jointFails.set(level, jointFail);
  const frozen: Frozen[] = [];
  for (const seed of TOWN_SEEDS) {
    const fz = await freezeField(seed, level);
    if (fz) frozen.push(fz);
  }
  if (frozen.length === 0) {
    console.log(`Статуя L${level}: осады не случилось`);
    continue;
  }
  const probe = await thaw(frozen[0], frozen[0].since, 0);
  const general = probe.pulse.figures.find((f) => f.id === 'general')!;
  const win = frozen.map((f) => gd(f.starvesAt - f.since));
  console.log(
    `Статуя L${level}: осад ${frozen.length}, дружина ${troopTotal(general.troops)} чел. (${stackTotal(kindsOf(general.troops))} строя), ` +
      `гарнизон ${stackTotal(kindsOf(probe.garrison))} строя, окно голода ${Math.min(...win).toFixed(1)}…${Math.max(...win).toFixed(1)} игр. дн.`,
  );
  console.log('  приход, игр. дн. ' + FIELD_DELAYS.map((d) => String(d).padStart(5)).join(''));
  const rows: Record<'вылазка' | 'с тыла' | 'с гарнизоном', FieldOutcomeRow[]> = { вылазка: [], 'с тыла': [], 'с гарнизоном': [] };
  for (const d of FIELD_DELAYS) {
    const cells = { вылазка: { n: 0, won: 0 }, 'с тыла': { n: 0, won: 0 }, 'с гарнизоном': { n: 0, won: 0 } };
    for (const fz of frozen) {
      const arrive = fz.since + worldDays(d);
      if (arrive >= fz.starvesAt) continue;
      for (let v = 0; v < VARIANTS; v++) {
        // Вылазка — в минуту прихода, тем же сохранением.
        {
          const t = await thaw(fz, arrive, v);
          if (t.pulse.siege) {
            const res = await t.world.sortie(t.garrison);
            if (res.error && !/К рогаткам сейчас не пробиться/.test(res.error)) throw new Error(res.error);
            cells['вылазка'].n++;
            if (res.won) cells['вылазка'].won++;
          }
        }
        for (const joint of [false, true]) {
          // Приказ отдаётся так, чтобы прийти к минуте `arrive`: дорога — из плана.
          let travel = travels.get(fz);
          if (travel === undefined) {
            const look = await thaw(fz, fz.since, 0);
            travel = (await look.world.strikePlan('home', false)).seconds * 1000;
            travels.set(fz, travel);
          }
          const orderAt = Math.max(fz.since, arrive - travel);
          const t = await thaw(fz, orderAt, v);
          if (!t.pulse.siege) continue;
          const garrisonBefore = t.garrison;
          const err = await t.world.strikeCamp('home', joint);
          if (err) throw new Error(`L${level} ${d} мин: ${err}`);
          const g = (await t.world.figures()).find((f) => f.id === 'general')!;
          t.later(g.arriveAt - t.now());
          const after = await t.world.sync(playerProfile(fz.g));
          const rep = (await t.world.reports()).find((r) => r.id.startsWith('camp'));
          const key = joint ? 'с гарнизоном' : 'с тыла';
          if (!rep) {
            // Боя не было: проход занят или осада кончилась до прихода — считается неудачей.
            const miss = after.effects.find((e) => e.id.startsWith('strike-miss'));
            if (!miss) throw new Error(`L${level} ${d} мин: ни боя, ни отказа`);
            cells[key].n++;
            continue;
          }
          cells[key].n++;
          if (rep.won) cells[key].won++;
          if (joint) {
            jointFail.runs++;
            if (!rep.won) {
              jointFail.fails++;
              const eff = after.effects.find((e) => e.id === `${rep.id}-eff`);
              const lost = eff?.lostTroops ?? {};
              const fig = after.figures.find((f) => f.id === 'general')!;
              const druzhinaLost = troopTotal(general.troops) - troopTotal(fig.troops);
              const townFell = troopTotal(lost) - Math.max(0, druzhinaLost);
              // Город после провала — по правилу учёта, на армии после потерь.
              const army = troopsAfter(fz.g.army, lost);
              const townAfter = homeOf(army, awayOf(after.marches, after.figures.map((f) => (f.id === 'general' ? { ...f, phase: 'field' as const } : f))));
              jointFail.garrisonWent += troopTotal(garrisonBefore);
              jointFail.garrisonFell += townFell;
              jointFail.townLeft += troopTotal(townAfter);
              if (troopTotal(townAfter) === 0) jointFail.townEmpty++;
              if (fig.phase === 'home' && troopTotal(fig.troops) > 0) jointFail.druzhinaHome++;
              if (fig.phase === 'down') jointFail.generalDown++;
            }
          }
        }
      }
    }
    for (const k of Object.keys(rows) as (keyof typeof rows)[]) rows[k].push(cells[k]);
  }
  const full = frozen.length * VARIANTS;
  for (const k of Object.keys(rows) as (keyof typeof rows)[]) {
    console.log(`  ${k.padEnd(15)} ${rows[k].map((c) => curveCell(c.won, c.n, full)).join('')}`);
  }
  console.log(boutsRow('боёв            ', rows['с гарнизоном'].map((c) => c.n)));
}
console.log(CURVE_NOTE);
console.log('');
console.log('--- провал совместного удара: что остаётся в городе ---');
for (const [level, jointFail] of jointFails) {
  if (jointFail.runs === 0) continue;
  const per = (x: number): string => (x / Math.max(1, jointFail.fails)).toFixed(1);
  console.log(
    `Статуя L${level}: совместных ударов ${jointFail.runs}, провалов ${jointFail.fails}; на провал: гарнизона вышло ${per(jointFail.garrisonWent)} чел., ` +
      `легло ${per(jointFail.garrisonFell)}, осталось в городе без дружины ${per(jointFail.townLeft)}; ` +
      `город без гарнизона — ${jointFail.townEmpty} раз из ${jointFail.fails}; дружина вернулась домой живой — ${jointFail.druzhinaHome}, полководец выбыл — ${jointFail.generalDown}`,
  );
}
console.log('«осталось в городе без дружины» — гарнизон после боя; уцелевшая дружина, придя домой, встаёт в гарнизон сама.');

// ------------------------------------------------------ частые вылазки ---
//
// Отката у вылазки нет и не будет: проход — поток (`CAMP_GATE_CLEAR`), и
// семнадцать вылазок за минуту проводят к рогаткам столько же, сколько одна.
// Здесь это меряется настоящим миром: одна вылазка всем гарнизоном против череды
// заходов подряд и против волны, разнесённой на десять минут.

console.log('');
console.log('--- частые вылазки: проход — поток, дробление его не обгоняет (настоящий мир, Статуя L10) ---');
console.log(
  `проход освобождается за ${gd(CAMP_GATE_CLEAR)} игр. дн.; «отказ» — к рогаткам сейчас не пробиться, боя не было`,
);
console.log('способ                 Δ, игр.дн  сняли осаду  заходов  отказов  к рогаткам  своих легло  людей в лагере: было → стало');
const SPAM_MAX = 30;
for (const d of [14, gd(CAMP_WORKS_RIPE)]) {
  for (const way of ['одна всем гарнизоном', 'подряд всем', 'подряд по пропуску', 'подряд по одному', 'волна через проход'] as const) {
    let lifted = 0;
    let tries = 0;
    let refused = 0;
    let passed = 0;
    let lost = 0;
    let runs = 0;
    let campBefore = 0;
    let campAfter = 0;
    // Статуя L10: у посёлков мерки 1-го и 5-го уровня жителей меньше порога защиты новичка, логово их
    // не замечает, и осады там не бывает (docs/lair_growth.md).
    for (const fz of frozenByLevel.get(10) ?? []) {
      for (let v = 0; v < VARIANTS; v++) {
        const t = await thaw(fz, fz.since + worldDays(d), v);
        if (!t.pulse.siege) continue;
        runs++;
        campBefore += t.pulse.siege.campMen;
        let menLeft = t.pulse.siege.campMen;
        // Гарнизон дома — за вычетом павших в прежних заходах этого же прогона.
        let home: TroopStack = { ...t.garrison };
        let k = 0;
        let won = false;
        const limit = way === 'одна всем гарнизоном' ? 1 : way === 'волна через проход' ? 2 : SPAM_MAX;
        while (k < limit && !won) {
          const view = (await t.world.sync(playerProfile(fz.g))).siege;
          if (!view) break;
          menLeft = view.campMen;
          const going: TroopStack =
            way === 'подряд по одному'
              ? { spearman: Math.min(1, home.spearman ?? 0) }
              : way === 'подряд по пропуску'
                ? fillPass(home, campPass(view.builders, sideWorks(view.since, t.now(), 'front')))
                : home;
          const res = await t.world.sortie(going);
          k++;
          if (res.error) {
            if (!/К рогаткам сейчас не пробиться/.test(res.error)) throw new Error(res.error);
            refused++;
          } else {
            const rep = (await t.world.reports()).find((r) => r.id === res.reportId);
            lost += rep?.lost.warrior ?? 0;
            passed += rep?.through?.passed ?? 0;
            const eff = (await t.world.sync(playerProfile(fz.g))).effects.find((e) => e.id === `${res.reportId}-eff`);
            home = troopsAfter(home, eff?.lostTroops ?? {});
            won = res.won;
            if (won) menLeft = 0;
          }
          // Подряд — раз в три секунды, рука нажимает не чаще; волна — через целый проход.
          t.later(way === 'волна через проход' ? CAMP_GATE_CLEAR : 3000);
        }
        // Остаток лагеря — после последнего захода, одной меркой у всех строк.
        const last = (await t.world.sync(playerProfile(fz.g))).siege;
        menLeft = won || !last ? 0 : last.campMen;
        tries += k;
        if (won) lifted++;
        campAfter += menLeft;
      }
    }
    const per = (x: number): string => (x / Math.max(1, runs)).toFixed(1);
    console.log(
      `${way.padEnd(25)} ${String(d).padStart(6)}  ${pct(lifted, runs).padStart(11)}  ${per(tries).padStart(7)}  ${per(refused).padStart(7)}  ${per(passed).padStart(10)}  ${String(lost).padStart(11)}  ${per(campBefore)} → ${per(campAfter)}`,
    );
  }
}
console.log(
  `${TOWN_SEEDS.length} осад × ${VARIANTS} сида боя; «подряд» — до снятия осады или ${SPAM_MAX} заходов, по три секунды между ними; «к рогаткам» — бойцов строя в среднем за прогон.`,
);
console.log('«по пропуску» — самый малый отряд, заполняющий проход; «по одному» — один копейщик; «волна» — два захода всем, второй через целый проход.');
console.log('Строки «подряд» обязаны не обгонять «одну всем»: проход пропускает поток, а не порцию на заход.');

// ------------------------------------------------------- осада игроком ---

/**
 * Что бывает, когда в осаду садится игрок. Здесь гоняется настоящий мир целиком:
 * полководец идёт к соседу, обкладывает его и ждёт. Проверяются разом три вещи,
 * которые иначе пришлось бы брать на веру, — что осада вообще ставится, что
 * осаждённый бот выходит на вылазку по порогу сил, и что соседи приходят на
 * выручку.
 */
const RAID_ARMY: TroopStack = { legionary: 30, spearman: 24, archer: 16, rider: 8 };

async function playerSiege(seed: number): Promise<string> {
  let now = 1_700_000_000_000;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  const p = profile(900, RAID_ARMY);
  await world.sync(p);
  const err0 = await world.setGarrison({ ...RAID_ARMY });
  if (err0) return `дружину не собрать: ${err0}`;
  const g0 = (await world.figures()).find((f) => f.id === 'general');
  now = Math.max(now, g0?.readyAt ?? now);
  await world.sync(p);

  const info = await world.info();
  const near = (await world.region({ x: info.home.x - 20, y: info.home.y - 20, w: 40, h: 40 })).settlements
    .filter((s) => !s.mine)
    .sort(
      (a, b) =>
        Math.hypot(a.x - info.home.x, a.y - info.home.y) - Math.hypot(b.x - info.home.x, b.y - info.home.y),
    )[0];
  if (!near) return 'соседей рядом нет';
  const moveErr = await world.moveFigure('general', { x: near.x, y: near.y });
  if (moveErr) return `не дойти: ${moveErr}`;
  const g1 = (await world.figures()).find((f) => f.id === 'general');
  now = Math.max(now, g1?.arriveAt ?? now);
  await world.sync(p);

  const err = await world.besiege();
  if (err) return `осада не встала: ${err}`;

  const seen = new Set<string>();
  const log: string[] = [];
  const start = now;
  const stamp = (): string => `+${gd(now - start).toFixed(0)} игр. дн.`;
  for (let i = 0; i < stepsFor(WAIT_DAYS / 2); i++) {
    now += STEP_MS;
    const pulse = await world.sync(p);
    for (const r of pulse.reports) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (r.title.startsWith('Выручка отбита')) log.push(`выручка отбита ${stamp()}`);
      if (r.title.startsWith('Город взят голодом')) {
        log.push(`город доели голодом ${stamp()}`);
        return log.join(', ');
      }
      if (r.title.startsWith('Лагерь разбит')) {
        log.push(`лагерь сбила выручка ${stamp()}`);
        return log.join(', ');
      }
    }
    const fig = (await world.figures()).find((f) => f.id === 'general');
    if (!fig?.besieging) {
      log.push(`осада кончилась ${stamp()}`);
      return log.join(', ');
    }
  }
  return [...log, 'осада всё ещё идёт'].join(', ');
}

console.log('');
console.log('--- осада игроком: чем кончается (настоящий мир, полководец у ворот) ---');
console.log(`порог вылазки бота: гарнизон ≥ лагерь × ${SIEGE_SORTIE_RATIO}; выручка выходит через ${gd(SIEGE_RELIEF_AT)} игр. дн.`);
for (const seed of SEEDS) {
  console.log(`сид ${String(seed).padStart(4)}: ${await playerSiege(seed)}`);
}


// ------------------------------------------------------- цена падения ---
//
// Раздел заведён потому, что решение «пола по времени у осады против игрока не
// будет» опиралось на замер, который устарел. Довод звучал так: падение — самый
// мягкий исход, племя восстанавливается до возвращения игрока, а жёсткое — сам
// дебаф, и пол его только удлиняет. После того как дележ склада стал общим
// правилом, а обоз вырос с 8 до 750, падение перестало быть бесплатным, и
// посылку надо было проверить заново, а не оставлять решение висеть на ней.

/** Настоящее племя нужного уровня с полным складом: с ним игрок и уходит. */
function tribeAt(level: number): GameState {
  const g = createInitialState(7);
  for (const b of g.buildings) b.level = level;
  g.pop = Math.round(115 * (1 + (level - 1) * 0.7));
  // Дружина дома и крупная: только тогда штурм не удался бы, и отряд садится лагерем
  // (`LocalWorld.sitsDown`). Осады против пустой деревни не бывает вовсе.
  g.army = { ...g.army, spearman: Math.round(60 * level), legionary: Math.round(20 * level) };
  autoAssign(g);
  const cap = storageCap(g);
  for (const r of RESOURCE_IDS) g.resources[r] = cap;
  return g;
}

/** Мир с ручными часами: тот же приём, что у остальных разделов этого отчёта. */
function clocked(seed: number) {
  let now = 1_700_000_000_000;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
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

const goodsPerHour = (g: GameState): number =>
  RESOURCE_IDS.reduce((n, r) => n + Math.max(0, productionPerDay(g)[r] ?? 0), 0) * gameDaysPerHour();

console.log('');
console.log('--- цена падения: что стоит голод и что стоит дебаф до него ---');
console.log('Осада начинается и кончается, в игре хозяин или нет: правило отсутствия снято решением');
console.log('владельца (docs/DEFEAT_LADDER.md). Логово объявляет «ограбить» — эта участь и в таблице.');
console.log('');
console.log(' ур   склад   тайник     окно   дебаф за окно   унесено   доля склада   отстроится  гарнизон   постройки (ур. / добра на отстройку)');

/** Унесено при падении против дебафа за окно, по уровням: из этого отношения и вывод раздела. */
const fallVsDebuff: string[] = [];
for (const level of [1, 3, 5, 7, 10]) {
  const g = tribeAt(level);
  const w = clocked(7 + level);
  const snap = (): PlayerProfile => playerProfile(g);
  let siege: WorldPulse['siege'] = null;
  for (let i = 0; i < stepsFor(WAIT_DAYS * 2) && !siege; i++) {
    w.advance(STEP_MS);
    siege = (await w.world.sync(snap())).siege;
  }
  if (!siege) {
    console.log(`  ${String(level).padStart(2)}   осады не случилось за отпущенное время`);
    continue;
  }
  const window = siege.starvesAt - w.now();
  const cap = storageCap(g);
  const total = cap * RESOURCE_IDS.length;
  const debuff = goodsPerHour(g) * (window / (60 * MIN)) * (1 - SIEGE_YIELD);
  // Уходим начисто: ни одного пульса до самого голода и восемь часов сверху.
  w.at(siege.starvesAt + 8 * 60 * MIN);
  const pulse = await w.world.sync(snap());
  const taken = pulse.effects.reduce(
    (n, e) => n + Object.values(e.resources).reduce((k, v) => k + Math.abs(v ?? 0), 0),
    0,
  );
  const routed = pulse.effects.reduce(
    (n, e) => n + Object.values(e.lostTroops ?? {}).reduce((k, v) => k + (v ?? 0), 0),
    0,
  );
  const army = Object.values(g.army).reduce((n, v) => n + (v ?? 0), 0);
  // Отстройка — срок хозяйства, значит игровые дни: настоящими минутами это число значило бы
  // разное на разных шкалах, а сравнивается оно с окном голода, которое тоже в игровых днях.
  const refill = taken / Math.max(1, RESOURCE_IDS.reduce((n, r) => n + Math.max(0, productionPerDay(g)[r] ?? 0), 0));
  // Пять построек по уровню — из того списка, что уехал в последствие, и по цене
  // тех самых улучшений, которые придётся заказать заново.
  let levels = 0;
  let rebuild = 0;
  for (const f of pulse.effects.flatMap((e) => e.fallen ?? [])) {
    const def = BUILDINGS.find((d) => d.id === f.id);
    for (let l = f.to + 1; l <= f.from && def; l++) {
      levels++;
      rebuild += Object.values(upgradeCost(def, l)).reduce((n, v) => n + (v ?? 0), 0);
    }
  }
  fallVsDebuff.push(`ур. ${level} — ${(taken / Math.max(1, debuff)).toFixed(2)}`);
  console.log(
    `  ${String(level).padStart(2)}  ${String(total).padStart(6)}  ${String(hiddenStash(g) * RESOURCE_IDS.length).padStart(6)}  ${gd(window).toFixed(1).padStart(6)}д  ${String(Math.round(debuff)).padStart(14)}  ${String(taken).padStart(8)}  ${`${Math.round((taken / total) * 100)}%`.padStart(11)}  ${`${refill.toFixed(1)} игр.дн`.padStart(10)}  ${`−${routed} из ${army}`.padStart(9)}   ${`−${levels} / ${rebuild}`.padStart(15)}`,
  );
}
console.log('');
console.log(`Гарнизон рассеивается на ${Math.round(SIEGE_ROUT * 100)}% (SIEGE_ROUT) — это и есть настоящая цена падения.`);
console.log('Сколько добра уносится, решает обоз лагеря: лагерь садится только когда штурм не удался бы');
console.log('(`LocalWorld.sitsDown`), а его сила — набег логова при жителях этого посёлка.');
console.log('');
console.log(`Унесено при падении против дебафа за окно: ${fallVsDebuff.join(', ') || 'осад не было'}.`);
console.log('Ради этого отношения раздел и заведён: ниже единицы падение мягче ожидания, и пол по времени,');
console.log('удлиняющий окно ради отсрочки падения, ухудшал бы ровно тот случай, ради которого заводится;');
console.log('выше единицы падение дороже ожидания, и вопрос о поле открыт заново.');
console.log('Кроме добра: «падение последствий не имеет» не верно — половина');
console.log('гарнизона расходится, и это не отстраивается само; и пять построек теряют по уровню,');
console.log('кроме тайника (одна дверь участи с прорвавшимся набегом, `spoils.fate`). На первом уровне');
console.log('падать нечему. Во что это обходится во времени партии — sack:report, раздел «лестница».');

// ------------------------------------------------------- орудия башни ---
//
// Раздел заведён до кода башни (docs/tower.md), тем же порядком, каким заводилось
// содержание войска: сначала числа, на которых стоит предложение, потом решение
// владельца, потом код. Первая половина — модель, из которой числа орудий выведены:
// вылазка всем гарнизоном против лагеря из той же замороженной осады (раздел «во
// времени»), у которого одно из двух чисел сдвинуто так, как сдвинуло бы его орудие.
// Вторая половина — те же орудия в настоящем мире.
//
//  - «рогатки медленнее на c» — фронт рубится долей 1 − c (`sideWorks` с таким планом):
//    так катапульта, бьющая по укреплениям, выглядит на чтении, без тика;
//  - «лагерь тоньше на s» — мощь лагеря умножена на 1 − s, и из неё тем же
//    `raidingParty` выводятся люди, пропуск (`campPass`) и строй в бою.
//
// Строка «без орудия» — та же модель без сдвига; сверять её надо со строкой «весь»
// раздела «во времени», где дрался настоящий мир. Разойдутся — модели верить нельзя.

const MODEL_SEEDS = 6;
const SLOWS = [1 / 6, 2 / 7, 0.4];
const THINS = [0.2, 0.4, 0.6, 0.8];
/** Обстрел на часах рогаток при прежнем проходе: [доля рогаток, потолок выбитой доли лагеря]. */
const GROWS: [number, number][] = [
  [0, 0.1],
  [0, 0.2],
  [0, 0.3],
  [2 / 7, 0.1],
  [2 / 7, 0.2],
];

/**
 * `thin` — доля мощи, выбитая к минуте вылазки; отрицательная — обстрел, копящийся на
 * часах рогаток: к минуте `at` выбито `−thin × (at − встал) / CAMP_WORKS_RIPE`, и дальше
 * `−thin` не растёт — потолок обстрела.
 */
function modelSortie(fz: Frozen, at: number, variant: number, slow: number, thin: number, keepPass = false): boolean {
  const save = JSON.parse(fz.save);
  const campId: string = save.sieges.home.campId;
  const works = sideWorks(fz.since, at, 'front', { front: 1 - slow, rear: CAMP_WOOD.rear });
  const share = thin >= 0 ? thin : -thin * Math.min(1, (at - fz.since) / CAMP_WORKS_RIPE);
  const power = fz.campPower * (1 - share);
  const camp = raidingParty(save.seed, campId, power);
  // «Проход прежний» — рогатки держат столько же, сколько держали до обстрела: выбитые
  // люди не сужают проход, а только не выходят к нему драться.
  const pass = campPass(keepPass ? menOfPower(fz.campPower) : camp.men, works);
  const garrison = homeOf(fz.g.army, awayOf([], []));
  const field = resolveField({
    seed: 9000 + variant * 13 + Math.floor(gd(at - fz.since)),
    attacker: { kinds: passKinds(kindsOf(garrison), pass) },
    defender: { kinds: camp.kinds },
  });
  return field.won;
}

/** Доли побед по минутам и первая минута, с которой вылазка безнадёжна. */
function modelRow(frozen: Frozen[], slow: number, thin: number, keepPass = false): { cells: string[]; hopeless: number | null } {
  const cells: string[] = [];
  const full = frozen.length * MODEL_SEEDS;
  let hopeless: number | null = null;
  for (const d of DELAYS) {
    let won = 0;
    let n = 0;
    for (const fz of frozen) {
      const at = fz.since + worldDays(d);
      if (at >= fz.starvesAt) continue;
      for (let v = 0; v < MODEL_SEEDS; v++) {
        n++;
        if (modelSortie(fz, at, v, slow, thin, keepPass)) won++;
      }
    }
    cells.push(curveCell(won, n, full));
    if (n > 0 && won === 0 && hopeless === null) hopeless = d;
    if (n > 0 && won > 0) hopeless = null;
  }
  return { cells, hopeless };
}

console.log('');
console.log('--- орудия башни (docs/tower.md) ---');
console.log('');
console.log('башня сейчас — по уровню (посёлок раздела «во времени»: все постройки уровня L, войско две мерки)');
/** Места лучников на башне этого уровня — правилом игры (`derived.towerSeats`). */
const SEATS = (level: number): number => towerSeats(townAt(level));
console.log(' ур  оборона башни  оборона посёлка  доля башни  ополчение  из них стрелков  лучников в войске  их доля в обороне  мест лучников  их доля в обороне  цена уровня (добра)');
const tower = BUILDINGS.find((b) => b.id === 'tower')!;
for (const level of [1, 5, 10]) {
  const g = townAt(level);
  const b = g.buildings.find((x) => x.type === 'tower')!;
  const own = buildingStat(b, 'defense');
  const all = defense(g);
  const archers = g.army.archer ?? 0;
  const archerPower = archers * powerOf('archer');
  const price = Object.values(upgradeCost(tower, level)).reduce((n, v) => n + (v ?? 0), 0);
  console.log(
    `${String(level).padStart(3)}  ${String(own).padStart(13)}  ${String(Math.round(all)).padStart(15)}  ${`${((own / all) * 100).toFixed(1)}%`.padStart(10)}  ` +
      `${String(militiaMen(g)).padStart(9)}  ${String(militiaArchers(g)).padStart(15)}  ${String(archers).padStart(17)}  ` +
      `${`${((archerPower / all) * 100).toFixed(1)}%`.padStart(17)}  ${String(SEATS(level)).padStart(13)}  ` +
      `${`${((SEATS(level) * powerOf('archer') / all) * 100).toFixed(1)}%`.padStart(17)}  ${String(price).padStart(19)}`,
  );
}
console.log('«стрелки» — ополченцы, которых башня уже ставит на стену с луком (`archers` башни, bridge.militiaArchers);');
console.log('«цена уровня» — улучшение до этого уровня, все ресурсы одной суммой (upgradeCost).');

console.log('');
console.log('вылазка всем гарнизоном под орудием — модель на замороженных осадах раздела «во времени»');
for (const level of LEVELS) {
  const frozen = frozenByLevel.get(level) ?? [];
  if (frozen.length === 0) continue;
  const window = Math.min(...frozen.map((f) => gd(f.starvesAt - f.since)));
  console.log(`Статуя L${level}: окно голода ${window.toFixed(1)} мин, осад ${frozen.length} × ${MODEL_SEEDS} сидов боя`);
  console.log('  Δ, игр. дн.              ' + DELAYS.map((d) => String(d).padStart(5)).join('') + '   безнадёжна с');
  const base = modelRow(frozen, 0, 0);
  const said = (h: number | null): string => (h === null ? 'не бывает в окне' : `${h}-й мин`);
  console.log(`  без орудия               ${base.cells.join('')}   ${said(base.hopeless)}`);
  for (const slow of SLOWS) {
    const r = modelRow(frozen, slow, 0);
    console.log(`  рогатки медленнее на ${slow.toFixed(2)} ${r.cells.join('')}   ${said(r.hopeless)}`);
  }
  for (const thin of THINS) {
    const r = modelRow(frozen, 0, thin);
    console.log(`  лагерь тоньше на ${thin.toFixed(1)}     ${r.cells.join('')}   ${said(r.hopeless)}`);
  }
  for (const thin of THINS) {
    const r = modelRow(frozen, 0, thin, true);
    console.log(`  тоньше на ${thin.toFixed(1)}, проход прежний ${r.cells.join('')}   ${said(r.hopeless)}`);
  }
  for (const [slow, grow] of GROWS) {
    const r = modelRow(frozen, slow, -grow, true);
    const name = `${slow > 0 ? `рогатки ${slow.toFixed(2)} + ` : ''}обстрел до ${grow.toFixed(1)}`;
    console.log(`  ${name.padEnd(29)} ${r.cells.join('')}   ${said(r.hopeless)}`);
  }
  if (base.hopeless !== null) {
    const step = DELAYS[1] - DELAYS[0];
    const cMin = 1 - base.hopeless / (base.hopeless + step);
    const cMax = 1 - base.hopeless / window;
    const cTarget = 1 - base.hopeless / gd(CAMP_WORKS_RIPE);
    console.log(
      `  катапульта по рогаткам: заметно — безнадёжность сдвинута хотя бы на шаг замера (${step} мин): c ≥ ${cMin.toFixed(2)}; ` +
        `не отменяет — безнадёжна раньше голода: c < ${cMax.toFixed(2)}; безнадёжна там, где сейчас дозревают рогатки: c = ${cTarget.toFixed(2)}`,
    );
  }
}
console.log('«*» — в столбце не весь набор (окно голода кончилось раньше минуты вылазки): доля про другой набор');
console.log('c — доля выработки фронта, которую съедает орудие; s — доля мощи лагеря, выбитая к минуте вылазки;');
console.log(`«обстрел до S» — выбитая доля мощи лагеря растёт ровно со временем за ${gd(CAMP_WORKS_RIPE)} игр. дн. (часы рогаток) до S и дальше не растёт; проход прежний.`);

// Орудия в игре есть — и та же кривая меряется настоящим миром: осада замораживается с
// готовым орудием на башне (`GameState.engine`, слепок `PlayerProfile.tower`), вылазка —
// `LocalWorld.sortie` всем гарнизоном, как в разделе «во времени», на тех же сидах. Модель
// выше остаётся тем, из чего числа выведены; этот раздел — то, что из них получилось.
console.log('');
console.log('вылазка всем гарнизоном под орудием — настоящий мир (LocalWorld.sortie, орудие готово с постановки лагеря)');
console.log('  Δ, игр. дн.              ' + DELAYS.map((d) => String(d).padStart(5)).join('') + '   безнадёжна с');
for (const [level, engine] of [
  [5, 'ballista'],
  [10, 'ballista'],
  [10, 'catapult'],
] as const) {
  const frozen: Frozen[] = [];
  for (const seed of TOWN_SEEDS) {
    const fz = await freezeSiege(seed, level, engine);
    if (fz) frozen.push(fz);
  }
  // Две заморозки обязаны быть одной осадой (docs/weights.md, место 7): строка «без орудия» взята из раздела «во времени»,
  // строки орудий — из своей заморозки, и различаться им позволено только орудием. Орудие наводится после того, как
  // окно осады открылось (`LocalWorld.aimTower`), и минута, лагерь и окно голода не должны от него зависеть; разойдутся —
  // строки сравнивали бы разные осады, и отчёт падает, а не печатает.
  const plain = frozenByLevel.get(level) ?? [];
  const key = (f: Frozen): string => `${f.seed} ${f.since} ${f.starvesAt} ${f.campPower}`;
  const was = plain.map(key).join('; ');
  const got = frozen.map(key).join('; ');
  if (was !== got) throw new Error(`L${level} ${engine}: заморозки с орудием и без него — разные осады: [${was}] против [${got}]`);
  const base = wholeRow.get(level) ?? [];
  console.log(`  L${level} без орудия (раздел «во времени») ${base.join('')}`);
  const cells: string[] = [];
  const full = frozen.length * VARIANTS;
  let hopeless: number | null = null;
  let tail = 0;
  for (const d of DELAYS) {
    let won = 0;
    let n = 0;
    for (const fz of frozen) {
      const at = fz.since + worldDays(d);
      if (at >= fz.starvesAt) continue;
      for (let v = 0; v < VARIANTS; v++) {
        const t = await thaw(fz, at, v);
        if (!t.pulse.siege) continue;
        const res = await t.world.sortie(t.garrison);
        if (res.error && !/К рогаткам сейчас не пробиться/.test(res.error)) throw new Error(res.error);
        n++;
        if (res.won) won++;
      }
    }
    cells.push(curveCell(won, n, full));
    if (n > 0 && won === 0 && hopeless === null) hopeless = d;
    if (n > 0 && won > 0) {
      hopeless = null;
      if (d >= 24) tail = Math.max(tail, won / n);
    }
  }
  const said = hopeless !== null ? `${hopeless}-й мин` : `хвост до ${Math.round(tail * 100)}%`;
  console.log(`  L${level} ${ENGINE_BY_ID[engine].name.toLowerCase().padEnd(21)} ${cells.join('')}   ${said}`);
}
console.log('«хвост» — самая высокая доля побед с 24-й минуты: вылазка, не ставшая безнадёжной до голода.');
console.log(`${CURVE_NOTE}; заморозки с орудием и без него сверены: те же осады, минуты, окна голода и лагеря`);

console.log('');
console.log('лучник против орудия: цена, с которой орудие сравнивается');
{
  const g = createInitialState(7);
  const wage = wageOf(g, 'archer');
  const sieges = Math.max(1, totalNew);
  // Считается прямо в игровых днях: горизонт раздела «частота» задан ими, и жалованье лучника —
  // тоже за игровой день. Пересчёт через настоящие часы стоял здесь, пока день был минутой.
  const daysPerSiege = (GAME_DAYS * TOWNS.length * SEEDS.length) / sieges;
  const recruit = archerRecruit();
  console.log(
    `жалованье лучника ${wage.toFixed(2)} золота в игровой день (умеренный налог новой партии); ` +
      `осада — раз в ${Math.round(daysPerSiege)} игровых дней (раздел «частота»: ${sieges} осад за ${GAME_DAYS * TOWNS.length * SEEDS.length} игровых дней), ` +
      `это ${(daysPerSiege / gameDaysPerHour()).toFixed(1)} ч мира при дне в ${dayRealSeconds()} с`,
  );
  console.log(
    `наём лучника своим трудом (derived.selfCost по ресурсам и луку): ${recruit.toFixed(1)} золота; ` +
      `лучник от осады до осады: ${(recruit + wage * daysPerSiege).toFixed(0)} золота`,
  );
  const perSiege = archerPerSiege(daysPerSiege, g);
  for (const [name, level] of [['балиста', 5], ['катапульта', 10]] as const) {
    const id: EngineId = name === 'балиста' ? 'ballista' : 'catapult';
    // Цену и расчёт считает `scripts/lib/engines` — та же дверь, которой их проверяет
    // тест `scripts/lib/engines.test.ts`. Второй копии этой арифметики быть не должно:
    // разойдись они, отчёт сказал бы «сходится», а в игре стояло бы другое число.
    const price = enginePrice(id);
    const crew = crewFor(id, daysPerSiege);
    const inCode = ENGINE_BY_ID[id].crew;
    console.log(
      `${name}: цена — улучшение башни до ${level}-го уровня, ${price.toFixed(0)} золота своим трудом; ` +
        `расчёт, чьё жалованье от осады до осады не меньше цены: ${crew} (${(crew * perSiege).toFixed(0)} золота); мест на ${level}-м уровне: ${SEATS(level)}; ` +
        `в коде (data/engines): ${inCode}${inCode === crew ? '' : ' — РАСХОДИТСЯ'}`,
    );
  }
}
