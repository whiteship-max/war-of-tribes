// Бой при прибытии: мир собирает обе стороны и зовёт ядро. Исход нельзя посчитать
// в момент отправки — к приходу у защитника меняется, кто дома: дружина собирается или
// уходит, войско гибнет и нанимается, — поэтому расчёт живёт здесь, на приходе отряда.
// Своей раскладки у стороны нет ни у кого: обе встают по правилу развёртывания
// (docs/battle_eu4.md, 14.5 и 14.26–14.27 — расстановка обороны ушла поставкой 2).
//
// Наружу выдаётся и полный результат (из него строится отчёт и журнал), и доли
// потерь в старой форме: на них держатся добыча, урон гарнизону и последствия
// для деревни, и переписывать их из-за нового ядра незачем.
import {
  deploySetup,
  simulateBattle,
  stackTotal,
  type BattleResult,
  type GroundPenalty,
  type Pips,
  type Side,
  type Stack,
  type UnitKind,
} from '@/battle';

export interface FieldSide {
  kinds: Stack;
  gear?: Partial<Record<UnitKind, number>>;
  /**
   * Стойкость, с которой сторона вышла в поле: у нас — обряд перед боем
   * (`derived.fervour`), у чужих — ноль, брать её им неоткуда.
   *
   * Кладётся поверх развёртывания, ровно как `gear`, и по той же причине: где кто
   * встал, решает правило развёртывания, а стойкость — свойство войска, а не построения.
   */
  resolve?: number;
  /**
   * Отметки того, кто ведёт сторону (`PlayerProfile.pips`): у нас — полководец в своих боях и у
   * своих ворот, у чужих — ничего. Кладутся поверх развёртывания тем же путём, что `resolve`.
   */
  pips?: Pips;
  /**
   * С какой долей полной морали сторона вышла в бой, 0..1: мораль между боями (docs/battle_eu4.md, 14.31). Считает её
   * одна дверь — `world/rest`; нет поля — полная.
   */
  rest?: number;
  // Поля своей раскладки у стороны нет, и заводить его нельзя: обе стороны встают по правилу развёртывания
  // (`setup.deploySetup`), одной дверью. Последней раскладкой руками была оборона деревни — она ушла поставкой 2
  // (docs/battle_eu4.md, 14.27), и держит это тест по исходнику (`world/muster.test.ts`).
}

export interface FieldInput {
  seed: number;
  attacker: FieldSide;
  defender: FieldSide;
  /**
   * Штраф кости от места боя (`world/place.groundAt`) — **нападающему, и только ему** (таблица EU4, docs/battle_eu4.md,
   * 14.5): поля у стороны нет нарочно, чтобы обороняющемуся его было неоткуда взять.
   */
  ground?: GroundPenalty;
}

export interface FieldOutcome {
  won: boolean;
  /** Доля потерь стороны, 0..1 — в этих числах считает остальной мир. */
  attackerLoss: number;
  defenderLoss: number;
  /** Полный результат с журналом. Из него строится отчёт на экране. */
  result: BattleResult | null;
  /**
   * С какой долей полной морали уцелевшие каждой стороны выходят из боя (`SideResult.rest`), 0..1 — отсюда мир пишет
   * пару морали армии (`world/rest`). Боя не было — 1 у обеих: никто не дрался.
   */
  rest: Record<Side, number>;
}

/**
 * Считает полевой бой. Пустая сторона в ядро не идёт: `validateSetup` требует
 * хотя бы одного бойца, а «пришёл никто» — это не ничья, а поражение пришедшего.
 */
export function resolveField(input: FieldInput): FieldOutcome {
  const atk = stackTotal(input.attacker.kinds);
  const def = stackTotal(input.defender.kinds);
  const fresh = { attacker: 1, defender: 1 };
  if (atk <= 0) return { won: false, attackerLoss: 0, defenderLoss: 0, result: null, rest: fresh };
  if (def <= 0) return { won: true, attackerLoss: 0, defenderLoss: 1, result: null, rest: fresh };

  const attacker = deploySetup(input.attacker.kinds);
  const defender = deploySetup(input.defender.kinds);
  // Доля морали кладётся, только если сторона не свежая: бой свежих сторон — тот же, что до морали между боями.
  const rested = (r: number | undefined): { rest?: number } => (r !== undefined && r < 1 ? { rest: r } : {});

  const result = simulateBattle({
    seed: input.seed,
    attacker: { ...attacker, gear: input.attacker.gear ?? attacker.gear, resolve: input.attacker.resolve ?? 0, pips: input.attacker.pips ?? {}, ground: input.ground, ...rested(input.attacker.rest) },
    defender: { ...defender, gear: input.defender.gear ?? defender.gear, resolve: input.defender.resolve ?? 0, pips: input.defender.pips ?? {}, ...rested(input.defender.rest) },
  });

  const a = result.sides.attacker.total;
  const d = result.sides.defender.total;
  return {
    won: result.winner === 'attacker',
    attackerLoss: a.initial > 0 ? a.losses / a.initial : 0,
    defenderLoss: d.initial > 0 ? d.losses / d.initial : 0,
    result,
    rest: { attacker: result.sides.attacker.rest ?? 1, defender: result.sides.defender.rest ?? 1 },
  };
}
