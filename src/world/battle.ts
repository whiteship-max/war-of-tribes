// Бой при прибытии: мир собирает обе стороны и зовёт ядро. Исход нельзя посчитать
// в момент отправки — защитник до последних пяти минут может перенастроить оборону
// (раздел 8 документа), поэтому расчёт живёт здесь, на приходе отряда.
//
// Наружу выдаётся и полный результат (из него строится отчёт и журнал), и доли
// потерь в старой форме: на них держатся добыча, урон гарнизону и последствия
// для деревни, и переписывать их из-за нового ядра незачем.
import {
  quickAttack,
  simulateBattle,
  stackTotal,
  type ArmySetup,
  type BattleResult,
  type Intel as BattleIntel,
  type QuickPresetId,
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
   * Кладётся поверх расстановки, ровно как `gear`, и по той же причине: при
   * быстрой атаке расстановку выбирает пресет, а стойкость — свойство войска,
   * а не построения.
   */
  resolve?: number;
  /** null — быстрая атака: пресет выберется по сиду похода. */
  setup: ArmySetup | null;
}

export interface FieldInput {
  seed: number;
  attacker: FieldSide;
  defender: FieldSide;
  /**
   * Что нападающий знал о цели: разведка сдвигает выбор пресета. Любой давности —
   * мир отдаёт сюда состав из последнего снимка и возраста его не спрашивает.
   */
  intel?: BattleIntel;
}

export interface FieldOutcome {
  won: boolean;
  /** Доля потерь стороны, 0..1 — в этих числах считает остальной мир. */
  attackerLoss: number;
  defenderLoss: number;
  /** Полный результат с журналом. Из него строится отчёт на экране. */
  result: BattleResult | null;
  /** Каким пресетом пошла сторона, если расстановку ей не задавали. */
  preset: { attacker: QuickPresetId | null; defender: QuickPresetId | null };
}

/** Сид для расстановки стороны: у нападающего и обороняющегося он не должен совпасть. */
const salt = (seed: number, n: number): number => (Math.imul(seed ^ n, 0x9e3779b1) >>> 0);

/**
 * Считает полевой бой. Пустая сторона в ядро не идёт: `validateSetup` требует
 * хотя бы одного бойца, а «пришёл никто» — это не ничья, а поражение пришедшего.
 */
export function resolveField(input: FieldInput): FieldOutcome {
  const atk = stackTotal(input.attacker.kinds);
  const def = stackTotal(input.defender.kinds);
  const none = { attacker: null, defender: null };
  if (atk <= 0) return { won: false, attackerLoss: 0, defenderLoss: 0, result: null, preset: none };
  if (def <= 0) return { won: true, attackerLoss: 0, defenderLoss: 1, result: null, preset: none };

  let attackerPreset: QuickPresetId | null = null;
  let defenderPreset: QuickPresetId | null = null;

  let attacker = input.attacker.setup;
  if (!attacker) {
    const quick = quickAttack(input.attacker.kinds, salt(input.seed, 1), input.intel);
    attackerPreset = quick.preset;
    attacker = quick.setup;
  }
  let defender = input.defender.setup;
  if (!defender) {
    const quick = quickAttack(input.defender.kinds, salt(input.seed, 2));
    defenderPreset = quick.preset;
    defender = quick.setup;
  }

  const result = simulateBattle({
    seed: input.seed,
    attacker: { ...attacker, gear: input.attacker.gear ?? attacker.gear, resolve: input.attacker.resolve ?? 0 },
    defender: { ...defender, gear: input.defender.gear ?? defender.gear, resolve: input.defender.resolve ?? 0 },
  });

  const a = result.sides.attacker.total;
  const d = result.sides.defender.total;
  return {
    won: result.winner === 'attacker',
    attackerLoss: a.initial > 0 ? a.losses / a.initial : 0,
    defenderLoss: d.initial > 0 ? d.losses / d.initial : 0,
    result,
    preset: { attacker: attackerPreset, defender: defenderPreset },
  };
}
