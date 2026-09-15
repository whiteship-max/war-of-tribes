// Главный шаг симуляции. Мутирует состояние на месте.
import type { GameState } from '../types';
import {
  DAY_LENGTH,
  EVENT_INTERVAL_MAX,
  EVENT_INTERVAL_MIN,
  RESOURCE_IDS,
  STARVATION_DEATH,
} from '../constants';
import {
  buildRate,
  currentSite,
  foodConsumptionPerDay,
  heatingWoodPerDay,
  moraleTarget,
  policyMoralePerDay,
  productionPerDay,
  seasonDayOf,
  seasonIndex,
  seasonMods,
  seasonOf,
  storageCap,
  taxIncomePerDay,
  yearOf,
} from '../derived';
import { COLD_DEATH, SEASON_DAYS, SEASON_META } from '../data/seasons';
import { BUILDING_BY_ID } from '../data/buildings';
import { QUESTS } from '../data/quests';
import { pickEvent } from '../data/events';
import { TUTORIAL_EVENT_MUTE } from '../data/tutorial';
import { MUTINY_EVENT } from '../data/order';
import { famineToll, growthTick, killPop, logPopDay } from './population';
import { mutinySilence, unrestTick } from './mutiny';
import { normalizeAssignments } from './workers';
import { forgeTick } from './smithy';
import { surveyTick } from './survey';
import { marketTick } from './market';
import { recruitTick } from './army';
import { settleHires } from './hire';
import { roll, rollInt } from './roll';
import { log, trimLog } from './log';
import { recordProduced, refreshCard } from '@/profile/stats';

export interface TickOptions {
  /** Офлайн-догон: события не запускаются. */
  offline?: boolean;
}

/**
 * Шаг симуляции. Возвращает текст того, что разрешилось без игрока, пока он
 * смотрел на экран: окно мятежа, оставленное без ответа. Показать это некому,
 * кроме оболочки, — поэтому текст отдаётся наружу, а не пишется в состояние.
 */
export function tick(s: GameState, dt: number, opts: TickOptions = {}): string | null {
  let settled: string | null = null;
  const dayBefore = Math.floor(s.time / DAY_LENGTH);
  const seasonBefore = seasonIndex(s.time);
  s.time += dt;
  const dayAfter = Math.floor(s.time / DAY_LENGTH);

  // Осаду снимает мир своим пульсом. В догоне пульса нет: он идёт до того, как мир
  // вообще открылся, — и здесь, и только здесь, осада снимается по сроку голода,
  // который мир назвал последним (`SiegeState.until`).
  if (opts.offline && s.siege && s.time >= s.siege.until) s.siege = null;

  // Мир мог измениться между тиками (сгорела хижина, кончилась стройка) —
  // сначала приводим в порядок, кто где работает, потом считаем по этим данным.
  normalizeAssignments(s);

  // Места агентов: нанятый пришёл — встаёт на место; безымянным — имя, как только
  // мир назвал веру. Возраст не тикает: он выводится из этих же часов при чтении.
  settleHires(s);

  // Сезон читается один раз за тик и дальше передаётся вниз: все множители из одной таблицы.
  const mods = seasonMods(s);

  // 1. Производство и потребление.
  const prod = productionPerDay(s, mods);
  const cap = storageCap(s);
  // Профиль считает добытое по тому, что действительно легло на склад: полный
  // склад ничего не добавил, и в итогах этого быть не должно.
  let gained = 0;
  for (const r of RESOURCE_IDS) {
    if (!prod[r]) continue;
    const before = s.resources[r];
    s.resources[r] = Math.min(cap, before + (prod[r] * dt) / DAY_LENGTH);
    gained += Math.max(0, s.resources[r] - before);
  }
  recordProduced(s, gained);
  const eat = (foodConsumptionPerDay(s, mods) * dt) / DAY_LENGTH;
  s.resources.food -= eat;
  if (s.resources.food < 0) {
    s.resources.food = 0;
    s.starvation += dt;
    if (s.starvation >= STARVATION_DEATH) {
      s.starvation = STARVATION_DEATH * 0.5;
      killPop(s, famineToll(s), 'голод');
    }
  } else {
    s.starvation = Math.max(0, s.starvation - dt * 2);
  }

  // 1б. Отопление: зимой очаги жгут дрова. Кончились — племя мёрзнет,
  // мораль валится вдвое быстрее (см. moraleTarget и speed ниже), а холод забирает стариков.
  const heat = (heatingWoodPerDay(s, mods) * dt) / DAY_LENGTH;
  if (heat > 0) {
    s.resources.wood -= heat;
    if (s.resources.wood < 0) {
      s.resources.wood = 0;
      s.freezing += dt;
      if (s.freezing >= COLD_DEATH) {
        s.freezing = COLD_DEATH * 0.5;
        killPop(s, famineToll(s), 'холод');
      }
    } else {
      s.freezing = Math.max(0, s.freezing - dt * 2);
    }
  } else {
    s.freezing = Math.max(0, s.freezing - dt * 2);
  }

  // 2. Улучшения: свободные жители и ремесленники работают над первым в очереди.
  const site = currentSite(s);
  if (site) {
    site.work += buildRate(s, mods) * dt;
    if (site.work >= site.workRequired) {
      site.level += 1;
      site.work = 0;
      site.workRequired = 0;
      log(s, `${BUILDING_BY_ID[site.type].name}: уровень ${site.level}.`, 'good');
    }
  }

  // 3. Кузница и казармы. Кузнец кует снаряжение, казармы превращают свободных
  // жителей в бойцов — обе очереди идут своим чередом, как стройка.
  forgeTick(s, dt);
  recruitTick(s, dt);
  // Изучение округи в Дозоре: не работа, а срок. Одна сверка отметки с часами —
  // поэтому офлайн-догон проходит мимо неё ровно так же, как непрерывная игра.
  surveyTick(s);

  // 3б. Рынок: налог капает в казну, дневной прилавок обновляется со сменой дня,
  // вернувшиеся караваны разгружаются.
  marketTick(s, dt, taxIncomePerDay(s));

  // 4. Мораль плавно стремится к целевой. Пока племя мёрзнет — вдвое быстрее.
  const target = moraleTarget(s);
  const speed = (dt / 20) * (s.freezing > 0 ? 2 : 1); // ~20 сек до заметного сдвига
  s.morale += (target - s.morale) * Math.min(1, speed);
  // Указ и рацион двигают мораль не целью, а прямо: ровно столько в игровой день,
  // сколько написано на кнопке в ратуше.
  const drift = (policyMoralePerDay(s) * dt) / DAY_LENGTH;
  if (drift !== 0) s.morale = Math.max(0, Math.min(100, s.morale + drift));

  // 5. Прирост населения. Ни рождений поимённо, ни старения: племя — это число,
  // и растёт оно от свободного жилья, запаса еды и морали (см. sim/population).
  growthTick(s, dt, mods);

  // 6. Итог дня по племени — одной строкой, а не по человеку на строку.
  if (dayAfter > dayBefore) {
    logPopDay(s);
    // Визитка пересобирается раз в игровой день: это тот слепок, который на
    // карте мира увидят чужие, и собирать его им будет не из чего.
    refreshCard(s);
    // Летопись живёт месяц: старое отбрасывается на смене суток, а не на каждой
    // записи — проход по трём сотням строк раз в игровой день ничего не стоит.
    trimLog(s);
  }

  // 6б. Смена сезона и предупреждение о зиме.
  if (seasonIndex(s.time) !== seasonBefore) {
    const season = seasonOf(s.time);
    log(s, `Пришла ${SEASON_META[season].name.toLowerCase()}. ${SEASON_META[season].hint}`, season === 'winter' ? 'bad' : 'info');
  }
  // Предупреждение поднимается за игровой день до зимы — в последний день осени.
  // Без конкретного расчёта запасов зима читается как несправедливость, а с ним — как задача.
  if (dayAfter > dayBefore && seasonOf(s.time) === 'autumn' && seasonDayOf(s.time) === SEASON_DAYS) {
    const year = yearOf(s.time);
    if (s.winterWarnedYear !== year) {
      s.winterWarnedYear = year;
      s.winterWarning = true;
      log(s, 'Скоро зима. Пора считать запасы еды и дров.', 'bad');
    }
  }
  // Догон мог проскочить осень насквозь — устаревшее предупреждение снимаем.
  if (s.winterWarning && seasonOf(s.time) !== 'autumn') s.winterWarning = false;

  // 7. Задания.
  for (const q of QUESTS) {
    if (s.completedQuests.includes(q.id)) continue;
    if (!q.check(s)) continue;
    s.completedQuests.push(q.id);
    for (const r of RESOURCE_IDS) {
      const n = q.reward[r];
      if (n) s.resources[r] = Math.min(storageCap(s), s.resources[r] + n);
    }
    s.prestige += 2;
    log(s, `Задание выполнено: ${q.title}.`, 'quest');
  }

  // 7б. Ропот и мятеж. Порядок считается при чтении; здесь идёт только срок,
  // и только при игроке — офлайн-догон его не двигает (см. sim/mutiny).
  const unrest = unrestTick(s, dt, !opts.offline);
  if (unrest === 'silence') {
    // Окно мятежа осталось без ответа: стража выходит сама. Разрешается оно тем
    // же путём, что и ответ игрока, — счёт, следующее событие, строка летописи.
    settled = mutinySilence(s);
    s.activeEvent = null;
    s.stats.eventsResolved++;
    scheduleNextEvent(s);
    log(s, `Мятеж: ${settled}`, 'bad');
  }

  // 8. События. Мятеж случаем не выпадает: его поднимает срок ропота, и первым —
  // на столе не должно лежать ничего, что заслонит его.
  if (unrest === 'raise' && !s.activeEvent) {
    s.activeEvent = { defId: MUTINY_EVENT, at: s.time };
  } else if (!s.tutorialDone && s.time < TUTORIAL_EVENT_MUTE) {
    // Пока идёт проводка первых шагов, модалка события накрыла бы подсветку.
    s.nextEventAt = Math.max(s.nextEventAt, s.time + 20);
  } else if (!s.activeEvent && s.time >= s.nextEventAt) {
    if (opts.offline) {
      s.nextEventAt = s.time + 20 + roll(s) * 20;
    } else if (s.unrest > 0) {
      // Пока идёт ропот, случайных окон нет: волки или ярмарка накрыли бы собой
      // и срок, и цену, а мятеж встал бы в очередь за ними.
      s.nextEventAt = s.time + 20;
    } else {
      const e = pickEvent(s);
      if (e) s.activeEvent = { defId: e.id, at: s.time };
      else s.nextEventAt = s.time + rollInt(s, EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
    }
  }
  return settled;
}

/** Догоняет офлайн-время фиксированным шагом. */
export function catchUp(s: GameState, seconds: number, step = 1): void {
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(step, left);
    tick(s, dt, { offline: true });
    left -= dt;
  }
}

export const scheduleNextEvent = (s: GameState): void => {
  s.nextEventAt = s.time + rollInt(s, EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
};
