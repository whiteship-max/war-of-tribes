// Осада вольного замка у отряда бродяги (ПН-10, docs/gdd/path_of_sword.md, 3.11 и 3.12) — одна дверь: бой, падение и конец осады
// считает сервер войны (`netlify/lib/war.ts`), мир бродяги отдаёт сюда итог своей стороны (`RoamWorld.settleSieges`), и партия его
// кладёт — каждый итог один раз (`RoamState.siege.seen`).
//
//   Бой у стены, вылазка, удар по лагерю — павшие уходят, часть ранена (`sim/bandwounds`, как в поле), победа — престиж мощью выбитых
//                     защитников / S (`prestigeS`, правило ПН-5 Р8), дух и счёт дел героя.
//   Истощение фаз и выбитые башней — разница войска лагеря на сервере, кроме павших в боях: уходят без раненых.
//   Падение          — «Замок взят» с объявленной участью (`RoamState.castle`, держится за отрядом на сервере до перехода — ПН-11);
//                     «Ограбить» — добро в обоз и казна в кошель, «Увести людей» — пленные; «Сжечь» — замок не взят.
//   Конец            — отбит штурм или осада снята: престиж — минус доля (`defeatPrestige`); замок взял другой отряд — лагерь снят
//                     без потерь; дань кастеляна — в обоз и кошель; отступили — строка.
import type { GameState, ResourceId, RoamCastle, RoamSiege, TroopId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { TROOP_IDS } from '../data/troops';
import type { TroopStack } from '../battle/kinds';
import { roamStub } from '../roamstubs';
import { movePrestige } from './prestige';
import { noteBattle } from './spirit';
import { noteRulerDeed } from './dynasty';
import { shareOf } from './infirmary';
import { layBandWounds } from './bandwounds';
import { addStock } from './stock';
import { cargoCap } from './roam';
import { log } from './log';
import { LETTER_TTL } from '@/world/data/tuning';
import { FATE_META } from '@/world/data/fates';
import type { Fate } from '@/world/types';

/** Разобранных итогов осады партия помнит не больше стольких. */
export const SIEGE_SEEN_MAX = 64;

/** Итог своей стороны осады вольного замка — то, что мир бродяги прочёл в записи войн сервера. */
export interface SiegeLook {
  war: string;
  /** Ключ замка `free:x:y`, имя и ступень. */
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  /** Войско при выходе и войско лагеря сейчас. */
  went: TroopStack;
  army: TroopStack;
  battles: { id: string; at: number; site: string; won: boolean; lost: TroopStack; foePower: number; foeMen: number }[];
  fall?: { at: number; fate: Fate; taken: Partial<Record<string, number>>; led: number };
  end?: { end: string; at: number; tribute?: Partial<Record<string, number>> };
}

const SITE_WORDS: Record<string, string> = {
  wall: 'Штурм',
  sortie: 'Вылазка гарнизона',
  camp: 'Удар по лагерю',
  joint: 'Удар по лагерю',
  field: 'Бой в поле',
};

/** Снять павших с отряда: не больше, чем стоит. Сколько ушло. */
function drop(band: Partial<Record<TroopId, number>>, lost: TroopStack): number {
  let n = 0;
  for (const id of TROOP_IDS) {
    const take = Math.min(band[id] ?? 0, Math.max(0, Math.floor(lost[id] ?? 0)));
    if (take <= 0) continue;
    n += take;
    const left = (band[id] ?? 0) - take;
    if (left > 0) band[id] = left;
    else delete band[id];
  }
  return n;
}

/** Добро и казна в обоз и кошель; сколько легло (без золота). */
function haul(s: GameState, goods: Partial<Record<string, number>>): { goods: number; gold: number } {
  const r = s.roam;
  if (!r) return { goods: 0, gold: 0 };
  let moved = 0;
  for (const id of RESOURCE_IDS) {
    const n = Math.floor(goods[id] ?? 0);
    if (n > 0) moved += addStock(s, id as ResourceId, n, cargoCap(r), 'cargo');
  }
  const gold = Math.floor(goods.gold ?? 0);
  r.purse += gold;
  return { goods: Math.round(moved), gold };
}

/**
 * Положить итог осады вольного замка в партию — одна дверь (ПН-10). Каждый бой, падение и конец — один раз. Возвращает строки
 * летописи (их же мир показывает всплывающей строкой).
 */
export function takeSiege(s: GameState, look: SiegeLook): string[] {
  const r = s.roam;
  if (!r) return [];
  const sg: RoamSiege = r.siege?.war === look.war ? r.siege : { war: look.war, army: { ...look.went }, seen: [] };
  const seen = new Set(sg.seen);
  const lines: string[] = [];
  const say = (line: string, tone: 'good' | 'bad' | 'info'): void => {
    lines.push(line);
    log(s, line, tone, `roamcastle:${look.war}`);
  };
  const fallen: TroopStack = {};
  for (const b of look.battles) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const fell = drop(r.band, b.lost);
    for (const [k, v] of Object.entries(b.lost)) fallen[k as TroopId] = (fallen[k as TroopId] ?? 0) + (v ?? 0);
    const hurt = layBandWounds(s, shareOf(b.lost, fell * roamStub('bandWound')));
    noteBattle(s, b.won);
    noteRulerDeed(s, b.won ? 'won' : 'lost');
    const fame = b.won && b.foePower > 0 ? movePrestige(s, b.foePower / roamStub('prestigeS')) : 0;
    const losses = fell > 0 ? ` Павших ${fell}${hurt > 0 ? `, из них ранены ${hurt}` : ''}.` : ' Без потерь.';
    say(
      `${SITE_WORDS[b.site] ?? 'Бой'}: ${look.name} (~${b.foeMen}) — ${b.won ? 'победа' : 'поражение'}.${losses}${fame > 0 ? ` Престиж +${Math.round(fame)}.` : ''}`,
      b.won ? 'good' : 'bad',
    );
  }
  // Истощение фаз и выбитые башней: войско лагеря убыло сверх павших в боях — эти ушли без раненых.
  const waste: TroopStack = {};
  for (const id of TROOP_IDS) {
    const d = (sg.army[id] ?? 0) - (fallen[id] ?? 0) - (look.army[id] ?? 0);
    if (d > 0) waste[id] = d;
  }
  const gone = drop(r.band, waste);
  if (gone > 0) say(`Осада ${look.name}: истощение лагеря — ушли ${gone}.`, 'bad');
  sg.army = { ...look.army };
  const fallKey = `fall:${look.war}`;
  if (look.fall && !seen.has(fallKey)) {
    seen.add(fallKey);
    const f = look.fall;
    const name = FATE_META[f.fate].name;
    if (f.fate === 'burn') {
      say(`${look.name} сожжён: замок не взят и отстраивается.`, 'info');
    } else {
      const castle: RoamCastle = { id: look.id, name: look.name, tier: look.tier, fate: f.fate, at: f.at, war: look.war };
      r.castle = castle;
      const got = haul(s, f.taken);
      if (f.led > 0) r.captives = { n: f.led, until: f.at + LETTER_TTL, key: `cap-${look.war}` };
      const loot = [got.goods > 0 ? `в обоз ${got.goods}` : '', got.gold > 0 ? `${got.gold} золота` : '', f.led > 0 ? `пленных ${f.led}` : ''].filter(Boolean);
      say(`Замок взят: ${look.name} — «${name}».${loot.length ? ` Добыча: ${loot.join(', ')}.` : ''} Замок держится за отрядом.`, 'good');
    }
  }
  const endKey = `end:${look.war}`;
  if (look.end && !seen.has(endKey)) {
    seen.add(endKey);
    const e = look.end;
    if (e.end === 'beaten' || e.end === 'lifted') {
      const shame = -movePrestige(s, -s.prestige * roamStub('defeatPrestige'));
      say(`${e.end === 'beaten' ? 'Штурм отбит' : 'Осада снята'}: ${look.name}. Престиж −${Math.round(shame)}.`, 'bad');
    } else if (e.end === 'gone') {
      say(`${look.name}: замок взял другой отряд — лагерь снят без потерь.`, 'info');
    } else if (e.end === 'paid') {
      const got = haul(s, e.tribute ?? {});
      say(`Кастелян ${look.name} откупился: ${got.gold} золота${got.goods > 0 ? `, в обоз ${got.goods}` : ''}. Осада снята.`, 'good');
    } else if (e.end === 'retreat' || e.end === 'recalled') {
      say(`Отряд отступил от ${look.name}.`, 'info');
    }
  }
  sg.seen = [...seen].slice(-SIEGE_SEEN_MAX);
  r.siege = sg;
  return lines;
}

const tierOk = (v: unknown): v is 1 | 2 | 3 => v === 1 || v === 2 || v === 3;
const FATES_TAKEN: readonly RoamCastle['fate'][] = ['occupy', 'plunder', 'captives'];

/** Поля осады из сохранения (`sim/roam.mergeRoam`): только целые записи; мусор — нет поля. */
export function readCastle(r: Record<string, unknown>): Pick<import('../types').RoamState, 'castle' | 'siege'> {
  const out: Pick<import('../types').RoamState, 'castle' | 'siege'> = {};
  const c = r.castle as Record<string, unknown> | undefined;
  if (c && typeof c.id === 'string' && typeof c.name === 'string' && tierOk(c.tier) && FATES_TAKEN.includes(c.fate as RoamCastle['fate']) && Number.isFinite(c.at) && typeof c.war === 'string') {
    out.castle = { id: c.id.slice(0, 64), name: c.name.slice(0, 64), tier: c.tier, fate: c.fate as RoamCastle['fate'], at: c.at as number, war: c.war.slice(0, 64) };
  }
  const g = r.siege as Record<string, unknown> | undefined;
  if (g && typeof g.war === 'string' && g.army && typeof g.army === 'object' && Array.isArray(g.seen)) {
    const army: Partial<Record<TroopId, number>> = {};
    for (const id of TROOP_IDS) {
      const n = Number((g.army as Record<string, unknown>)[id]);
      if (Number.isFinite(n) && n > 0) army[id] = Math.floor(n);
    }
    out.siege = { war: g.war.slice(0, 64), army, seen: g.seen.filter((x): x is string => typeof x === 'string').slice(-SIEGE_SEEN_MAX) };
  }
  return out;
}
