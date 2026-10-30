// Исход встречи с НПС для отряда бродяги (ПН-5, docs/gdd/path_of_sword.md, 3.6.4–3.6.5 и «Решения ПН-5») — одна дверь: бой посчитал
// мир (`world/encounter`: засада, удар по цели), сюда он отдаёт итог, и партия его кладёт.
//
//   Победа          — павшие уходят, часть ранена (`sim/bandwounds`), престиж — мощь противника / S (`prestigeS`), добыча — золото
//                     логова по мощи (`lairs.lairGold` — то же, что у лорда), цель побита (пепелище `LAIR_RUIN`), дух — память победы.
//   Проиграл, жив   — отход: павшие и раненые, обоз теряет долю — сколько унесут уцелевшие враги (`spoils.plunder`), престиж — минус
//                     доля (`defeatPrestige`); путь продолжается — ход держит сервер.
//   Перебит, герой жив — герой ранен на срок раненых (`WOUND_DAYS`), обоз — победителю целиком, кошель — доля (`defeatPurse`).
//   Перебит, герой погиб — кость (`heroFall`); соратников в Срезе 1 нет — сразу «наследник пути» (3.6.5, п. 2): новый герой того же
//                     происхождения 1-го уровня, переходят доля престижа (`heirPrestige`) и знамя (герб профиля), запись в родословной.
//                     Схрона и заданий пути в Срезе 1 нет — переходить нечему.
// Каждый бой — одна строка летописи; её же мир показывает всплывающей строкой (вести без спама: бой бывает только по приказу — засада
// на дороге и удар по цели, не больше двух на ход). Числа без вывода — заглушки игры (`game/roamstubs`, за выключателем).
import type { GameState, TroopId } from '../types';
import { DAY_LENGTH, RESOURCE_IDS, WOUND_DAYS } from '../constants';
import { TROOP_IDS } from '../data/troops';
import { troopTotal, type TroopStack } from '../battle/kinds';
import { roamStub } from '../roamstubs';
import { movePrestige } from './prestige';
import { noteBattle } from './spirit';
import { noteRulerDeed } from './dynasty';
import { drawName, keepInBook } from './agents';
import { shareOf } from './infirmary';
import { layBandWounds } from './bandwounds';
import { log } from './log';
import { yearOf } from '../derived';
import { lairGold } from '@/world/lairs';
import { plunder, HEAD_CARRY } from '@/world/spoils';
import { LAIR_RUIN, LETTER_TTL } from '@/world/data/tuning';
import { captivesOf } from '../askrules';
import { BEATEN_MAX } from './roam';
import { noteDealFight } from './contracts';

/** Итог боя, который отдаёт мир: кто бился, чем кончилось, кого потеряли. */
export interface FightOut {
  /** Засада на дороге, удар по цели или набег на село договора «Защитить село» (ПН-7: ватага нападает, `id` — номер договора). */
  how: 'ambush' | 'strike' | 'defend';
  /** Цель удара или ватага засады: номер точки (у засады — пусто), вид словами и имя. */
  id: string;
  name: string;
  /** Сила противника, мощи. */
  power: number;
  /** Сколько бойцов строя было у противника и какую долю он потерял. */
  foeMen: number;
  foeLoss: number;
  won: boolean;
  /** Наши павшие по видам. */
  lost: TroopStack;
  /** Сид боя — кость гибели героя. */
  seed: number;
  /** Минута мира боя — до неё побитая точка пепелище не считает. */
  at: number;
}

const minus = (band: Partial<Record<TroopId, number>>, lost: TroopStack): number => {
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
};

/** Кость гибели героя — из сида боя, 0..1. */
export const fallRoll = (seed: number): number => {
  let h = (seed ^ 0x6b43a9b5) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Герой ранен — до какой игровой секунды; здоров — `null`. */
export const heroHurt = (s: GameState): number | null => {
  const h = s.roam?.hero.hurt;
  return h !== undefined && h > s.time ? h : null;
};

/** Точка побита и ещё пепелище в минуту мира `now`. */
export const beatenAt = (s: GameState, id: string, now: number): boolean => (s.roam?.beaten ?? []).some((b) => b.id === id && b.until > now);

/**
 * Наследник пути (ГДД 3.6.5, п. 2): погибший герой — в книгу родословной (место правителя: герой — будущий правитель), новый —
 * того же происхождения, 1-го уровня, с начала счёта дел; престиж — доля погибшего. Знамя — герб профиля, он не меняется. Возвращает
 * имя нового героя.
 */
export function heirOfPath(s: GameState): string {
  const r = s.roam;
  if (!r) return '';
  const old = r.hero;
  const t = old.deeds ?? {};
  keepInBook(s, 'ruler', {
    name: old.name || 'Герой пути',
    level: old.war,
    deeds: (t.won ?? 0) + (t.lost ?? 0) + (t.fled ?? 0),
    from: yearOf(old.since ?? 0),
    to: yearOf(s.time),
    end: 'fell',
    traits: [],
  });
  const name = drawName(s) ?? `Наследник ${old.name || 'героя'}`;
  r.hero = { name, war: 1, since: s.time };
  movePrestige(s, -s.prestige * (1 - roamStub('heirPrestige')));
  return name;
}

/**
 * Положить итог боя в партию (ГДД 3.6.4) — одна дверь на засаду и удар. Возвращает строку летописи (её же мир покажет всплывающей
 * строкой).
 */
export function takeFight(s: GameState, f: FightOut): string {
  const line = layFight(s, f);
  // Договоры (ПН-7): удар по цели договора выигран или набег на село отбит — исполнен и сдан; набег не отбит — сорван.
  noteDealFight(s, f);
  return line;
}

function layFight(s: GameState, f: FightOut): string {
  const r = s.roam;
  if (!r) return '';
  const fell = minus(r.band, f.lost);
  // Раненые — доля павших: лазарета у бродяги нет, лежат при отряде (`sim/bandwounds`).
  const hurt = layBandWounds(s, shareOf(f.lost, fell * roamStub('bandWound')));
  noteBattle(s, f.won);
  noteRulerDeed(s, f.won ? 'won' : 'lost');
  const what =
    f.how === 'ambush' ? `Засада: ${f.name.toLowerCase()} (~${f.foeMen})` : f.how === 'defend' ? `Набег на ${f.name} (~${f.foeMen})` : `Бой: ${f.name} (~${f.foeMen})`;
  const losses = fell > 0 ? ` Павших ${fell}${hurt > 0 ? `, из них ранены ${hurt}` : ''}.` : ' Без потерь.';
  if (f.won) {
    const fame = movePrestige(s, f.power / roamStub('prestigeS'));
    const gold = f.how === 'strike' ? lairGold(f.power) : 0;
    r.purse += gold;
    if (f.how === 'strike' && f.id) {
      r.beaten = [{ id: f.id, until: f.at + LAIR_RUIN }, ...(r.beaten ?? []).filter((b) => b.id !== f.id)].slice(0, BEATEN_MAX);
    }
    // Пленные (ГДД 3.4.5, ПН-6): доля уцелевших врагов — «Принять в отряд» дубинщиками до срока вести (`sim/bandranks.takeCaptives`).
    const taken = captivesOf(Math.round(f.foeMen * (1 - f.foeLoss)));
    if (taken > 0) r.captives = { n: taken, until: f.at + LETTER_TTL, key: `cap-${f.seed >>> 0}-${f.at}` };
    else delete r.captives;
    const line = `${what} — победа.${losses} Престиж +${Math.round(fame)}${gold > 0 ? `, добыча ${gold} золота` : ''}.${taken > 0 ? ` Пленных ${taken}: можно принять в отряд.` : ''}`;
    log(s, line, 'good', `roamfight:${f.at}`);
    return line;
  }
  const shame = -movePrestige(s, -s.prestige * roamStub('defeatPrestige'));
  if (troopTotal(r.band) > 0) {
    // Отход: обоз теряет то, что унесут уцелевшие враги (`plunder`: тайника у обоза нет).
    const carry = Math.round(f.foeMen * (1 - f.foeLoss)) * HEAD_CARRY;
    const taken = plunder(r.cargo, 0, carry).taken;
    let lostGoods = 0;
    for (const id of RESOURCE_IDS) {
      const n = taken[id] ?? 0;
      if (n <= 0) continue;
      lostGoods += n;
      const left = (r.cargo[id] ?? 0) - n;
      if (left > 0) r.cargo[id] = left;
      else delete r.cargo[id];
    }
    const line = `${what} — отход.${losses}${lostGoods > 0 ? ` Из обоза унесли ${Math.round(lostGoods)}.` : ''} Престиж −${Math.round(shame)}.`;
    log(s, line, 'bad', `roamfight:${f.at}`);
    return line;
  }
  // Перебит: обоз — победителю, кошель — доля.
  r.cargo = {};
  const purse = r.purse * roamStub('defeatPurse');
  r.purse -= purse;
  if (fallRoll(f.seed) < roamStub('heroFall')) {
    const was = r.hero.name || 'Герой';
    const heir = heirOfPath(s);
    const line = `${what} — отряд перебит, ${was} пал. Обоз и ${Math.round(purse)} золота — победителю. Путь продолжает наследник: ${heir}.`;
    log(s, line, 'bad', `roamfight:${f.at}`);
    return line;
  }
  r.hero.hurt = s.time + WOUND_DAYS * DAY_LENGTH;
  const line = `${what} — отряд перебит, герой ранен. Обоз и ${Math.round(purse)} золота — победителю. Престиж −${Math.round(shame)}.`;
  log(s, line, 'bad', `roamfight:${f.at}`);
  return line;
}
