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
  BATTLE_RULES,
  FIRST_RULES,
  FRONT_WIDTH,
  deploySetup,
  emptyStack,
  simulateBattle,
  stackTotal,
  SECTORS,
  UNIT_KINDS,
  type ArmySetup,
  type BattleResult,
  type GroundPenalty,
  type Pips,
  type Side,
  type Spirit,
  type Stack,
  type Widen,
} from '@/battle';

/**
 * Сторона боя — то, что уходит в ядро. Ни ступени снаряжения, ни вещей в ней нет (слово владельца по 14.35, путь П2): вещи
 * пришли в бой через цену вида — людьми строя (`price.kindsOf`), — и второй раз их не кладут. Чем отряд одет, нужно только
 * показу (ролик, отчёт), и живёт оно у того, кто отряд собрал.
 */
export interface FieldSide {
  kinds: Stack;
  /**
   * Стойкость, с которой сторона вышла в поле: у нас — обряд перед боем
   * (`derived.fervour`), у чужих — ноль, брать её им неоткуда.
   *
   * Кладётся поверх развёртывания: где кто встал, решает правило развёртывания, а стойкость — свойство войска, а не
   * построения.
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
  /**
   * Мораль и дисциплина войска, 0…100 (ДР-1, `ArmySetup.spirit`): у нас — дух дружины (`game/spiritrules`, мост везёт его
   * слепком `PlayerProfile.spirit`), у соседа — его слепок, срезанный потолком книги сервера, у логова — ничего. Нет поля —
   * множители единица.
   */
  spirit?: Spirit;
  /**
   * Какая часть стороны — гарнизон, вышедший из ворот в совместный удар, по родам (`ArmySetup.garrison`): ядро только
   * раскладывает её по секторам в итог, чтобы ролик вывел гарнизон из ворот, а дружину с поля. Исход от поля не зависит.
   */
  garrison?: Partial<Stack>;
  /**
   * Клещи (docs/siege_v2.md, 6.2): какая часть `kinds` — вторая армия, вставшая в тылу противника (`ArmySetup.behind`).
   * Встаёт тем же правилом развёртывания, что и строй, своей расстановкой. Нет поля — второй армии нет.
   */
  behind?: Stack;
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
  /**
   * Ширина боя и проём посреди боя (`BattleInput.width`, `.widen`): у боя у стены — фронт штурма (`world/wall.wallFront`).
   * Нет поля — ширина фронта, бой в поле.
   */
  width?: number;
  /** Ширина стрельбы (`BattleInput.fire`): у боя у стены — полная, стреляют со всей стены. Нет — ширина боя. */
  fire?: number;
  widen?: Widen;
  /**
   * Версия правил боя (`BATTLE_RULES`, BTL-0). Двери боя мира и сервера (`world/fights`) пишут нынешнюю, и она едет во
   * входе боя войны (`WarInput.rules`); нет поля — нынешняя. Вход, прочитанный из записи, — через `recordedField`.
   */
  rules?: number;
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
/**
 * Сторона по правилу развёртывания (`setup.deploySetup`). Клещи — две расстановки тем же правилом: строй своей полосы и
 * вторая армия в тылу противника; сектора — их сумма, `behind` — вторая.
 */
function sideSetup(side: FieldSide, rules: number): ArmySetup {
  const back = side.behind && stackTotal(side.behind) > 0 ? side.behind : null;
  if (!back) return deploySetup(side.kinds, FRONT_WIDTH, rules);
  const own = emptyStack();
  for (const k of UNIT_KINDS) own[k] = Math.max(0, side.kinds[k] - back[k]);
  const front = deploySetup(own, FRONT_WIDTH, rules);
  const rear = deploySetup(back, FRONT_WIDTH, rules);
  const sectors = {} as ArmySetup['sectors'];
  for (const id of SECTORS) {
    sectors[id] = emptyStack();
    for (const k of UNIT_KINDS) sectors[id][k] = front.sectors[id][k] + rear.sectors[id][k];
  }
  return { sectors, behind: rear.sectors };
}

export function resolveField(input: FieldInput): FieldOutcome {
  const atk = stackTotal(input.attacker.kinds);
  const def = stackTotal(input.defender.kinds);
  const fresh = { attacker: 1, defender: 1 };
  if (atk <= 0) return { won: false, attackerLoss: 0, defenderLoss: 0, result: null, rest: fresh };
  if (def <= 0) return { won: true, attackerLoss: 0, defenderLoss: 1, result: null, rest: fresh };

  // Версия правил — и раскладке: правило развёртывания менялось (BTL-5), запись старше раскладывается по своим.
  const rules = input.rules ?? BATTLE_RULES;
  const attacker = sideSetup(input.attacker, rules);
  const defender = deploySetup(input.defender.kinds, FRONT_WIDTH, rules);
  // Доля морали кладётся, только если сторона не свежая: бой свежих сторон — тот же, что до морали между боями.
  const rested = (r: number | undefined): { rest?: number } => (r !== undefined && r < 1 ? { rest: r } : {});
  // Дух — только если он есть: бой без него (логово, вход старше ДР-1) — тот же, что до духа, байт в байт.
  const spirited = (v: Spirit | undefined): { spirit?: Spirit } => (v ? { spirit: { morale: v.morale, discipline: v.discipline } } : {});

  const result = simulateBattle({
    seed: input.seed,
    rules,
    attacker: {
      ...attacker,
      resolve: input.attacker.resolve ?? 0,
      pips: input.attacker.pips ?? {},
      ground: input.ground,
      ...rested(input.attacker.rest),
      ...spirited(input.attacker.spirit),
      ...(input.attacker.garrison ? { garrison: input.attacker.garrison } : {}),
    },
    defender: {
      ...defender,
      resolve: input.defender.resolve ?? 0,
      pips: input.defender.pips ?? {},
      ...rested(input.defender.rest),
      ...spirited(input.defender.spirit),
    },
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.fire !== undefined ? { fire: input.fire } : {}),
    ...(input.widen ? { widen: input.widen } : {}),
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

/**
 * Бой из записанного входа — журнал для ролика боя войны, посчитанного сервером (BTL-0, OWNER-DECISIONS п. 7): по версии
 * правил этого входа, а вход без версии старше версий (`FIRST_RULES`). Исход не пересчитывается — его везёт запись.
 */
export const recordedField = (input: FieldInput): FieldOutcome => resolveField({ ...input, rules: input.rules ?? FIRST_RULES });
