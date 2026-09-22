// Гейт: единственная дверь ко всем вопросам «открыто ли это».
//
// **Правило проекта, ради которого дверь одна** (docs/dynasty.md, раздел 10.1, решение 1):
// гейт существует только выведенный из структуры и прошедший через одну дверь. Показ
// («закрыто, откроется на уровне N»), отказ («нанять нельзя») и сам запрет читают здесь
// одно и то же число; двух правд о том, что закрыто, быть не должно — иначе карточка
// обещает одно, кнопка делает другое, и разойдутся они ровно тогда, когда лестницу
// поправят.
//
// **Рукописного `requiresTech` нет ни у здания, ни у бойца, ни у вещи, ни у агента, и
// заводить его нельзя.** Уровень ступени выводится из места в списке ветви
// (`data/realm.diploLevelOf`), а что ступень даёт — меряется этими же дверьми
// (`techGains`), а не подписывается рядом. Держат это тесты по исходникам
// (`sim/tech.test.ts`).
//
// **Ни одного тика.** Уровень лежит в партии (`RealmState.tech`), всё остальное —
// чтение: открыто ли место, сколько ячеек у стола, что даст следующий уровень.
import type { FigureId } from '@/world/types';
import type { GameState, RealmBranch } from '../types';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { LETTER_DECISIONS } from '@/world/letters';
import {
  BRANCH_BUILT,
  BRANCH_NAME,
  BRANCH_OF,
  DIPLO_RUNGS,
  DIPLO_RUNG_NAME,
  type DiploRung,
  diploLevelOf,
  isDiploRung,
  levelPrice,
  levelsOf,
} from '../data/realm';
import { asGame, type GameSec } from '../pace';
import { DAY_LENGTH } from '../constants';
import { pointsOf, rulerRate, spend } from './points';
import { log } from './log';

/**
 * Что можно спросить у гейта. Сегодня это ступени дипломатической ветви и только они:
 * военная и административная ветви ещё не построены, и заводить их ключи заранее значило
 * бы обещать проверку, которой нет.
 */
export type TechKey = DiploRung;

export interface Gate {
  branch: RealmBranch;
  level: number;
}

/**
 * Где на лестнице стоит ступень. Выводится из ветви, а не пишется таблицей: список
 * ступеней и есть лестница (docs/dynasty.md, раздел 4.6).
 */
export const gateOf = (key: TechKey): Gate => ({ branch: 'diplo', level: diploLevelOf(key) });

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
  return `${DIPLO_RUNG_NAME[key]} откроется на ${g.level} уровне ${BRANCH_OF[g.branch]} ветви — в «Технологиях».`;
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

// ---------- Что даст следующий уровень: замером, а не подписью ----------

/**
 * Что изменится между уровнем `level` и следующим — **прогоном тех же дверей на двух
 * уровнях**, тем же приёмом, каким это сделано у кнопки улучшения (`ui/parts/upgrade.ts`).
 * Подпись, написанная рядом, разошлась бы с правилом при первой же правке лестницы; замер
 * разойтись не может.
 */
export function techGains(branch: RealmBranch, level: number): string[] {
  if (branch !== 'diplo') return [];
  const out: string[] = [];
  const was = FIGURE_IDS.filter((id) => placeOpenAt(level, id));
  const now = FIGURE_IDS.filter((id) => placeOpenAt(level + 1, id));
  for (const id of now) if (!was.includes(id)) out.push(`Место в игре: ${FIGURE_BY_ID[id].name.toLowerCase()}`);
  const slots = mailSlotsAt(level + 1) - mailSlotsAt(level);
  if (slots > 0) out.push(`Стол донесений: ${mailSlotsAt(level)} → ${mailSlotsAt(level + 1)} ячеек`);
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
  const last = levelsOf(branch);
  const next = level < last ? level + 1 : 0;
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
  let level = 1;
  for (const rung of DIPLO_RUNGS) if (proved(s, rung, hadAll)) level = Math.max(level, diploLevelOf(rung));
  if (level > techLevel(s, 'diplo')) {
    s.realm.tech.diplo = level;
    out.push('diplo');
  }
  return out;
}
