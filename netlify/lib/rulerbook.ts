// Правитель в описи (ПН-2, docs/gdd/path_of_sword.md, «Решения ПН-2»): черты правителя на сервере — **той же функцией**, что в
// игре (`game/rulertraits.rulerTraitsOf`, `rulerNumbersOf`), из счёта дел описи. Одна дверь сервера — `claimedRuler`: её читают
// книга сословий (слагаемое `ruler` в потолке лояльности и указе), потолок духа (дисциплина), прибавка выручки рынка и множитель
// стройки (`watch.estateCeilOf`, `estateFaults`, `spiritCeilOf`, `marketBoost`, `buildMult`).
//
// Это потолок, а не правда (как `commandbook.claimedLead`): счёт везёт клиент. Сверяет его правило «ruler» (`rulerFaults`,
// `rulerFlags`): черты описи — те, что даёт её счёт; счёт того же правителя не убывает; дни правления — не быстрее часов партии,
// минимальное жалованье — не дольше правления; бои — не больше боёв описи, уровни — не больше сдвига уровней, пиры — не чаще
// самого короткого отката трактира. Подделка — флаг.
import { DAY_LENGTH } from '../../src/game/pace.js';
import { FEAST_COOLDOWN_DAYS, FEAST_COOLDOWN_PER_LEVEL, MAX_BUILDING_LEVEL } from '../../src/game/constants.js';
import {
  RULER_DEED_KEYS,
  RULER_TRAITS,
  RULER_TRAIT_BY_ID,
  isRulerTraitId,
  rulerNumbersOf,
  rulerTraitsOf,
  type RulerDeeds,
  type RulerNumbers,
} from '../../src/game/rulertraits.js';
import type { RoamOrigin } from '../../src/game/types.js';
import type { WatchCard, WatchRuler } from './contract.js';

/** Допуск сверки дней: опись снята чуть раньше часов партии, числа дробные. */
const DAYS_SLACK = 0.01;

/** Счёт дел описи — только известные имена, не ниже нуля; описи без правителя — нули. */
export function deedsOf(x: WatchRuler | undefined): RulerDeeds {
  const out = {} as RulerDeeds;
  for (const k of RULER_DEED_KEYS) out[k] = Math.max(0, x?.deeds[k] ?? 0);
  return out;
}

/** Происхождение описи — только то, что даёт черту; иное — нет. */
const originOf = (x: WatchRuler | undefined): RoamOrigin | undefined =>
  x?.origin !== undefined && RULER_TRAITS.some((t) => t.origin === x.origin) ? (x.origin as RoamOrigin) : undefined;

/** Числа черт правителя по описи — единственное чтение черт сервером. Правителя в описи нет — нули. */
export function claimedRuler(card: WatchCard): RulerNumbers {
  return rulerNumbersOf(card.ruler ? rulerTraitsOf(deedsOf(card.ruler), originOf(card.ruler)) : []);
}

const one = (n: number): string => (Math.round(n * 100) / 100).toString().replace('.', ',');

/** Нарушения одной описи: черты — из таблицы и те, что даёт счёт; числа — не ниже нуля; минимальное — не дольше правления. */
export function rulerFaults(card: WatchCard): string[] {
  const x = card.ruler;
  if (!x) return [];
  const out: string[] = [];
  const strange = x.held.filter((t) => !isRulerTraitId(t));
  if (strange.length > 0) out.push(`Правитель: черты «${strange.join('», «')}» — таких нет.`);
  for (const k of RULER_DEED_KEYS) if ((x.deeds[k] ?? 0) < 0) out.push(`Правитель: в счёте дел «${k}» ${one(x.deeds[k])} — ниже нуля.`);
  const d = deedsOf(x);
  if (d.minDays > d.days + DAYS_SLACK) out.push(`Правитель: на минимальном жалованье ${one(d.minDays)} игр. дн. из ${one(d.days)} правления.`);
  if (x.origin !== undefined && x.n >= 0) out.push(`Правитель: происхождение «${x.origin}» у правителя без пути — оно есть только у героя (до перехода, ПН-11).`);
  const fair = rulerTraitsOf(d, originOf(x));
  const said = x.held.filter(isRulerTraitId);
  const extra = said.filter((t) => !fair.includes(t));
  const missing = fair.filter((t) => !said.includes(t));
  if (extra.length > 0) out.push(`Правитель: черты ${extra.map((t) => `«${RULER_TRAIT_BY_ID[t].name}»`).join(', ')} — счёт дел их не даёт.`);
  if (missing.length > 0) out.push(`Правитель: счёт дел даёт черты ${missing.map((t) => `«${RULER_TRAIT_BY_ID[t].name}»`).join(', ')}, а опись их не называет.`);
  return out;
}

/** Самый короткий откат пира — у трактира высшего уровня (`derived.feastInfo`), игровых дней. */
const FEAST_WAIT_MIN = Math.max(1, FEAST_COOLDOWN_DAYS - FEAST_COOLDOWN_PER_LEVEL * (MAX_BUILDING_LEVEL - 1));

/** Сколько пиров могло быть за `days` игровых дней: первый — сразу, дальше — не чаще отката. */
const feastsIn = (days: number): number => Math.floor(Math.max(0, days) / FEAST_WAIT_MIN) + 1;

/**
 * Сколько уровней могли достроить по описям: рост и убыль вместе — уровень, достроенный и потерянный в осаде внутри промежутка,
 * опись не покажет ростом.
 */
const levelsMoved = (a: WatchCard, b: WatchCard): number => {
  const types = new Set([...Object.keys(a.buildings), ...Object.keys(b.buildings)]);
  let n = 0;
  for (const t of types) n += Math.abs((b.buildings[t] ?? 0) - (a.buildings[t] ?? 0));
  return n;
};

/**
 * Счёт правителя между описями (правило «ruler»). Тот же правитель (номер дома тот же) — счёт не убывает; новый — счёт с нуля.
 * Прибавилось не больше, чем могло: дней — не быстрее часов партии, минимального — не больше дней, боёв — не больше боёв описи,
 * уровней — не больше сдвига уровней, пиров — не больше, чем позволяет откат трактира.
 */
export function rulerFlags(a: WatchCard, b: WatchCard): string[] {
  const x = b.ruler;
  if (!x) return [];
  const out: string[] = [];
  const same = a.ruler !== undefined && a.ruler.n === x.n;
  const was = deedsOf(same ? a.ruler : undefined);
  const now = deedsOf(x);
  if (same) {
    const down = RULER_DEED_KEYS.filter((k) => now[k] + (k === 'days' || k === 'minDays' ? DAYS_SLACK : 0) < was[k]);
    if (down.length > 0) out.push(`Счёт дел правителя убыл: ${down.map((k) => `${k} ${one(was[k])} → ${one(now[k])}`).join(', ')}.`);
  }
  const went = Math.max(0, (b.time - a.time) / DAY_LENGTH);
  const grew = (k: keyof RulerDeeds): number => Math.max(0, now[k] - was[k]);
  // Тот же правитель — дни растут не быстрее часов партии; новый вступил внутри промежутка — его дни не дольше промежутка. Прежняя
  // опись без правителя — дел до неё не было, а правление могло идти давно: дни не сверяются.
  if (a.ruler !== undefined && grew('days') > went + DAYS_SLACK) out.push(`Правитель: правления прибавилось ${one(grew('days'))} игр. дн., а часы партии ушли на ${one(went)}.`);
  if (grew('minDays') > grew('days') + DAYS_SLACK) out.push(`Правитель: минимального жалованья прибавилось ${one(grew('minDays'))} игр. дн. за ${one(grew('days'))} правления.`);
  if (grew('won') > Math.max(0, b.won - a.won)) out.push(`Правитель: побед прибавилось ${grew('won')}, а в описи — ${Math.max(0, b.won - a.won)}.`);
  if (grew('lost') > Math.max(0, b.lost - a.lost)) out.push(`Правитель: поражений прибавилось ${grew('lost')}, а в описи — ${Math.max(0, b.lost - a.lost)}.`);
  if (grew('built') > levelsMoved(a, b)) out.push(`Правитель: достроено ${grew('built')} ур., а уровни описи сдвинулись на ${levelsMoved(a, b)}.`);
  if (grew('feasts') > feastsIn(went)) out.push(`Правитель: пиров прибавилось ${grew('feasts')} за ${one(went)} игр. дн. — откат трактира даёт не больше ${feastsIn(went)}.`);
  return out;
}
