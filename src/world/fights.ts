// Бои, которые считают двое: мир на клиенте (набег логова, вылазка, удар по лагерю логова) и сервер в
// войне между игроками (docs/pvp.md). Одна дверь на сторону обороны у своих ворот и на бой у лагеря:
// пока она одна, штурм замка игрока и штурм деревни логовом не могут разойтись в том, кто стоит у
// частокола, а вылазка против лагеря игрока — в том, сколько пройдёт через рогатки.
//
// Модуль чистый: ни состояния мира, ни часов, ни случайности — сид приходит снаружи. Его собирает и
// сервер (`netlify/lib/war.ts`), поэтому DOM и хранилища здесь нет и быть не может.
import { BATTLE_RULES, emptyStack, HORSE_KINDS, UNIT_KINDS, type Flanks, type GroundPenalty, type Pips, type Spirit, type Stack } from '@/battle';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { troopLosses } from '@/game/battle/price';
import { resolveField, type FieldInput, type FieldOutcome, type FieldSide } from './battle';
import type { WallFront } from './wall';
import { refusedAtGate, splitLosses, strikeForecast, worksRipeAt, type CampSight, type Through, type WoodPlan } from './works';
import { siegeWear } from './siege';
import { CAMP_WOOD, CAMP_WORKS_RIPE } from './data/tuning';
import { mixRest } from './rest';
import { weakest } from './muster';
import type { ScarSide, ScarWhere } from '@/game/scarrules';

/** Командиры флангов в сторону боя — только если они есть (ДР-3): бой без них тот же, что до них, и запись входа та же. */
const led = (f: Flanks | undefined): { flanks?: Flanks } => (f ? { flanks: f } : {});
/** Черты армии в сторону боя и место во вход (ДР-4) — только если они есть: бой без них тот же, и запись входа та же. */
const scarred = (v: ScarSide | undefined): { scars?: ScarSide } => (v ? { scars: v } : {});
const placed = (w: ScarWhere | undefined): { where?: ScarWhere } => (w ? { where: w } : {});

/**
 * Оборона дома в родах боя: гарнизон и дружина у ворот плюс ополчение — частокол, башня и сами жители.
 * Башня ставит часть ополчения стрелками: людей не прибавляется, меняется род. Своей раскладки у обороны
 * нет — её раскладывает правило развёртывания, как любой бой (docs/battle_eu4.md, 14.27).
 */
export function defenceKinds(kinds: Stack, militia: number, archers: number): Stack {
  const men = Math.max(0, Math.round(militia));
  const bows = Math.min(men, Math.max(0, Math.round(archers)));
  const out: Stack = { ...kinds };
  out.infantry += men - bows;
  out.archer += bows;
  return out;
}

/** Оборона у стены: гарнизон и дружина у ворот в родах боя, ополчение и стрелки башни среди него. */
export interface WallDefence {
  kinds: Stack;
  militia: number;
  archers: number;
  resolve?: number;
  pips?: Pips;
  /** Командиры флангов обороны (ДР-3, `FieldSide.flanks`): там же, где отметки полководца; нет — без командиров. */
  flanks?: Flanks;
  rest?: number;
  /** Мораль и дисциплина обороны (ДР-1, `FieldSide.spirit`); нет — множители единица. */
  spirit?: Spirit;
  /** Черты армии обороны (ДР-4, `FieldSide.scars`); нет — черт нет. */
  scars?: ScarSide;
}

/** Бой у стены: обе стороны, место и фронт штурма. Ни мира, ни часов. */
export interface WallFightIn {
  seed: number;
  attacker: FieldSide;
  defender: WallDefence;
  ground?: GroundPenalty;
  /** Фронт штурма (`wall.wallFront`); нет — бой в поле у ворот: стены между сторонами нет (волки — на выгоне). */
  front?: WallFront | null;
  /** Где и когда бой (ДР-4, `FieldInput.where`): место клетки, час партии, осада. Нет — ни одной темы черт. */
  where?: ScarWhere;
}

/** Конница нападающего, которая в бой не входит: на лестницы и с башни кони не лезут (`WallFront.horse`). */
export function horseHeld(kinds: Stack, front: WallFront | null | undefined): Stack {
  const out = emptyStack();
  if (!front || front.horse) return out;
  for (const k of HORSE_KINDS) out[k] = kinds[k];
  return out;
}

/**
 * Бой у стены — **одна дверь** на набег логова и разбойников у ворот города игрока (мир) и на штурм города игрока войной
 * (сервер): сторона обороны собирается здесь (`defenceKinds`), фронт штурма — проёмами стены (`world/wall`, docs/siege_v2.md,
 * 4.1). Ядро получает ширину боя, грань стены нападающему поверх места и проём посреди боя; конница нападающего, если
 * пройти ей некуда, стоит у стены и в бою её нет — ни убивает, ни гибнет. Весь, как он случится, и ничего не трогая.
 */
export function wallFight(input: WallFightIn): { input: FieldInput; field: FieldOutcome } {
  const front = input.front ?? null;
  const held = horseHeld(input.attacker.kinds, front);
  const kinds = { ...input.attacker.kinds };
  for (const k of UNIT_KINDS) kinds[k] -= held[k];
  const ground: GroundPenalty | undefined = front && front.wall > 0 ? { ...(input.ground ?? {}), wall: front.wall } : input.ground;
  const d = input.defender;
  const fieldIn: FieldInput = {
    seed: input.seed,
    rules: BATTLE_RULES,
    ...(ground ? { ground } : {}),
    attacker: { ...input.attacker, kinds },
    defender: {
      kinds: defenceKinds(d.kinds, d.militia, d.archers),
      resolve: d.resolve,
      pips: d.pips,
      ...led(d.flanks),
      rest: d.rest,
      ...(d.spirit ? { spirit: d.spirit } : {}),
      ...scarred(d.scars),
    },
    ...placed(input.where),
    ...(front ? { width: front.width, fire: front.fire } : {}),
    ...(front?.widen ? { widen: front.widen } : {}),
  };
  return { input: fieldIn, field: resolveField(fieldIn) };
}

/**
 * Кто из обороны пал у ворот, поимённо. Бой знает потери по родам; по видам их раскладывает
 * `troopLosses`. Не легло ни на один вид — называются со слабых (`muster.weakest`), числом от доли:
 * числом племя сняло бы их со всей дружины и могло задеть тех, кто в поле.
 */
export function homeLosses(home: TroopStack, field: FieldOutcome): TroopStack {
  const spread = field.result ? troopLosses(home, field.result.sides.defender.losses) : {};
  if (troopTotal(spread) > 0) return spread;
  const all = troopTotal(home);
  return weakest(home, Math.min(all, Math.round(all * field.defenderLoss)));
}

/** Вылазка на машину лагеря: охрана машины и вышедшие из ворот. Ни мира, ни часов. */
export interface MachineFightIn {
  seed: number;
  /** Охрана машины — сторона лагеря у города (`machines.GUARD_SHARE`), в родах боя. */
  guard: { kinds: Stack; resolve?: number; pips?: Pips; flanks?: Flanks; rest: number; spirit?: Spirit; scars?: ScarSide };
  /** Кто вышел из ворот, с моралью между боями и износом осады. */
  sortie: CampPartIn;
  /** Стойкость, отметки, командиры флангов и дух вышедших — кто их ведёт и чьё это войско. */
  resolve?: number;
  pips?: Pips;
  flanks?: Flanks;
  spirit?: Spirit;
  /** Черты армии вышедших (ДР-4); нет — черт нет. */
  scars?: ScarSide;
  ground?: GroundPenalty;
  /** Где и когда бой (ДР-4): у стены осаждённого города — осада. */
  where?: ScarWhere;
}

/** Охрана машины в родах боя: доля `share` каждого рода лагеря, вниз до целого. */
export function guardKinds(camp: Stack, share: number): Stack {
  const out = emptyStack();
  const k = Math.min(1, Math.max(0, share));
  for (const u of UNIT_KINDS) out[u] = Math.floor(camp[u] * k);
  return out;
}

/**
 * Вылазка на машину лагеря (docs/siege_v2.md, раздел 5) — одна дверь на мир и на сервер войны. Машина стоит перед лагерем,
 * у стены: вышедшие из ворот бьются с её охраной в поле — без рогаток и без укреплений лагеря (они держат сам лагерь, а не
 * машину). Победа сжигает машину; что с ней делать, решает тот, кто зовёт. Весь бой, как он случится, и ничего не трогая.
 */
export function machineFight(input: MachineFightIn): { input: FieldInput; field: FieldOutcome } {
  const fieldIn: FieldInput = {
    seed: input.seed,
    rules: BATTLE_RULES,
    ...(input.ground ? { ground: input.ground } : {}),
    ...placed(input.where),
    attacker: {
      kinds: input.sortie.kinds,
      resolve: input.resolve,
      pips: input.pips,
      ...led(input.flanks),
      rest: input.sortie.rest ?? 1,
      ...(input.spirit ? { spirit: input.spirit } : {}),
      ...scarred(input.scars),
    },
    defender: {
      kinds: input.guard.kinds,
      resolve: input.guard.resolve,
      pips: input.guard.pips,
      ...led(input.guard.flanks),
      rest: input.guard.rest,
      ...(input.guard.spirit ? { spirit: input.guard.spirit } : {}),
      ...scarred(input.guard.scars),
    },
  };
  return { input: fieldIn, field: resolveField(fieldIn) };
}

/** Часть нападающих на лагерь: кто вышел с этой стороны и с какой моралью. */
export interface CampPartIn {
  kinds: Stack;
  /** Мораль между боями, 0..1; нет — свежие. */
  rest?: number;
}

/** Бой у лагеря: всё, что нужно, чтобы его посчитать, и ничего из мира. */
export interface CampFightIn {
  seed: number;
  at: number;
  /** Рогатки лагеря: с какой минуты стоит, кто строил, занятость проходов, древесина. */
  sight: CampSight;
  /** Лагерь — кто в нём стоит, в родах боя. */
  camp: { kinds: Stack; resolve?: number; pips?: Pips; flanks?: Flanks; rest: number; spirit?: Spirit; scars?: ScarSide };
  /** Со стороны города (вылазка, гарнизон в совместном ударе) и с тыла (дружина из поля). */
  front?: CampPartIn;
  rear?: CampPartIn;
  /**
   * Стойкость, отметки, командиры флангов (ДР-3) и дух нападающих — кто их ведёт и чьё это войско (ДР-1: дух у гарнизона и
   * дружины один).
   */
  resolve?: number;
  pips?: Pips;
  flanks?: Flanks;
  spirit?: Spirit;
  /** Черты армии нападающих (ДР-4): у гарнизона и дружины одни — армия одна. Нет — черт нет. */
  scars?: ScarSide;
  ground?: GroundPenalty;
  /** Где и когда бой (ДР-4): бой у лагеря — осадный. Нет — ни одной темы черт. */
  where?: ScarWhere;
  /**
   * Укрепления лагеря в гранях кости (`siegecraft.fortFaces`): штраф нападающим на лагерь, поверх земли. Нет — ноль, и бой
   * тот же, что до укреплений.
   */
  fort?: number;
}

export type CampFightOut =
  | { refused: true; front: Through | null; rear: Through | null }
  | {
      refused: false;
      input: FieldInput;
      field: FieldOutcome;
      /** Кто прошёл через рогатки каждой стороны. */
      front: Through | null;
      rear: Through | null;
      /** Потери боя по сторонам, в родах: сколько легло из прошедших с каждой. */
      lost: { front: Stack; rear: Stack };
      /** Сколько бойцов строя дралось и сколько вышло. */
      fought: number;
      all: number;
    };

/**
 * Бой у лагеря — одна дверь на вылазку, выручку, удар полководца с тыла и совместный удар, и у мира, и у
 * сервера. Укрепления действуют на всех одинаково: в бой входят только прошедшие через рогатки
 * (`works.strikeForecast`), остальные стоят у рогаток и в бою их нет. У лагеря две стороны, у каждой свой
 * проход; бой при этом один, а прошли с обеих сторон — это клещи: гарнизон бьёт фронт лагеря, дружина стоит у него в
 * тылу (`FieldSide.behind`). Потери делятся между сторонами по родам (`works.splitLosses`). Вышли, а пробиться некому, —
 * отказ до боя.
 */
export function campFight(input: CampFightIn): CampFightOut {
  const cast = strikeForecast(input.sight, input.at, input.rear?.kinds ?? emptyStack(), input.front?.kinds ?? null);
  const front = cast.front;
  const rear = input.rear ? cast.rear : null;
  if (refusedAtGate(front, rear)) return { refused: true, front, rear };
  const parts = [
    { part: input.front, t: front },
    { part: input.rear, t: rear },
  ].filter((x): x is { part: CampPartIn; t: Through } => Boolean(x.part && x.t));
  const kinds = emptyStack();
  for (const { t } of parts) for (const k of UNIT_KINDS) kinds[k] += t.kinds[k];
  const fought = parts.reduce((n, x) => n + x.t.passed, 0);
  const all = parts.reduce((n, x) => n + x.t.went, 0);
  // Совместный удар — клещи (docs/siege_v2.md, 6.2; этап 2д): гарнизон из ворот бьёт лагерь со стороны города, дружина с
  // поля стоит у него в тылу (`FieldSide.behind`) — ядро считает удар с двух сторон правилами обхода и тыла. Кто из ворот,
  // ядро пишет и для ролика (`FieldSide.garrison`).
  const garrison = input.front && input.rear && front && rear ? front.kinds : undefined;
  const behind = garrison && rear ? rear.kinds : undefined;
  // Укрепления — та же грань кости, что земля (`GroundPenalty.works`): у кого бы лагерь ни стоял, бьют его через них.
  const fort = input.fort !== undefined && input.fort > 0 ? input.fort : 0;
  const ground = fort > 0 ? { ...(input.ground ?? {}), works: fort } : input.ground;
  const fieldIn: FieldInput = {
    seed: input.seed,
    rules: BATTLE_RULES,
    ...(ground ? { ground } : {}),
    ...placed(input.where),
    attacker: {
      kinds,
      resolve: input.resolve,
      pips: input.pips,
      ...led(input.flanks),
      // Мораль между боями (14.31): у каждой части своя, вместе — по прошедшим.
      rest: mixRest(parts.map(({ part, t }) => ({ rest: part.rest ?? 1, men: t.passed }))),
      ...(input.spirit ? { spirit: input.spirit } : {}),
      ...scarred(input.scars),
      ...(garrison ? { garrison } : {}),
      ...(behind ? { behind } : {}),
    },
    defender: {
      kinds: input.camp.kinds,
      resolve: input.camp.resolve,
      pips: input.camp.pips,
      ...led(input.camp.flanks),
      rest: input.camp.rest,
      ...(input.camp.spirit ? { spirit: input.camp.spirit } : {}),
      ...scarred(input.camp.scars),
    },
  };
  const field = resolveField(fieldIn);
  const losses = field.result?.sides.attacker.losses ?? emptyStack();
  const lost = splitLosses(losses, front?.kinds ?? emptyStack(), rear?.kinds ?? emptyStack());
  return { refused: false, input: fieldIn, field, front, rear, lost, fought, all };
}

/** Сторона боя в поле (ПЛ-1): войско со всем, что о нём знает сервер войны, — в родах боя. */
export interface MeetSide {
  kinds: Stack;
  resolve?: number;
  pips?: Pips;
  flanks?: Flanks;
  /** Мораль между боями, 0..1; нет — свежие. */
  rest?: number;
  spirit?: Spirit;
  scars?: ScarSide;
}

export interface MeetFightIn {
  seed: number;
  /** Перехватчик — полководец города или союзника — нападает; поход обороняется. */
  chaser: MeetSide;
  march: MeetSide;
  /** Земля клетки встречи — нападающему (`place.groundAt`, шаг перехватчика на неё). */
  ground?: GroundPenalty;
  /** Где бой (ДР-4): клетка встречи, не осада. */
  where?: ScarWhere;
}

/**
 * Бой в поле при перехвате похода между игроками (ПЛ-1, docs/siege_v2.md, «Решения ПЛ-1»): ни стены, ни рогаток — две армии
 * сходятся на клетке встречи, обе встают по правилу развёртывания (`setup.deploySetup`). Дверь у сервера войны одна; у мира
 * тот же бой с отрядом логова считает `resolveField` с теми же сторонами (`LocalWorld.resolveChase`).
 */
export function meetFight(input: MeetFightIn): { input: FieldInput; field: FieldOutcome } {
  const side = (v: MeetSide): FieldSide => ({
    kinds: v.kinds,
    resolve: v.resolve,
    pips: v.pips,
    ...led(v.flanks),
    rest: v.rest,
    ...(v.spirit ? { spirit: v.spirit } : {}),
    ...scarred(v.scars),
  });
  const fieldIn: FieldInput = {
    seed: input.seed,
    rules: BATTLE_RULES,
    ...(input.ground ? { ground: input.ground } : {}),
    ...placed(input.where),
    attacker: side(input.chaser),
    defender: side(input.march),
  };
  return { input: fieldIn, field: resolveField(fieldIn) };
}

/**
 * Минута, в которую решается «садиться ли» (`campHolds`): рогатки стороны города дозрели (`works.worksRipeAt`, по плану
 * древесины лагеря). Фронт не дозреет никогда (весь лес в тыл) — через `CAMP_WORKS_RIPE` от постановки: позже рогатки
 * фронта не станут крепче, чем сейчас.
 */
export function holdMinute(since: number, wood: WoodPlan = CAMP_WOOD): number {
  const ripe = worksRipeAt(since, 'front', wood);
  return ripe < Infinity ? ripe : since + CAMP_WORKS_RIPE;
}

/** Всё, чем решается «садиться ли»: лагерь в минуту дозревания и гарнизон, выходящий на вылазку весь. */
export interface HoldIn extends Omit<CampFightIn, 'at' | 'front' | 'rear' | 'resolve' | 'pips' | 'flanks' | 'spirit' | 'scars'> {
  /**
   * Гарнизон на вылазке: все, кто дома, без ополчения — оно за ворота не выходит. Мораль — между боями, на минуту
   * дозревания; износ осады к этой минуте дверь кладёт сама (`siege.siegeWear`).
   */
  sortie: CampPartIn & { resolve?: number; pips?: Pips; flanks?: Flanks; spirit?: Spirit; scars?: ScarSide };
  /** Путь износа гарнизона до дна — срок голода окна, которое встало бы (`siege.wearSpan`). */
  wearSpan: number;
}

/**
 * **Садиться в осаду или штурмовать** (docs/siege_v2.md, 1.3, шаг 3) — одна дверь на лагерь логова у города игрока и у
 * двора мира. Отряд, который стены с ходу не взял бы, садится, если его лагерь **удержится против вылазки всего гарнизона
 * в минуту, когда рогатки со стороны города дозреют** (`holdMinute`); не удержится — штурмует, как прежде.
 *
 * Правило, а не порог: это сухой бой той же двери, что настоящая вылазка (`campFight`) — проход через дозревшие рогатки,
 * укрепления, место, мораль, — в минуту дозревания и ничего не трогая. Почему дозревание, а не постановка: прежнее правило
 * спрашивало вылазку на пустом поле, а рано вылазка сильна, поздно безнадёжна (docs/siege_audit.md, Б3), — и отсекало
 * ровно те осады, где у защитника был бы ответ. Новое оставляет ему окно до дозревания: решение, которое надо успеть
 * принять. Пробиться к рогаткам некому (проход закрыт) — лагерь держится.
 */
export function campHolds(input: HoldIn): boolean {
  const at = holdMinute(input.sight.since, input.sight.wood);
  const { sortie } = input;
  const out = campFight({
    seed: input.seed,
    at,
    sight: input.sight,
    camp: input.camp,
    front: { kinds: sortie.kinds, rest: (sortie.rest ?? 1) * siegeWear(input.sight.since, at, input.wearSpan) },
    resolve: sortie.resolve,
    pips: sortie.pips,
    ...led(sortie.flanks),
    ...(sortie.spirit ? { spirit: sortie.spirit } : {}),
    ...scarred(sortie.scars),
    ...placed(input.where),
    ground: input.ground,
    fort: input.fort,
  });
  return out.refused || !out.field.won;
}
