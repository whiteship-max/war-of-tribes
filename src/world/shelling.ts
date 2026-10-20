// Обстрел машинами по фазам (Р-5, docs/siege_v2.md, 21.1): артиллерия лагеря — камнемёт и требушет — и требушет на стене
// осаждённого. Одна дверь на мир на клиенте и на сервер войны; её зовёт кость фаз (`siegeroll.rollPhase`), и выстрелы фазы
// ложатся в её строку журнала (`PhaseRow.shots`, `PhaseRow.gun`) — обе стороны видят одно.
//
// Модуль чистый, того же рода, что `machines.ts` и `siegecraft.ts`: ни состояния мира, ни часов, ни `Math.random`, и без
// `@/` — его собирает сервер. Кость выстрела даёт тот, кто зовёт (`roll`): у фаз она одна, из сида осады и номера фазы.
//
// Что делает выстрел, решает цель:
//  - артиллерия лагеря по **стенам** — грани к кости фазы (`machineFaces`): камнемёт +1, требушет +2;
//  - по **городу** — выстрелы по постройкам (`targets` окна): попадание — фаза без работы, каждое второе в ту же постройку —
//    −1 уровень, не ниже первого;
//  - по **машинам** — выстрелы по требушету на стене: попадание его разбивает;
//  - требушет на стене по **лагерю** — попадание уносит ещё одну долю истощения фазы, по **машинам** — разбивает самую дорогую
//    машину у стены.
import type { SiegeWindow } from './siege';
import type { Shot } from './siegeroll';
import { machinesAt, type MachineOrder } from './machines';
import { ARTILLERY, ARTILLERY_WEIGHT, MACHINE_IDS, MACHINE_WOOD, type ArtilleryId, type MachineId } from './data/machines';
import { AIMS, BUILDING_FLOOR, GUN_AIMS, GUN_HOLD, GUN_ID, GUN_SPAN, HITS_PER_LEVEL, SHOT_HIT, type Aim, type GunAim } from './data/shelling';

export type { Aim, GunAim } from './data/shelling';

/** Что двери нужно от окна осады. */
type ShellWindow = Pick<SiegeWindow, 'startedAt' | 'sinceAt' | 'wood' | 'machines' | 'log' | 'guns' | 'targets'>;

const last = <T extends { at: number }>(xs: readonly T[], at: number): T | undefined => {
  let out: T | undefined;
  for (const x of xs) if (x.at <= at && (!out || x.at >= out.at)) out = x;
  return out;
};

/** Цель артиллерии лагеря в минуту `at`: последний приказ к ней; нет приказа — стены. */
export function artilleryAimOf(w: Pick<SiegeWindow, 'log'>, at: number): Aim {
  const d = last((w.log ?? []).filter((x) => x.act === 'aim'), at);
  return d?.aim === 'town' || d?.aim === 'engines' ? d.aim : 'wall';
}

/**
 * Почему артиллерии лагеря не бить по цели `aim` в минуту `at`; null — можно. У логова и двора мира построек и стены нет —
 * «город» и «машины» гаснут строкой; у города игрока по машинам бить можно и до того, как требушет на стене встал.
 */
export function aimBlock(w: Pick<SiegeWindow, 'log' | 'targets' | 'wall'>, aim: Aim, at: number): string | null {
  if (!AIMS.includes(aim)) return 'Такой цели нет.';
  if (artilleryAimOf(w, at) === aim) return 'Машины и так бьют туда.';
  if (aim === 'town' && !w.targets?.length) return 'Построек у них нет — по городу бить нечего.';
  if (aim === 'engines' && !(w.wall && w.wall > 0)) return 'Стены у них нет — и машин на ней нет.';
  return null;
}

/** Почему требушету на стене не бить по цели `aim`; null — можно. */
export function gunAimBlock(w: Pick<SiegeWindow, 'log'>, aim: GunAim, at: number): string | null {
  if (!GUN_AIMS.includes(aim)) return 'Такой цели нет.';
  if (gunAimOf(w, at) === aim) return 'Требушет и так бьёт туда.';
  return null;
}

/** Цель требушета на стене в минуту `at`: последний приказ; нет — лагерь. */
export function gunAimOf(w: Pick<SiegeWindow, 'log'>, at: number): GunAim {
  const d = last((w.log ?? []).filter((x) => x.act === 'gunAim'), at);
  return d?.aim === 'machines' ? 'machines' : 'camp';
}

/** Артиллерия лагеря, стоящая готовой к минуте `at` (`world/machines`): камнемёт и требушет. */
export function artilleryAt(w: ShellWindow, at: number): ArtilleryId[] {
  const ready = new Set(machinesAt(w, at).filter((e) => e.ready).map((e) => e.id));
  return ARTILLERY.filter((id) => ready.has(id));
}

/** Грани артиллерии к кости фазы в минуту `at`: камнемёт +1, требушет +2 — только когда цель стены. */
export const machineFaces = (w: ShellWindow, at: number): number =>
  artilleryAimOf(w, at) === 'wall' ? artilleryAt(w, at).reduce((n, id) => n + ARTILLERY_WEIGHT[id], 0) : 0;

/** Требушет на стене глазами минуты `at`: когда заказан, когда готов, разбит ли. */
export interface GunState extends MachineOrder {
  readyAt: number;
  ready: boolean;
  live: boolean;
}

/** Требушеты на стене к минуте `at`, по порядку заказа. */
export function gunsAt(w: Pick<SiegeWindow, 'guns'>, at: number): GunState[] {
  return [...(w.guns ?? [])]
    .sort((a, b) => a.at - b.at)
    .map((g) => {
      const gone = g.spent !== undefined && g.spent <= at;
      const readyAt = g.at + GUN_SPAN;
      return { ...g, readyAt, live: !gone, ready: !gone && readyAt <= at };
    });
}

/** Требушет на стене стоит готовым к минуте `at`. */
export const gunReady = (w: Pick<SiegeWindow, 'guns'>, at: number): boolean => gunsAt(w, at).some((g) => g.ready);

/** Почему требушет на стене не заказать в минуту `at`; null — можно. Цену (склад) спрашивает тот, кто платит. */
export function gunBlock(w: Pick<SiegeWindow, 'guns' | 'wall'>, at: number): string | null {
  if (!(w.wall && w.wall > 0)) return 'Стены нет — требушет ставить некуда.';
  const live = gunsAt(w, at).filter((g) => g.live);
  if (live.length >= GUN_HOLD) return live.some((g) => g.ready) ? 'Требушет уже стоит на стене.' : 'Требушет на стене уже строят.';
  return null;
}

/** Очередь требушетов после заказа в минуту `at`. */
export const gunAfter = (w: Pick<SiegeWindow, 'guns'>, at: number): MachineOrder[] => [...(w.guns ?? []), { id: GUN_ID, at }];

/** Очередь требушетов после попадания в минуту `at`: первый живой разбит. */
export function gunsBroken(w: Pick<SiegeWindow, 'guns'>, at: number): MachineOrder[] {
  let done = false;
  return [...(w.guns ?? [])]
    .sort((a, b) => a.at - b.at)
    .map((g) => {
      if (done || (g.spent !== undefined && g.spent <= at)) return g;
      done = true;
      return { ...g, spent: at, broke: true as const };
    });
}

/**
 * Машина лагеря, по которой бьёт требушет на стене в минуту `at`: самая дорогая из стоящих у стены (больше всего леса —
 * таран, башня и требушет прежде лестниц), готовая прежде строящейся. Нет — null.
 */
export function gunTarget(w: ShellWindow, at: number): MachineId | null {
  const live = machinesAt(w, at).filter((e) => !(e.spent !== undefined && e.spent <= at));
  if (!live.length) return null;
  const order = (id: MachineId): number => MACHINE_IDS.indexOf(id);
  const best = [...live].sort((a, b) => MACHINE_WOOD[b.id] - MACHINE_WOOD[a.id] || Number(b.ready) - Number(a.ready) || order(b.id) - order(a.id))[0];
  return best.id;
}

/**
 * Очередь машин лагеря после попадания требушета в минуту `at`: машина этого рода разбита вместе с лесом — очередь, а не
 * склад, как у сожжённой вылазкой (`machines.machinesBurned`).
 */
export function machinesBroken(w: ShellWindow, id: MachineId, at: number): MachineOrder[] {
  let done = false;
  return [...(w.machines ?? [])]
    .sort((a, b) => a.at - b.at)
    .map((o) => {
      if (done || o.id !== id || (o.spent !== undefined && o.spent <= at)) return o;
      done = true;
      return { ...o, spent: at, broke: true as const };
    });
}

/**
 * Что выстрелы фазы сделали с окном: машины лагеря, разбитые требушетом на стене, и требушет, разбитый артиллерией лагеря.
 * Одна дверь на мир и сервер войны: сами выстрелы бросила кость фазы (`rollPhase`, строка журнала), здесь — только их след.
 */
export function shotsApplied(w: ShellWindow, row: { shots?: Shot[]; gun?: Shot[] }, at: number): Pick<SiegeWindow, 'machines' | 'guns'> {
  let out: ShellWindow = w;
  for (const s of row.gun ?? []) if (s.hit && s.machine) out = { ...out, machines: machinesBroken(out, s.machine, at) };
  if ((row.shots ?? []).some((s) => s.hit && s.gun)) out = { ...out, guns: gunsBroken(out, at) };
  return { machines: out.machines, guns: out.guns };
}

/** Сколько раз постройка `b` уже получила попадание в этой осаде — по строкам журнала до этой фазы. */
const hitsOn = (rows: readonly { shots?: Shot[] }[], b: string): number =>
  rows.reduce((n, r) => n + (r.shots ?? []).filter((s) => s.hit && s.building === b).length, 0);

/**
 * Выстрелы фазы: артиллерия лагеря (`shots`) по цели осаждающего и требушет на стене (`gun`) — по цели осаждённого. `roll`
 * — кость выстрела (1..14) по метке; `prior` — строки журнала до этой фазы (для второго попадания в ту же постройку). Цель
 * «стены» выстрелов не даёт — её вес идёт к кости (`machineFaces`). Нет выстрелов — пустые списки.
 */
export function phaseShots(w: ShellWindow, at: number, roll: (tag: string) => number, prior: readonly { shots?: Shot[] }[]): { shots: Shot[]; gun: Shot[] } {
  const shots: Shot[] = [];
  const aim = artilleryAimOf(w, at);
  if (aim !== 'wall') {
    const guns = aim === 'engines' ? gunsAt(w, at).filter((g) => g.ready) : [];
    let gunUp = guns.length > 0;
    const targets = w.targets ?? [];
    const fresh = new Map<string, number>();
    for (const id of artilleryAt(w, at)) {
      for (let i = 0; i < ARTILLERY_WEIGHT[id]; i++) {
        const tag = `${id}${i}`;
        if (aim === 'town') {
          if (!targets.length) break;
          const b = targets[(roll(`${tag}b`) - 1) % targets.length];
          const hit = roll(tag) >= SHOT_HIT;
          if (!hit) {
            shots.push({ by: id, hit, building: b });
            continue;
          }
          const n = hitsOn(prior, b) + (fresh.get(b) ?? 0) + 1;
          fresh.set(b, (fresh.get(b) ?? 0) + 1);
          shots.push({ by: id, hit, building: b, ...(n % HITS_PER_LEVEL === 0 ? { lost: true as const } : {}) });
        } else {
          // По машинам на стене: бить по чему — пока стоит требушет; разбит — остальные выстрелы фазы пустые.
          if (!gunUp) break;
          const hit = roll(tag) >= SHOT_HIT;
          shots.push({ by: id, hit, gun: true });
          if (hit) gunUp = false;
        }
      }
    }
  }
  const gun: Shot[] = [];
  if (gunReady(w, at)) {
    const target = gunAimOf(w, at);
    let machines: ShellWindow = w;
    for (let i = 0; i < ARTILLERY_WEIGHT[GUN_ID]; i++) {
      const tag = `gun${i}`;
      if (target === 'camp') {
        gun.push({ by: 'gun', hit: roll(tag) >= SHOT_HIT, camp: true });
        continue;
      }
      const m = gunTarget(machines, at);
      if (!m) break;
      const hit = roll(tag) >= SHOT_HIT;
      gun.push({ by: 'gun', hit, machine: m });
      if (hit) machines = { ...machines, machines: machinesBroken(machines, m, at) };
    }
  }
  return { shots, gun };
}

/** Постройки, стоящие без работы в минуту `at`: попадание фазы держит постройку до броска следующей (`nextAt`). */
export function idleBuildings(rows: readonly { at: number; shots?: Shot[] }[], at: number, phase: number): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.at > at || at >= r.at + phase) continue;
    for (const s of r.shots ?? []) if (s.hit && s.building) out.add(s.building);
  }
  return [...out];
}

/** Уровень после попадания, отнимающего уровень: не ниже первого. */
export const lostLevel = (level: number): number => Math.max(BUILDING_FLOOR, Math.floor(level) - 1);

// ------------------------------------------------ слова (правило 18: числа — этими же функциями) ---

/** Цель артиллерии лагеря — имя на кнопке. */
export const AIM_NAME: Record<Aim, string> = { wall: 'По стенам', town: 'По городу', engines: 'По машинам' };
/** Цель требушета на стене — имя на кнопке. */
export const GUN_AIM_NAME: Record<GunAim, string> = { camp: 'По лагерю', machines: 'По машинам' };

const shotsWord = (n: number): string => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'выстрел' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'выстрела' : 'выстрелов'}`;

/** Что даст цель артиллерии лагеря весом `weight` (сумма готовых машин) — до нажатия, строкой окна. */
export function aimWords(aim: Aim, weight: number): string {
  if (weight <= 0) return 'Машин нет: закажи камнемёт или требушет — они бьют каждую фазу.';
  if (aim === 'wall') return `Кость каждой фазы +${weight}: пролом и сдача ближе.`;
  if (aim === 'town') return `${shotsWord(weight)} за фазу по постройкам, попадает каждый второй: постройка стоит фазу без работы, каждое второе попадание в неё — −1 уровень. К кости ничего.`;
  return `${shotsWord(weight)} за фазу по требушету на стене, попадает каждый второй: попадание его разбивает. К кости ничего.`;
}

/** Что даст цель требушета на стене — строкой окна. */
export function gunAimWords(aim: GunAim): string {
  const n = ARTILLERY_WEIGHT[GUN_ID];
  return aim === 'camp'
    ? `${shotsWord(n)} за фазу по лагерю, попадает каждый второй: попадание уносит ещё долю истощения фазы.`
    : `${shotsWord(n)} за фазу по машинам у стены, попадает каждый второй: попадание разбивает самую дорогую.`;
}

/** Выстрелы фазы словами: «по городу 2 из 3 — кузница (−1 ур.), мельница». `name` — имя постройки по её ключу. */
export function shotsText(shots: readonly Shot[], gun: readonly Shot[], name: (building: string) => string = (b) => b, machine: (id: MachineId) => string = (id) => id): string {
  const parts: string[] = [];
  const town = shots.filter((s) => s.building);
  if (town.length) {
    const hits = town.filter((s) => s.hit).map((s) => `${name(s.building as string)}${s.lost ? ' (−1 ур.)' : ''}`);
    parts.push(`по городу ${hits.length} из ${town.length}${hits.length ? ` — ${hits.join(', ')}` : ''}`);
  }
  const engines = shots.filter((s) => s.gun);
  if (engines.length) parts.push(engines.some((s) => s.hit) ? 'требушет на стене разбит' : `по требушету на стене ${engines.length} мимо`);
  const camp = gun.filter((s) => s.camp);
  if (camp.length) parts.push(`требушет со стены по лагерю ${camp.filter((s) => s.hit).length} из ${camp.length}`);
  const broke = gun.filter((s) => s.machine && s.hit).map((s) => machine(s.machine as MachineId).toLowerCase());
  const missed = gun.filter((s) => s.machine && !s.hit).length;
  if (broke.length || missed) parts.push(broke.length ? `требушет со стены разбил: ${broke.join(', ')}` : `требушет со стены по машинам ${missed} мимо`);
  return parts.join('; ');
}
