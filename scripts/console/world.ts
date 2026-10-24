// Мир консоли: посёлок мерки в настоящем мире автопилота (`autopilot.openSky`) — набег, осада, удар по лагерю, перехват
// приказами мира, как в игре. Посёлок стоит (уровни, склад и войско — как поставили), мир и пульс идут: так же, как у
// стенда боя у стены и у осады в отчётах; хлеб под осадой идёт шагом игры (ОС-1, `autopilot.larder`). Своих правил боя и осады здесь нет — только приказы и печать того, что мир сделал.
import type { GameState, TroopId } from '@/game/types';
import type { GateFoe, Report, SiegeView, WorldPulse } from '@/world/types';
import { HOME_ID } from '@/world/local/LocalWorld';
import { gameDaysOfMs, gameSeconds, worldDays } from '@/game/pace';
import { journalOf, phaseText, rowsOf } from '@/world/siegeroll';
import { starvesAt, type SiegeWindow } from '@/world/siege';
import { machinesAt, MACHINE_NAME } from '@/world/machines';
import { blockadeAt } from '@/world/blockade';
import { gunsAt } from '@/world/shelling';
import { breadWords, cutWords } from '@/world/siegewords';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { GAME, PULSE_FLOOR, larder, openSky, type Inside, type OpenSky } from '../autopilot';
import { townOf } from './town';

/** Шаг мира консоли — тот же, что у осады в отчётах: пол пульса автопилота, настоящие миллисекунды. */
export const STEP_MS = PULSE_FLOOR * 1000;

/** Сколько игровых дней консоль ждёт набега или осады, прежде чем сказать «не дождался». */
export const WAIT_DAYS = 360;

export interface Bench {
  sky: OpenSky;
  w: Inside;
  g: GameState;
  /** Минута начала, мс мира. */
  start: number;
}

/**
 * Посёлок `level` (своё войско — `army`) в мире `seed`; логова дозрели, набеги идут по правилам мира. `shield: false` —
 * без защиты слабого (как ступень «без защиты» отчётов): логово замечает город любой величины и выходит всей силой.
 */
export async function bench(level: number, seed: number, army?: Partial<Record<TroopId, number>>, o: { raids?: boolean; shield?: boolean } = {}): Promise<Bench> {
  const g = townOf(level, army);
  const step = o.shield === false ? { name: 'консоль без защиты', rho: null, shield: false } : GAME;
  const sky = openSky(g, { seed, pulse: 30, raids: o.raids ?? true, ripe: true, step });
  await sky.pulse();
  return { sky, w: sky.world, g, start: sky.now() };
}

/** Срок словами в игровых днях. */
export const spanDays = (ms: number): string => `${gameDaysOfMs(ms).toFixed(1)} игр. дн.`;

/** Игровые дни от начала. */
export const daysOf = (b: Bench, at = b.sky.now()): string => `${gameDaysOfMs(at - b.start).toFixed(1)} игр. дн.`;

/**
 * Набег на посёлок — сейчас: следующий выход логов мира назначается на эту минуту (`scheduleAi` выбирает логово и путь
 * сам). `power` — мощь набега вместо той, что дал бы мир (люди — как у мира: воин на три мощи). Нет набега — `null` и
 * причина словами (защита слабого, рядом нет живых логов, на город уже идут).
 */
export function raidNow(b: Bench, power: number | null): { id: string; power: number; from: string; arriveAt: number } | { error: string } {
  const w = b.w;
  const before = new Set<string>(w.save.marches.map((m: Inside) => m.id));
  w.save.nextAiAt = b.sky.now();
  w.scheduleAi(b.sky.now());
  const m = w.save.marches.find((x: Inside) => !before.has(x.id) && !x.own && x.targetId === HOME_ID);
  if (!m) {
    const busy = w.save.marches.some((x: Inside) => !x.own && x.targetId === HOME_ID);
    return { error: busy ? 'на город уже идёт отряд' : 'логово не выходит: защита слабого (мало жителей и войска — lairs.weakCity) или рядом нет живых логов; --no-shield снимает защиту, --world — другой мир' };
  }
  if (power !== null) setRaidPower(m, power);
  return { id: m.id, power: m.power, from: m.fromName ?? m.fromId, arriveAt: m.arriveAt };
}

/**
 * Мощь набега в пути вместо той, что дал бы мир (люди — как у мира: воин на три мощи). Одна дверь у консоли (`raidNow`) и у
 * стенда осады `siege:report` (сильный лагерь, docs/siege_v2.md, 23.14): садиться ли — решает мир в минуту прихода.
 */
export function setRaidPower(m: { power: number; units?: unknown }, power: number): void {
  m.power = Math.max(2, power);
  m.units = { warrior: Math.max(1, Math.round(m.power / 3)) };
}

/** Донесение словами: заголовок и текст мира, одной-двумя строками. */
export function reportWords(r: Report): string {
  const text = (r.text ?? '').replace(/\s+/g, ' ').trim();
  return `${r.title}${text ? ` — ${text}` : ''}`;
}

const buildingName = (id: string): string => (BUILDING_BY_ID as Record<string, { name: string } | undefined>)[id]?.name ?? id;

/**
 * Строка осады в эту минуту: хлеб склада и прогноз, штраф к добыче, машины лагеря, кольцо. Хлеб — склад (ОС-1): строки — те
 * же, что видит окно защитника (`siegewords.breadWords`, `cutWords` от чисел окна); без окна — прогноз окна мира в игровых днях.
 */
export function siegeLine(b: Bench, w: SiegeWindow, at: number, view?: SiegeView | null): string {
  const left = Math.max(0, gameDaysOfMs(starvesAt(w) - at));
  const bread =
    view?.cut !== undefined
      ? `хлеб ${Math.round(b.g.resources.food)}; ${breadWords(view.dryAt !== undefined ? Math.max(0, view.dryAt - at) / 1000 : Infinity).replace(/\.$/, '')}; ${cutWords(view.ratio ?? Infinity).replace(/\.$/, '')}`
      : `хлеба до голода ${Number.isFinite(left) ? `${left.toFixed(1)} игр. дн.` : 'не кончится'}`;
  const machines = machinesAt(w, at)
    .map((m) => `${MACHINE_NAME[m.id]}${m.ready ? ' готов' : Number.isFinite(m.readyAt) ? ` к ${gameDaysOfMs(m.readyAt - b.start).toFixed(0)} игр. дн.` : ' — без древесины'}`)
    .join(', ');
  const guns = gunsAt(w, at).filter((x) => x.live);
  const gun = guns.length ? `; требушет на стене ${guns.some((x) => x.ready) ? 'стоит' : `к ${gameDaysOfMs(guns[0].readyAt - b.start).toFixed(0)} игр. дн.`}` : '';
  return `${bread}; машины лагеря: ${machines || 'нет'}${gun}; кольцо ${blockadeAt(w, at) ? 'замкнуто' : 'открыто'}`;
}

export interface Played {
  reports: Report[];
  /** Окно осады своего города, если село, — последним видом. */
  siege: SiegeWindow | null;
  /** Донесение с записью осады (её конец), если осада кончилась. */
  ended: Report | null;
}

/**
 * Шагать мир до `until` (вернуло true) или срока `days`, печатая каждое новое донесение и каждую новую фазу осады своего
 * города. `each` — после каждого пульса (приказы сценария).
 */
export async function play(
  b: Bench,
  days: number,
  o: { quiet?: boolean; until?: (p: Played, pulse: WorldPulse) => boolean; each?: (p: Played, pulse: WorldPulse) => Promise<void> | void } = {},
): Promise<Played> {
  const seen = new Set<string>();
  const out: Played = { reports: [], siege: null, ended: null };
  let phases = 0;
  let siegeSeen = '';
  const end = b.sky.now() + worldDays(days);
  while (b.sky.now() < end) {
    b.sky.at(b.sky.now() + STEP_MS);
    // Посёлок стоит, а хлеб под осадой идёт шагом игры (ОС-1): голод решает склад (`autopilot.larder`).
    larder(b.g, gameSeconds(STEP_MS / 1000));
    const pulse = await b.sky.pulse();
    const w: SiegeWindow | undefined = b.w.save.sieges[HOME_ID];
    if (w) {
      // Лагерь узнаётся по отряду: переучёт хлеба (паёк, кольцо) заводит окно той же осады заново, с новым началом.
      if (w.campId !== siegeSeen) {
        siegeSeen = w.campId;
        phases = 0;
        if (!o.quiet) console.log(`  [${daysOf(b)}] лагерь сел под стенами: ${siegeLine(b, w, b.sky.now(), pulse.siege)}`);
      }
      out.siege = w;
      const rows = rowsOf(w);
      for (; phases < rows.length; phases++) {
        if (!o.quiet) console.log(`  [${daysOf(b, rows[phases].at)}] ${phaseText(rows[phases], phases + 1, buildingName, (id) => MACHINE_NAME[id])}; ${siegeLine(b, w, rows[phases].at, pulse.siege)}`);
      }
    }
    for (const r of pulse.reports) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.reports.push(r);
      if (r.siege) out.ended = r;
      if (!o.quiet) console.log(`  [${daysOf(b, r.at)}] ${reportWords(r)}`);
    }
    await o.each?.(out, pulse);
    if (o.until?.(out, pulse)) break;
  }
  return out;
}

/** Фазы осады словами из записи донесения (`Report.siege`) — журнал целиком, как его покажет ролик. */
export const siegeJournal = (r: Report): string[] => (r.siege ? journalOf(r.siege, buildingName, (id) => MACHINE_NAME[id]) : []);

// ---------- Сухие прогоны у ворот и у стены ----------

export interface GatePoint {
  won: number;
  runs: number;
  attackerLoss: number[];
  defenderLoss: number[];
}

/** Бои у ворот: `runs` боёв на сидах `i·7919` (i от `seed`), как у мерки раздела 4 `raid-mix:report`. */
export function gatePoint(b: Bench, foe: GateFoe, power: number, seed: number, runs: number): GatePoint & { first: Record<string, unknown> } {
  const at = b.sky.now();
  const out: GatePoint = { won: 0, runs, attackerLoss: [], defenderLoss: [] };
  let first: Record<string, unknown> | null = null;
  for (let i = seed; i < seed + runs; i++) {
    const call = { id: `gate-bench${i}`, foe, power, seed: i * 7919 };
    const party = b.w.gateParty(call);
    const gate = b.w.gateField(party, call.seed, b.w.save.home, at, null);
    if (gate.field.won) out.won++;
    out.attackerLoss.push(gate.field.attackerLoss * 100);
    out.defenderLoss.push(gate.field.defenderLoss * 100);
    first ??= { gate, party };
  }
  return { ...out, first: first as Record<string, unknown> };
}


/** Набег логова мощью `power` у стены посёлка, сухим прогоном (`LocalWorld.wallField`, штурм с ходу): сиды `i·7919`. */
export function wallPoint(b: Bench, power: number, seed: number, runs: number): GatePoint & { first: Record<string, unknown> } {
  const at = b.sky.now();
  const out: GatePoint = { won: 0, runs, attackerLoss: [], defenderLoss: [] };
  let first: Record<string, unknown> | null = null;
  for (let i = seed; i < seed + runs; i++) {
    const f = b.w.wallField({ id: `console${i}`, seed: i * 7919, power }, at);
    if (f.field.won) out.won++;
    out.attackerLoss.push(f.field.attackerLoss * 100);
    out.defenderLoss.push(f.field.defenderLoss * 100);
    first ??= f;
  }
  return { ...out, first: first as Record<string, unknown> };
}
