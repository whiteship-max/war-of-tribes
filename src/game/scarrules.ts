// Шрамы и привычки армии (ДР-4, docs/siege_v2.md, «Решения ДР-4») — числа и правила, одни на игру и на сервер.
//
// Черта следует из журнала боёв, а не из броска (как черты агентов из счёта дел, `data/traits.ts`): журнал — метки последних
// `SCAR_LOG` боёв (`FightMark`), черты — чистая функция от него (`scarsOf`). В партии журнал пишет одна дверь `sim/scars`; на
// сервере — книга черт по меткам боёв войны (`netlify/lib/scarbook.ts`), которые сервер записал сам (`WarBattle.marks`).
//
// В бой черта едет готовыми поправками к показателям родов (`ArmySetup.scars`): где она действует — в лесу, ночью, против
// конницы, — решает `scarEdge` по месту боя и составу противника, а ядро про черты не знает.
//
// Импорты — относительные: модуль собирает и сервер.
import type { BattleResult, Profile, ScarEdge, Side, Stack, StatId, UnitKind } from '../battle/types';
import { HORSE_KINDS, UNIT_KINDS } from '../battle/types';

export type ScarId =
  | 'ghosts'
  | 'fords'
  | 'highland'
  | 'pikewall'
  | 'walls'
  | 'nightwolves'
  | 'arrowfear'
  | 'woodfear'
  | 'wallshy'
  | 'nightpanic'
  | 'frostbit'
  | 'grumble';

/**
 * Где и когда был бой — то, что черты спрашивают у места и часа. Лес, река и холмы — по месту боя (`world/place.placeAt`), ночь
 * и зима — по часам партии, осада — по тому, какой дверью шёл бой (`BattleSite`: стена, вылазка, лагерь, совместный удар). Бой
 * войны ночи и зимы не несёт: часы у каждой партии свои, и сервер их не судит (Ш6).
 */
export interface ScarWhere {
  woods?: true;
  river?: true;
  hills?: true;
  night?: true;
  winter?: true;
  siege?: true;
}

/** Черты стороны боя (`world/battle.FieldSide.scars`): какие есть и шла ли голодной. */
export interface ScarSide {
  held: ScarId[];
  hungry?: true;
}

/** С чем сторона пришла в бой: место, голод и войско противника по родам. */
export interface ScarCtx extends ScarWhere {
  hungry?: true;
  foe: Stack;
}

/** Метка боя в журнале армии (Ш4): исход и то, из чего выводятся черты. */
export interface FightMark extends ScarWhere {
  out: 'win' | 'loss' | 'draw';
  /** Уверенная победа (`SURE`): пало не больше десятой части, противник бежал или перебит и был не меньше половины нас. */
  sure?: true;
  /** Наше войско бежало: проиграли, и сломалась мораль. */
  fled?: true;
  /** Шли в бой голодными (дух без сытого обоза). У боя войны поля нет — голод в партии, сервер его не видит. */
  hungry?: true;
  /** В войске противника конницы не меньше `HORSE_HEAVY`. */
  horse?: true;
  /** Какую долю нашего войска выбили стрелы противника, до сотых. Нет поля — меньше сотой. */
  arrows?: number;
  /**
   * Номер человека на месте полководца в минуту боя; `NO_GENERAL` — места нет. Нет поля — неизвестно (книга агентов сервера без
   * сида): тогда смена полководца «Страх обстрела» по этой метке не снимает.
   */
  gen?: number;
  /** Бой войны: номер боя и минута сервера (`WarBattle.id`, `.at`). У боёв с логовами и у своих ворот поля нет. */
  war?: { id: string; at: number };
}

/** Полководца на месте нет: место пусто или ещё не занято. */
export const NO_GENERAL = -1;

/** Армия помнит столько последних боёв (Ш2): черта, бой которой ушёл дальше, выводится заново из того, что осталось. */
export const SCAR_LOG = 30;

/** Не больше стольких черт разом (Ш2): новая сверх них вытесняет самую давнюю. */
export const SCARS_MAX = 3;

/** «Огромные потери от стрел» — стрелы выбили не меньше этой доли нашего войска («Страх обстрела»). */
export const ARROWS_HEAVY = 0.2;

/** Войско противника — «с конницей», если конных в нём не меньше этой доли («Стена копий»). */
export const HORSE_HEAVY = 0.25;

/** «При виде лучников»: лучников в войске противника не меньше этой доли («Страх обстрела» действует). */
export const ARCHERS_SEEN = 0.1;

/** Уверенная победа (Ш1): пало не больше `lost` нашего войска, противник был не меньше `foe` нас и бежал или перебит. */
export const SURE = { lost: 0.1, foe: 0.5 };

/** Тема черты: какой признак боя она спрашивает. */
export type ScarTheme = 'woods' | 'river' | 'hills' | 'horse' | 'siege' | 'night' | 'winter' | 'hunger' | 'arrows';

/**
 * Как черта приходит: `wins` — победы в теме подряд (поражение в теме обнуляет счёт), `losses` — поражения в теме подряд (победа
 * обнуляет), `fled` — войско бежало в бою темы, `hungry` — бои голодными подряд (сытый бой обнуляет), `arrows` — стрелы выбили не
 * меньше `ARROWS_HEAVY`. `need` — сколько раз.
 */
export interface ScarGain {
  by: 'wins' | 'losses' | 'fled' | 'hungry' | 'arrows';
  need: number;
}

/**
 * Как черта уходит: `loss` — поражение в теме (у доброй), `win` — победа в теме (у дурной), `sureFed` — уверенная победа сытыми,
 * `sureOrGeneral` — уверенная победа или новый полководец.
 */
export type ScarLose = 'loss' | 'win' | 'sureFed' | 'sureOrGeneral';

export interface ScarDef {
  id: ScarId;
  name: string;
  good: boolean;
  theme: ScarTheme;
  gain: ScarGain;
  lose: ScarLose;
  /**
   * Направление поправки (Ш5): по роду — какие показатели и в какую сторону, единицами; величина — `SCAR_SIZE`. Пустой род —
   * все рода (`ALL`).
   */
  shape: ScarEdge;
}

const FOOT: readonly UnitKind[] = ['spear', 'infantry'];

/** Одни и те же показатели у родов `kinds` (по умолчанию — у всех), знаком `sign`. */
function each(stats: readonly StatId[], sign: 1 | -1, kinds: readonly UnitKind[] = UNIT_KINDS): ScarEdge {
  const out: ScarEdge = {};
  for (const k of kinds) out[k] = Object.fromEntries(stats.map((s) => [s, sign])) as Partial<Profile>;
  return out;
}

/** Две поправки одной черты вместе (у одного рода — сумма). */
function both(a: ScarEdge, b: ScarEdge): ScarEdge {
  const out: ScarEdge = {};
  for (const k of UNIT_KINDS) {
    const x = { ...(a[k] ?? {}) };
    for (const [s, v] of Object.entries(b[k] ?? {})) x[s as StatId] = (x[s as StatId] ?? 0) + (v ?? 0);
    if (Object.keys(x).length > 0) out[k] = x;
  }
  return out;
}

/** Таблица черт (Ш1). Порядок — порядок проверки прихода в одном бою и порядок в окне при равной давности. */
export const SCARS: readonly ScarDef[] = [
  // ---------- Добрые ----------
  { id: 'ghosts', name: 'Лесные призраки', good: true, theme: 'woods', gain: { by: 'wins', need: 3 }, lose: 'loss', shape: each(['shockAtk', 'fireDef'], 1) },
  { id: 'fords', name: 'Бродники', good: true, theme: 'river', gain: { by: 'wins', need: 2 }, lose: 'loss', shape: each(['shockAtk', 'shockDef'], 1) },
  {
    id: 'highland',
    name: 'Горцы',
    good: true,
    theme: 'hills',
    gain: { by: 'wins', need: 3 },
    lose: 'loss',
    shape: both(each(['fireAtk'], 1, ['archer']), each(['shockDef'], 1)),
  },
  { id: 'pikewall', name: 'Стена копий', good: true, theme: 'horse', gain: { by: 'wins', need: 2 }, lose: 'loss', shape: each(['shockDef', 'moraleDef'], 1, FOOT) },
  { id: 'walls', name: 'Стойкие в осаде', good: true, theme: 'siege', gain: { by: 'wins', need: 3 }, lose: 'loss', shape: each(['moraleDef', 'shockDef'], 1) },
  { id: 'nightwolves', name: 'Ночные волки', good: true, theme: 'night', gain: { by: 'wins', need: 2 }, lose: 'loss', shape: each(['shockAtk', 'moraleAtk'], 1) },
  // ---------- Дурные ----------
  {
    id: 'arrowfear',
    name: 'Страх обстрела',
    good: false,
    theme: 'arrows',
    gain: { by: 'arrows', need: 1 },
    lose: 'sureOrGeneral',
    shape: each(['moraleDef', 'fireDef'], -1, FOOT),
  },
  { id: 'woodfear', name: 'Лесной морок', good: false, theme: 'woods', gain: { by: 'losses', need: 2 }, lose: 'win', shape: each(['moraleDef', 'shockDef'], -1) },
  { id: 'wallshy', name: 'Битые у стен', good: false, theme: 'siege', gain: { by: 'losses', need: 2 }, lose: 'win', shape: each(['moraleDef', 'shockAtk'], -1) },
  { id: 'nightpanic', name: 'Ночная паника', good: false, theme: 'night', gain: { by: 'fled', need: 1 }, lose: 'win', shape: each(['moraleDef', 'shockDef'], -1) },
  {
    id: 'frostbit',
    name: 'Мерзляки',
    good: false,
    theme: 'winter',
    gain: { by: 'losses', need: 2 },
    lose: 'win',
    shape: both(each(['shockAtk'], -1), each(['fireAtk'], -1, ['archer'])),
  },
  { id: 'grumble', name: 'Голодный ропот', good: false, theme: 'hunger', gain: { by: 'hungry', need: 2 }, lose: 'sureFed', shape: each(['moraleDef', 'shockAtk'], -1) },
];

export const SCAR_BY_ID: Readonly<Record<ScarId, ScarDef>> = Object.fromEntries(SCARS.map((d) => [d.id, d])) as Record<ScarId, ScarDef>;

export const SCAR_IDS: readonly ScarId[] = SCARS.map((d) => d.id);

export const isScarId = (v: unknown): v is ScarId => typeof v === 'string' && (SCAR_IDS as readonly string[]).includes(v);

/**
 * Величина каждой черты — во сколько отметок её направление (Ш5). **Выведена** (`npm run fight -- --derive-scars`, docs/siege_v2.md,
 * 27.2): добрая в своём бою стоит, как одна шкала духа ДР-1 на верху, дурная — как одна на дне.
 */
export const SCAR_SIZE: Record<ScarId, number> = {
  ghosts: 0.5,
  fords: 0.5,
  highland: 0.5,
  pikewall: 0.5,
  walls: 0.5,
  nightwolves: 0.5,
  arrowfear: 0.5,
  woodfear: 0.5,
  wallshy: 0.5,
  nightpanic: 0.5,
  frostbit: 0.5,
  grumble: 0.5,
};

// ---------- Признаки ----------

/** Доля родов `kinds` в войске; пустое — ноль. */
export function shareOf(stack: Stack, kinds: readonly UnitKind[]): number {
  let all = 0;
  let some = 0;
  for (const k of UNIT_KINDS) {
    const n = Math.max(0, stack[k] ?? 0);
    all += n;
    if (kinds.includes(k)) some += n;
  }
  return all > 0 ? some / all : 0;
}

/** Бой в теме черты — по метке или по тому, с чем сторона пришла в бой (у них одни признаки места). */
function inTheme(theme: ScarTheme, m: FightMark | ScarCtx): boolean {
  switch (theme) {
    case 'woods':
      return m.woods === true;
    case 'river':
      return m.river === true;
    case 'hills':
      return m.hills === true;
    case 'siege':
      return m.siege === true;
    case 'night':
      return m.night === true;
    case 'winter':
      return m.winter === true;
    case 'hunger':
      return m.hungry === true;
    case 'horse':
      return 'foe' in m ? shareOf(m.foe, HORSE_KINDS) >= HORSE_HEAVY : m.horse === true;
    case 'arrows':
      return 'foe' in m ? shareOf(m.foe, ['archer']) >= ARCHERS_SEEN : (m.arrows ?? 0) >= ARROWS_HEAVY;
  }
}

/** Черта действует в этом бою: её тема есть у места, часа, голода или войска противника. */
export const scarActive = (id: ScarId, ctx: ScarCtx): boolean => inTheme(SCAR_BY_ID[id].theme, ctx);

// ---------- Метка боя ----------

/**
 * Метка боя для журнала (Ш4) — из итога ядра: исход для стороны `us`, уверенная победа, бегство, доля выбитых стрелами и
 * конница противника. Место и час (`where`) и голод кладёт тот, кто знает, где и с чем бились. Полководца дописывает племя
 * (`sim/scars.noteFight`), а у боя войны — сервер.
 */
export function markOf(result: BattleResult, us: Side, where: ScarWhere, hungry = false): FightMark {
  const them: Side = us === 'attacker' ? 'defender' : 'attacker';
  const ours = result.sides[us];
  const theirs = result.sides[them];
  const out: FightMark['out'] = result.winner === us ? 'win' : result.winner === 'draw' ? 'draw' : 'loss';
  const mark: FightMark = { out, ...cleanWhere(where) };
  const men = ours.total.initial;
  const lost = men > 0 ? ours.total.losses / men : 0;
  if (out === 'win' && lost <= SURE.lost && theirs.total.initial >= SURE.foe * men && (result.reason === 'morale' || result.reason === 'annihilated')) mark.sure = true;
  if (out === 'loss' && result.reason === 'morale') mark.fled = true;
  if (hungry) mark.hungry = true;
  if (shareOf(theirs.initial, HORSE_KINDS) >= HORSE_HEAVY) mark.horse = true;
  const arrows = men > 0 ? Math.round((100 * theirs.rangedTotal) / men) / 100 : 0;
  if (arrows > 0) mark.arrows = Math.min(1, arrows);
  return mark;
}

/** Признаки места без пустых полей. */
export function cleanWhere(w: ScarWhere): ScarWhere {
  const out: ScarWhere = {};
  for (const k of ['woods', 'river', 'hills', 'night', 'winter', 'siege'] as const) if (w[k] === true) out[k] = true;
  return out;
}

// ---------- Чтение ----------

const FLAGS = ['woods', 'river', 'hills', 'night', 'winter', 'siege', 'sure', 'fled', 'hungry', 'horse'] as const;

/** Метка из сохранения, из записи войн или из описи (Ш8): только известные поля и разумные числа; не метка — `null`. */
export function readMark(v: unknown): FightMark | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.out !== 'win' && r.out !== 'loss' && r.out !== 'draw') return null;
  const m: FightMark = { out: r.out };
  for (const f of FLAGS) if (r[f] === true) m[f] = true;
  if (typeof r.arrows === 'number' && Number.isFinite(r.arrows) && r.arrows > 0) m.arrows = Math.min(1, Math.round(r.arrows * 100) / 100);
  if (typeof r.gen === 'number' && Number.isInteger(r.gen) && r.gen >= NO_GENERAL) m.gen = r.gen;
  const w = r.war as Record<string, unknown> | undefined;
  if (w && typeof w === 'object' && typeof w.id === 'string' && w.id.length > 0 && w.id.length <= 64 && typeof w.at === 'number' && Number.isFinite(w.at)) {
    m.war = { id: w.id, at: w.at };
  }
  return m;
}

// ---------- Черты из журнала ----------

/** Черта у армии: что и при каком полководце пришла (`gen` — для «нового полководца»). */
export interface HeldScar {
  id: ScarId;
  gen?: number;
}

/** Полководец сменился: оба известны и разные. */
const newGeneral = (was: number | undefined, now: number | undefined): boolean => was !== undefined && now !== undefined && was !== now;

/** Уходит ли черта `def` от метки `m` (у «нового полководца» — и от смены человека к этой метке). */
export function scarLostBy(def: ScarDef, m: FightMark, held?: HeldScar): boolean {
  switch (def.lose) {
    case 'loss':
      return m.out === 'loss' && inTheme(def.theme, m);
    case 'win':
      return m.out === 'win' && inTheme(def.theme, m);
    case 'sureFed':
      return m.sure === true && m.hungry !== true;
    case 'sureOrGeneral':
      return m.sure === true || newGeneral(held?.gen, m.gen);
  }
}

/** Счёт к приходу черты `def` после метки `m`: прибавить, обнулить или оставить. */
function counted(def: ScarDef, n: number, m: FightMark): number {
  const inside = inTheme(def.theme, m);
  switch (def.gain.by) {
    case 'wins':
      return !inside || m.out === 'draw' ? n : m.out === 'win' ? n + 1 : 0;
    case 'losses':
      return !inside || m.out === 'draw' ? n : m.out === 'loss' ? n + 1 : 0;
    case 'hungry':
      return m.hungry === true ? n + 1 : 0;
    case 'fled':
      return inside && m.fled === true ? n + 1 : n;
    case 'arrows':
      return inside ? n + 1 : n;
  }
}

/** Что сделал с чертой бой журнала: пришла, ушла по своему правилу или забыта (вытеснена новой сверх `SCARS_MAX`). */
export interface ScarStep {
  at: number;
  id: ScarId;
  how: 'gain' | 'lose' | 'out';
}

/**
 * Черты армии по журналу (Ш1, Ш2): последние `SCAR_LOG` меток по порядку, `genNow` — полководец сейчас (нет — неизвестно).
 * Порядок результата — порядок прихода, старшая первой. Шаг за шагом: метка снимает то, что снимает, потом двигает счёт, потом
 * приносит то, что набрало порог; сверх `SCARS_MAX` уходит самая давняя. Счёт пришедшей черты обнуляется: вытесненная не
 * возвращается на следующем же бою.
 */
export function scarsOf(log: readonly FightMark[], genNow?: number): HeldScar[] {
  return scarRun(log, genNow).held;
}

/** То же, что `scarsOf`, с шагами — для летописи (`sim/scars`). `at` шага — номер метки в окне. */
export function scarRun(log: readonly FightMark[], genNow?: number): { held: HeldScar[]; steps: ScarStep[] } {
  const marks = log.slice(-SCAR_LOG);
  let held: HeldScar[] = [];
  const count: Partial<Record<ScarId, number>> = {};
  const steps: ScarStep[] = [];
  marks.forEach((m, at) => {
    held = held.filter((h) => {
      const gone = scarLostBy(SCAR_BY_ID[h.id], m, h);
      if (gone) steps.push({ at, id: h.id, how: 'lose' });
      return !gone;
    });
    for (const def of SCARS) {
      const n = counted(def, count[def.id] ?? 0, m);
      count[def.id] = n;
      if (n < def.gain.need || held.some((h) => h.id === def.id)) continue;
      // Пара одной темы не уживается: то, что даёт одну, уже сняло другую (`scarLostBy`), но пришедшая в том же бою — снимает.
      held = held.filter((h) => !(SCAR_BY_ID[h.id].theme === def.theme && SCAR_BY_ID[h.id].good !== def.good));
      held.push(m.gen !== undefined ? { id: def.id, gen: m.gen } : { id: def.id });
      steps.push({ at, id: def.id, how: 'gain' });
      count[def.id] = 0;
      while (held.length > SCARS_MAX) {
        const out = held.shift()!;
        steps.push({ at, id: out.id, how: 'out' });
      }
    }
  });
  // Новый полководец снимает «Страх обстрела» и без боя: черта помнит, при ком пришла.
  held = held.filter((h) => {
    const def = SCAR_BY_ID[h.id];
    const gone = def.lose === 'sureOrGeneral' && newGeneral(h.gen, genNow);
    if (gone) steps.push({ at: marks.length, id: h.id, how: 'lose' });
    return !gone;
  });
  return { held, steps };
}

/** Метки боёв войны из журнала по минуте сервера (Ш6): то, из чего сервер выводит черты в войну. */
export function warMarks(log: readonly FightMark[]): FightMark[] {
  return log.filter((m) => m.war !== undefined).sort((a, b) => a.war!.at - b.war!.at || (a.war!.id < b.war!.id ? -1 : a.war!.id > b.war!.id ? 1 : 0));
}

// ---------- В бою ----------

/**
 * Поправки черт `held` в бою с местом и противником `ctx` (Ш3): каждая действующая черта — своё направление на свою величину,
 * у одного рода — сумма. Ни одна не действует — `undefined`: поля у стороны нет, и бой байт в байт прежний. Потолок по показателю
 * держит ядро (`SCAR_CAP`, `battle/sim.scarProfile`).
 */
export function scarEdge(held: readonly ScarId[], ctx: ScarCtx, size: Readonly<Record<ScarId, number>> = SCAR_SIZE): ScarEdge | undefined {
  let out: ScarEdge | undefined;
  for (const id of held) {
    if (!isScarId(id) || !scarActive(id, ctx)) continue;
    const k = size[id];
    if (!(k > 0)) continue;
    out ??= {};
    for (const [kind, stats] of Object.entries(SCAR_BY_ID[id].shape)) {
      const into = (out[kind as UnitKind] ??= {});
      for (const [s, v] of Object.entries(stats ?? {})) into[s as StatId] = (into[s as StatId] ?? 0) + (v ?? 0) * k;
    }
  }
  return out;
}
