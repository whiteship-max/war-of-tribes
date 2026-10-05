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
import { refusedAtGate, splitLosses, strikeForecast, type CampSight, type Through } from './works';
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
  const fieldIn: FieldInput = {
    seed: input.seed,
    ground: input.ground,
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
