// Бой при прибытии: мир собирает обе стороны и зовёт ядро. Исход нельзя посчитать
// в момент отправки — защитник до `DEFENSE_FREEZE` перед приходом может перенастроить оборону
// (раздел 8 документа), поэтому расчёт живёт здесь, на приходе отряда.
//
// Наружу выдаётся и полный результат (из него строится отчёт и журнал), и доли
// потерь в старой форме: на них держатся добыча, урон гарнизону и последствия
// для деревни, и переписывать их из-за нового ядра незачем.
import {
  SECTORS,
  UNIT_KINDS,
  deploySetup,
  simulateBattle,
  stackTotal,
  type ArmySetup,
  type BattleResult,
  type Pips,
  type Sector,
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
   * Кладётся поверх расстановки, ровно как `gear`, и по той же причине: где кто
   * встал, решает правило развёртывания, а стойкость — свойство войска, а не построения.
   */
  resolve?: number;
  /**
   * Отметки того, кто ведёт сторону (`PlayerProfile.pips`): у нас — полководец в своих боях и у
   * своих ворот, у чужих — ничего. Кладутся поверх расстановки тем же путём, что `resolve`.
   */
  pips?: Pips;
  /**
   * Своя раскладка по секторам — у одной стороны в игре: у обороны деревни до поставки 2
   * (docs/battle_eu4.md, 14.5). null — сторона встаёт по правилу развёртывания (`setup.deploySetup`).
   */
  setup: ArmySetup | null;
}

export interface FieldInput {
  seed: number;
  attacker: FieldSide;
  defender: FieldSide;
}

export interface FieldOutcome {
  won: boolean;
  /** Доля потерь стороны, 0..1 — в этих числах считает остальной мир. */
  attackerLoss: number;
  defenderLoss: number;
  /** Полный результат с журналом. Из него строится отчёт на экране. */
  result: BattleResult | null;
}

/**
 * Расстановка, в которой не больше бойцов каждого рода, чем есть в строю.
 *
 * Расстановку собирают заранее — оборону племя присылает слепком раз в пульс, а
 * за `DEFENSE_FREEZE` до набега мир её запирает, — а бойцы за это время уходят к
 * полководцу. Запирается порядок, а не люди: без подрезки ушедший стоял бы и у
 * частокола по старой расстановке, и в строю полководца.
 *
 * Лишние снимаются с конца — резерв, потом тыл, потом фронт: стена держится до
 * последнего. Расстановка, собранная из тех же людей, не меняется вовсе:
 * `toArmySetup` округляет род целиком, `kindsOf` — каждый вид отдельно, а вес
 * бойца в строю — целое или половинка, поэтому сумма по видам никогда не меньше.
 * Держит это тест, а не комментарий (`world/muster.test.ts`).
 */
export function fitSetup(setup: ArmySetup, have: Stack): ArmySetup {
  const sectors = Object.fromEntries(SECTORS.map((id) => [id, { ...setup.sectors[id] }])) as Record<Sector, Stack>;
  for (const k of UNIT_KINDS) {
    let over = SECTORS.reduce((n, id) => n + sectors[id][k], 0) - Math.max(0, have[k]);
    for (let i = SECTORS.length - 1; i >= 0 && over > 0; i--) {
      const sector = sectors[SECTORS[i]];
      const take = Math.min(sector[k], over);
      sector[k] -= take;
      over -= take;
    }
  }
  return { ...setup, sectors };
}

/**
 * Считает полевой бой. Пустая сторона в ядро не идёт: `validateSetup` требует
 * хотя бы одного бойца, а «пришёл никто» — это не ничья, а поражение пришедшего.
 */
export function resolveField(input: FieldInput): FieldOutcome {
  const atk = stackTotal(input.attacker.kinds);
  const def = stackTotal(input.defender.kinds);
  if (atk <= 0) return { won: false, attackerLoss: 0, defenderLoss: 0, result: null };
  if (def <= 0) return { won: true, attackerLoss: 0, defenderLoss: 1, result: null };

  const attacker = input.attacker.setup ?? deploySetup(input.attacker.kinds);
  const defender = input.defender.setup ?? deploySetup(input.defender.kinds);

  const result = simulateBattle({
    seed: input.seed,
    attacker: { ...attacker, gear: input.attacker.gear ?? attacker.gear, resolve: input.attacker.resolve ?? 0, pips: input.attacker.pips ?? {} },
    defender: { ...defender, gear: input.defender.gear ?? defender.gear, resolve: input.defender.resolve ?? 0, pips: input.defender.pips ?? {} },
  });

  const a = result.sides.attacker.total;
  const d = result.sides.defender.total;
  return {
    won: result.winner === 'attacker',
    attackerLoss: a.initial > 0 ? a.losses / a.initial : 0,
    defenderLoss: d.initial > 0 ? d.losses / d.initial : 0,
    result,
  };
}
