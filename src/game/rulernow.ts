// Черты правителя сейчас (ПН-2, docs/gdd/path_of_sword.md, 3.2.3 и «Решения ПН-2») — **единственное чтение черт для дверей игры**
// (`rulerTraitNumbers`) и счёт дел партии: чей он (правителя или героя пути), с какой минуты идёт, как читается из сохранения.
//
// Правила черт — таблица, пороги, пары и числа — в `game/rulertraits.ts`, и в первую загрузку они не едут: черт без дел не бывает
// (`traitsPossible`), а правила подгружаются докачкой раньше, чем черта может прийти: на входе, если в записи есть дела или
// минимальное жалованье (`save.readyToRead`), и с первым делом (`sim/dynasty.noteRulerDeed`) — самая скорая черта ждёт ещё двух дел
// или полутора игровых дней минимального жалованья. Пока правил нет, а дела есть — черт ещё быть не может, и дверь отдаёт нули.
//
// Импорты — без `@/`: множитель Старосты с «Строителем» (`stewardBuild`) читает и сервер (`watch.buildMult`).
import type { GameState, RoamOrigin, RulerTally } from './types';
import { giftCeil } from './councilrules';
import { roamOn } from './roamflag';
import type { RulerNumbers, RulerRules } from './rulertraits';

let rules: RulerRules | null = null;

/** Правила подгружены: их модуль зовёт это сам при первом чтении (`rulertraits`). */
export function useRulerRules(r: RulerRules): void {
  rules = r;
}

/** Правила, если подгружены. */
export const rulerRules = (): RulerRules | null => rules;

let loading: Promise<unknown> | null = null;

/**
 * Подгрузить правила черт. Повторный вызов — то же обещание: дверь чтения зовёт загрузку из каждого чтения, пока правил нет, и
 * долгий синхронный прогон не должен заводить по загрузке на чтение.
 */
export const loadRulerTraits = (): Promise<unknown> => (loading ??= rules ? Promise.resolve() : import('./rulertraits'));

/** Чей счёт сейчас: героя на пути или правителя в замке. Пишет в него одна дверь — `sim/dynasty.noteRulerDeed`. */
export function rulerPerson(s: GameState): { deeds?: RulerTally } | null {
  if (roamOn() && s.phase === 'roam' && s.roam) return s.roam.hero;
  return s.realm?.ruler ?? null;
}

/**
 * Чей счёт сейчас: номер человека дома (у героя пути — −1: в дом он ляжет при переходе, ПН-11), с какой игровой секунды счёт
 * идёт и происхождение (у героя пути).
 */
export function rulerSeat(s: GameState): { n: number; tally: RulerTally | undefined; since: number; origin?: RoamOrigin } {
  if (roamOn() && s.phase === 'roam' && s.roam) return { n: -1, tally: s.roam.hero.deeds, since: s.roam.hero.since ?? s.time, origin: s.roam.origin };
  return { n: s.realm?.ruler?.n ?? 0, tally: s.realm?.ruler?.deeds, since: s.realm?.ruler?.bornAt ?? s.time };
}

/**
 * Сколько игровых секунд закрывает смена жалованья с минимального: идущий отрезок, срезанный началом правления (у прежнего
 * правителя отрезок остался с ним). Жалованье не минимальное — ноль.
 */
export function wageMinClosing(s: GameState): number {
  const w = s.pay?.wage;
  return w && w.mode === 'min' ? Math.max(0, s.time - Math.max(w.since, rulerSeat(s).since)) : 0;
}

const count = (v: unknown, max = 1e9): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);

/** Счёт дел из сохранения: только известные поля, числа — не ниже нуля; пустой счёт — `undefined`. */
export function readTally(v: unknown): RulerTally | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const out: RulerTally = {};
  for (const k of ['won', 'lost', 'fled', 'built', 'feasts', 'mercy', 'cruel'] as const) {
    const n = Math.floor(count(r[k]));
    if (n > 0) out[k] = n;
  }
  const min = count(r.wageMin, 1e15);
  if (min > 0) out.wageMin = min;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Может ли черта держаться: есть счёт дел, дружине платят минимальное или у героя есть происхождение. Нет ни того, ни другого —
 * черт нет ни при каких правилах (тест перебором — `rulertraits.test.ts`), и правила не нужны.
 */
export function traitsPossible(s: GameState): boolean {
  const seat = rulerSeat(s);
  return seat.tally !== undefined || seat.origin !== undefined || s.pay?.wage?.mode === 'min';
}

/** Черт нет: нули. Двери его только читают. */
export const NO_RULER: Readonly<RulerNumbers> = { won: 0, lost: 0, drill: 0, trade: 0, build: 0, calm: false, loyalty: { merchants: 0, guilds: 0, peasants: 0, knights: 0, clergy: 0 } };

/** Числа черт правителя — **единственное** чтение черт для дверей игры (правило 4 `rulertraits`). */
export const rulerTraitNumbers = (s: GameState): RulerNumbers => {
  if (!traitsPossible(s)) return NO_RULER;
  if (!rules) {
    void loadRulerTraits();
    return NO_RULER;
  }
  return rules.numbersNow(s);
};

/**
 * Множитель Старосты на стройке с прибавкой «Строителя»: черта ложится под тот же потолок, что Староста высшего уровня
 * (`councilrules.giftCeil`, ГДД 3.2.3: «общая дверь с советом, потолок общий»). Прибавки нет — множитель как есть.
 * Одна формула на игру (`derived.buildBoost`) и сервер (`watch.buildMult`).
 */
export const stewardBuild = (steward: number, build: number): number => (build > 0 ? Math.min(1 + giftCeil('steward'), steward + build) : steward);
