// Дела полководца в своём осадном лагере: «Укрепить лагерь» и «Обстрел города» (задание владельца 06.10.2026, ночь 2).
//
// Модуль чистый, того же рода, что `siege.ts` и `bombard.ts`: ни состояния мира, ни часов, ни `Math.random`, и без `@/` —
// его собирает сервер войны (`netlify/lib/war.ts`). Правило то же — **считаем при чтении, не тикаем**: что сделано, лежит
// в окне осады двумя счётчиками (`SiegeWindow.craft`), а всё, что они дают, выводится из них в минуту боя.
//
// Одна дверь на лагерь под логовом (мир на клиенте) и под городом игрока (сервер войны):
//  - укрепления — грани кости нападающих на лагерь (`fortFaces` → `GroundPenalty.works`, через `fights.campFight`);
//  - обстрел — пролом стены при штурме (`wallMen`) и дух гарнизона во всяком его бою, пока лагерь стоит (`garrisonWear`).
// Числа — `data/siegecraft.ts`, цены в энергии — `data/energy.ENERGY_PRICE`.
import { BOMBARD_VOLLEYS, FORTIFY_FACES } from './data/siegecraft';
import { siegeWear } from './siege';
import { gameDaysOfMs } from '../game/pace';
import { gameDaysText } from '../game/span';
import { num } from '../game/num';

/** Дело в лагере. Имена — строки таблицы энергии: цена дела у него одна. */
export type CraftAct = 'fortify' | 'bombard';
export const CRAFT_ACTS: readonly CraftAct[] = ['fortify', 'bombard'];

/** Что сделано в лагере за эту осаду. Лежит в окне осады; нет поля — ничего. */
export interface Craft {
  /** Сколько раз лагерь укрепляли. */
  fort?: number;
  /** Сколько залпов дал обстрел. */
  shots?: number;
}

/** Сколько раз дело можно сделать за осаду: строк в его таблице. */
export const craftMax = (act: CraftAct): number => (act === 'fortify' ? FORTIFY_FACES.length : BOMBARD_VOLLEYS.length);

/** Сколько раз дело уже сделано — не меньше нуля и не больше предела. */
export function craftDone(craft: Craft | undefined, act: CraftAct): number {
  const n = act === 'fortify' ? craft?.fort : craft?.shots;
  return Math.min(craftMax(act), Math.max(0, Number.isFinite(n) ? Math.floor(n as number) : 0));
}

/** Почему дело больше не сделать за эту осаду; null — можно. Энергию проверяет дверь энергии. */
export function craftBlock(craft: Craft | undefined, act: CraftAct): string | null {
  const max = craftMax(act);
  if (craftDone(craft, act) < max) return null;
  return act === 'fortify' ? `Лагерь укреплён до предела: ${max} из ${max}.` : `Город обстрелян до предела: ${max} из ${max}.`;
}

/** Окно после дела: счётчик на одно больше. Предел не переступается. */
export function craftAfter(craft: Craft | undefined, act: CraftAct): Craft {
  const fort = craftDone(craft, 'fortify') + (act === 'fortify' ? 1 : 0);
  const shots = craftDone(craft, 'bombard') + (act === 'bombard' ? 1 : 0);
  return {
    ...(fort > 0 ? { fort: Math.min(fort, craftMax('fortify')) } : {}),
    ...(shots > 0 ? { shots: Math.min(shots, craftMax('bombard')) } : {}),
  };
}

const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);

/** Сколько граней кости снимают укрепления у тех, кто идёт на лагерь. */
export const fortFaces = (craft: Craft | undefined): number => sum(FORTIFY_FACES.slice(0, craftDone(craft, 'fortify')));

/** Какая доля стены пробита, 0..1. */
export const breachOf = (craft: Craft | undefined): number =>
  Math.min(1, sum(BOMBARD_VOLLEYS.slice(0, craftDone(craft, 'bombard')).map((v) => v.wall)));

/** На сколько обстрел продвинул часы осады для духа гарнизона, мс мира. */
export const shakeMs = (craft: Craft | undefined): number =>
  sum(BOMBARD_VOLLEYS.slice(0, craftDone(craft, 'bombard')).map((v) => v.wear));

/**
 * Во сколько раз дух гарнизона в бою ниже от осады, идущей с минуты `since`, с обстрелом лагеря: часы осады
 * (`siege.siegeWear`), продвинутые залпами. Одна дверь на гарнизон под лагерем игрока — у логова (мир) и у города игрока
 * (сервер); дна осады обстрел не ломает.
 */
export const garrisonWear = (since: number, at: number, craft: Craft | undefined): number =>
  siegeWear(since - shakeMs(craft), at);

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
const days = (ms: number): string => gameDaysText(Math.round(gameDaysOfMs(ms)));

/**
 * Что даст следующее дело — строка меню осаждающего (правило 18: числа — этими же функциями). `since` и `at` нужны
 * обстрелу: у дна осады залп духу уже ничего не даёт, и строка говорит это. `walls` — есть ли у города стена: у логова
 * её нет, и пролом ему ничего не стоит.
 */
export function craftGain(craft: Craft | undefined, act: CraftAct, since: number, at: number, walls: boolean): string {
  const block = craftBlock(craft, act);
  if (block) return block;
  const next = craftAfter(craft, act);
  if (act === 'fortify') {
    return `Вылазке и удару с тыла кость −${faces(fortFaces(next) - fortFaces(craft))}, всего −${faces(fortFaces(next))}.`;
  }
  const shake = garrisonWear(since, at, craft) - garrisonWear(since, at, next);
  const parts = [
    walls ? `пролом ${pct(breachOf(next) - breachOf(craft))} стены` : '',
    Math.round(shake * 100) > 0 ? `мораль гарнизона −${pct(shake)}` : 'мораль гарнизона уже на дне осады',
  ].filter(Boolean);
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
  const fort = craftDone(craft, 'fortify');
  if (fort > 0) parts.push(`Лагерь укреплён на ${fort} из ${craftMax('fortify')}. Кость тех, кто идёт на лагерь, −${faces(fortFaces(craft))}.`);
  const shots = craftDone(craft, 'bombard');
  if (shots > 0) {
    const shake = `мораль гарнизона просела, как после ещё ${days(shakeMs(craft))} осады.`;
    parts.push(
      `Город обстреляли ${shots} из ${craftMax('bombard')} раз. ${walls ? `Пролом ${pct(breachOf(craft))} стены, ${shake}` : `${shake[0].toUpperCase()}${shake.slice(1)}`}`,
    );
  }
  return parts.join(' ');
}
