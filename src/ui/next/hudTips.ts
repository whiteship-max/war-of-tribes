/**
 * Подсказки верха нового интерфейса — чистые функции от состояния (правило 18: строка с числом считается
 * функциями игры, и тест сверяет её с функцией — `hudTips.test.ts`). Своей арифметики у строк нет: числа
 * берутся у `upkeepInfo`, `popGrowth`, `moraleBreakdown`, `netPerDay`, `storageCap`, `armyPower`, сроки —
 * у `waitSpan`.
 */
import type { Tab } from '@/game/store';
import type { GameState, ResourceId } from '@/game/types';
import {
  armyPower,
  armySize,
  dayOf,
  housingCapacity,
  moraleBreakdown,
  netPerDay,
  orderValue,
  seasonAfter,
  seasonOf,
  seasonProgress,
  storageCap,
  upkeepInfo,
} from '@/game/derived';
import { ORDER_WARN, RESOURCE_META } from '@/game/constants';
import { SEASON_META, SEASON_SECONDS } from '@/game/data/seasons';
import { popGrowth } from '@/game/sim/population';
import { asGame } from '@/game/pace';
import { signed } from '@/ui/parts/signed';
import { realSpanText, waitSpan } from '@/ui/parts/wait';
import { ENERGY_MAX, MINIGAME_COST } from '@/game/data/minigames';
import { energyFullIn, energyShown } from '@/game/sim/minigames';
import type { RealmView } from '@/ui/realm/open';
import type { TipContent } from './tip';

/** Куда ведут ссылки подсказок: раздел шторки, здание, раздел державы. */
export interface TipGo {
  tab(t: Tab): void;
  building(id: number): void;
  realm(v: RealmView): void;
}

/** Целое с узким пробелом в разрядах: «4 800» (docs/ui_audit.md, 4.5). */
export function fmtInt(n: number): string {
  return String(Math.floor(Math.max(0, n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Ставка: до сотни — с десятой, дальше — целое; запятая; меньше десятой — ноль без дроби. */
export function fmtRate(n: number): string {
  const a = Math.abs(n);
  if (a < 0.05) return '0';
  return a >= 100 ? fmtInt(a) : a.toFixed(1).replace('.', ',');
}

/** Ставка со знаком: «+12,4 в день», «−3,0 в день»; ноль — без знака. */
export function perDay(n: number): string {
  const s = signed(n);
  const sign = s.startsWith('+') || s.startsWith('−') ? s[0] : '';
  return `${sign}${fmtRate(n)} в день`;
}

export function goldTip(s: GameState, go: TipGo): TipContent {
  const up = upkeepInfo(s);
  return {
    title: `Золото · ${fmtInt(s.gold)}`,
    body: `Сбор ${fmtRate(up.income)} в день, жалованье ${fmtRate(up.wages)} в день.`,
    link: { label: 'Указы', go: () => go.realm('government') },
  };
}

export function popTip(s: GameState, go: TipGo): TipContent {
  const g = popGrowth(s);
  return {
    title: `Жители · ${fmtInt(s.pop)} из ${fmtInt(housingCapacity(s))}`,
    body: g.blocked ?? `Прирост ${perDay(g.perDay)}.`,
    link: { label: 'Прирост', go: () => go.tab('pop') },
  };
}

export function moraleTip(s: GameState, go: TipGo): TipContent {
  const lines = moraleBreakdown(s).lines;
  const worst = lines.filter((l) => l.value < 0).sort((a, b) => a.value - b.value)[0];
  const best = lines.filter((l) => l.value > 0).sort((a, b) => b.value - a.value)[0];
  const top = worst ?? best;
  return {
    title: `Мораль · ${Math.round(s.morale)}`,
    body: top ? `${worst ? 'Тянет вниз' : 'Держит'}: ${top.name.toLowerCase()} ${signed(top.value, 0)}.` : undefined,
    link: { label: 'Мораль', go: () => go.tab('morale') },
  };
}

export function orderTip(s: GameState, go: TipGo): TipContent {
  const order = Math.round(orderValue(s));
  return {
    title: `Порядок · ${order}`,
    body: order < ORDER_WARN ? 'Невольники ропщут.' : 'Невольники под надзором.',
    link: { label: 'Порядок', go: () => go.tab('order') },
  };
}

export function armyTip(s: GameState, go: TipGo): TipContent {
  const up = upkeepInfo(s);
  return {
    title: `Дружина · ${fmtInt(armySize(s))}`,
    body: `Мощь ${fmtInt(Math.round(armyPower(s)))}. Жалованье ${fmtRate(up.armyWages)} в день.`,
    link: { label: 'Дружина', go: () => go.tab('army') },
  };
}

/** Сколько игровых секунд до следующего сезона. */
export const seasonLeft = (time: number) => asGame(SEASON_SECONDS * (1 - seasonProgress(time)));

export function seasonTip(s: GameState, go: TipGo): TipContent {
  const season = seasonOf(s.time);
  return {
    title: `${SEASON_META[season].name} · день ${dayOf(s.time)}`,
    body: `${SEASON_META[seasonAfter(season)].name} через ${waitSpan(seasonLeft(s.time))}.`,
    link: { label: 'Сезон', go: () => go.tab('season') },
  };
}

/**
 * Энергия промыслов: сколько из полного, когда полная, сколько стоит игра (docs/minigames.md, 1). Числа — дверью
 * `sim/minigames`, срок — настоящим временем (`realSpanText`): энергия идёт сутками игрока. Ссылка — в «Промыслы».
 */
export function energyTip(s: GameState, now: number, open: () => void): TipContent {
  const full = energyFullIn(s, now);
  return {
    title: `Энергия · ${energyShown(s, now)} из ${ENERGY_MAX}`,
    body: `${full > 0 ? `Полная через ${realSpanText(Math.ceil(full / 1000))}.` : 'Запас полон.'} Промысел стоит ${MINIGAME_COST}.`,
    link: { label: 'Промыслы', go: open },
  };
}

/** Полон ли склад по этому запасу: места меньше единицы (как в полоске прежнего вида). */
export const isFull = (s: GameState, r: ResourceId): boolean => s.resources[r] >= storageCap(s) - 1;

export function resTip(s: GameState, r: ResourceId, storage: number | null, go: TipGo): TipContent {
  return {
    title: `${RESOURCE_META[r].name} · ${fmtInt(s.resources[r])} из ${fmtInt(storageCap(s))}`,
    body: isFull(s, r) ? 'Склад полон: новое пропадает.' : perDay(netPerDay(s)[r]),
    link: storage !== null ? { label: 'Склад', go: () => go.building(storage) } : undefined,
  };
}

/**
 * Прирост запаса меньше этого за игровой день — «стоит на месте»: стрелки нет. Иначе стрелка дрожала бы
 * от десятых долей расхода на очаг.
 */
export const TREND_DEAD = 0.5;

/** Куда идёт запас: вверх, вниз или стоит. Полный склад не растёт — стрелки у него нет, число охрой. */
export function trendOf(perDay: number, full: boolean): 'up' | 'down' | null {
  if (full && perDay >= 0) return null;
  if (perDay > TREND_DEAD) return 'up';
  if (perDay < -TREND_DEAD) return 'down';
  return null;
}
