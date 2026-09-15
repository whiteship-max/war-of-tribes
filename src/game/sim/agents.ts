// Люди на местах агентов — единственная дверь в `s.agents`.
//
// На каждом из четырёх мест стоит человек — с именем, возрастом, опытом и вещами, —
// или место пустует. Человек смертен: гибнет на деле (`HomeEffect.fell`) и уходит на
// покой в шестьдесят (`HomeEffect.retired`). Нового нанимают в здании (`sim/hire.ts`),
// и начинает он **с нуля**: первый уровень, новое имя, молодой возраст — не
// наследуется ничего.
//
// Опыт приходит из мира делом (`HomeEffect.deed`) и тоже чистая функция от события:
// тика у опыта нет. Возраст не хранится вовсе — он выводится из игрового времени
// (`ageOf`), поэтому стареет агент только пока идут часы деревни: неделя без игры не
// отправит всех четверых на покой.
//
// Вещи меняются только дома. Место агента знает мир, поэтому переодевание
// принимает его готовым (`Placed` из вида фигуры), а правило «дома» — одно на
// игру и на карточку: `world/shelter.canRegear`.
import type { AgentProgress, FaithId, GameState } from '../types';
import type { FigureId, HomeEffect } from '@/world/types';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { canRegear, placeOf, type Placed } from '@/world/shelter';
import {
  AGENT_AGE0,
  AGENT_YEAR,
  DEED_GAP,
  DEED_XP,
  MAX_AGENT_LEVEL,
  ONSLAUGHT_PER_CIRCLE,
  RETIRE_AGE,
  SIGHT_PER_CIRCLE,
  SKILL_OF,
  STEALTH_PER_CIRCLE,
  SLOT_COUNT,
  XP_CAP,
  levelOf,
  slotsOpen,
} from '../data/agents';
import { agentName } from '../data/names';
import { ITEMS, slotName, type ItemId } from '../data/items';
import { cityName } from '../../../netlify/lib/contract';
import { perilText, veilAt } from '@/world/peril';
import { log } from './log';

const blank = (): AgentProgress => ({
  xp: 0,
  deedAt: null,
  slots: Array.from({ length: SLOT_COUNT }, () => null),
  person: 0,
  name: null,
  bornAt: 0,
  age0: AGENT_AGE0,
  vacant: false,
  hiring: null,
});

/** Агенты новой партии: первый уровень у всех, руки пустые, имён ещё нет — их назовёт вера. */
export function emptyAgents(): Record<FigureId, AgentProgress> {
  return Object.fromEntries(FIGURE_IDS.map((id) => [id, blank()])) as Record<FigureId, AgentProgress>;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Агенты из сохранения. Словарь мержится по агентам, как армия по видам: новый
 * агент не должен приехать `undefined`. Каждое поле читается с умолчанием и
 * проверкой: опыт — неотрицательное число не выше потолка, ячейка — имя или пусто,
 * имя — через ту же очистку, что имя города.
 */
export function mergeAgents(saved: unknown): Record<FigureId, AgentProgress> {
  const out = emptyAgents();
  if (!saved || typeof saved !== 'object') return out;
  for (const id of FIGURE_IDS) {
    const raw = (saved as Record<string, unknown>)[id];
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<Record<keyof AgentProgress, unknown>>;
    const slots = Array.isArray(r.slots) ? r.slots : [];
    const h = r.hiring as Partial<Record<'until' | 'name' | 'age0', unknown>> | null | undefined;
    out[id] = {
      xp: finite(r.xp) ? Math.max(0, Math.min(XP_CAP, r.xp)) : 0,
      deedAt: finite(r.deedAt) ? r.deedAt : null,
      slots: Array.from({ length: SLOT_COUNT }, (_, i) => slotName(slots[i])),
      person: finite(r.person) ? Math.max(0, Math.floor(r.person)) : 0,
      name: cityName(r.name),
      bornAt: finite(r.bornAt) ? r.bornAt : 0,
      age0: finite(r.age0) ? Math.max(0, r.age0) : AGENT_AGE0,
      vacant: r.vacant === true,
      hiring:
        h && typeof h === 'object' && finite(h.until)
          ? { until: h.until, name: cityName(h.name), age0: finite(h.age0) ? h.age0 : AGENT_AGE0 }
          : null,
    };
  }
  return out;
}

// ---------- Кто на месте ----------

/** На месте стоит человек — не пустует. Идущий найм места не занимает. */
export const seated = (s: GameState, agent: FigureId): boolean => s.agents?.[agent]?.vacant !== true;

/** Возраст человека на месте, годы — дробные. Не хранится: выводится из часов деревни. */
export function ageOf(s: GameState, agent: FigureId): number {
  const p = s.agents?.[agent];
  if (!p) return AGENT_AGE0;
  return p.age0 + Math.max(0, s.time - p.bornAt) / AGENT_YEAR;
}

/** Сколько полных лет — так возраст и называют. */
export const yearsOf = (s: GameState, agent: FigureId): number => Math.floor(ageOf(s, agent));

/** Дожил до покоя: бросает дело и уходит, как дойдёт до своих ворот. */
export const retiring = (s: GameState, agent: FigureId): boolean => seated(s, agent) && ageOf(s, agent) >= RETIRE_AGE;

/** Когда человеку на месте исполнится шестьдесят, игровое время. */
export function retireAt(s: GameState, agent: FigureId): number {
  const p = s.agents[agent];
  return p.bornAt + Math.max(0, RETIRE_AGE - p.age0) * AGENT_YEAR;
}

/** Имя человека на месте — или имя должности, пока имени нет. */
export const personName = (s: GameState, agent: FigureId): string => s.agents?.[agent]?.name ?? FIGURE_BY_ID[agent].name;

/** Должность и имя для летописи: «Лазутчик Ян Хромой» — или «Лазутчик», пока имени нет. */
export function titled(s: GameState, agent: FigureId): string {
  const name = s.agents?.[agent]?.name;
  return name ? `${FIGURE_BY_ID[agent].name} ${name}` : FIGURE_BY_ID[agent].name;
}

/** Сколько лет — словами: «41 год», «24 года», «60 лет». */
export function yearsWord(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  const last = abs % 10;
  const word = tens >= 11 && tens <= 14 ? 'лет' : last === 1 ? 'год' : last >= 2 && last <= 4 ? 'года' : 'лет';
  return `${abs} ${word}`;
}

/**
 * Имя следующему, кому оно положено: партия берёт имя из перестановки по своему сиду
 * и номеру, а набор — у веры деревни. Пока мир не назвал веру, имени нет и брать его
 * неоткуда: подставлять католика «пока не знаем» нельзя — литовец под Вильнюсом
 * получил бы франкское имя навсегда.
 */
export function drawName(s: GameState, faith: FaithId | null = s.faith.id): string | null {
  if (!faith) return null;
  const name = cityName(agentName(s.seed, s.hires, faith));
  s.hires += 1;
  return name;
}

// ---------- Что навык даёт ----------
//
// Прибавки уезжают в мир слепком деревни (`bridge.playerProfile`), как Дозор отдаёт
// свои числа: мир не знает, что такое уровень, и получает прибавку готовой. Эти же
// функции зовёт карточка агента — второго счёта «сколько даёт кружок» у неё нет.
// Пустое место не даёт ничего: навык — свойство человека, а не должности.

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

const onPlace = (s: GameState, agent: FigureId, value: (level: number) => number, none: number): number =>
  seated(s, agent) ? value(agentLevel(s, agent)) : none;

export const onslaughtOf = (s: GameState): number => onPlace(s, 'general', onslaughtAt, 0);
export const sightBonusOf = (s: GameState): number => onPlace(s, 'scout', sightBonusAt, 0);
export const stealthOf = (s: GameState): number => onPlace(s, 'spy', stealthAt, 0);
/** Скрытность лазутчика в гибели: во сколько раз реже он гибнет на деле (`world/peril.veilAt`). */
export const veilOf = (s: GameState): number => onPlace(s, 'spy', veilAt, 1);

const ORDINAL = ['', 'первого', 'второго', 'третьего', 'четвёртого', 'пятого'];

/** Кружки словом-рисунком: ●●●○○. */
export const circlesText = (level: number): string =>
  '●'.repeat(Math.max(0, Math.min(MAX_AGENT_LEVEL, level))) + '○'.repeat(Math.max(0, MAX_AGENT_LEVEL - level));

export interface Deed {
  agent: FigureId;
  ok: boolean;
  /** Мировое время дела, мс. */
  at: number;
  /**
   * Кто делал: номер человека на месте. Дело, пришедшее за погибшего, новому не
   * засчитывается. Нет поля — дело из сохранения до смертных агентов, и засчитывается.
   */
  person?: number;
}

/**
 * Засчитать дело. Удача — два опыта, неудача — один; не чаще раза в `DEED_GAP`
 * на агента. Дело, пришедшее раньше срока (или раньше прошлого засчитанного),
 * опыта не даёт и отметку не двигает, — поэтому засчитанные дела всегда идут
 * по времени и не ближе пяти минут друг к другу. Возвращает, сколько опыта легло.
 */
export function recordDeed(s: GameState, deed: Deed): number {
  const p = s.agents?.[deed.agent];
  if (!p || !Number.isFinite(deed.at) || p.vacant) return 0;
  if (deed.person !== undefined && deed.person !== p.person) return 0;
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
      `${titled(s, deed.agent)} дошёл до ${ORDINAL[now]} уровня` +
        (skill ? `: ${skill.name.toLowerCase()} ${circlesText(now)}.` : '.'),
      'good',
    );
  }
  return p.xp - before;
}

/** Где нанимают — словами, для строк «место пустует». */
export type HireWhere = (agent: FigureId) => string;

/**
 * Освободить место: человек погиб или ушёл. Весть приезжает из мира поздно — после
 * офлайна, после очереди событий, — и применяется только к тому, о ком она: место,
 * на котором уже стоит нанятый после, её не касается. Возвращает, освободилось ли.
 */
function vacate(s: GameState, agent: FigureId, person: number): boolean {
  const p = s.agents?.[agent];
  if (!p || p.vacant || p.person !== person) return false;
  p.vacant = true;
  p.hiring = null;
  return true;
}

/**
 * Агент погиб на деле. Строка летописи называет, **кого** потеряли и **почему**, и
 * стоит в ней тот самый риск, что был показан перед приказом, — тем же числом.
 */
export function recordDeath(s: GameState, fell: NonNullable<HomeEffect['fell']>, where: HireWhere): boolean {
  if (!fell || typeof fell !== 'object') return false;
  const p = s.agents?.[fell.agent];
  if (!p) return false;
  const level = agentLevel(s, fell.agent);
  const years = yearsOf(s, fell.agent);
  const who = titled(s, fell.agent);
  if (!vacate(s, fell.agent, fell.person)) return false;
  const why = fell.why.length > 0 ? ` ${fell.why.join(', ')}.` : '';
  log(
    s,
    `${who} погиб ${fell.where}: ${yearsWord(years)}, ${levelWord(level)} уровень.` +
      `${why} Перед приказом гибель стояла ${perilText(fell.peril)}. Место пустует — нанять ${where(fell.agent)}.`,
    'bad',
  );
  return true;
}

/** Агент дошёл домой после шестидесяти и ушёл на покой. */
export function recordRetire(s: GameState, retired: NonNullable<HomeEffect['retired']>, where: HireWhere): boolean {
  const p = s.agents?.[retired.agent];
  if (!p) return false;
  const level = agentLevel(s, retired.agent);
  const who = titled(s, retired.agent);
  if (!vacate(s, retired.agent, retired.person)) return false;
  log(
    s,
    `${who} ушёл на покой в ${RETIRE_AGE} лет, дослужив до ${ORDINAL[level]} уровня. ` +
      `Место пустует — нанять ${where(retired.agent)}.`,
    'info',
  );
  return true;
}

/**
 * Человек пришёл на пустое место: номер следующий, опыт и вещи — с нуля, возраст —
 * какой дало здание. Имя известно с начала найма; если веры тогда ещё не знали, оно
 * берётся сейчас.
 */
export function seat(s: GameState, agent: FigureId, at: number, age0: number, name: string | null): void {
  const p = s.agents[agent];
  const next = blank();
  next.person = p.person + 1;
  next.bornAt = at;
  next.age0 = age0;
  next.name = name ?? drawName(s);
  s.agents[agent] = next;
}

/** Уровень словом в именительном: «третий». */
export const levelWord = (level: number): string =>
  ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый'][Math.max(0, Math.min(MAX_AGENT_LEVEL, level))];

/**
 * Имена тем, кто стоит на месте без имени: четверым, с кем партия началась, — как
 * только мир назовёт веру. Зовётся шагом партии; имён, раз данных, не трогает.
 */
export function nameAgents(s: GameState): boolean {
  if (!s.faith.id) return false;
  let changed = false;
  for (const id of FIGURE_IDS) {
    const p = s.agents[id];
    if (p.vacant || p.name !== null) continue;
    p.name = drawName(s);
    changed = true;
  }
  return changed;
}

/**
 * Почему агента нельзя переодеть прямо сейчас; null — можно. Слова одни на
 * карточку и на действие: кнопка, которая не сработает, говорит то же, что
 * сказал бы отказ.
 */
export function regearBlock(agent: FigureId, where: Placed): string | null {
  if (canRegear(where)) return null;
  const name = FIGURE_BY_ID[agent].name;
  const place = placeOf(where);
  if (place === 'vacant') return `Места ${FIGURE_BY_ID[agent].one} некому занять: переодевать некого.`;
  if (place === 'down') return `${name} вне строя: переодеться сможет, когда вернётся домой.`;
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
  if (!p || p.vacant) return 'Место пустует: переодевать некого.';
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

