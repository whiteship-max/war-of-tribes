// Главный шаг симуляции. Мутирует состояние на месте.
import type { GameState } from '../types';
import {
  DAY_LENGTH,
  DAYS_PER_YEAR,
  EVENT_INTERVAL_MAX,
  EVENT_INTERVAL_MIN,
  GROWTH_REQUIRED,
  RESOURCE_IDS,
  STARVATION_DEATH,
} from '../constants';
import {
  buildRate,
  currentSite,
  foodConsumptionPerDay,
  hasTech,
  heatingWoodPerDay,
  housingCapacity,
  moraleTarget,
  policyMoralePerDay,
  productionPerDay,
  rationOf,
  researchRate,
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
import { TECH_BY_ID } from '../data/techs';
import { QUESTS } from '../data/quests';
import { pickEvent } from '../data/events';
import { TUTORIAL_EVENT_MUTE } from '../data/tutorial';
import { addVillager, killOldestVillager, killRandomVillager, removeVillager } from './population';
import { normalizeAssignments } from './workers';
import { forgeTick } from './smithy';
import { marketTick } from './market';
import { recruitTick } from './army';
import { chance, rnd, rndInt } from './random';
import { log } from './log';

export interface TickOptions {
  /** Офлайн-догон: события не запускаются. */
  offline?: boolean;
}

export function tick(s: GameState, dt: number, opts: TickOptions = {}): void {
  const dayBefore = Math.floor(s.time / DAY_LENGTH);
  const seasonBefore = seasonIndex(s.time);
  s.time += dt;
  const dayAfter = Math.floor(s.time / DAY_LENGTH);

  // Мир мог измениться между тиками (сгорела хижина, кончилась стройка) —
  // сначала приводим в порядок, кто где работает, потом считаем по этим данным.
  normalizeAssignments(s);

  // Сезон читается один раз за тик и дальше передаётся вниз: все множители из одной таблицы.
  const mods = seasonMods(s);

  // 1. Производство и потребление.
  const prod = productionPerDay(s, mods);
  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) {
    if (prod[r]) s.resources[r] = Math.min(cap, s.resources[r] + (prod[r] * dt) / DAY_LENGTH);
  }
  const eat = (foodConsumptionPerDay(s, mods) * dt) / DAY_LENGTH;
  s.resources.food -= eat;
  if (s.resources.food < 0) {
    s.resources.food = 0;
    s.starvation += dt;
    if (s.starvation >= STARVATION_DEATH) {
      s.starvation = STARVATION_DEATH * 0.5;
      if (s.villagers.length > 1) killRandomVillager(s, 'голод');
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
        if (s.villagers.length > 1) killOldestVillager(s, 'холод');
      }
    } else {
      s.freezing = Math.max(0, s.freezing - dt * 2);
    }
  } else {
    s.freezing = Math.max(0, s.freezing - dt * 2);
  }

  // 2. Стройка: свободные жители работают над первой стройплощадкой в очереди.
  // Улучшение — такая же стройка, просто у здания уже есть уровень.
  const site = currentSite(s);
  if (site) {
    site.work += buildRate(s, mods) * dt;
    if (site.work >= site.workRequired) {
      const name = BUILDING_BY_ID[site.type].name;
      site.level += 1;
      site.work = 0;
      site.workRequired = 0;
      log(s, site.level === 1 ? `Построено: ${name}.` : `${name}: уровень ${site.level}.`, 'good');
    }
  }

  // 3. Исследование.
  if (s.research) {
    s.research.work += researchRate(s, mods) * dt;
    const def = TECH_BY_ID[s.research.techId];
    if (s.research.work >= def.work) {
      s.techs.push(def.id);
      if (def.id === 'chiefdom') s.prestige += 5;
      s.research = null;
      log(s, `Изучено: ${def.name}.`, 'good');
    }
  }

  // 3б. Кузница и казармы. Кузнец кует снаряжение, казармы превращают свободных
  // жителей в бойцов — обе очереди идут своим чередом, как стройка.
  forgeTick(s, dt, mods);
  recruitTick(s, dt);

  // 3в. Рынок: налог капает в казну, дневной прилавок обновляется со сменой дня,
  // вернувшиеся караваны разгружаются. До технологии торга шаг ничего не делает.
  marketTick(s, dt, taxIncomePerDay(s));

  // 4. Мораль плавно стремится к целевой. Пока племя мёрзнет — вдвое быстрее.
  const target = moraleTarget(s);
  const speed = (dt / 20) * (s.freezing > 0 ? 2 : 1); // ~20 сек до заметного сдвига
  s.morale += (target - s.morale) * Math.min(1, speed);
  // Указ и рацион двигают мораль не целью, а прямо: ровно столько в игровой день,
  // сколько написано на кнопке в Доме вождя.
  const drift = (policyMoralePerDay(s) * dt) / DAY_LENGTH;
  if (drift !== 0) s.morale = Math.max(0, Math.min(100, s.morale + drift));

  // 5. Рост населения.
  const housing = housingCapacity(s);
  const foodDays = s.resources.food / Math.max(1, foodConsumptionPerDay(s, mods));
  // Рацион правит рождаемость: на скудном пайке детей не заводят вовсе.
  const growthMult = rationOf(s).growth;
  if (s.villagers.length < housing && foodDays >= 1.5 && s.morale >= 35 && growthMult > 0) {
    let rate = (1 + s.morale / 100) * growthMult;
    if (hasTech(s, 'traditions')) rate *= 1.3;
    s.growth += rate * dt;
    if (s.growth >= GROWTH_REQUIRED) {
      s.growth = 0;
      const v = addVillager(s);
      s.stats.born++;
      log(s, `${v.name} ${v.sex === 'f' ? 'пришла' : 'пришёл'} в племя.`, 'good');
    }
  } else {
    s.growth = Math.max(0, s.growth - dt * 0.5);
  }

  // 6. Старение и смена поколений (раз в игровой день).
  if (dayAfter > dayBefore) {
    for (const v of s.villagers) v.age += 1 / DAYS_PER_YEAR;
    const elders = s.villagers.filter((v) => v.age >= 58);
    for (const v of elders) {
      if (s.villagers.length <= 2) break;
      if (chance((v.age - 55) / 40)) {
        removeVillager(s, v.id);
        s.stats.died++;
        log(s, `${v.name} умер${v.sex === 'f' ? 'ла' : ''} от старости в ${Math.floor(v.age)} лет.`, 'bad');
      }
    }
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

  // 8. Случайные события (только онлайн).
  if (!s.tutorialDone && s.time < TUTORIAL_EVENT_MUTE) {
    // Пока идёт проводка первых шагов, модалка события накрыла бы подсветку.
    s.nextEventAt = Math.max(s.nextEventAt, s.time + 20);
  } else if (!s.activeEvent && s.time >= s.nextEventAt) {
    if (opts.offline) {
      s.nextEventAt = s.time + 20 + rnd() * 20;
    } else {
      const e = pickEvent(s);
      if (e) s.activeEvent = { defId: e.id, at: s.time };
      else s.nextEventAt = s.time + rndInt(EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
    }
  }
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
  s.nextEventAt = s.time + rndInt(EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
};
