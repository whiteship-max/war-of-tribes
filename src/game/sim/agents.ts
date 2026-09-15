// Опыт и вещи агентов — единственная дверь в `s.agents`.
//
// Опыт приходит из мира делом (`HomeEffect.deed`) и уходит гибелью
// (`HomeEffect.fell`), и то и другое — чистая функция от события: тика у опыта
// нет, часов модуль не читает. Время дела приезжает числом вместе с делом, как
// номер дня приезжает в ежедневку.
//
// Вещи меняются только дома. Место агента знает мир, поэтому переодевание
// принимает его готовым (`Placed` из вида фигуры), а правило «дома» — одно на
// игру и на карточку: `world/shelter.canRegear`.
import type { AgentProgress, GameState } from '../types';
import type { FigureId } from '@/world/types';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { canRegear, placeOf, type Placed } from '@/world/shelter';
import {
  DEED_GAP,
  DEED_XP,
  LEVEL_XP,
  MAX_AGENT_LEVEL,
  ONSLAUGHT_PER_CIRCLE,
  SIGHT_PER_CIRCLE,
  SKILL_OF,
  STEALTH_PER_CIRCLE,
  SLOT_COUNT,
  XP_CAP,
  levelFloor,
  levelOf,
  slotsOpen,
} from '../data/agents';
import { ITEMS, slotName, type ItemId } from '../data/items';
import { log } from './log';

const blank = (): AgentProgress => ({ xp: 0, deedAt: null, slots: Array.from({ length: SLOT_COUNT }, () => null) });

/** Агенты новой партии: первый уровень у всех, руки пустые. */
export function emptyAgents(): Record<FigureId, AgentProgress> {
  return Object.fromEntries(FIGURE_IDS.map((id) => [id, blank()])) as Record<FigureId, AgentProgress>;
}

/**
 * Агенты из сохранения. Словарь мержится по агентам, как армия по видам: новый
 * агент не должен приехать `undefined`. Каждое поле читается с умолчанием и
 * проверкой: опыт — неотрицательное число не выше потолка, ячейка — имя или пусто.
 */
export function mergeAgents(saved: unknown): Record<FigureId, AgentProgress> {
  const out = emptyAgents();
  if (!saved || typeof saved !== 'object') return out;
  for (const id of FIGURE_IDS) {
    const raw = (saved as Record<string, unknown>)[id];
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<Record<keyof AgentProgress, unknown>>;
    const xp = typeof r.xp === 'number' && Number.isFinite(r.xp) ? Math.max(0, Math.min(XP_CAP, r.xp)) : 0;
    const deedAt = typeof r.deedAt === 'number' && Number.isFinite(r.deedAt) ? r.deedAt : null;
    const slots = Array.isArray(r.slots) ? r.slots : [];
    out[id] = { xp, deedAt, slots: Array.from({ length: SLOT_COUNT }, (_, i) => slotName(slots[i])) };
  }
  return out;
}

// ---------- Что навык даёт ----------
//
// Три числа, и каждое уезжает в мир слепком деревни (`bridge.playerProfile`), как
// Дозор отдаёт `intelKeen`: мир не знает, что такое уровень, и получает прибавку
// готовой. Эти же функции зовёт карточка агента — второго счёта «сколько даёт
// кружок» у неё нет. Живут они здесь, а не в `derived.ts`, нарочно: модули навыка
// читаются тестом как целое (`agents.owners.test.ts`), и в них не должно быть ни
// одного числа, которым владеет здание.

/** Уровень агента в этой партии. */
export const agentLevel = (s: GameState, agent: FigureId): number => levelOf(s.agents?.[agent]?.xp ?? 0);

/** Кружков сверх первого на уровне. Первый уровень — ноль, и навык не действует. */
const extra = (level: number): number => Math.max(0, Math.min(MAX_AGENT_LEVEL, Math.floor(level)) - 1);

/** Натиск на этом уровне полководца: прибавка к стойкости в его боях. */
export const onslaughtAt = (level: number): number => ONSLAUGHT_PER_CIRCLE * extra(level);
/** Зоркость на этом уровне разведчика: на сколько клеток шире он открывает землю. */
export const sightBonusAt = (level: number): number => SIGHT_PER_CIRCLE * extra(level);
/** Скрытность на этом уровне лазутчика: доля провалов, прошедших незамеченными. */
export const stealthAt = (level: number): number => STEALTH_PER_CIRCLE * extra(level);

export const onslaughtOf = (s: GameState): number => onslaughtAt(agentLevel(s, 'general'));
export const sightBonusOf = (s: GameState): number => sightBonusAt(agentLevel(s, 'scout'));
export const stealthOf = (s: GameState): number => stealthAt(agentLevel(s, 'spy'));

const ORDINAL = ['', 'первого', 'второго', 'третьего', 'четвёртого', 'пятого'];

/** Кружки словом-рисунком: ●●●○○. */
export const circlesText = (level: number): string =>
  '●'.repeat(Math.max(0, Math.min(MAX_AGENT_LEVEL, level))) + '○'.repeat(Math.max(0, MAX_AGENT_LEVEL - level));

export interface Deed {
  agent: FigureId;
  ok: boolean;
  /** Мировое время дела, мс. */
  at: number;
}

/**
 * Засчитать дело. Удача — два опыта, неудача — один; не чаще раза в `DEED_GAP`
 * на агента. Дело, пришедшее раньше срока (или раньше прошлого засчитанного),
 * опыта не даёт и отметку не двигает, — поэтому засчитанные дела всегда идут
 * по времени и не ближе пяти минут друг к другу. Возвращает, сколько опыта легло.
 */
export function recordDeed(s: GameState, deed: Deed): number {
  const p = s.agents?.[deed.agent];
  if (!p || !Number.isFinite(deed.at)) return 0;
  if (p.deedAt !== null && deed.at - p.deedAt < DEED_GAP) return 0;
  const before = p.xp;
  p.deedAt = deed.at;
  p.xp = Math.min(XP_CAP, p.xp + (deed.ok ? DEED_XP.ok : DEED_XP.fail));
  const was = levelOf(before);
  const now = levelOf(p.xp);
  if (now > was) {
    const skill = SKILL_OF[deed.agent];
    log(
      s,
      `${FIGURE_BY_ID[deed.agent].name} дошёл до ${ORDINAL[now]} уровня` +
        (skill ? `: ${skill.name.toLowerCase()} ${circlesText(now)}.` : '.'),
      'good',
    );
  }
  return p.xp - before;
}

/**
 * Сколько опыта отнимает гибель: путь к следующему уровню, но не больше половины
 * шага до него. Уровень, однажды взятый, не падает; на последнем уровне пути нет
 * и отнимать нечего.
 */
export function fallLoss(xp: number): number {
  const level = levelOf(xp);
  if (level >= MAX_AGENT_LEVEL) return 0;
  const floor = levelFloor(level);
  const step = LEVEL_XP[level] - floor;
  return Math.max(0, Math.min(xp - floor, Math.floor(step / 2)));
}

/** Агент выбыл. Возвращает, сколько опыта ушло. */
export function recordFall(s: GameState, agent: FigureId): number {
  const p = s.agents?.[agent];
  if (!p) return 0;
  const loss = fallLoss(p.xp);
  if (loss <= 0) return 0;
  p.xp -= loss;
  log(s, `${FIGURE_BY_ID[agent].name} выбыл и растерял часть пути к следующему уровню: опыта −${loss}.`, 'bad');
  return loss;
}

/**
 * Почему агента нельзя переодеть прямо сейчас; null — можно. Слова одни на
 * карточку и на действие: кнопка, которая не сработает, говорит то же, что
 * сказал бы отказ.
 */
export function regearBlock(agent: FigureId, where: Placed): string | null {
  if (canRegear(where)) return null;
  const name = FIGURE_BY_ID[agent].name;
  if (placeOf(where) === 'down') return `${name} выбыл: переодеться сможет, когда вернётся домой.`;
  if (where.phase === 'moving') return `${name} в пути: переодеваются дома — у своих ворот или в городе.`;
  return `${name} в поле: переодеваются дома — у своих ворот или в городе.`;
}

/**
 * Надеть предмет в ячейку или снять (`item` = null). Ячейка получает имя и
 * ничего больше; что предмет даёт, спросят у `ITEMS`, когда он будет надет.
 */
export function regear(
  s: GameState,
  agent: FigureId,
  slot: number,
  item: ItemId | null,
  where: Placed,
  owned: readonly ItemId[],
): string | null {
  const p = s.agents?.[agent];
  if (!p) return 'Такого агента нет.';
  const blocked = regearBlock(agent, where);
  if (blocked) return blocked;
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) return 'Такого места нет.';
  if (slot >= slotsOpen(p.xp)) return 'Это место откроется с четвёртого уровня.';
  if (item !== null) {
    if (!Object.prototype.hasOwnProperty.call(ITEMS, item)) return 'Такого предмета нет.';
    if (!owned.includes(item)) return 'Этого предмета у тебя нет.';
    if (p.slots.some((x, i) => i !== slot && x === item)) return 'Этот предмет уже надет.';
  }
  p.slots[slot] = item;
  return null;
}
