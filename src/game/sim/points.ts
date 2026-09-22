// Очки правителя: единственная дверь. Читают их отсюда, перекладывают базу отсюда, и
// второго места, где к `RealmState.points` прикасаются, быть не должно — как у алмазов
// с их `creditGems` (замок держит `realm.test.ts`, читая исходники).
//
// **Очки — функция времени, а не счётчик.** В партии лежит пара «сколько было и когда»
// (`points`, `pointsAt`), а нынешнее число выводится при чтении. Тика нет, накопителя нет,
// догон офлайна прибавляет очки сам — тем, что двигает `s.time`. Тот же приём, которым
// живут очаг предыстории, часы голода осады и древесина лагеря.
//
// **Потолок зажимает при чтении, но одного зажима мало — надо перекладывать базу.** Игрок
// у потолка тратит очки; если `pointsAt` останется старым, следующее же чтение вернёт его
// к потолку, и уровень достанется даром. Поэтому всякая запись идёт через `bank`, и это
// тест-свойство с мутацией: «потратил у потолка — не вернулось».
import type { GameState, RealmBranch, RulerSkills } from '../types';
import { DAY_LENGTH } from '../constants';
import { POINTS_CAP, REALM_BRANCHES, pointsPerDay } from '../data/realm';

/** Сколько очков этого вида даёт правитель за игровой день. Пустого места у дома не бывает. */
export const rulerRate = (s: GameState, branch: RealmBranch): number => pointsPerDay(s.realm?.ruler?.skills?.[branch] ?? 0);

/**
 * Сколько очков этого вида сейчас. Чистое чтение: партию не трогает, дважды подряд даёт
 * то же число, и сколько раз игрок заглядывал — не важно.
 */
export function pointsOf(s: GameState, branch: RealmBranch): number {
  const r = s.realm;
  if (!r) return 0;
  const had = Math.max(0, r.points?.[branch] ?? 0);
  const since = Math.max(0, s.time - (r.pointsAt ?? 0));
  return Math.min(POINTS_CAP, had + (rulerRate(s, branch) * since) / DAY_LENGTH);
}

/** Все три вида разом — для карточки и для тестов. */
export const allPoints = (s: GameState): RulerSkills =>
  Object.fromEntries(REALM_BRANCHES.map((b) => [b, pointsOf(s, b)])) as RulerSkills;

/**
 * Переложить базу: то, что накопилось к этой минуте, становится отложенным, и отсчёт
 * начинается заново. Зовут её ровно два события — трата и смена правителя (у нового своя
 * ставка), — и оба обязаны её звать: без неё прошлое считалось бы по новой ставке, а
 * потолок тёк бы.
 *
 * Тот же приём, что `works.rebaseWood` и `bombard.reaim`: смена ставки не переписывает
 * прошлое.
 */
export function bank(s: GameState): void {
  const r = s.realm;
  if (!r) return;
  const now = allPoints(s);
  for (const b of REALM_BRANCHES) r.points[b] = now[b];
  r.pointsAt = s.time;
}
