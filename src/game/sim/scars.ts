// Шрамы и привычки армии (ДР-4, docs/siege_v2.md, «Решения ДР-4») — единственная дверь журнала боёв армии (`GameState.scars`).
// Числа и правила — `game/scarrules` (одни на игру и сервер): черты — чистая функция от журнала (`scarsOf`), в партии лежат только
// метки боёв. Метку боя считает мир (`HomeEffect.scar`), у боя войны — сервер (`WarBattle.marks`); племя дописывает к своей
// метке полководца и кладёт её сюда (`noteFight`) той же минутой, что память духа (`sim/expedition`). Строку летописи пишет только
// эта дверь и только когда набор черт сменился (Ш9).
import type { GameState, ScarState } from '../types';
import {
  NO_GENERAL,
  SCAR_BY_ID,
  SCAR_LOG,
  readMark,
  scarRun,
  scarsOf,
  warMarks,
  type FightMark,
  type HeldScar,
  type ScarId,
} from '../scarrules';
import { forgetLine, gainLine, loseLine, loseWords } from '../scarwords';
import { seated } from './agents';
import { log } from './log';

/** Полководец сейчас — номер человека на месте; места нет — `NO_GENERAL`. */
export const generalNow = (s: GameState): number => (seated(s, 'general') ? s.agents.general.person : NO_GENERAL);

/** Журнал боёв армии: метки по порядку, старшая первой. Нет поля — пусто (партия до ДР-4). */
export const scarLog = (s: GameState): readonly FightMark[] => s.scars?.log ?? [];

/** Черты армии сейчас (Ш1–Ш2): по журналу и нынешнему полководцу, по порядку прихода. */
export const scarsNow = (s: GameState): HeldScar[] => scarsOf(scarLog(s), generalNow(s));

/** Имена черт сейчас — то, что мост везёт в мир (`PlayerProfile.scars`). */
export const scarIds = (s: GameState): ScarId[] => scarsNow(s).map((h) => h.id);

/**
 * Черты в войне с соседями (Ш6): та же функция по меткам боёв войны — тем, что записал сервер. Ими сервер и бьётся за нас;
 * черты из боёв с логовами и у своих ворот сюда не входят.
 */
export const warScarsNow = (s: GameState): HeldScar[] => scarsOf(warMarks(scarLog(s)), generalNow(s));

/** Пишет строки летописи о том, что сменилось от `before` к `after`; `lost` — что ушло по своему правилу и чем. */
function tell(s: GameState, before: readonly HeldScar[], after: readonly HeldScar[], lost: ReadonlyMap<ScarId, string>): void {
  const had = new Set(before.map((h) => h.id));
  const has = new Set(after.map((h) => h.id));
  for (const h of before) {
    if (has.has(h.id)) continue;
    const why = lost.get(h.id);
    log(s, why ? loseLine(h.id, why) : forgetLine(h.id), why ? (SCAR_BY_ID[h.id].good ? 'bad' : 'good') : 'info');
  }
  for (const h of after) if (!had.has(h.id)) log(s, gainLine(h.id), SCAR_BY_ID[h.id].good ? 'good' : 'bad');
}

/**
 * Бой кончился: метка — в журнал (Ш4). К своей метке племя дописывает полководца; у метки боя войны он уже от сервера (его книги
 * агентов). Журнал держит `SCAR_LOG` последних. Набор черт сменился — строка летописи на каждую перемену.
 */
export function noteFight(s: GameState, mark: FightMark): void {
  const gen = generalNow(s);
  const m: FightMark = mark.war === undefined && mark.gen === undefined ? { ...mark, gen } : { ...mark };
  const before = scarsNow(s);
  const next = [...scarLog(s), m].slice(-SCAR_LOG);
  s.scars = { log: next, gen };
  const run = scarRun(next, gen);
  const last = next.length - 1;
  // Что сняла эта метка — её шаги (и смена полководца после неё); ушедшее иначе — вытеснено или забыто.
  const lost = new Map<ScarId, string>();
  for (const st of run.steps) {
    if (st.how !== 'lose' || st.at < last) continue;
    const general = SCAR_BY_ID[st.id].lose === 'sureOrGeneral';
    lost.set(st.id, general ? (st.at === last && m.sure === true ? 'уверенная победа' : 'новый полководец') : loseWords(st.id));
  }
  tell(s, before, run.held, lost);
}

/**
 * Полководец сменился (шаг племени): «Страх обстрела» помнит, при ком пришёл, и уходит с новым человеком — строкой летописи сразу,
 * а не со следующим боем. Сменился ли — по номеру, записанному с последней перемены; без журнала делать нечего.
 */
export function scarsStep(s: GameState): void {
  const st = s.scars;
  if (!st) return;
  const gen = generalNow(s);
  if (st.gen === gen) return;
  const before = scarsOf(st.log, st.gen);
  st.gen = gen;
  const after = scarsOf(st.log, gen);
  const lost = new Map<ScarId, string>();
  for (const h of before) if (!after.some((x) => x.id === h.id)) lost.set(h.id, 'новый полководец');
  tell(s, before, after, lost);
}

// ---------- Опись ----------

/** Черты для описи (Ш7, `WatchCard.scars`): свои, номера боёв войны в журнале и черты войны по ним. */
export function scarsWatch(s: GameState): { held: ScarId[]; war: string[]; warHeld: ScarId[] } | undefined {
  const marks = scarLog(s);
  if (marks.length === 0) return undefined;
  return {
    held: scarsNow(s).map((h) => h.id),
    war: warMarks(marks).map((m) => m.war!.id),
    warHeld: warScarsNow(s).map((h) => h.id),
  };
}

// ---------- Чтение из сохранения ----------

/** Журнал из сохранения: метки, что читаются, не больше `SCAR_LOG` последних; ни одной — нет поля (Ш8). */
export function mergeScars(saved: unknown): ScarState | undefined {
  if (!saved || typeof saved !== 'object') return undefined;
  const r = saved as Record<string, unknown>;
  const log = Array.isArray(r.log) ? r.log.map(readMark).filter((m): m is FightMark => m !== null).slice(-SCAR_LOG) : [];
  if (log.length === 0) return undefined;
  const gen = typeof r.gen === 'number' && Number.isInteger(r.gen) && r.gen >= NO_GENERAL ? r.gen : undefined;
  return gen === undefined ? { log } : { log, gen };
}

