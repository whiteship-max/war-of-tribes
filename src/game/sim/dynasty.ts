// Дом правителя: кто правит, кто наследует, когда меняются. Людей в доме двое живых —
// правитель и наследник, — и это половина всех именованных людей игры: вторая половина
// четыре места агентов карты. Третьего источника имён нет (docs/handbook/village.md, «Население»).
//
// Правитель делает ровно одно — даёт очки трёх видов (`sim/points`). Ни морали, ни
// обороны, ни множителей: числами, которыми уже владеет здание, он не владеет, и это то
// же правило, что запрещает второй источник числа навыкам агентов
// (`game/data/agents.owners.test.ts`).
//
// **Что происходит на смене правителя, решено владельцем: меняются только навыки.**
// Очки и изученное остаются — смерть не наказывает за то, чем игрок не управлял
// (docs/dynasty.md, раздел 1.4). Отсюда `bank` перед сменой: ставка у нового своя, а
// прошлое пересчитывать по ней нельзя.
//
// Возраст не тикает — он выводится из тех же часов деревни и той же формулы, что возраст
// агента (`sim/agents.ageAt`): второй правды о том, как стареет человек, в игре нет.
import type { FaithId, GameState, HousePerson, RealmState, Ruler, RulerSkills, RulerTally } from '../types';
import { ADVISOR_POSTS } from '../councilrules';
import { AGENT_AGE0, AGENT_YEAR, RETIRE_AGE, RETIRE_WARN } from '../data/agents';
import { ADMIN_LEVELS, DIPLO_LEVELS, MAX_RULER_SKILL, MIN_RULER_SKILL, POINTS_CAP, REALM_BRANCHES, SKILL_NAME, WAR_LEVELS, startingPoints } from '../data/realm';
import { AGENT_EPITHETS, AGENT_NAMES, houseName } from '../data/names';
import { cityName } from '../../../netlify/lib/contract';
import { FIGURE_IDS } from '@/world/data/figures';
import { mixSeed, seeded } from './random';
import { ageAt, keepInBook, mergeSkills, yearsWord } from './agents';
import { GEAR_SLOTS, slotName } from '../data/items';
import { bank } from './points';
import { log } from './log';
import { readTally, rulerPerson, wageMinClosing } from '../rulertraits';

/**
 * Соль кости дома. Навыки — **не бросок общего потока партии**: `roll(s)` двигает
 * `s.rolls`, и тогда рождение правителя сдвигало бы все события деревни, а с ними каждый
 * вывод отчётов. Здесь тот же приём, что у зерна дела лазутчика: поток выводится из сида
 * и номера человека, счётчика не трогает и повторяется при любом чтении.
 */
const HOUSE_DIE = 0x72756c65;

/**
 * Навыки человека дома: три числа `MIN_RULER_SKILL`…`MAX_RULER_SKILL` ровной костью.
 * Ровной, а не колоколом: середина лестницы и так даёт среднего правителя, а любая другая
 * форма — это придуманное число, которого нечем оправдать. Плохой правитель поэтому
 * обычное дело, как в EU4, и это не поломка: он смертен, а смерть отнимает только навыки.
 */
export function skillsOf(seed: number, n: number): RulerSkills {
  const rnd = seeded(mixSeed(seed, mixSeed(HOUSE_DIE, n)));
  const span = MAX_RULER_SKILL - MIN_RULER_SKILL + 1;
  const out = {} as RulerSkills;
  for (const b of REALM_BRANCHES) out[b] = MIN_RULER_SKILL + Math.floor(rnd() * span);
  return out;
}

/** Три навыка словами: «административный 3, дипломатический 1, военный 4». Одни слова на летопись и карточку. */
export const skillLine = (skills: RulerSkills): string => REALM_BRANCHES.map((b) => `${SKILL_NAME[b]} ${skills[b]}`).join(', ');

/** Возраст правителя, годы дробные. Не хранится — выводится из часов деревни. */
export const rulerAge = (s: GameState): number => ageAt(s.realm?.ruler?.age0 ?? AGENT_AGE0, s.realm?.ruler?.bornAt ?? 0, s.time);

/** Сколько полных лет правителю. */
export const rulerYears = (s: GameState): number => Math.floor(rulerAge(s));

/** Когда нынешнему правителю исполнится `RETIRE_AGE`, игровое время. */
export const rulerRestAt = (s: GameState): number => {
  const r = s.realm.ruler;
  return r.bornAt + Math.max(0, RETIRE_AGE - r.age0) * AGENT_YEAR;
};

/** Правление близко к концу: карточка предупреждает тем же порогом, что у агента. */
export const rulerAging = (s: GameState): boolean => rulerAge(s) >= RETIRE_WARN;

/**
 * Имена живых поимённых людей: четыре места агентов, двое в доме и совет Ратуши (РТ-1). По этому списку
 * проверяется, что тёзок среди живых не бывает, и он же не даёт дому и совету взять занятое имя.
 */
export function livingNames(s: GameState): string[] {
  const out: string[] = [];
  for (const id of FIGURE_IDS) {
    const p = s.agents?.[id];
    if (p && !p.vacant && p.name) out.push(p.name);
  }
  for (const p of [s.realm?.ruler, s.realm?.heir]) if (p?.name) out.push(p.name);
  // Совет Ратуши (РТ-1) — третий источник поимённых: тёзки советнику дом не выставит.
  for (const post of ADVISOR_POSTS) {
    const a = s.council?.seats?.[post];
    if (a?.name) out.push(a.name);
  }
  // Командиры флангов (ДР-3) — четвёртый: ни дом, ни совет, ни агенты тёзку командиру не выставят.
  for (const c of Object.values(s.command?.seats ?? {})) if (c?.name) out.push(c.name);
  return out;
}

/**
 * Свободное имя дома, начиная с номера `from`. Шагает дальше, пока имя занято живым:
 * тёзка правителя и полководца — не ошибка формата, а путаница на экране, и стоит она
 * одного шага по перестановке. Сколько шагов может понадобиться, ограничено самим набором.
 */
function freeName(s: GameState, faith: FaithId, from: number): string {
  const taken = new Set(livingNames(s));
  const span = AGENT_NAMES[faith].length * AGENT_EPITHETS.length;
  // Очистка та же, что у имени города; наборы проходят её без изменений — это тест
  // (`data/names.test.ts`), поэтому запасное слово сюда не доходит никогда.
  const pick = (i: number): string => cityName(houseName(s.seed, i, faith)) ?? 'Правитель';
  let name = pick(from);
  for (let step = 1; step <= span && taken.has(name); step++) name = pick(from + step);
  return name;
}

/** Новый человек дома: номер, навыки костью и имя, если вера уже названа. */
function born(s: GameState, n: number): HousePerson {
  return { n, name: s.faith.id ? freeName(s, s.faith.id, n) : null, skills: skillsOf(s.seed, n) };
}

/**
 * Дом новой партии: правитель и наследник. Имён пока нет — веру деревне называет мир по
 * клетке замка первым же пульсом, и до того имени взять неоткуда; так же приходит в игру
 * и четвёрка агентов.
 *
 * Очков — ровно на первый покупаемый уровень каждой ветви (`startingPoints`): игра
 * начинается со сделанным первым ходом, тем же приёмом, каким посёлок стоит готовым.
 */
export function newHouse(seed: number, at = 0): RealmState {
  const points = {} as RulerSkills;
  const tech = {} as RulerSkills;
  for (const b of REALM_BRANCHES) {
    points[b] = startingPoints(b);
    tech[b] = 1;
  }
  const ruler: Ruler = { n: 0, name: null, skills: skillsOf(seed, 0), bornAt: at, age0: AGENT_AGE0 };
  return { ruler, heir: { n: 1, name: null, skills: skillsOf(seed, 1) }, points, pointsAt: at, tech, born: 2 };
}

/**
 * Вступление наследника. Меняются **только навыки** (решение владельца): очки и
 * изученное остаются на месте, и об этом игроку сказано заранее, на карточке правителя, —
 * а не после смерти.
 */
export function succeed(s: GameState): void {
  const r = s.realm;
  const old = r.ruler;
  // Ставка у нового своя — прошлое по ней не пересчитывается.
  bank(s);
  const years = rulerYears(s);
  keepInBook(s, 'ruler', {
    name: old.name ?? 'Правитель',
    level: 0,
    deeds: 0,
    from: Math.floor(old.age0),
    to: years,
    end: 'rest',
    traits: [],
    skills: old.skills,
  });
  r.ruler = { ...r.heir, bornAt: s.time, age0: AGENT_AGE0 };
  r.heir = born(s, r.born);
  r.born += 1;
  log(s, `${old.name ?? 'Правитель'} оставил правление в ${yearsWord(years)}. Держава переходит к наследнику${r.ruler.name ? `, ${r.ruler.name}` : ''}.`, 'info');
  log(s, 'Очки и изученное остались. Сменились только навыки правителя.', 'info');
}

/**
 * Дело правителя (на пути — героя) в счёт его черт (ПН-2, `game/rulertraits.ts`) — **единственная** запись в счёт дел: бой
 * дружины, достроенный уровень, праздник, участь взятого города, закрытый отрезок минимального жалованья (`n` — игровых
 * секунд). Новый правитель приходит без дел (`succeed`): его черты — его дела.
 */
export function noteRulerDeed(s: GameState, deed: keyof RulerTally, n = 1): void {
  if (!(n > 0) || !Number.isFinite(n)) return;
  const who = rulerPerson(s);
  if (!who) return;
  const t = (who.deeds ??= {});
  t[deed] = (t[deed] ?? 0) + n;
}

/** Жалованье меняют: идущий отрезок минимального — в счёт дел. Зовёт дверь жалованья (`sim/upkeep.setWageMode`) до смены. */
export const closeWageMin = (s: GameState): void => noteRulerDeed(s, 'wageMin', wageMinClosing(s));

/**
 * Шаг партии для дома: безымянным дать имя, если вера уже известна; дожившему до
 * `RETIRE_AGE` — оставить правление наследнику. Ни тика, ни накопителя: обе ветки —
 * события, а не счёт. Зовётся оттуда же, откуда шаг мест агентов (`sim/tick`).
 */
export function dynastyStep(s: GameState): boolean {
  const r = s.realm;
  if (!r) return false;
  let changed = false;
  if (s.faith.id) {
    for (const p of [r.ruler, r.heir]) {
      if (p.name) continue;
      p.name = freeName(s, s.faith.id, p.n);
      changed = true;
    }
  }
  if (rulerAge(s) >= RETIRE_AGE) {
    succeed(s);
    changed = true;
  }
  return changed;
}

/**
 * Дом из сохранения. Мержится по полям, как профиль и вера: спред `...data` на уровень
 * ниже не спускается, а каждое число читается с проверкой и в границах своей лестницы.
 * Партия, записанная до дома, приезжает сюда с `undefined` — и получает дом новой партии;
 * правильное время вступления ей ставит ступень сохранения, а не это слияние.
 */
export function mergeRealm(base: RealmState, saved: unknown): RealmState {
  if (!saved || typeof saved !== 'object') return base;
  const r = saved as Partial<Record<keyof RealmState, unknown>>;
  const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  const person = (raw: unknown, def: HousePerson): HousePerson => {
    if (!raw || typeof raw !== 'object') return def;
    const p = raw as Partial<Record<keyof Ruler, unknown>>;
    return { n: Math.max(0, Math.floor(num(p.n, def.n))), name: cityName(p.name), skills: mergeSkills(p.skills) ?? def.skills };
  };
  const ruler = person(r.ruler, base.ruler);
  const raw = (r.ruler ?? {}) as Partial<Record<keyof Ruler, unknown>>;
  const levels = (v: unknown, def: RulerSkills, min: number, max: number): RulerSkills => {
    const src = (v ?? {}) as Record<string, unknown>;
    const out = {} as RulerSkills;
    for (const b of REALM_BRANCHES) out[b] = Math.max(min, Math.min(max, Math.round(num(src[b], def[b]))));
    return out;
  };
  return {
    ruler: {
      ...ruler,
      bornAt: num(raw.bornAt, base.ruler.bornAt),
      age0: Math.max(0, num(raw.age0, base.ruler.age0)),
      // Счёт дел правления (ПН-2): только известные поля, не ниже нуля; пустого нет.
      ...((): { deeds?: RulerTally } => {
        const deeds = readTally(raw.deeds);
        return deeds ? { deeds } : {};
      })(),
    },
    heir: person(r.heir, base.heir),
    points: levels(r.points, base.points, 0, POINTS_CAP),
    pointsAt: num(r.pointsAt, base.pointsAt),
    tech: levels(r.tech, base.tech, 1, Math.max(ADMIN_LEVELS, DIPLO_LEVELS, WAR_LEVELS)),
    born: Math.max(0, Math.floor(num(r.born, base.born))),
    // Вещи правителя (ДР-7): места — имя или пусто, всё прочее — пусто.
    ...(Array.isArray(r.gear) ? { gear: Array.from({ length: GEAR_SLOTS }, (_, i) => slotName((r.gear as unknown[])[i])) } : {}),
  };
}
