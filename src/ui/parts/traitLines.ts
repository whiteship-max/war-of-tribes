// Слова черт агента — без React, чтобы их можно было проверить тестом.
//
// Ни одного своего числа: что черта даёт, выводится из её множителя и того числа
// мира, к которому он прикладывается (`world/data/tuning`); условие — из порога и
// доли в таблице (`game/data/traits`). Правка таблицы меняет строку сама.
//
// Показываются только черты, которые человек держит: каталога возможных черт у
// игрока нет, и черта, которую сегодня не заслужить, обещанием не становится.
import { TRAIT_BY_ID, deedsOf, type TraitDef, type TraitId } from '@/game/data/traits';
import type { Tally } from '@/game/types';
import { formatLeft } from '@/world/geo';
import { FIGURE_SCOUT_CATCH, HANDOVER_BASE, SPY_BUSY, SPY_HELD } from '@/world/data/tuning';
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

function whatOf(def: TraitDef): string {
  const e = def.effect;
  if (e.won !== undefined) return `Победа в его бою поднимает дух дома ещё на +${e.won} сверх обычного.`;
  if (e.lost !== undefined) return `Поражение в его бою роняет дух дома ещё на ${Math.abs(e.lost)} сверх обычного.`;
  if (e.muster !== undefined) {
    const faster = e.muster < 1;
    return (
      `Дружина собирается и расходится ${faster ? 'быстрее' : 'дольше'} на ${shift(e.muster)}: ` +
      `сбор, который шёл бы ${formatLeft(HANDOVER_BASE / 1000)}, идёт ${formatLeft((HANDOVER_BASE * e.muster) / 1000)}.`
    );
  }
  if (e.carry !== undefined) return `Обоз поднимает на ${shift(e.carry)} больше добычи.`;
  if (e.catch !== undefined) {
    return `Часовые берут его в ${pct(FIGURE_SCOUT_CATCH * e.catch)} приходов вместо ${pct(FIGURE_SCOUT_CATCH)}.`;
  }
  if (e.busy !== undefined) {
    return `После удачного дела свободен через ${formatLeft((SPY_BUSY * e.busy) / 1000)} вместо ${formatLeft(SPY_BUSY / 1000)}.`;
  }
  if (e.held !== undefined) {
    return `Пойманного держат ${formatLeft((SPY_HELD * e.held) / 1000)} вместо ${formatLeft(SPY_HELD / 1000)}.`;
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
    return `${rule[0].toUpperCase()}${rule.slice(1)}. Сейчас: ${count(n, one, few, many)}, ${bad} ${t.fail}.`;
  }
  if (def.of === 'bled') {
    return (
      `${least[0].toUpperCase()}${least.slice(1)}, павших ${most ? 'не больше' : 'не меньше'} ${num} на бой. ` +
      `Сейчас: ${count(n, one, few, many)}, пало ${t.bled}.`
    );
  }
  return (
    `${least[0].toUpperCase()}${least.slice(1)}, и в ${num} из ${den} сожжено логово. ` +
    `Сейчас: ${count(n, one, few, many)}, сожжено ${t.burned}.`
  );
}

/** Черты человека словами — только те, что он держит. */
export const traitLines = (ids: readonly TraitId[], t: Tally): TraitLine[] =>
  ids.map((id) => {
    const def = TRAIT_BY_ID[id];
    return { id, name: def.name, good: def.good, what: whatOf(def), why: whyOf(def, t) };
  });

/** Черты ушедшего — одной строкой имён, для родословной. */
export const traitNames = (ids: readonly TraitId[]): string => ids.map((id) => TRAIT_BY_ID[id].name).join(', ');
