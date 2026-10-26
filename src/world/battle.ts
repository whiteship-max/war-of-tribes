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
  type Flanks,
  type GroundPenalty,
  type Pips,
  type Side,
  type Spirit,
  type Stack,
  type Widen,
  type ScarEdge,
} from '@/battle';
import { markOf, scarEdge, type FightMark, type ScarSide, type ScarWhere } from '@/game/scarrules';

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
   * Командиры флангов того, кто ведёт сторону (ДР-3, `ArmySetup.flanks`): тактика левого и правого в отметках со знаком. У
   * нас — люди «Командующих» (`PlayerProfile.flanks`) там же, где отметки полководца; у соседа — книга сервера; у логова —
   * ничего. Нет поля — командиров нет, и бой байт в байт прежний.
   */
  flanks?: Flanks;
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
   * Черты армии (ДР-4, `game/scarrules`): какие у неё есть и шла ли она голодной. Где какая действует, решает `scarEdge` по месту
   * боя (`FieldInput.where`) и войску противника, а в ядро едут готовые поправки (`ArmySetup.scars`). У нас — черты по журналу
   * боёв (`PlayerProfile.scars`), у соседа в войне — черты книги сервера, у логова — ничего. Нет поля или ни одна не действует —
   * бой байт в байт прежний.
   */
  scars?: ScarSide;
  /**
   * Сторона — звери, а не люди (стая у ворот, ДР-5): в ядре она лёгкая конница, но для черт армии она не войско — ни метки
   * «конница противника» (`scarrules.markOf`), ни действия черт, спрашивающих состав противника («Стена копий», «Страх
   * обстрела»). Нет поля — люди.
   */
  beasts?: true;
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
   * Где и когда бой (ДР-4, `scarrules.ScarWhere`): лес, река, холмы, ночь, зима, осада — то, что спрашивают черты армий и что
   * ложится в метку боя (`FieldOutcome.marks`). Ядро места не знает; нет поля — ни одной из этих тем у боя нет.
   */
  where?: ScarWhere;
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
  /**
   * Метки боя для журналов армий (ДР-4, `scarrules.markOf`): исход, уверенная победа, бегство, стрелы и конница противника, место
   * и голод — у каждой стороны своя. Боя не было — `null`: в журнал не идёт ничего.
   */
  marks: Record<Side, FightMark> | null;
  /**
   * Доля выбитых по секторам флангов, где у стороны бился командир (ДР-5, `FieldSide.flanks`): из неё мир выводит гибель
   * командира (`LocalWorld.flankDeed`). Нет поля — у сторон командиров не было или боя не было.
   */
  flankLoss?: Partial<Record<Side, Partial<Record<'A' | 'C', number>>>>;
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

/** Доля выбитых своего сектора у флангов с командиром (ДР-5): пустой сектор — нет поля. */
function flankLossOf(result: BattleResult, input: FieldInput): Pick<FieldOutcome, 'flankLoss'> {
  const out: NonNullable<FieldOutcome['flankLoss']> = {};
  for (const side of ['attacker', 'defender'] as const) {
    const led = input[side].flanks;
    if (!led) continue;
    const by: Partial<Record<'A' | 'C', number>> = {};
    for (const sec of ['A', 'C'] as const) {
      if (!led[sec]) continue;
      const s = result.sides[side].sectors[sec];
      const was = stackTotal(s.initial);
      if (was > 0) by[sec] = Math.max(0, Math.min(1, 1 - stackTotal(s.final) / was));
    }
    if (Object.keys(by).length) out[side] = by;
  }
  return Object.keys(out).length ? { flankLoss: out } : {};
}

export function resolveField(input: FieldInput): FieldOutcome {
  const atk = stackTotal(input.attacker.kinds);
  const def = stackTotal(input.defender.kinds);
  const fresh = { attacker: 1, defender: 1 };
  if (atk <= 0) return { won: false, attackerLoss: 0, defenderLoss: 0, result: null, rest: fresh, marks: null };
  if (def <= 0) return { won: true, attackerLoss: 0, defenderLoss: 1, result: null, rest: fresh, marks: null };

  // Версия правил — и раскладке: правило развёртывания менялось (BTL-5), запись старше раскладывается по своим.
  const rules = input.rules ?? BATTLE_RULES;
  const attacker = sideSetup(input.attacker, rules);
  const defender = deploySetup(input.defender.kinds, FRONT_WIDTH, rules);
  // Доля морали кладётся, только если сторона не свежая: бой свежих сторон — тот же, что до морали между боями.
  const rested = (r: number | undefined): { rest?: number } => (r !== undefined && r < 1 ? { rest: r } : {});
  // Дух — только если он есть: бой без него (логово, вход старше ДР-1) — тот же, что до духа, байт в байт.
  const spirited = (v: Spirit | undefined): { spirit?: Spirit } => (v ? { spirit: { morale: v.morale, discipline: v.discipline } } : {});
  // Командиры флангов — только если они есть (ДР-3): бой без них — тот же, что до них, байт в байт.
  const led = (f: Flanks | undefined): { flanks?: Flanks } => (f && (f.A || f.C) ? { flanks: { ...f } } : {});
  // Черты (ДР-4) — только действующие в этом бою: ни одной — поля нет, и бой тот же, что до черт, байт в байт.
  const where = input.where ?? {};
  const scarred = (own: FieldSide, foe: FieldSide): { scars?: ScarEdge } => {
    const s = own.scars;
    if (!s || s.held.length === 0) return {};
    // Звери — не войско (ДР-5): черты «против конницы» и «при виде лучников» против стаи не действуют.
    const edge = scarEdge(s.held, { ...where, ...(s.hungry ? { hungry: true as const } : {}), foe: foe.beasts ? emptyStack() : foe.kinds });
    return edge ? { scars: edge } : {};
  };

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
      ...led(input.attacker.flanks),
      ...scarred(input.attacker, input.defender),
      ...(input.attacker.garrison ? { garrison: input.attacker.garrison } : {}),
    },
    defender: {
      ...defender,
      resolve: input.defender.resolve ?? 0,
      pips: input.defender.pips ?? {},
      ...rested(input.defender.rest),
      ...spirited(input.defender.spirit),
      ...led(input.defender.flanks),
      ...scarred(input.defender, input.attacker),
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
    marks: {
      attacker: markOf(result, 'attacker', where, input.attacker.scars?.hungry === true, input.defender.beasts === true),
      defender: markOf(result, 'defender', where, input.defender.scars?.hungry === true, input.attacker.beasts === true),
    },
    ...flankLossOf(result, input),
  };
}

/**
 * Бой из записанного входа — журнал для ролика боя войны, посчитанного сервером (BTL-0, OWNER-DECISIONS п. 7): по версии
 * правил этого входа, а вход без версии старше версий (`FIRST_RULES`). Исход не пересчитывается — его везёт запись.
 */
export const recordedField = (input: FieldInput): FieldOutcome => resolveField({ ...input, rules: input.rules ?? FIRST_RULES });
