// Гейт: единственная дверь ко всем вопросам «открыто ли это».
//
// **Правило проекта, ради которого дверь одна** (docs/dynasty.md, раздел 10.1, решение 1):
// гейт существует только выведенный из структуры и прошедший через одну дверь. Показ
// («закрыто, откроется на уровне N»), отказ («нанять нельзя») и сам запрет читают здесь
// одно и то же число; двух правд о том, что закрыто, быть не должно — иначе карточка
// обещает одно, кнопка делает другое, и разойдутся они ровно тогда, когда лестницу
// поправят.
//
// **Рукописного `requiresTech` нет ни у здания, ни у бойца, ни у вещи, ни у агента, ни у
// участи, и заводить его нельзя.** Уровень ступени выводится из места в списке ветви
// (`data/realm.diploLevelOf`, `warLevelOfFate`) или из работы горна (`warLevelOfGear`), а что
// ступень даёт — меряется этими же дверьми (`techGains`), а не подписывается рядом. Держат
// это тесты по исходникам (`sim/tech.test.ts`).
//
// **Ни одного тика.** Уровень лежит в партии (`RealmState.tech`), всё остальное —
// чтение: открыто ли место, сколько ячеек у стола, что даст следующий уровень.
import type { Fate, FigureId } from '@/world/types';
import type { EquipmentId, GameState, RealmBranch, TroopId } from '../types';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { FATE_META } from '@/world/data/fates';
import { LETTER_DECISIONS } from '@/world/letters';
import { EQUIPMENT_BY_ID, EQUIPMENT_IDS } from '../data/equipment';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import {
  BRANCH_BUILT,
  BRANCH_NAME,
  BRANCH_OF,
  DIPLO_RUNGS,
  DIPLO_RUNG_NAME,
  type DiploRung,
  WAR_FATES,
  type WarFate,
  diploLevelOf,
  isDiploRung,
  isWarFate,
  levelPrice,
  levelsOf,
  warLevelOfFate,
  warLevelOfGear,
  warLevelOfTroop,
} from '../data/realm';
import { asGame, type GameSec } from '../pace';
import { DAY_LENGTH } from '../constants';
import { pointsOf, rulerRate, spend } from './points';
import { log } from './log';

/**
 * Что можно спросить у гейта: ступень дипломатической ветви, вещь кузницы, вид бойца или
 * участь взятого города. Административная ветвь ещё не построена, и заводить её ключи
 * заранее значило бы обещать проверку, которой нет.
 *
 * Ключи не пересекаются, и это свойство самих таблиц контента, а не соглашение: вещь
 * зовётся `spear`, боец — `spearman`, ступень дипломатии — `spy`, участь — `captives`.
 * Сойдись однажды два имени — упадёт тест «ключи гейта не пересекаются».
 */
export type TechKey = DiploRung | EquipmentId | TroopId | WarFate;

export interface Gate {
  branch: RealmBranch;
  level: number;
}

const isGear = (key: string): key is EquipmentId => (EQUIPMENT_IDS as readonly string[]).includes(key);
const isTroop = (key: string): key is TroopId => (TROOP_IDS as readonly string[]).includes(key);

/**
 * Где на лестнице стоит ступень. Выводится из самих таблиц, а не пишется рядом
 * (docs/dynasty.md, раздел 4.6): у дипломатии — место в списке ступеней, у вещи — её
 * работа у горна, у вида бойца — самая поздняя вещь из тех, что он носит.
 */
export function gateOf(key: TechKey): Gate {
  if (isGear(key)) return { branch: 'war', level: warLevelOfGear(key) };
  if (isTroop(key)) return { branch: 'war', level: warLevelOfTroop(key) };
  if (isWarFate(key)) return { branch: 'war', level: warLevelOfFate(key) };
  return { branch: 'diplo', level: diploLevelOf(key) };
}

/** Как ступень зовут игроку. Имена берутся у контента: своего списка названий нет. */
export function techName(key: TechKey): string {
  if (isGear(key)) return EQUIPMENT_BY_ID[key].name.toLowerCase();
  if (isTroop(key)) return TROOP_BY_ID[key].name.toLowerCase();
  if (isWarFate(key)) return `участь «${FATE_META[key].name.toLowerCase()}»`;
  return DIPLO_RUNG_NAME[key].toLowerCase();
}

/**
 * Как называется уровень ветви. Тоже выводится из лестницы, и тоже здесь: спроси экран
 * лестницу сам — и у названия ступени с её открытием стало бы два источника.
 * Первый уровень — то состояние, в котором партия начинается.
 */
export function levelName(branch: RealmBranch, level: number): string {
  if (level <= 1) return 'С этого держава начинается';
  if (branch === 'diplo') {
    const rung = DIPLO_RUNGS.find((r) => diploLevelOf(r) === level);
    return rung ? DIPLO_RUNG_NAME[rung] : `Уровень ${level}`;
  }
  if (branch === 'war') {
    const item = EQUIPMENT_IDS.find((i) => warLevelOfGear(i) === level);
    if (item) return EQUIPMENT_BY_ID[item].name;
    const fate = WAR_FATES.find((f) => warLevelOfFate(f) === level);
    return fate ? `Участь: ${FATE_META[fate].name.toLowerCase()}` : `Уровень ${level}`;
  }
  return `Уровень ${level}`;
}

/** Изученный уровень ветви. Партия без дома (мусор в сохранении) читается как первый. */
export function techLevel(s: GameState, branch: RealmBranch): number {
  const raw = s.realm?.tech?.[branch];
  const l = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 1;
  return Math.max(1, Math.min(levelsOf(branch), l));
}

/**
 * Открыта ли ступень при таком уровне ветви. Уровнем, а не состоянием, — чтобы тем же
 * правилом можно было спросить «а что будет на следующем уровне» и получить ответ,
 * который не может разойтись с настоящим (`techGains`).
 */
export const openAtLevel = (level: number, key: TechKey): boolean => level >= gateOf(key).level;

/** Открыта ли ступень у этой партии. */
export const techOpen = (s: GameState, key: TechKey): boolean => openAtLevel(techLevel(s, gateOf(key).branch), key);

/**
 * Почему закрыто — словами, одной строкой, и эта же строка стоит везде, где игрок
 * упирается: в найме, в списке мест, в самой ветви. `null` — открыто.
 */
export function techBlock(s: GameState, key: TechKey): string | null {
  if (techOpen(s, key)) return null;
  const g = gateOf(key);
  return `Ещё не изучено: ${techName(key)} — ${g.level} уровень ${BRANCH_OF[g.branch]} ветви, в «Технологиях».`;
}

// ---------- Что гейт закрывает: места агентов и ячейки стола ----------

/** Есть ли у партии с таким уровнем ветви это место агента. Негейтованные есть всегда. */
export const placeOpenAt = (level: number, id: FigureId): boolean => !isDiploRung(id) || openAtLevel(level, id);

/** Есть ли у партии это место агента. */
export const placeOpen = (s: GameState, id: FigureId): boolean =>
  !isDiploRung(id) || techOpen(s, id as TechKey);

/** Почему места нет; `null` — место есть. */
export const placeBlock = (s: GameState, id: FigureId): string | null =>
  isDiploRung(id) ? techBlock(s, id as TechKey) : null;

/**
 * Сколько ячеек у стола донесений при таком уровне ветви. Считается по списку ступеней, а
 * не прибавкой в единицу: заведи вторую такую ступень — она прибавит сама.
 */
export const mailSlotsAt = (level: number): number =>
  LETTER_DECISIONS + DIPLO_RUNGS.filter((r) => r === 'letterSlot' && openAtLevel(level, r)).length;

/** Сколько ячеек у стола донесений сейчас. */
export const mailSlots = (s: GameState): number => mailSlotsAt(techLevel(s, 'diplo'));

// ---------- Что гейт закрывает: вещи кузницы и виды бойцов ----------

/** Куют ли эту вещь при таком уровне военной ветви. */
export const gearOpenAt = (level: number, item: EquipmentId): boolean => openAtLevel(level, item);

/** Куют ли эту вещь сейчас. */
export const gearOpen = (s: GameState, item: EquipmentId): boolean => techOpen(s, item);

/** Почему вещь не куют; `null` — куют. */
export const gearBlock = (s: GameState, item: EquipmentId): string | null => techBlock(s, item);

/**
 * Нанимают ли этот вид при таком уровне военной ветви. **Вид открыт, когда открыто всё,
 * что он носит** — правило целиком лежит в `warLevelOfTroop`, и второго списка «кому что
 * нужно» здесь нет.
 */
export const troopOpenAt = (level: number, troop: TroopId): boolean => openAtLevel(level, troop);

/** Нанимают ли этот вид сейчас. */
export const troopOpen = (s: GameState, troop: TroopId): boolean => techOpen(s, troop);

/** Почему вид не нанимают; `null` — нанимают. */
export const troopBlock = (s: GameState, troop: TroopId): string | null => techBlock(s, troop);

// ---------- Что гейт закрывает: участи взятого города ----------

/**
 * Можно ли объявить участь при таком уровне военной ветви. Участь вне ветви не закрыта
 * гейтом вовсе: «ограбить» — то, с чем партия начинается, а «сжечь» в ветви нет (решение
 * владельца 10) — её закрывает сама лестница участи (`spoils.fateBlock`, `vsWorld`).
 */
export const fateOpenAt = (level: number, fate: Fate): boolean => !isWarFate(fate) || openAtLevel(level, fate);

/** Можно ли объявить участь сейчас. */
export const fateOpen = (s: GameState, fate: Fate): boolean => !isWarFate(fate) || techOpen(s, fate);

/**
 * Какие участи партия объявить не может — и почему, той же строкой, что стоит в ветви.
 * Это то, что едет в мир слепком (`PlayerProfile.fateLocks`): мир не знает ни уровней, ни
 * ветвей, и проверяет приказ и падение готовой строкой гейта (`spoils.fateBlock`). Нечего
 * запирать — пусто.
 */
export function fateLocks(s: GameState): Partial<Record<Fate, string>> {
  const out: Partial<Record<Fate, string>> = {};
  for (const f of WAR_FATES) {
    const why = techBlock(s, f);
    if (why) out[f] = why;
  }
  return out;
}

// ---------- Что даст следующий уровень: замером, а не подписью ----------

/**
 * Что изменится между уровнем `level` и следующим — **прогоном тех же дверей на двух
 * уровнях**, тем же приёмом, каким это сделано у кнопки улучшения (`ui/parts/upgrade.ts`).
 * Подпись, написанная рядом, разошлась бы с правилом при первой же правке лестницы; замер
 * разойтись не может.
 */
export function techGains(branch: RealmBranch, level: number): string[] {
  const out: string[] = [];
  if (branch === 'diplo') {
    const was = FIGURE_IDS.filter((id) => placeOpenAt(level, id));
    const now = FIGURE_IDS.filter((id) => placeOpenAt(level + 1, id));
    for (const id of now) if (!was.includes(id)) out.push(`Место в игре: ${FIGURE_BY_ID[id].name.toLowerCase()}`);
    const slots = mailSlotsAt(level + 1) - mailSlotsAt(level);
    if (slots > 0) out.push(`Стол донесений: ${mailSlotsAt(level)} → ${mailSlotsAt(level + 1)} ячеек`);
  }
  if (branch === 'war') {
    const gear = EQUIPMENT_IDS.filter((i) => gearOpenAt(level + 1, i) && !gearOpenAt(level, i));
    if (gear.length > 0) out.push(`Кузница: ${gear.map((i) => EQUIPMENT_BY_ID[i].name.toLowerCase()).join(', ')}`);
    const troops = TROOP_IDS.filter((t) => troopOpenAt(level + 1, t) && !troopOpenAt(level, t));
    if (troops.length > 0) out.push(`Войско: ${troops.map((t) => TROOP_BY_ID[t].name.toLowerCase()).join(', ')}`);
    const fates = WAR_FATES.filter((f) => fateOpenAt(level + 1, f) && !fateOpenAt(level, f));
    if (fates.length > 0) out.push(`Участь взятого города: ${fates.map((f) => FATE_META[f].name.toLowerCase()).join(', ')}`);
  }
  return out;
}

// ---------- Изучение: одна дверь траты ----------

export interface StudyInfo {
  branch: RealmBranch;
  /** Изученный уровень. */
  level: number;
  /** Какой уровень покупается следующим; 0 — покупать нечего. */
  next: number;
  /** Цена следующего уровня, очков. */
  price: number;
  /** Сколько очков этого вида есть. */
  have: number;
  /** Сколько ждать до цены, игровые секунды; 0 — хватает уже сейчас. */
  wait: GameSec;
  /** Что даст следующий уровень — замером. */
  gains: string[];
  /** Почему изучить нельзя; `null` — можно. */
  blocked: string | null;
}

/** Всё о следующем уровне ветви — одна функция на кнопку, на подпись и на действие. */
export function studyInfo(s: GameState, branch: RealmBranch): StudyInfo {
  const level = techLevel(s, branch);
  const next = level < levelsOf(branch) ? level + 1 : 0;
  const price = next > 0 ? levelPrice(branch, next) : 0;
  const have = pointsOf(s, branch);
  const rate = rulerRate(s, branch);
  const short = Math.max(0, price - have);
  let blocked: string | null = null;
  if (!BRANCH_BUILT[branch]) blocked = `${BRANCH_NAME[branch]} ветвь ещё не построена.`;
  else if (next === 0) blocked = 'Ветвь изучена целиком.';
  else if (short > 0) blocked = `Не хватает очков: нужно ${price}, есть ${Math.floor(have)}.`;
  return {
    branch,
    level,
    next,
    price,
    have,
    wait: asGame(rate > 0 ? (short / rate) * DAY_LENGTH : 0),
    gains: next > 0 ? techGains(branch, level) : [],
    blocked,
  };
}

/**
 * Изучить следующий уровень ветви. Очки списывает единственная дверь траты
 * (`points.spend`), уровень поднимается здесь, и третьего места, где растёт
 * `RealmState.tech`, нет — кроме засчитывания начатым партиям (`creditTech`).
 */
export function study(s: GameState, branch: RealmBranch): string | null {
  const info = studyInfo(s, branch);
  if (info.blocked) return info.blocked;
  if (!spend(s, branch, info.price)) return `Не хватает очков: нужно ${info.price}, есть ${Math.floor(info.have)}.`;
  s.realm.tech[branch] = info.next;
  const opened = info.gains.length > 0 ? ` Открылось: ${info.gains.join('; ').toLowerCase()}.` : '';
  log(s, `Изучен ${info.next} уровень ${BRANCH_NAME[branch].toLowerCase()} ветви — ${info.price} очков.${opened}`, 'good');
  return null;
}

// ---------- Засчитывание того, что партия уже прошла ----------

/**
 * Доказательство, что ступень у партии уже есть. Берётся из самого состояния
 * (docs/dynasty.md, раздел 6.2): технологии не отнимают у игрока того, чем он уже владеет.
 *
 * `hadAll` — запись сделана до того, как ветвь появилась. Тогда доказательством служит
 * сама запись: **до гейта место лазутчика было у каждой партии**, и тот, у кого лазутчик
 * как раз погиб, иначе потерял бы право нанять нового — то есть гейт отнял бы место, а не
 * закрыл новое. Ячейку стола `hadAll` не доказывает ничего: пятой ячейки не было ни у
 * кого, и это не «уже пройдено», а новая возможность.
 */
function proved(s: GameState, rung: DiploRung, hadAll: boolean): boolean {
  if (rung === 'letterSlot') return false;
  const p = s.agents?.[rung as FigureId];
  if (!p) return false;
  // Место занято, на него идёт найм или на нём уже кто-то сидел (номер человека не
  // обнуляется гибелью) — всё это партия, у которой место есть.
  return hadAll || p.vacant !== true || p.hiring !== null || p.person > 0;
}

/**
 * Держит ли партия эту вещь — **на складе или в дружине** (правило владельца: начатой
 * партии засчитывается ступень по самой дорогой вещи, которая у неё уже есть).
 *
 * `hadAll` сюда не приходит нарочно, и это не недосмотр: место агента до гейта **было** у
 * каждой партии, и отнять его значило бы отнять человека, — а доспех, которого партия
 * ни разу не сковала, у неё не отнимают, потому что его у неё нет. Разница между
 * возможностью и вещью здесь и проходит.
 */
function heldGear(s: GameState, item: EquipmentId): boolean {
  if ((s.equipment?.[item] ?? 0) > 0) return true;
  if ((s.forge ?? []).some((o) => o.item === item)) return true;
  const wears = TROOP_IDS.filter((t) => (TROOP_BY_ID[t].gear[item] ?? 0) > 0);
  for (const t of wears) {
    if ((s.army?.[t] ?? 0) > 0) return true;
    if ((s.away?.[t] ?? 0) > 0) return true;
    if ((s.recruits ?? []).some((o) => o.troop === t)) return true;
    if ((s.wounded ?? []).some((w) => (w.troops?.[t] ?? 0) > 0)) return true;
  }
  return false;
}

/**
 * Засчитать начатой партии то, что она уже прошла. Уровень только растёт: засчитывание
 * ничего не отнимает и ничего не удешевляет — оно лишь не даёт гейту закрыть уже
 * имеющееся. Возвращает ветви, которым уровень подняли.
 *
 * Дверь одна на три чтения (docs/dynasty.md, раздел 6.2): ступень сохранения, посёлок
 * мерки автопилота и — с будущими ветвями — всё, что ставит добро в обход покупки. Разведи
 * их по двум правилам, и отчёты начнут мерить деревню, которой в игре не бывает.
 */
export function creditTech(s: GameState, hadAll = false): RealmBranch[] {
  if (!s.realm?.tech) return [];
  const out: RealmBranch[] = [];
  const raise = (branch: RealmBranch, level: number): void => {
    if (level <= techLevel(s, branch)) return;
    s.realm.tech[branch] = level;
    out.push(branch);
  };
  let diplo = 1;
  for (const rung of DIPLO_RUNGS) if (proved(s, rung, hadAll)) diplo = Math.max(diplo, diploLevelOf(rung));
  raise('diplo', diplo);
  // Военная ветвь: самая дорогая вещь, которая у партии уже есть. Лестница монотонна,
  // значит всё, что ниже, подразумевается, и своего перебора видов бойцов здесь не нужно —
  // вид доказывает ровно те вещи, которые носит.
  //
  // **Участи здесь нет, и это решение владельца, а не пропуск** (docs/dynasty.md, раздел
  // 11.2): правило «по самой дорогой вещи» — про вещи, участь вещью не является, и
  // доказательства для неё в сохранении нет. Засчитай её хоть чем-нибудь — победами,
  // невольниками, `hadAll`, — и лестница, монотонная по построению, отдала бы вместе с ней
  // весь доспех тем, кто его не ковал. Выше последней вещи засчитывание не поднимается
  // никогда; участь открывается только покупкой — как ячейка стола донесений.
  let war = 1;
  for (const item of EQUIPMENT_IDS) if (heldGear(s, item)) war = Math.max(war, warLevelOfGear(item));
  raise('war', war);
  return out;
}
