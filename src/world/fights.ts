// Бои, которые считают двое: мир на клиенте (набег логова, вылазка, удар по лагерю логова) и сервер в
// войне между игроками (docs/pvp.md). Одна дверь на сторону обороны у своих ворот и на бой у лагеря:
// пока она одна, штурм замка игрока и штурм деревни логовом не могут разойтись в том, кто стоит у
// частокола, а вылазка против лагеря игрока — в том, сколько пройдёт через рогатки.
//
// Модуль чистый: ни состояния мира, ни часов, ни случайности — сид приходит снаружи. Его собирает и
// сервер (`netlify/lib/war.ts`), поэтому DOM и хранилища здесь нет и быть не может.
import { emptyStack, UNIT_KINDS, type GroundPenalty, type Pips, type Stack } from '@/battle';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { troopLosses } from '@/game/battle/price';
import { resolveField, type FieldInput, type FieldOutcome } from './battle';
import { refusedAtGate, splitLosses, strikeForecast, worksRipeAt, type CampSight, type Through, type WoodPlan } from './works';
import { siegeWear } from './siege';
import { CAMP_WOOD, CAMP_WORKS_RIPE } from './data/tuning';
import { mixRest } from './rest';
import { weakest } from './muster';

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
  camp: { kinds: Stack; resolve?: number; pips?: Pips; rest: number };
  /** Со стороны города (вылазка, гарнизон в совместном ударе) и с тыла (дружина из поля). */
  front?: CampPartIn;
  rear?: CampPartIn;
  /** Стойкость и отметки нападающих — кто их ведёт. */
  resolve?: number;
  pips?: Pips;
  ground?: GroundPenalty;
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
 * проход; бой при этом один — прошедшие с обеих сторон складываются в одного нападающего, а потери
 * делятся между сторонами по родам (`works.splitLosses`). Вышли, а пробиться некому, — отказ до боя.
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
  // Совместный удар — с обеих сторон: со стороны города вышел гарнизон. Кто из ворот, ядро только разложит по секторам
  // для ролика (`FieldSide.garrison`, решение владельца 03.10.2026, вариант А) — бой один, исход от этого не зависит.
  const garrison = input.front && input.rear && front && rear ? front.kinds : undefined;
  // Укрепления — та же грань кости, что земля (`GroundPenalty.works`): у кого бы лагерь ни стоял, бьют его через них.
  const fort = input.fort !== undefined && input.fort > 0 ? input.fort : 0;
  const ground = fort > 0 ? { ...(input.ground ?? {}), works: fort } : input.ground;
  const fieldIn: FieldInput = {
    seed: input.seed,
    ...(ground ? { ground } : {}),
    attacker: {
      kinds,
      resolve: input.resolve,
      pips: input.pips,
      // Мораль между боями (14.31): у каждой части своя, вместе — по прошедшим.
      rest: mixRest(parts.map(({ part, t }) => ({ rest: part.rest ?? 1, men: t.passed }))),
      ...(garrison ? { garrison } : {}),
    },
    defender: { kinds: input.camp.kinds, resolve: input.camp.resolve, pips: input.camp.pips, rest: input.camp.rest },
  };
  const field = resolveField(fieldIn);
  const losses = field.result?.sides.attacker.losses ?? emptyStack();
  const lost = splitLosses(losses, front?.kinds ?? emptyStack(), rear?.kinds ?? emptyStack());
  return { refused: false, input: fieldIn, field, front, rear, lost, fought, all };
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
export interface HoldIn extends Omit<CampFightIn, 'at' | 'front' | 'rear' | 'resolve' | 'pips'> {
  /**
   * Гарнизон на вылазке: все, кто дома, без ополчения — оно за ворота не выходит. Мораль — между боями, на минуту
   * дозревания; износ осады к этой минуте дверь кладёт сама (`siege.siegeWear`).
   */
  sortie: CampPartIn & { resolve?: number; pips?: Pips };
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
    ground: input.ground,
    fort: input.fort,
  });
  return out.refused || !out.field.won;
}
