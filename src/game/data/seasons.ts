// Конфигурация сезонов. Всё, что сезон меняет в балансе, лежит здесь и нигде больше:
// логика (derived.ts, sim/tick.ts) только читает эту таблицу.
import type { JobId, Season } from '../types';
import { DAY_LENGTH } from '../constants';
import { gameSec } from '../pace';
import { yardSeason } from './yards';

/** Сколько игровых дней длится один сезон. В секундах реального времени — `SEASON_SECONDS`. */
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
  /** Прибавка к целевой морали. */
  morale: number;
  /** Множитель потребления еды. */
  food: number;
  /** Дрова в день на одного жителя под открытым небом. 0 — отопление не нужно. */
  heating: number;
}

// Множители профессий — строки дворов (`data/yards.ts`): сезон двора лежит рядом с его
// выработкой, а сюда собирается по сезону.
export const SEASON_MODIFIERS: Record<Season, SeasonModifiers> = {
  // Весна — рост: земля оттаяла, зелень пошла.
  spring: {
    jobs: yardSeason('spring'),
    build: 1,
    morale: 0,
    food: 1,
    heating: 0,
  },
  // Лето — пик: длинный день, но зверь разбредается по лесам.
  summer: {
    jobs: yardSeason('summer'),
    build: 1.1,
    morale: 2,
    food: 1,
    heating: 0,
  },
  // Осень — окно запаса: жатва и нагулявший жир зверь. Тут копят на зиму.
  autumn: {
    jobs: yardSeason('autumn'),
    build: 1,
    morale: 0,
    food: 1,
    heating: 0,
  },
  // Зима — испытание: поле мертво, добыча просела, дрова горят. Скот зимует в загоне.
  winter: {
    jobs: yardSeason('winter'),
    build: 0.7,
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

/**
 * Скидка на отопление всему посёлку, всегда. Костра она не спрашивает: у костра нет
 * уровня, и читать у него нечего, — имя поля осталось с тех пор, когда костёр
 * строили. Обещать «от общего костра» в интерфейсе поэтому нельзя.
 */
export const HEATING_CAMPFIRE = 0.85;

/** Сколько секунд зимы без дров племя выдерживает до первой смерти от холода. */
export const COLD_DEATH = gameSec(2 * DAY_LENGTH);

/** Насколько сильнее падает мораль, пока племя мёрзнет. */
export const FREEZING_MORALE_PENALTY = 20;

export const SEASON_META: Record<Season, { name: string; icon: string; hint: string }> = {
  spring: { name: 'Весна', icon: '🌱', hint: 'Земля оттаяла: сбор и поля идут веселее.' },
  summer: { name: 'Лето', icon: '☀️', hint: 'Длинный день: поля, стройка и добыча на пике, но зверь разбрёлся.' },
  autumn: { name: 'Осень', icon: '🍂', hint: 'Жатва и жирный зверь. Успей набить склады — дальше зима.' },
  winter: { name: 'Зима', icon: '❄️', hint: 'Поля мертвы, добыча просела, дрова горят. Считай запасы.' },
};

/** Доля суток, когда солнце над горизонтом. Зимой ночь длиннее. */
export const SEASON_DAYLIGHT: Record<Season, number> = {
  spring: 0.52,
  summer: 0.62,
  autumn: 0.48,
  winter: 0.36,
};

/** Время суток: так его видит строка состояния и так его считает гибель агента. */
export type DayPart = 'morning' | 'day' | 'evening' | 'night';

/**
 * Где по фазе солнца кончается каждое время суток (0 — рассвет, 0.5 — закат). Одна
 * таблица на значок в строке состояния и на риск тайного дела: ночь, которую игрок
 * видит сверху экрана, обязана быть той же ночью, что прячет лазутчика.
 */
export const DAY_PART_UNTIL: Readonly<Record<Exclude<DayPart, 'night'>, number>> = {
  morning: 0.08,
  day: 0.42,
  evening: 0.58,
};
