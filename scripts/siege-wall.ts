// Сила стены — замороженные осады стенда и вывод граней обороны стены и лестниц (docs/siege_v2.md, 17.1): одна функция на
// раздел «сила стены» `siege:report` и на шаг вывода W (`npm run derive -- w`, ПБ-1, п. 3; docs/siege_v2.md, «Решения ПБ-1»).
// Стена и лестницы — пара с W: бои у стен — выборка W, а ширина решает бой у стены, — и выводятся они одним кругом неподвижной
// точки с W и шагом кости. Код перенесён из `siege-report.ts` дословно (посёлок этапа, заморозка осады, ровный штурм); отчёт
// зовёт его отсюда, и вывод отчёта тот же.
import { HOME_ID, LocalWorld } from '@/world/local/LocalWorld';
import type { WorldSave } from '@/world/local/state';
import { wallFight } from '@/world/fights';
import { SCALING, wallFront, type Assault, type WallFront } from '@/world/wall';
import { WALL_BREACHES, WALL_TARGET_BREACHED, WALL_TARGET_SCALING, type WallFaces } from '@/world/data/wall';
import { raidingParty } from '@/world/garrison';
import { awayOf, homeOf } from '@/world/muster';
import type { TroopStack } from '@/game/battle/kinds';
import { kindsOf, troopPower } from '@/game/battle/price';
import type { WorldPulse } from '@/world/types';
import { siegeWear, type SiegeWindow } from '@/world/siege';
import { CAMP_WASTE, CAMP_WASTE_DAYS, SIEGE_PHASE } from '@/world/data/siegeroll';
import { CUT_RATIO_STRONG } from '@/world/data/siegefood';
import { militiaArchers, militiaMen, playerProfile } from '@/world/bridge';
import { createInitialState } from '@/game/state';
import { autoAssign } from '@/game/sim/workers';
import { housingCapacity, storageCap } from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import type { EngineId, GameState } from '@/game/types';
import { realMs, worldDays } from '@/game/pace';
import { PULSE_FLOOR } from './autopilot';
import { setRaidPower } from './console/world';

/**
 * Шаг мира — тоже игровым временем, с полом в настоящую минуту (`PULSE_FLOOR`, как у автопилота):
 * иначе тот же горизонт стоил бы в тридцать раз больше шагов. Десять игровых секунд — пять
 * настоящих минут при ×30, и это грубее пола, поэтому пол ни на что не влияет; он стоит затем,
 * чтобы при шкале 1 шаг остался прежним.
 *
 * `PULSE` — ручка замера, настоящих секунд, и не приёмки: ею проверяют, не меняет ли выводов более
 * редкий пульс мира (docs/time.md, раздел 18.10). Имя то же, что у автопилота.
 */
export const STEP_MS = (Number(process.env.PULSE) > 0 ? Number(process.env.PULSE) : Math.max(PULSE_FLOOR, realMs(10) / 1000)) * 1000;
/**
 * Сколько шагов покрывают `days` игровых дней при шаге `STEP_MS`. Ждать осады отчёт ждёт игровым
 * временем: осада приходит из паузы между набегами (`AI_ATTACK_MIN..MAX`, игровые дни), а до
 * поворота шкалы эти ожидания стояли числами настоящих шагов — и после поворота не дожидались
 * ничего (docs/time.md, раздел 18).
 */
export const stepsFor = (days: number): number => Math.ceil(worldDays(days) / STEP_MS);
/** Горизонт ожидания осады: столько же игрового времени, сколько отчёт ждал при дне в минуту. */
export const WAIT_DAYS = 360;

export const TOWN_SEEDS = [11, 42, 77, 101, 202, 303, 404, 505];
export const TOWN_MIX: TroopStack = { spearman: 4, archer: 3, legionary: 2, rider: 1 };

/**
 * Мерка войска посёлка этапа: 20 бойцов на первом уровне и по 10 за каждый следующий.
 * Это прежняя вместимость Статуи — правилом игры она больше не является (войско держит
 * цена), но все замеры осады сняты на этих составах, и сравниваются они между
 * прогонами. Правило здесь — мерка отчёта, а не игры.
 */
export const armyUnit = (level: number): number => 20 + 10 * (level - 1);

/** Посёлок уровня L: жильё на 90%, склад полон, войско — две мерки. */
export function townAt(level: number): GameState {
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

export function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

/**
 * Лагерь стенда — сильный (решение владельца 24.10.2026, docs/siege_v2.md, 23.14). После ОС-1 лагерь логова слабее гарнизона
 * у посёлка стенда голодом не морит: поля за стеной кормят город (штраф к хлебу ниже безубыточного), и лагерь снимается в
 * первую фазу — у L10 лагеря ×0.81…0.99 гарнизона, окно в одну фазу. Разделы ниже меряют осаду, которая морит голодом, —
 * вылазки, стороны лагеря, орудия, ход осады, «безразличие», силу стены, способы штурма, ответы, переговоры, цену падения.
 * Поэтому набег логова на наш город в пути получает мощь ×`CUT_RATIO_STRONG` гарнизона мерки кольца (бойцы строя дома, без
 * ополчения, — `LocalWorld.garrisonPower`): штраф к хлебу наибольший, поля не кормят, как у любого лагеря до ОС-1. Мощь —
 * той же дверью, что консоль (`console/world.setRaidPower`); садиться ли лагерем — решает мир в минуту прихода.
 */
export function strongRaids(world: LocalWorld, pulse: WorldPulse, g: GameState, done: Set<string>): void {
  const save = (world as unknown as { save: WorldSave }).save;
  const garrison = troopPower(homeOf(g.army, awayOf(pulse.marches, pulse.figures)));
  for (const m of save.marches) {
    if (m.own || m.targetId !== HOME_ID || done.has(m.id)) continue;
    setRaidPower(m, CUT_RATIO_STRONG * garrison);
    done.add(m.id);
  }
}

export interface Frozen {
  seed: number;
  save: string;
  since: number;
  starvesAt: number;
  campPower: number;
  g: GameState;
}

export async function freezeSiege(seed: number, level: number, engine: EngineId | null = null): Promise<Frozen | null> {
  const g = townAt(level);
  // Орудие готово с первой минуты: башня уровня L, расчёт — лучники гарнизона (TOWN_MIX).
  if (engine) g.engine = { id: engine, until: 0 };
  let now = 1_700_000_000_000;
  const store = memory();
  const world = new LocalWorld({ seed, now: () => now, storage: store });
  const strong = new Set<string>();
  for (let i = 0; i < stepsFor(WAIT_DAYS); i++) {
    now += STEP_MS;
    const r = await world.sync(playerProfile(g));
    strongRaids(world, r, g, strong);
    if (!r.siege) continue;
    const save = store.read() as string;
    const parsed = JSON.parse(save);
    const camp = parsed.marches.find((x: { id: string }) => x.id === parsed.sieges.home.campId);
    return { seed, save, since: r.siege.since, starvesAt: r.siege.starvesAt, campPower: camp.power, g };
  }
  return null;
}

/** Уровни посёлков стенда, на чьих осадах меряются ход осады, «безразличие», сила стены и способы штурма. */
export const PHASE_LEVELS = [5, 10];
/** Вариантов боя у раздела «способы штурма»: разница способов — доли силы, и четырёх вариантов на неё мало. */
export const STORM_VARIANTS = 12;

/** Осады стенда: лагерь логова под посёлком уровня `PHASE_LEVELS` на каждом мире `TOWN_SEEDS`, замороженный в минуту постановки. */
export async function phaseSieges(): Promise<{ level: number; fz: Frozen }[]> {
  const phaseFrozen: { level: number; fz: Frozen }[] = [];
  for (const level of PHASE_LEVELS) {
    for (const seed of TOWN_SEEDS) {
      const fz = await freezeSiege(seed, level);
      if (fz) phaseFrozen.push({ level, fz });
    }
  }
  return phaseFrozen;
}

/** Окно осады и лагерь из замороженного сохранения. */
export function frozenWindow(fz: Frozen): { win: SiegeWindow; camp: { id: string; power: number; homeDays: number }; worldSeed: number } {
  const save = JSON.parse(fz.save);
  const win = save.sieges.home as SiegeWindow;
  const m = save.marches.find((x: { id: string }) => x.id === win.campId);
  return { win, camp: { id: m.id, power: m.power, homeDays: win.homeDays ?? 0 }, worldSeed: save.seed };
}

/** Лагерь и сид мира у штурма в середине осады — из сохранения, раз на осаду: штурм читает из них только числа. */
const stormCamps = new WeakMap<Frozen, ReturnType<typeof frozenWindow>>();

/**
 * Взял ли штурм войском в `k` раз сильнее лагеря к середине осады хотя бы половину боёв; `front` — стена (нет — поле без
 * стены). Ровно «доля побед из `STORM_VARIANTS` вариантов ≥ 0.5» — теми же боями в том же порядке, но до решённого ответа:
 * половина побед набрана — да; оставшимися её уже не набрать — нет. Ровный штурм спрашивает у доли только это
 * (docs/handbook/console.md, «Где было время»).
 */
export function winHalf(fz: Frozen, front: WallFront | undefined, k: number): boolean {
  let held = stormCamps.get(fz);
  if (!held) stormCamps.set(fz, (held = frozenWindow(fz)));
  const { camp, worldSeed } = held;
  const span = fz.starvesAt - fz.since;
  const mid = fz.since + span / 2;
  const before = Math.floor((mid - fz.since) / SIEGE_PHASE);
  const rate = CAMP_WASTE * (1 + camp.homeDays / CAMP_WASTE_DAYS);
  const party = raidingParty(worldSeed, camp.id, camp.power * Math.pow(1 - rate, before) * k);
  const need = STORM_VARIANTS / 2;
  let won = 0;
  for (let v = 0; v < STORM_VARIANTS; v++) {
    if (won >= need) return true;
    if (won + (STORM_VARIANTS - v) < need) return false;
    const { field } = wallFight({
      seed: fz.seed * 31 + v,
      attacker: { kinds: party.kinds },
      defender: { kinds: kindsOf(fz.g.army), militia: militiaMen(fz.g), archers: militiaArchers(fz.g), rest: siegeWear(fz.since, mid, span) },
      ...(front ? { front } : {}),
    });
    if (field.won) won += 1;
  }
  return won >= need;
}

/**
 * Ровный штурм одной осады за одной стеной, запомненный: «сила стены» и «способы штурма» спрашивают одни и те же стены
 * (три пролома сходятся к одной), и второй раз их не считают — бой чистая функция осады, стены и силы.
 */
const evenKs = new WeakMap<Frozen, Map<string, number>>();

/** Наименьшее `k` (до сотых), при котором штурм берёт половину боёв; бесконечность — не берёт и в двенадцать раз. */
export function evenK(fz: Frozen, front: WallFront | undefined): number {
  let memo = evenKs.get(fz);
  if (!memo) evenKs.set(fz, (memo = new Map()));
  const key = JSON.stringify(front ?? null);
  const have = memo.get(key);
  if (have !== undefined) return have;
  let lo = 0.25;
  let hi = 12;
  let k: number;
  if (!winHalf(fz, front, hi)) k = Infinity;
  else if (winHalf(fz, front, lo)) k = lo;
  else {
    while (hi - lo > 0.01) {
      const mid = (lo + hi) / 2;
      if (winHalf(fz, front, mid)) hi = mid;
      else lo = mid;
    }
    k = hi;
  }
  memo.set(key, k);
  return k;
}

export function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN;
}

type Sieges = readonly { fz: Frozen }[];

/** Ровный штурм поля — тот же бой без стены: мерка «во сколько раз сильнее» у целей владельца. */
export const fieldKOf = (frozen: Sieges): number => median(frozen.map((x) => evenK(x.fz, undefined)));

/** Ровный штурм способа `a` при гранях `faces`, в долях поля. */
export const wallRatioOf = (frozen: Sieges, a: Assault, faces: WallFaces): number =>
  median(frozen.map((x) => evenK(x.fz, wallFront(a, undefined, faces)))) / fieldKOf(frozen);

/**
 * Грани обороны стены и лестниц из целей владельца (docs/siege_v2.md, 17.1): сперва оборона стены (все проёмы) — ровный штурм через
 * три пролома ×`WALL_TARGET_BREACHED` поля, потом лестницы сверх неё — штурм с ходу ×`WALL_TARGET_SCALING` поля; бисекцией по
 * граням, до десятых.
 */
export function wallFacesOf(frozen: Sieges): WallFaces {
  /** Грани, при которых `ratio(faces)` доходит до цели: бисекция по монотонной доле (больше граней — дороже штурм). */
  const solve = (ratio: (f: number) => number, target: number): number => {
    let lo = 0;
    let hi = 30;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (ratio(mid) < target) lo = mid;
      else hi = mid;
    }
    return Math.round(((lo + hi) / 2) * 10) / 10;
  };
  const wall = solve((f) => wallRatioOf(frozen, { breaches: WALL_BREACHES }, { wall: f, ladder: 0 }), WALL_TARGET_BREACHED);
  const ladder = solve((f) => wallRatioOf(frozen, SCALING, { wall, ladder: f }), WALL_TARGET_SCALING);
  return { wall, ladder };
}
