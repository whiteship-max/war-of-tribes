// Дела полководца в своём осадном лагере: «Укрепить лагерь» и «Обстрел города» (задание владельца 06.10.2026, ночь 2).
//
// Модуль чистый, того же рода, что `siege.ts` и `bombard.ts`: ни состояния мира, ни часов, ни `Math.random`, и без `@/` —
// его собирает сервер войны (`netlify/lib/war.ts`). Правило то же — **считаем при чтении, не тикаем**: что сделано, лежит
// в окне осады счётчиками (`SiegeWindow.craft`) и журналом дел с минутой (`SiegeWindow.log`), а всё, что они дают,
// выводится из них в минуту боя или фазы.
//
// Одна дверь на лагерь под логовом (мир на клиенте) и под городом игрока (сервер войны):
//  - укрепления — грани кости нападающих на лагерь (`fortFaces` → `GroundPenalty.works`, через `fights.campFight`);
//  - обстрел — дело фазы (docs/siege_v2.md, 2.5): один залп за фазу, +2 к кости своей фазы (`siegeroll.modsOf`) и дух
//    гарнизона во всяком его бою, пока лагерь стоит (`garrisonWear`). Пролом даёт исход фазы, а не залп; пробитая доля
//    стены при штурме — проломы / 3 (`wallMen`).
// Числа — `data/siegecraft.ts`, цены в энергии — `data/energy.ENERGY_PRICE`.
import { FORTIFY_FACES } from './data/siegecraft';
import { BREACH_MAX, LEGACY_VOLLEY_WALL } from './data/siegeroll';
import { siegeSince, siegeWear, wearSpan, type SiegeWindow } from './siege';
import { breachesOf, phaseOf, shakeShare, volleyBlock, volleysOf, type RollWindow } from './siegeroll';
import { num } from '../game/num';

/** Дело в лагере. Имена — строки таблицы энергии: цена дела у него одна. */
export type CraftAct = 'fortify' | 'bombard';
export const CRAFT_ACTS: readonly CraftAct[] = ['fortify', 'bombard'];

/**
 * Что сделано в лагере за эту осаду. Лежит в окне осады; нет поля — ничего. В записи боя — снимок к его минуте, с
 * проломами (`breach`), чтобы донесение и ролик сказали это, не читая окна.
 */
export interface Craft {
  /** Сколько раз лагерь укрепляли. */
  fort?: number;
  /** Сколько залпов дал обстрел за осаду. */
  shots?: number;
  /** Сколько проломов в стене к минуте боя (0..3, `siegeroll.breachesOf`) — только в записи боя. */
  breach?: number;
}

/**
 * Сколько раз дело можно сделать: укрепить — строк в таблице за осаду; обстрел — один залп за фазу (docs/siege_v2.md,
 * 2.5: дело фазы, а не три за осаду; предел — энергия, которая в лагере копится залпом за фазу).
 */
export const craftMax = (act: CraftAct): number => (act === 'fortify' ? FORTIFY_FACES.length : 1);

const count = (n: number | undefined): number => Math.max(0, Number.isFinite(n) ? Math.floor(n as number) : 0);

/** Сколько раз дело уже сделано: укреплений — за осаду, залпов — в фазе минуты `now`. */
export function craftDone(w: Pick<SiegeWindow, 'craft' | 'log' | 'startedAt' | 'sinceAt'>, act: CraftAct, now?: number): number {
  if (act === 'fortify') return Math.min(craftMax('fortify'), count(w.craft?.fort));
  if (now === undefined) return count(w.craft?.shots);
  const since = siegeSince(w as SiegeWindow);
  const k = phaseOf(since, now);
  return volleysOf(w).filter((d) => phaseOf(since, d.at) === k).length;
}

/** Сколько раз дело сделано по снимку дел (запись боя, лагерь сервера): укреплений и залпов за осаду. */
export const craftCount = (craft: Craft | undefined, act: CraftAct): number =>
  act === 'fortify' ? Math.min(craftMax('fortify'), count(craft?.fort)) : count(craft?.shots);

/** Почему дело больше не сделать сейчас; null — можно. Энергию проверяет дверь энергии. */
export function craftBlock(w: RollWindow, act: CraftAct, now: number): string | null {
  if (act === 'bombard') return volleyBlock(w, now);
  const max = craftMax(act);
  return craftDone(w, act) < max ? null : `Лагерь укреплён до предела: ${max} из ${max}.`;
}

/**
 * Окно после дела в минуту `now`: укрепление — счётчик на одно больше; залп — счётчик и строка журнала с минутой, которую
 * прочтёт кость его фазы (`siegeroll.volleyIn`). Предел не переступается.
 */
export function craftAfter(w: Pick<SiegeWindow, 'craft' | 'log'>, act: CraftAct, now: number): Pick<SiegeWindow, 'craft' | 'log'> {
  const fort = Math.min(craftMax('fortify'), count(w.craft?.fort) + (act === 'fortify' ? 1 : 0));
  const shots = count(w.craft?.shots) + (act === 'bombard' ? 1 : 0);
  const craft: Craft = { ...(fort > 0 ? { fort } : {}), ...(shots > 0 ? { shots } : {}) };
  const log = act === 'bombard' ? [...(w.log ?? []), { at: now, act: 'volley' as const }] : (w.log ?? []);
  return { craft, log };
}

const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);

/** Сколько граней кости снимают укрепления у тех, кто идёт на лагерь. */
export const fortFaces = (craft: Craft | undefined): number => sum(FORTIFY_FACES.slice(0, Math.min(craftMax('fortify'), count(craft?.fort))));

/**
 * Какая доля стены пробита, 0..1: проломы / 3 (docs/siege_v2.md, 2.5 и 4.2) — проломы даёт исход фазы, а не залп. Запись
 * боя до фаз проломов не знает: её залпы читаются прежними долями (20 / 10 / 5 %), как и были посчитаны.
 */
export function breachOf(craft: Craft | undefined): number {
  if (craft?.breach !== undefined) return Math.min(BREACH_MAX, count(craft.breach)) / BREACH_MAX;
  return Math.min(1, sum(LEGACY_VOLLEY_WALL.slice(0, count(craft?.shots))));
}

/** Что сделано в лагере к минуте боя — снимок окна с проломами, в запись боя. */
export const craftAt = (w: RollWindow): Craft => ({ ...(w.craft ?? {}), breach: breachesOf(w) });

/**
 * Во сколько раз дух гарнизона в бою ниже от осады к минуте `at`: часы осады до дна к голоду окна (`siege.siegeWear`,
 * `wearSpan`), продвинутые залпами на их долю пути (`siegeroll.shakeShare`). Одна дверь на гарнизон под лагерем игрока —
 * у логова (мир) и у города игрока (сервер); дна осады обстрел не ломает.
 */
export function garrisonWear(w: SiegeWindow, at: number): number {
  const span = wearSpan(w);
  const shots = volleysOf(w).filter((d) => d.at <= at).length + (w.log ? 0 : count(w.craft?.shots));
  return siegeWear(siegeSince(w) - shakeShare(shots) * span, at, span);
}

/** Кто стоит на стене при штурме после пролома: ополчение и стрелки башни среди него, целыми людьми. */
export function wallMen(militia: number, archers: number, craft: Craft | undefined): { militia: number; archers: number } {
  const keep = 1 - breachOf(craft);
  const men = Math.max(0, Math.round(Math.max(0, militia) * keep));
  return { militia: men, archers: Math.min(men, Math.max(0, Math.round(Math.max(0, archers) * keep))) };
}

/** Доля как проценты словами: целые, со знаком минуса. */
const pct = (share: number): string => `${Math.round(share * 100)} %`;
/** Грань кости словами: целая — без дроби, иначе с одной цифрой, через запятую (дверь `game/num`). */
const faces = (n: number): string => num(n);

/**
 * Что даст следующее дело — строка меню осаждающего (правило 18: числа — этими же функциями). `walls` — есть ли у города
 * стена: у логова её нет, и залп бьёт только по духу.
 */
export function craftGain(w: SiegeWindow, act: CraftAct, now: number, walls: boolean): string {
  const block = craftBlock(w, act, now);
  if (block) return block;
  if (act === 'fortify') {
    const next = craftAfter(w, act, now).craft;
    return `Вылазке и удару с тыла кость −${faces(fortFaces(next) - fortFaces(w.craft))}, всего −${faces(fortFaces(next))}.`;
  }
  const after = { ...w, ...craftAfter(w, act, now) };
  const shake = garrisonWear(w, now) - garrisonWear(after, now);
  const parts = [
    walls ? 'кость этой фазы +2 к пролому и сдаче' : 'кость этой фазы +2',
    Math.round(shake * 100) > 0 ? `мораль гарнизона −${pct(shake)}` : 'мораль гарнизона уже на дне осады',
  ];
  const line = parts.join(', ');
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}

/**
 * Что сделано в лагере — словами для обороняющегося и для донесения о бое. Пусто — ничего не делали. `walls` — есть ли у
 * города стена, как у `craftGain`: у логова и двора мира её нет, и пролома строка не называет (docs/siege_audit.md,
 * решение 7) — меню и строка «что сделано» одного окна не расходятся.
 */
export function craftNote(craft: Craft | undefined, walls = true): string {
  const parts: string[] = [];
  const fort = Math.min(craftMax('fortify'), count(craft?.fort));
  if (fort > 0) parts.push(`Лагерь укреплён на ${fort} из ${craftMax('fortify')}. Кость тех, кто идёт на лагерь, −${faces(fortFaces(craft))}.`);
  const shots = count(craft?.shots);
  if (shots > 0) parts.push(`Город обстреляли ${shots} раз${shots % 10 >= 2 && shots % 10 <= 4 && (shots % 100 < 12 || shots % 100 > 14) ? 'а' : ''}.`);
  const breach = Math.round(breachOf(craft) * BREACH_MAX);
  if (walls && breach > 0) parts.push(`В стене ${breach} из ${BREACH_MAX} проломов — ${pct(breachOf(craft))} стены без защитников.`);
  return parts.join(' ');
}
