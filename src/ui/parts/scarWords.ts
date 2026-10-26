// Слова черт армии в «Дружине» (ДР-4, docs/siege_v2.md, «Решения ДР-4», Ш10): что черта даёт — словами и числами таблицы, где
// действует, что такое уверенная победа и чего сервер у боя войны не судит. Строки летописи — `game/scarwords` (их пишет шаг
// племени); здесь — то, что нужно только окну, и едет оно куском «Дружины». Своей арифметики нет (правило 18).
import type { StatId, UnitKind } from '@/battle/types';
import { UNIT_KINDS } from '@/battle/types';
import { SCAR_BY_ID, SCAR_SIZE, SURE, type ScarDef, type ScarId, type ScarTheme } from '@/game/scarrules';
import { THEME_WHERE, part } from '@/game/scarwords';

/** Уверенная победа — словами (Ш1). */
export const SURE_WORDS = `уверенная победа — пало не больше ${part(SURE.lost)} наших, противник бежал или перебит и был не меньше ${part(SURE.foe)} нас`;

/** Что даёт черта — словами направления (величина — в отметках, `SCAR_SIZE`, разбирает окно). */
export const EFFECT_WORDS: Record<ScarId, string> = {
  ghosts: 'бьют из чащи сильнее, стрелы вязнут в ветвях',
  fords: 'в воде крепче и в натиске, и в обороне',
  highland: 'лучники бьют сверху сильнее, строй держит склон',
  pikewall: 'копья и пехота держат конный удар и не бегут от него',
  walls: 'у стен держатся дольше и стоят твёрже',
  nightwolves: 'ночью бьют внезапно и страшат противника',
  arrowfear: 'копья и пехота при виде лучников ломают строй и бегут в укрытие',
  woodfear: 'в чаще каждый куст — засада: строй слабеет и бежит раньше',
  wallshy: 'у стен бьют вяло и бегут раньше',
  nightpanic: 'в темноте строй рассыпается и бежит раньше',
  frostbit: 'в стужу руки не держат ни копьё, ни лук',
  grumble: 'на голодный желудок бьют вяло и бегут раньше',
};

/** Где действует — коротко, для строки черты («в бою в лесу»); порог доли — в разборе (`gainWords`, `THEME_WHERE`). */
export function activeWords(id: ScarId): string {
  const d: ScarDef = SCAR_BY_ID[id];
  if (d.theme === 'hunger') return 'в бою на голодный желудок';
  if (d.theme === 'siege') return 'в осадном бою';
  if (d.theme === 'horse') return 'против конницы';
  if (d.theme === 'arrows') return 'при виде лучников';
  return `в бою ${THEME_WHERE[d.theme]}`;
}

/** Показатель словами — как его зовёт «Дружина». */
const STAT_WORD: Record<StatId, string> = {
  fireAtk: 'огонь',
  fireDef: 'защита от стрел',
  shockAtk: 'натиск',
  shockDef: 'защита в натиске',
  moraleAtk: 'удар по морали',
  moraleDef: 'стойкость',
};

const KINDS_WORD = (kinds: readonly UnitKind[]): string =>
  kinds.length === UNIT_KINDS.length
    ? 'у всех родов'
    : kinds.length === 1 && kinds[0] === 'archer'
      ? 'у лучников'
      : kinds.every((k) => k === 'spear' || k === 'infantry')
        ? 'у копий и пехоты'
        : `у родов: ${kinds.join(', ')}`;

/**
 * Что черта даёт числами (Ш5): показатели и рода её направления на её величину (`SCAR_SIZE`), в отметках, со знаком. Одна
 * строка на группу родов: «натиск +0,49, защита от стрел +0,49 — у всех родов».
 */
export function edgeLines(id: ScarId, fmt: (n: number) => string): string[] {
  const shape = SCAR_BY_ID[id].shape;
  const k = SCAR_SIZE[id];
  const groups = new Map<string, { kinds: UnitKind[]; stats: [StatId, number][] }>();
  for (const kind of UNIT_KINDS) {
    const stats = Object.entries(shape[kind] ?? {}).filter(([, v]) => v) as [StatId, number][];
    if (stats.length === 0) continue;
    const key = stats.map(([s, v]) => `${s}${v}`).join('|');
    const g = groups.get(key) ?? { kinds: [], stats };
    g.kinds.push(kind);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => `${g.stats.map(([s, v]) => `${STAT_WORD[s]} ${fmt(v * k)}`).join(', ')} — ${KINDS_WORD(g.kinds)}`);
}

/** Чего сервер у боя войны не судит — у таких черт в войне с соседями нет действия (Ш6). */
export const WAR_BLIND: readonly ScarTheme[] = ['night', 'winter', 'hunger'];
