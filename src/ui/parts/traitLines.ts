// Слова черт агента — без React, чтобы их можно было проверить тестом.
//
// Ни одного своего числа: что черта даёт, выводится из её множителя и того числа
// мира, к которому он прикладывается (`world/data/tuning`); условие — из порога и
// доли в таблице (`game/data/traits`). Правка таблицы меняет строку сама.
//
// Показываются только черты, которые человек держит: каталога возможных черт у
// игрока нет, и черта, которую сегодня не заслужить, обещанием не становится.
import { TRAIT_BY_ID, deedsOf, type TraitDef, type TraitId } from '@/game/data/traits';
import { gameDaysOfMs } from '@/game/pace';
import type { Tally } from '@/game/types';
import { gameDaysText, realLeft, waitDays } from '@/ui/parts/wait';
import { FIGURE_SCOUT_CATCH, SPY_BUSY, SPY_HELD } from '@/world/data/tuning';
import { musterMs } from '@/world/muster';
import { count } from './plural';

export interface TraitLine {
  id: TraitId;
  name: string;
  good: boolean;
  /** Что черта даёт, с числами. */
  what: string;
  /** За что она держится и как сейчас, с числами. */
  why: string;
}

const pct = (share: number): string => `${Math.round(share * 100)} %`;

/** На сколько процентов множитель меняет число: «на четверть быстрее» говорится числом. */
const shift = (mult: number): string => `${Math.round(Math.abs(mult - 1) * 100)} %`;

/** Срок мира в игровых днях с единицей и настоящим временем рядом: «9 игр. дн. (4 ч 30 мин)». */
function daysOf(ms: number): string {
  const days = Math.round(gameDaysOfMs(ms) * 10) / 10;
  return `${gameDaysText(days)} (${waitDays(days)})`;
}

/**
 * Черта сбора — живой строкой из чисел игры (правило 18): полный сбор с этим человеком считает та же функция, что мир
 * (`world/muster.musterMs`). Сбор идёт только в осаде своего города: дома перевод мгновенный (`LocalWorld.regroupInstant`,
 * решение владельца 06.10.2026), и окно ответа на набег от черты не зависит — оно до прихода. Прежде строка сравнивала
 * полный сбор с предупреждением Дозора («сбор успевает» / «не успевает», слово владельца, docs/battle_eu4.md, 14.35), а
 * сбора дома больше нет — сравнивать не с чем. Множитель — всех его черт сбора разом, как их складывает слепок
 * (`sim/agents.traitNumbers`).
 */
function musterWhat(mult: number, own: number): string {
  return (
    `Дружина собирается и расходится ${own < 1 ? 'быстрее' : 'дольше'} на ${shift(own)}. ` +
    `Полный сбор ${daysOf(musterMs(Infinity, mult))} в осаде своего города. Дома перевод мгновенный.`
  );
}

function whatOf(def: TraitDef, mult: number): string {
  const e = def.effect;
  if (e.won !== undefined) return `Победа в его бою поднимает мораль дома ещё на +${e.won}.`;
  if (e.lost !== undefined) return `Поражение в его бою роняет мораль дома ещё на ${Math.abs(e.lost)}.`;
  if (e.muster !== undefined) return musterWhat(mult, e.muster);
  if (e.carry !== undefined) return `Обоз поднимает на ${shift(e.carry)} больше добычи.`;
  if (e.catch !== undefined) {
    return `Часовые ловят его в ${pct(FIGURE_SCOUT_CATCH * e.catch)} приходов вместо ${pct(FIGURE_SCOUT_CATCH)}.`;
  }
  if (e.busy !== undefined) {
    return `После удачного дела свободен через ${realLeft((SPY_BUSY * e.busy) / 1000)} вместо ${realLeft(SPY_BUSY / 1000)}.`;
  }
  if (e.held !== undefined) {
    return `Пойманного держат ${realLeft((SPY_HELD * e.held) / 1000)} вместо ${realLeft(SPY_HELD / 1000)}.`;
  }
  return '';
}

/** Как называются дела этого агента. */
const DEEDS: Record<string, [string, string, string]> = {
  general: ['бой', 'боя', 'боёв'],
  scout: ['ходка', 'ходки', 'ходок'],
  spy: ['дело', 'дела', 'дел'],
  diplomat: ['дело', 'дела', 'дел'],
};

function whyOf(def: TraitDef, t: Tally): string {
  const n = deedsOf(t);
  const [one, few, many] = DEEDS[def.agent];
  // После «не меньше» число управляет родительным: «не меньше четырёх боёв», а не «боя».
  const least = `не меньше ${def.min} ${many}`;
  const { num, den } = def.share;
  const most = def.at === 'most';
  if (def.of === 'fail') {
    const bad = def.agent === 'general' ? 'проигранных' : def.agent === 'scout' ? 'поимок' : 'провалов';
    const rule =
      num === 0
        ? `${least} и ни одного ${def.agent === 'general' ? 'проигранного' : bad}`
        : `${least}, ${bad} ${most ? 'не больше' : 'не меньше'} ${num} из ${den}`;
    return `${rule[0].toUpperCase()}${rule.slice(1)}. Сейчас ${count(n, one, few, many)}, ${bad} ${t.fail}.`;
  }
  if (def.of === 'bled') {
    return (
      `${least[0].toUpperCase()}${least.slice(1)}, павших ${most ? 'не больше' : 'не меньше'} ${num} на бой. ` +
      `Сейчас ${count(n, one, few, many)}, пало ${t.bled}.`
    );
  }
  return (
    `${least[0].toUpperCase()}${least.slice(1)}, и в ${num} из ${den} сожжено логово. ` +
    `Сейчас ${count(n, one, few, many)}, сожжено ${t.burned}.`
  );
}

/**
 * Черты человека словами — только те, что он держит.
 */
export function traitLines(ids: readonly TraitId[], t: Tally): TraitLine[] {
  const muster = ids.reduce((m, id) => m * (TRAIT_BY_ID[id].effect.muster ?? 1), 1);
  return ids.map((id) => {
    const def = TRAIT_BY_ID[id];
    return { id, name: def.name, good: def.good, what: whatOf(def, muster), why: whyOf(def, t) };
  });
}

/** Черты ушедшего — одной строкой имён, для родословной. */
export const traitNames = (ids: readonly TraitId[]): string => ids.map((id) => TRAIT_BY_ID[id].name).join(', ');
