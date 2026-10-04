// Действия над верой: обряд праздника, уклад храма, надлом и крещение.
//
// Считать здесь нечего — всё, что о вере можно спросить, считается при чтении в
// `derived.ts` (`pietyBreakdown`, `faithTilt`, `heresy`, `fervour`). Здесь
// только то, что меняет состояние и пишет в летопись; зависимость
// односторонняя, как у `sim/smithy.ts` с `forgeInfo`.
//
// **Тика у веры нет и заводить его нельзя.** Обряд держится отметкой `riteUntil`,
// надлом убывает от `strainAt`, набожность выводится из состояния — поэтому
// офлайн-догон проходит мимо всего этого, ничего не доигрывая, и вернувшийся
// после долгого отсутствия игрок застаёт ровно то же, что застал бы в игре.
import type { FaithId, GameState, ObservanceId } from '../types';
import {
  BAPTISM_GOLD_PER_POP,
  BAPTISM_STRAIN,
  DAY_LENGTH,
  RITE_DAYS,
  RITE_FOOD_PER_POP,
  RITE_GOLD_PER_POP,
  STRAIN_DAYS,
} from '../constants';
import { FAITH_BY_ID, OBSERVANCE_BY_ID, type FeastDef } from '../data/faiths';
import { faithOf, heresy, population, seasonIndex, seasonOf, strainNow } from '../derived';
import { log } from './log';
import { pay } from './pay';

// ---------- Обряд ----------

export interface RiteInfo {
  /** Праздник этого сезона у этой веры. null — вера ещё неизвестна. */
  feast: FeastDef | null;
  /** Цена обряда сейчас. */
  food: number;
  gold: number;
  /** Секунд, пока обряд ещё идёт. 0 — не идёт. */
  left: number;
  /** Почему нельзя справить; null — можно. */
  blocked: string | null;
}

/**
 * Всё об обряде считается здесь и при чтении: цена, срок и причина отказа
 * приходят в панель готовыми, своих формул она не держит.
 */
export function riteInfo(s: GameState): RiteInfo {
  const id = faithOf(s);
  const pop = population(s);
  const food = Math.round(pop * RITE_FOOD_PER_POP);
  const gold = Math.round(pop * RITE_GOLD_PER_POP);
  const left = Math.max(0, (s.faith?.riteUntil ?? 0) - s.time);
  if (!id) return { feast: null, food, gold, left, blocked: 'Вера города ещё не ясна.' };
  const feast = FAITH_BY_ID[id].feasts[seasonOf(s.time)];

  let blocked: string | null = null;
  if (left > 0) blocked = 'Обряд идёт.';
  // Раз в сезон — по номеру сезона, а не по суткам. Считай мы дни, обряд,
  // справленный в последний день лета, открылся бы снова назавтра.
  //
  // «Обряд уже был» узнаётся по `riteUntil`, а не по `riteAt`: у первого обряда
  // партии `riteAt` равен нулю — время начинается с нуля, — и проверка `> 0`
  // молча пропускала бы его. Поймал это тест, а не рассуждение.
  else if (s.faith.riteUntil > 0 && seasonIndex(s.faith.riteAt) === seasonIndex(s.time)) {
    blocked = 'Обряд этого сезона уже справили.';
  } else if (Math.floor(s.resources.food) < food) blocked = 'Не хватает еды.';
  else if (Math.floor(s.gold) < gold) blocked = 'Не хватает золота.';
  return { feast, food, gold, left, blocked };
}

/**
 * Отметить обряд начавшимся. Отдельной функцией, потому что зовут её двое:
 * храм (`holdRite`, платит сам) и событие «Приход зовёт на праздник» (плату уже
 * сняло само событие через `payEventCost`). Две отметки в двух местах разошлись
 * бы ровно тогда, когда правят одну из них.
 */
export function beginRite(s: GameState): void {
  s.faith.riteAt = s.time;
  s.faith.riteUntil = s.time + RITE_DAYS * DAY_LENGTH;
}

/** Справить обряд. Плата снимается сразу — как за стройку и за пир. */
export function holdRite(s: GameState): string | null {
  const info = riteInfo(s);
  if (info.blocked) return info.blocked;
  pay(s, { food: info.food });
  s.gold -= info.gold;
  beginRite(s);
  const feast = info.feast as FeastDef;
  log(s, `${feast.name}: ${feast.text}`, 'good');
  return null;
}

// ---------- Уклад ----------

export function setObservance(s: GameState, id: ObservanceId): string | null {
  if (!OBSERVANCE_BY_ID[id]) return 'Такого устава нет.';
  if (s.faith.observance === id) return null;
  s.faith.observance = id;
  log(s, `Устав прихода: ${OBSERVANCE_BY_ID[id].name.toLowerCase()}.`);
  return null;
}

// ---------- Надлом ----------

/**
 * Прибавить надлома. Новый складывается с остатком старого и отсчитывается
 * заново: два навязанных решения подряд бьют больнее одного, но копиться без
 * предела не могут — потолок ставит сама шкала набожности, а срок — `STRAIN_DAYS`.
 */
export function addStrain(s: GameState, n: number): void {
  if (n <= 0) return;
  s.faith.strain = strainNow(s) + n;
  s.faith.strainAt = s.time;
}

/** Сколько игровых дней надлому осталось. Для панели и текстов. */
export const strainDaysLeft = (s: GameState): number =>
  s.faith.strain <= 0 ? 0 : Math.max(0, STRAIN_DAYS - (s.time - s.faith.strainAt) / DAY_LENGTH);

// ---------- Реликвия ----------

/**
 * Реликвия приезжает из события и уходит с разорением (`sim/expedition`). Одна
 * на веру и одинаковая по силе у всех четырёх — вещь, а не превосходство.
 * Второй раз её не дают: событие само проверяет, что слот пуст.
 */
export function grantRelic(s: GameState): boolean {
  const id = faithOf(s);
  if (!id || s.faith.relic) return false;
  s.faith.relic = id;
  log(s, `В храме появилась святыня: ${FAITH_BY_ID[id].relic}. Молва о ней идёт по округе.`, 'good');
  return true;
}

/** Реликвию унесли. Возвращает её имя — летопись о такой потере обязана сказать. */
export function loseRelic(s: GameState): string | null {
  const relic = s.faith?.relic;
  if (!relic) return null;
  s.faith.relic = null;
  return FAITH_BY_ID[relic].relic;
}

// ---------- Крещение ----------

export interface BaptismInfo {
  /** Куда можно креститься. Пусто — некуда: вера уже не языческая. */
  options: FaithId[];
  gold: number;
  /** Почему нельзя; null — можно. */
  blocked: string | null;
}

/**
 * Крещение — единственный способ сменить веру, и он односторонний: язычник
 * может принять крест, обратно дороги нет. Так это и было: решение принимали
 * раз и жили с ним.
 *
 * Куда именно — выбор игрока между двумя обрядами, и он не безразличен: у них
 * разные наклоны (`data/faiths.ts`), и на карте по-разному лягут отношения с
 * соседями (`world/faith.faithAttitude`).
 */
export function baptismInfo(s: GameState): BaptismInfo {
  const id = faithOf(s);
  const gold = Math.round(population(s) * BAPTISM_GOLD_PER_POP);
  if (id !== 'pagan') return { options: [], gold, blocked: 'Город уже крещён.' };
  return {
    options: ['catholic', 'orthodox'],
    gold,
    blocked: Math.floor(s.gold) < gold ? 'Не хватает золота.' : null,
  };
}

export function baptize(s: GameState, to: FaithId): string | null {
  const info = baptismInfo(s);
  if (info.blocked) return info.blocked;
  if (!info.options.includes(to)) return 'В эту веру не крестят.';
  const was = FAITH_BY_ID[faithOf(s) as FaithId];
  s.gold -= info.gold;
  s.faith.id = to;
  s.faith.converted = true;
  // Реликвия старой веры остаётся при старой вере: громовой камень в костёле не
  // стоит. Молчать об этом нельзя — игрок за неё платил вниманием.
  const lost = loseRelic(s);
  // Обряд старой веры обрывается вместе с ней: праздновать Расу в костёле не
  // станут, а держать прибавку от отменённого обряда было бы враньём.
  s.faith.riteUntil = 0;
  s.faith.riteAt = 0;
  // Надлом — и есть тот самый риск раскола, и он не бросок кости: игра
  // считается на чтении, а спрятанный бросок пришлось бы где-то хранить и
  // как-то объяснять. Риск здесь настоящий и целиком в руках игрока: обычный
  // приход от такого удара проваливается ниже порога ереси, а высокий храм со
  // строгим уставом и свежим обрядом — выдерживает. Готовиться к крещению
  // можно, отделаться дёшево нельзя.
  addStrain(s, BAPTISM_STRAIN);
  log(s, `Город принял крещение: ${was.name.toLowerCase()} сменилось на ${FAITH_BY_ID[to].name.toLowerCase()}.`, 'good');
  log(
    s,
    heresy(s)
      ? 'Старики ропщут, роща пустует. Приход надломлен.'
      : 'Старики ропщут, роща пустует, но храм крепок. Приход переживёт.',
    'bad',
  );
  if (lost) log(s, `${lost} убрали из храма: старой вере — старое место.`, 'bad');
  return null;
}

// ---------- Мост из мира ----------

/**
 * Вера деревни и чужая вера вокруг приезжают из мира — он один знает, на какой
 * клетке стоит замок. Племя про координаты не знает и знать не должно, поэтому
 * дверь одна и она здесь.
 *
 * Первый ответ мира **ставит** веру: новая партия начинается без неё (мир ещё
 * не отвечал), и подставлять католичество «по умолчанию» нельзя — деревня под
 * Вильнюсом на минуту оказалась бы католической, а потом сменила бы веру молча.
 * Дальше вера уже своя: крещение мир не отменяет, и второй раз он её не трогает.
 *
 * Возвращает `true`, если что-то изменилось: пульс идёт часто (`PULSE_MS` в
 * `world/store.ts`), и
 * перерисовывать по нему экран без причины не за что.
 */
export function syncFaith(s: GameState, id: FaithId, pressure: number): boolean {
  const p = Math.max(0, Math.min(1, pressure));
  let changed = false;
  if (!s.faith.id) {
    s.faith.id = id;
    const def = FAITH_BY_ID[id];
    log(s, `Округа живёт своей верой: ${def.name.toLowerCase()}. В городе стоит ${def.temple.toLowerCase()}.`);
    changed = true;
  }
  if (Math.abs(s.faith.pressure - p) > 0.005) {
    s.faith.pressure = p;
    changed = true;
  }
  return changed;
}
