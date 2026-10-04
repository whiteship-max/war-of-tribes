// Люди на местах агентов — единственная дверь в `s.agents`.
//
// На каждом из четырёх мест стоит человек — с именем, возрастом, опытом и вещами, —
// или место пустует. Человек смертен: гибнет на деле (`HomeEffect.fell`) и уходит на
// покой в возрасте `RETIRE_AGE` (`HomeEffect.retired`). Нового нанимают в здании (`sim/hire.ts`),
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
import type { AgentProgress, FaithId, GameState, LineageEntry, LineagePlace, RulerSkills, Tally } from '../types';
import type { FigureId, HomeEffect } from '@/world/types';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import { canRegear, placeOf, type Placed } from '@/world/shelter';
import {
  AGENT_AGE0,
  AGENT_YEAR,
  DEED_GAP,
  DEED_XP,
  MAX_AGENT_LEVEL,
  RETIRE_AGE,
  SIGHT_PER_CIRCLE,
  SKILL_OF,
  STEALTH_PER_CIRCLE,
  SLOT_COUNT,
  THIRD_SLOT_LEVEL,
  XP_CAP,
  levelOf,
  slotsOpen,
} from '../data/agents';
import { agentName } from '../data/names';
import { MAX_RULER_SKILL, MIN_RULER_SKILL, REALM_BRANCHES } from '../data/realm';
import {
  LINEAGE_KEEP,
  LINEAGE_LEVEL,
  TRAIT_BY_ID,
  deedsOf,
  isTraitId,
  traitsOf,
  type TraitId,
  type TraitNumbers,
} from '../data/traits';
import { ITEMS, slotName, type ItemId } from '../data/items';
import { cityName } from '../../../netlify/lib/contract';
import { perilText, veilAt } from '@/world/peril';
import { PIP_IDS, type Pips } from '@/battle';
import { tradition } from '../derived';
import { log } from './log';
import { mixSeed, seeded } from './random';

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
  tally: { ok: 0, fail: 0, bled: 0, burned: 0 },
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
    const t = (r.tally ?? {}) as Partial<Record<keyof Tally, unknown>>;
    const count = (v: unknown): number => (finite(v) ? Math.max(0, Math.floor(v)) : 0);
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
      // Счёт дел появился позже опыта: у партии до черт его нет, и он начинается с
      // нуля — задним числом побед от поражений не отличить.
      tally: { ok: count(t.ok), fail: count(t.fail), bled: count(t.bled), burned: count(t.burned) },
    };
  }
  return out;
}

/**
 * Родословная из сохранения: по месту, каждая запись с проверкой, не длиннее
 * потолка места. Имя — через ту же очистку, что имя города; черта, которой в
 * таблице больше нет, выбрасывается молча — она о прошлом и ничего не даёт.
 */
export function mergeLineage(saved: unknown): Partial<Record<LineagePlace, LineageEntry[]>> {
  const out: Partial<Record<LineagePlace, LineageEntry[]>> = {};
  if (!saved || typeof saved !== 'object') return out;
  // Книга одна, и мест в ней на одно больше, чем фигур на карте: дом правителя.
  for (const id of [...FIGURE_IDS, 'ruler'] as LineagePlace[]) {
    const raw = (saved as Record<string, unknown>)[id];
    if (!Array.isArray(raw) || LINEAGE_KEEP[id] <= 0) continue;
    const rows: LineageEntry[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Partial<Record<keyof LineageEntry, unknown>>;
      const name = cityName(r.name);
      if (!name || !finite(r.level) || !finite(r.deeds) || !finite(r.from) || !finite(r.to)) continue;
      if (r.end !== 'fell' && r.end !== 'rest') continue;
      // У записи правителя уровня нет — три навыка; поле необязательное, и старая
      // запись агента приезжает без него, как приезжала.
      const skills = mergeSkills(r.skills);
      rows.push({
        name,
        level: skills ? 0 : Math.max(1, Math.min(MAX_AGENT_LEVEL, Math.floor(r.level))),
        deeds: Math.max(0, Math.floor(r.deeds)),
        from: Math.max(0, Math.floor(r.from)),
        to: Math.max(0, Math.floor(r.to)),
        end: r.end,
        traits: Array.isArray(r.traits) ? r.traits.filter(isTraitId) : [],
        ...(skills ? { skills } : {}),
      });
      if (rows.length >= LINEAGE_KEEP[id]) break;
    }
    if (rows.length > 0) out[id] = rows;
  }
  return out;
}

/** Три навыка из сохранения, каждый в границах лестницы; не три числа — значит не правитель. */
export function mergeSkills(saved: unknown): RulerSkills | null {
  if (!saved || typeof saved !== 'object') return null;
  const r = saved as Record<string, unknown>;
  const out = {} as RulerSkills;
  for (const b of REALM_BRANCHES) {
    const v = r[b];
    if (!finite(v)) return null;
    out[b] = Math.max(MIN_RULER_SKILL, Math.min(MAX_RULER_SKILL, Math.round(v)));
  }
  return out;
}

// ---------- Кто на месте ----------

/** На месте стоит человек — не пустует. Идущий найм места не занимает. */
export const seated = (s: GameState, agent: FigureId): boolean => s.agents?.[agent]?.vacant !== true;

/**
 * Как стареет человек — одна формула на всю игру: и на агента, и на правителя
 * (`sim/dynasty.rulerAge`). Второй правды о том, во что обращается прошедшее время,
 * быть не должно: год один (`AGENT_YEAR`), и часы одни — деревни.
 */
export const ageAt = (age0: number, bornAt: number, now: number): number => age0 + Math.max(0, now - bornAt) / AGENT_YEAR;

/** Возраст человека на месте, годы — дробные. Не хранится: выводится из часов деревни. */
export function ageOf(s: GameState, agent: FigureId): number {
  const p = s.agents?.[agent];
  if (!p) return AGENT_AGE0;
  return ageAt(p.age0, p.bornAt, s.time);
}

/** Сколько полных лет — так возраст и называют. */
export const yearsOf = (s: GameState, agent: FigureId): number => Math.floor(ageOf(s, agent));

/** Дожил до покоя: бросает дело и уходит, как дойдёт до своих ворот. */
export const retiring = (s: GameState, agent: FigureId): boolean => seated(s, agent) && ageOf(s, agent) >= RETIRE_AGE;

/** Когда человеку на месте исполнится `RETIRE_AGE`, игровое время. */
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

/** Соль склонности полководца: своя, чтобы не совпасть ни с костью дома, ни с перестановкой имён. */
const TEMPER_DIE = 0x70697073;

/**
 * Отметки полководца на этом уровне. Кружков сверх первого — столько же отметок, и каждая ложится в
 * одну из четырёх (обстрел, сшибка, сеча, манёвр) по склонности человека: броском от сида партии и
 * его номера — тем же приёмом, каким `sim/dynasty.skillsOf` выводит навыки правителя. Поля в
 * сохранении нет, `s.rolls` не двигается, и один и тот же человек растёт всегда одинаково: второй
 * кружок ложится туда же, дорасти он до него раньше или позже. Первый уровень — ни одной отметки.
 */
export function pipsAt(seed: number, person: number, level: number): Pips {
  const rnd = seeded(mixSeed(seed, mixSeed(TEMPER_DIE, person)));
  const out: Pips = {};
  for (let i = 0; i < extra(level); i += 1) {
    const pip = PIP_IDS[Math.floor(rnd() * PIP_IDS.length)];
    out[pip] = (out[pip] ?? 0) + 1;
  }
  return out;
}

/** Зоркость на этом уровне разведчика: на сколько клеток шире он открывает землю. */
export const sightBonusAt = (level: number): number => SIGHT_PER_CIRCLE * extra(level);
/** Скрытность на этом уровне лазутчика: доля провалов, прошедших незамеченными. */
export const stealthAt = (level: number): number => STEALTH_PER_CIRCLE * extra(level);

const onPlace = (s: GameState, agent: FigureId, value: (level: number) => number, none: number): number =>
  seated(s, agent) ? value(agentLevel(s, agent)) : none;

/**
 * Уровень, с которого считаются отметки полководца уровня `level`: его кружки и кружки воинской традиции Статуи
 * (`derived.tradition`; П4, docs/battle_eu4.md, 14.35), не выше последнего. Традиция — не второй счёт отметок, а вход той же
 * двери (`pipsAt`): лишний кружок ложится туда же, куда лёг бы кружок опыта, — по склонности человека.
 */
export const pipLevel = (s: GameState, level: number): number =>
  Math.min(MAX_AGENT_LEVEL, Math.max(1, Math.floor(level)) + tradition(s));

/** Отметки полководца на месте. Пустое место — ни одной: навык — свойство человека, а не должности. */
export const pipsOf = (s: GameState): Pips =>
  seated(s, 'general') ? pipsAt(s.seed, s.agents?.general?.person ?? 0, pipLevel(s, agentLevel(s, 'general'))) : {};
export const sightBonusOf = (s: GameState): number => onPlace(s, 'scout', sightBonusAt, 0);
export const stealthOf = (s: GameState): number => onPlace(s, 'spy', stealthAt, 0);
/** Скрытность лазутчика в гибели: во сколько раз реже он гибнет на деле (`world/peril.veilAt`). */
export const veilOf = (s: GameState): number => onPlace(s, 'spy', veilAt, 1);

const ORDINAL = ['', 'первого', 'второго', 'третьего', 'четвёртого', 'пятого'];

/** Уровень словом в родительном: «до второго уровня». */
export const levelOfWord = (level: number): string => ORDINAL[Math.max(0, Math.min(MAX_AGENT_LEVEL, level))];

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
  /** Сколько бойцов дружины пало в этом деле. Есть только у боёв полководца. */
  lost?: number;
  /** Этим делом сожжено логово. */
  lair?: boolean;
}

/**
 * Засчитать дело. Удача и неудача дают опыт по `DEED_XP`; не чаще раза в `DEED_GAP`
 * на агента. Дело, пришедшее раньше срока (или раньше прошлого засчитанного),
 * опыта не даёт и отметку не двигает, — поэтому засчитанные дела всегда идут
 * по времени и не ближе `DEED_GAP` друг к другу. Возвращает, сколько опыта легло.
 */
export function recordDeed(s: GameState, deed: Deed): number {
  const p = s.agents?.[deed.agent];
  if (!p || !Number.isFinite(deed.at) || p.vacant) return 0;
  if (deed.person !== undefined && deed.person !== p.person) return 0;
  if (p.deedAt !== null && deed.at - p.deedAt < DEED_GAP) return 0;
  const before = p.xp;
  const had = traitsOf(deed.agent, p.tally);
  p.deedAt = deed.at;
  p.xp = Math.min(XP_CAP, p.xp + (deed.ok ? DEED_XP.ok : DEED_XP.fail));
  // Счёт дел — за той же проверкой срока, что опыт: черты не фармятся там, где не
  // фармится опыт.
  if (deed.ok) p.tally.ok += 1;
  else p.tally.fail += 1;
  p.tally.bled += Number.isFinite(deed.lost) ? Math.max(0, Math.floor(deed.lost as number)) : 0;
  if (deed.lair) p.tally.burned += 1;
  const was = levelOf(before);
  const now = levelOf(p.xp);
  if (now > was) {
    const skill = SKILL_OF[deed.agent];
    log(
      s,
      `${titled(s, deed.agent)} дошёл до ур. ${now}` +
        (skill ? `: ${skill.name.toLowerCase()} ${circlesText(now)}.` : '.'),
      'good',
    );
  }
  const has = traitsOf(deed.agent, p.tally);
  for (const id of has) {
    if (had.includes(id)) continue;
    const def = TRAIT_BY_ID[id];
    log(s, `${titled(s, deed.agent)} прослыл: «${def.name}».`, def.good ? 'good' : 'bad');
  }
  for (const id of had) {
    if (has.includes(id)) continue;
    const def = TRAIT_BY_ID[id];
    log(s, `${titled(s, deed.agent)} больше не слывёт: «${def.name}».`, def.good ? 'bad' : 'good');
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
function vacate(s: GameState, agent: FigureId, person: number, end: LineageEntry['end']): boolean {
  const p = s.agents?.[agent];
  if (!p || p.vacant || p.person !== person) return false;
  remember(s, agent, end);
  p.vacant = true;
  p.hiring = null;
  return true;
}

/**
 * Положить ушедшего в родословную места. Зовёт её только `vacate` — единственная
 * дверь, через которую человек покидает место, — поэтому записи не бывает ни
 * дважды, ни мимо. Погибших помнят всех, ушедших на покой — с уровня `LINEAGE_LEVEL`;
 * новые первыми, не больше потолка места.
 */
function remember(s: GameState, agent: FigureId, end: LineageEntry['end']): void {
  const p = s.agents[agent];
  const level = agentLevel(s, agent);
  if (end === 'rest' && level < LINEAGE_LEVEL) return;
  keepInBook(s, agent, {
    name: p.name ?? FIGURE_BY_ID[agent].name,
    level,
    deeds: deedsOf(p.tally),
    from: Math.floor(p.age0),
    to: yearsOf(s, agent),
    end,
    traits: traitsOf(agent, p.tally),
  });
}

/**
 * Положить запись в книгу родословной: новые первыми, не больше потолка места. **Книга
 * одна на дом правителя и на места агентов, и кладут в неё одной этой дверью** — у мест
 * её зовёт `remember` (а его — только `vacate`), у дома `sim/dynasty.succeed`. Второго
 * места, где трогают `s.lineage`, быть не должно: две записи одного ухода не отличить от
 * одной, а потолок, применённый дважды, съел бы чужую память.
 *
 * Кого помнить, решает не эта дверь, а тот, кто зовёт: у агентов порог `LINEAGE_LEVEL`
 * для ушедших на покой, у дома порога нет — правителей помнят всех.
 */
export function keepInBook(s: GameState, place: LineagePlace, entry: LineageEntry): void {
  const keep = LINEAGE_KEEP[place];
  if (keep <= 0) return;
  if (!s.lineage) s.lineage = {};
  s.lineage[place] = [entry, ...(s.lineage[place] ?? [])].slice(0, keep);
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
  if (!vacate(s, fell.agent, fell.person, 'fell')) return false;
  const why = fell.why.length > 0 ? ` ${fell.why.join(', ')}.` : '';
  log(
    s,
    `${who} погиб ${fell.where}: ${yearsWord(years)}, ур. ${level}.` +
      `${why} Риск гибели был ${perilText(fell.peril)}. Место пустует, нанять ${where(fell.agent)}.`,
    'bad',
  );
  return true;
}

/** Агент дошёл домой после `RETIRE_AGE` и ушёл на покой. */
export function recordRetire(s: GameState, retired: NonNullable<HomeEffect['retired']>, where: HireWhere): boolean {
  const p = s.agents?.[retired.agent];
  if (!p) return false;
  const level = agentLevel(s, retired.agent);
  const who = titled(s, retired.agent);
  if (!vacate(s, retired.agent, retired.person, 'rest')) return false;
  log(
    s,
    `${who} ушёл на покой в ${RETIRE_AGE} лет, дослужив до ур. ${level}. ` +
      `Место пустует, нанять ${where(retired.agent)}.`,
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

// ---------- Что черта даёт ----------
//
// Черты не хранятся: они выводятся из счёта дел человека на месте. Пустое место
// не даёт ничего — черта, как и навык, свойство человека, а не должности.

/** Черты человека на месте. */
export const traitsHeld = (s: GameState, agent: FigureId): TraitId[] =>
  seated(s, agent) && s.agents?.[agent] ? traitsOf(agent, s.agents[agent].tally) : [];

/**
 * Сколько морали дома прибавит к исходу боя слава того, кто его вёл. Считается по
 * чертам **до** этого боя: побеждал всегда — победа радует сильнее; бит — поражение
 * горше. Первое поражение «Победоносного» прибавки не даёт и снимает черту.
 */
export function reputeMorale(s: GameState, deed: Deed): number {
  const p = s.agents?.[deed.agent];
  if (!p || p.vacant) return 0;
  if (deed.person !== undefined && deed.person !== p.person) return 0;
  let sum = 0;
  for (const id of traitsHeld(s, deed.agent)) {
    const e = TRAIT_BY_ID[id].effect;
    sum += (deed.ok ? e.won : e.lost) ?? 0;
  }
  return sum;
}

/** Ключи множителей, которые черты отдают миру. */
const WORLD_KEYS = ['muster', 'carry', 'catch', 'busy', 'held'] as const;

/**
 * Множители черт для мира — только те, что не единица. Мир получает их готовыми,
 * как прибавки навыка: что такое черта, он не знает. Нет черт — пусто, и слепок
 * партии без черт тот же байт в байт.
 */
export function traitNumbers(s: GameState): TraitNumbers {
  const out: TraitNumbers = {};
  for (const id of FIGURE_IDS) {
    for (const t of traitsHeld(s, id)) {
      const e = TRAIT_BY_ID[t].effect;
      for (const key of WORLD_KEYS) {
        const v = e[key];
        if (v !== undefined) out[key] = (out[key] ?? 1) * v;
      }
    }
  }
  return out;
}

/**
 * Новый полководец без дружины: пришёл на место, ещё не водил ни одного боя, а
 * дружины при нём нет. Дружина прежнего осталась городу или пала с ним, и
 * преемник сидит дома, пока игрок её не соберёт, — тихая потеря целой службы.
 * Место знает мир, поэтому фигура приходит готовой (`FigureView`). Номер человека
 * больше нуля — это не тот, с кем партия началась: первому дружину собирают по
 * обучению, а не по тревоге.
 */
export function bareGeneral(
  s: GameState,
  view: { place: string; troops?: Partial<Record<string, number>> } | undefined,
): boolean {
  const p = s.agents?.general;
  if (!p || p.vacant || p.person <= 0 || !view) return false;
  if (deedsOf(p.tally) > 0) return false;
  if (view.place !== 'map' && view.place !== 'city') return false;
  return Object.values(view.troops ?? {}).every((n) => !n || n <= 0);
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
  if (place === 'vacant') return 'Место пустует, переодевать некого.';
  if (place === 'down') return `${name} вне строя, переодеться сможет дома.`;
  if (where.phase === 'moving') return `${name} в пути, переодеваются дома.`;
  return `${name} в поле, переодеваются дома.`;
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
  if (!p || p.vacant) return 'Место пустует, переодевать некого.';
  const blocked = regearBlock(agent, where);
  if (blocked) return blocked;
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) return 'Такого места нет.';
  if (slot >= slotsOpen(p.xp)) return `Это место откроется на ур. ${THIRD_SLOT_LEVEL}.`;
  if (item !== null) {
    if (!Object.prototype.hasOwnProperty.call(ITEMS, item)) return 'Такой вещи нет.';
    if (!owned.includes(item)) return 'Этой вещи у тебя нет.';
    if (p.slots.some((x, i) => i !== slot && x === item)) return 'Эта вещь уже надета.';
  }
  p.slots[slot] = item;
  return null;
}

