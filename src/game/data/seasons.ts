// Конфигурация сезонов. Всё, что сезон меняет в балансе, лежит здесь и нигде больше:
// логика (derived.ts, sim/tick.ts) только читает эту таблицу.
import type { JobId, Season } from '../types';
import { DAY_LENGTH } from '../constants';

/** Сколько игровых дней длится один сезон. 5 × 60 сек = 5 минут реального времени. */
export const SEASON_DAYS = 5;

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Игровых дней в году. */
export const YEAR_DAYS = SEASON_DAYS * SEASONS.length;

/** Секунд в сезоне. */
export const SEASON_SECONDS = SEASON_DAYS * DAY_LENGTH;

export interface SeasonModifiers {
  /** Множитель выработки по профессиям; отсутствующая профессия — без изменений. */
  jobs: Partial<Record<JobId, number>>;
  /** Множитель скорости стройки. */
  build: number;
  /** Множитель скорости исследований. */
  research: number;
  /** Прибавка к целевой морали. */
  morale: number;
  /** Множитель потребления еды. */
  food: number;
  /** Дрова в день на одного жителя под открытым небом. 0 — отопление не нужно. */
  heating: number;
}

export const SEASON_MODIFIERS: Record<Season, SeasonModifiers> = {
  // Весна — рост: земля оттаяла, зелень пошла.
  spring: {
    jobs: { gatherer: 1.15, farmer: 1.2 },
    build: 1,
    research: 1,
    morale: 0,
    food: 1,
    heating: 0,
  },
  // Лето — пик: длинный день, но зверь разбредается по лесам.
  summer: {
    jobs: { farmer: 1.35, gatherer: 1.25, woodcutter: 1.1, stonecutter: 1.1, miner: 1.1, hunter: 0.9 },
    build: 1.1,
    research: 1,
    morale: 2,
    food: 1,
    heating: 0,
  },
  // Осень — окно запаса: жатва и нагулявший жир зверь. Тут копят на зиму.
  autumn: {
    jobs: { farmer: 1.5, hunter: 1.2, gatherer: 1.1, woodcutter: 1.15 },
    build: 1,
    research: 1,
    morale: 0,
    food: 1,
    heating: 0,
  },
  // Зима — испытание: поле мертво, зато племя сидит у огня и думает.
  // Скот зимует в загоне и почти не проседает — ради этого животноводство и изучают.
  winter: {
    jobs: { farmer: 0, gatherer: 0.4, hunter: 0.75, woodcutter: 0.8, stonecutter: 0.65, miner: 0.7, herder: 0.9 },
    build: 0.7,
    research: 1.15,
    morale: -6,
    food: 1.4,
    heating: 1.2,
  },
};

/**
 * Первая в партии зима мягче: все её штрафы умножаются на этот коэффициент.
 * Новичок должен понять правила, а не умереть на обучении.
 */
export const FIRST_WINTER_SOFTEN = 0.6;

/** Житель под крышей (укрытие или хижина) жжёт дров вдвое меньше, чем в открытом лагере. */
export const HEATING_SHELTERED = 0.5;

/** Готовый костёр греет всё поселение и срезает расход. */
export const HEATING_CAMPFIRE = 0.85;

/** Сколько секунд зимы без дров племя выдерживает до первой смерти от холода. */
export const COLD_DEATH = 2 * DAY_LENGTH;

/** Насколько сильнее падает мораль, пока племя мёрзнет. */
export const FREEZING_MORALE_PENALTY = 20;

export const SEASON_META: Record<Season, { name: string; icon: string; hint: string }> = {
  spring: { name: 'Весна', icon: '🌱', hint: 'Земля оттаяла: сбор и поля идут веселее.' },
  summer: { name: 'Лето', icon: '☀️', hint: 'Длинный день: поля, стройка и добыча на пике, но зверь разбрёлся.' },
  autumn: { name: 'Осень', icon: '🍂', hint: 'Жатва и жирный зверь. Успей набить склады — дальше зима.' },
  winter: { name: 'Зима', icon: '❄️', hint: 'Поля мертвы, добыча просела, дрова горят. Зато думается хорошо.' },
};

/** Доля суток, когда солнце над горизонтом. Зимой ночь длиннее. */
export const SEASON_DAYLIGHT: Record<Season, number> = {
  spring: 0.52,
  summer: 0.62,
  autumn: 0.48,
  winter: 0.36,
};
