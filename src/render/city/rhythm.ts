// Распорядок дня и состояние города в виде и звуке (docs/city_v3.md, ЖГ-1). Только вид: механики здесь нет — всё читается
// из партии и часов игры, ничего не пишется.
//
// Два слоя, оба — чистые функции:
// - **распорядок** (`rhythmAt`) — от фазы солнца: на рассвете открываются лавки, рынок шумит до полудня, днём работа у
//   построек, вечером люди у трактира, ночью улицы пустеют и ходит дозор с фонарём; смена стражи у ворот — на рассвете, в
//   полдень, на закате и в полночь;
// - **состояние** (`moodOf`) — от партии: победа — праздник на площади, набег или осада — тревога (люди прячутся, стража на
//   стенах, колокол тревоги), голод — очередь у амбара, мор — меньше людей и дым, мораль — оживлённо или хмуро.
//
// Город (`life.ts`), звук (`sound/epoch`) и покои (вид из окна — тот же живой город) спрашивают одни и те же функции: двух
// правд о том, праздник ли сейчас, нет.
import type { GameState } from '@/game/types';
import { MORALE_BASE, MORALE_GROWTH_ZERO } from '@/game/constants';
import { DAY_LENGTH } from '@/game/pace';

/** Плавная ступенька: 0 до `a`, 1 после `b`. */
export const step = (x: number, a: number, b: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Что делает город в эту фазу солнца, 0..1 на каждое дело. */
export interface DayRhythm {
  /** Лавки и ряды рынка: с рассвета, людно до полудня, к вечеру сворачиваются. */
  market: number;
  /** Работа у построек: от рассвета до заката. */
  work: number;
  /** Люди у трактира: вечер, до глубокой ночи редеет. */
  tavern: number;
  /** Ночной дозор с фонарём по улицам. */
  patrol: number;
  /**
   * Смена стражи у ворот: ход смены 0..1, пока она идёт; иначе −1. Старый караул уходит в проезд ворот, новый выходит
   * на посты (`life.shiftPose`).
   */
  shift: number;
}

/** Фазы смены стражи: рассвет, полдень, закат, полночь (0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — ночь). */
export const SHIFT_AT: readonly number[] = [0.005, 0.25, 0.5, 0.75];
/** Сколько длится смена, доля суток: около двадцати настоящих секунд (сутки — полчаса, `game/pace`). */
export const SHIFT_LEN = 0.012;

/** Ход смены стражи в фазу `solar`: 0..1 — идёт, −1 — нет. */
export function shiftAt(solar: number): number {
  for (const at of SHIFT_AT) {
    const d = (((solar - at) % 1) + 1) % 1;
    if (d < SHIFT_LEN) return d / SHIFT_LEN;
  }
  return -1;
}

/** Распорядок дня по фазе солнца (`derived.solarPhase`). */
export function rhythmAt(solar: number): DayRhythm {
  const s = ((solar % 1) + 1) % 1;
  // Рынок: лавки открываются с рассветом (0.01…0.06), людно до полудня, после полудня редеет, к закату пусто.
  const market = step(s, 0.01, 0.06) * (1 - 0.7 * step(s, 0.24, 0.32)) * (1 - step(s, 0.4, 0.47));
  const work = step(s, 0.03, 0.07) * (1 - step(s, 0.44, 0.49));
  // Трактир: с конца работы до глубокой ночи, гуще всего в сумерках.
  const tavern = step(s, 0.4, 0.47) * (1 - 0.6 * step(s, 0.62, 0.7)) * (1 - step(s, 0.84, 0.92));
  const patrol = step(s, 0.54, 0.58) * (1 - step(s, 0.97, 0.995));
  return { market, work, tavern, patrol, shift: shiftAt(s) };
}

/** Состояние города в виде, 0..1 на каждое; `cheer` — −1 (хмуро) … +1 (оживлённо). */
export interface CityMood {
  /** Праздник на площади — после победы. */
  feast: number;
  /** Набег идёт к городу или осада под стенами. */
  alarm: number;
  /** Амбары пусты — очередь у амбара. */
  hunger: number;
  /** Мор — меньше людей, дым над домами. */
  plague: number;
  cheer: number;
}

export const CALM_MOOD: CityMood = { feast: 0, alarm: 0, hunger: 0, plague: 0, cheer: 0 };

/** Праздник после победы держится столько игровых суток (девять настоящих минут). */
export const FEAST_DAYS = 0.3;
/** Мор виден столько игровых суток после записи в летописи. */
export const PLAGUE_DAYS = 1;
/** Мораль, с которой город оживлён до конца, и с которой хмур до конца. */
export const CHEER_FULL = 88;
export const GLOOM_FULL = 22;

/** Мораль → оживление: от средней (`MORALE_BASE`) вверх — веселее, ниже порога роста (`MORALE_GROWTH_ZERO`) — хмуро. */
export function cheerOf(morale: number): number {
  if (morale >= MORALE_BASE) return Math.min(1, (morale - MORALE_BASE) / (CHEER_FULL - MORALE_BASE));
  if (morale >= MORALE_GROWTH_ZERO) return 0;
  return -Math.min(1, (MORALE_GROWTH_ZERO - morale) / (MORALE_GROWTH_ZERO - GLOOM_FULL));
}

/** Мор: письмо о нём ждёт на столе или летопись записала убыль от мора за последние сутки. */
export function plagueOf(s: GameState): boolean {
  if (s.inbox.some((e) => e.defId === 'sickness')) return true;
  const since = s.time - PLAGUE_DAYS * DAY_LENGTH;
  // Летопись — свежие сверху (`sim/log`); дальше суток не смотрим.
  for (let i = 0; i < Math.min(40, s.log.length); i++) {
    const e = s.log[i];
    if (e.at < since) break;
    if (e.kind === 'bad' && e.text.endsWith(': мор.')) return true;
  }
  return false;
}

/** Что видно из партии: `threat` — враг идёт к городу (мир, `marchesOnHome`), `feastUntil` — конец праздника (игровое время). */
export function moodOf(s: GameState, threat: boolean, feastUntil: number): CityMood {
  const alarm = s.siege || threat || s.gate.length > 0 ? 1 : 0;
  const hunger = s.resources.food <= 0 || s.starvation > 0 ? 1 : 0;
  return {
    // В тревогу не празднуют.
    feast: alarm ? 0 : s.time < feastUntil ? 1 : 0,
    alarm,
    hunger,
    plague: plagueOf(s) ? 1 : 0,
    cheer: cheerOf(s.morale),
  };
}

/**
 * Праздник после победы: счёт побед (`stats.battlesWon`) вырос — праздник до `FEAST_DAYS` вперёд. Первое чтение только
 * запоминает: вход в игру и встреча копий — не победа. Один на игру — его спрашивают и город, и звук.
 */
export class FeastClock {
  private won = -1;
  private until = -Infinity;
  /** Прочесть партию; вернуть конец праздника (игровое время). */
  observe(s: GameState): number {
    const won = s.stats.battlesWon;
    if (this.won >= 0 && won > this.won) this.until = s.time + FEAST_DAYS * DAY_LENGTH;
    this.won = won;
    return this.until;
  }
}

export const feastClock = new FeastClock();

/** Состояние адресом (`?mood=feast`) — стенду и проверке на телефоне: праздник, осада, голод, мор, хмуро, весело. */
export function forcedMood(search: string): CityMood | null {
  const v = new URLSearchParams(search).get('mood');
  if (v === null) return null;
  const m: Record<string, Partial<CityMood>> = {
    feast: { feast: 1, cheer: 1 },
    siege: { alarm: 1 },
    hunger: { hunger: 1, cheer: -0.6 },
    plague: { plague: 1, cheer: -0.5 },
    gloom: { cheer: -1 },
    cheer: { cheer: 1 },
    calm: {},
  };
  return v in m ? { ...CALM_MOOD, ...m[v] } : null;
}

/** Что состояние делает с улицами: доли людей и стражи. Распорядок — отдельно (`rhythmAt`). */
export interface MoodLook {
  /** Доля идущих по улицам от обычной. */
  street: number;
  /** Доля стоящих кружками (рынок, колодец, паперть) от обычной. */
  idle: number;
  /** Стражи на стене не меньше этой доли мест. */
  wall: number;
}

export function lookOf(m: CityMood): MoodLook {
  // Хмуро — меньше народу и на улицах, и в кружках; оживлённо — рынок не сворачивается после полудня (`idleMode`).
  const gloom = Math.max(0, -m.cheer);
  const street = (1 - 0.92 * m.alarm) * (1 - 0.5 * m.plague) * (1 - 0.15 * m.hunger) * (1 - 0.4 * gloom);
  const idle = (1 - m.alarm) * (1 - 0.6 * m.plague) * (1 - 0.6 * gloom);
  return { street, idle, wall: m.alarm ? 0.85 : 0 };
}
