// Единственное место, где мир и племя знают друг о друге.
//
// Мир получает отсюда слепок деревни (сколько людей, чем обороняется, что можно
// унести) и отдаёт сюда последствия походов. Дальше вниз связи нет: симуляция
// племени не знает про координаты, а мир — про жителей и склад.
import type { GameState, TroopId } from '@/game/types';
import { DAY_LENGTH, RESOURCE_IDS } from '@/game/constants';
import { TROOP_IDS } from '@/game/data/troops';
import {
  buildingOfType,
  buildingStat,
  commandCap,
  defense,
  hiddenStash,
  homeArmyPower,
  intelKeen,
  mountGear,
  soldierFoodPerDay,
  soldierPower,
  surveyRadius,
  townFoodPerDay,
  warningSeconds,
} from '@/game/derived';
import { BATTLE_MAN, type TroopStack } from '@/game/battle/kinds';
import { clampFormation, stashUnplaced, toArmySetup } from '@/game/battle/formation';
import { troopTotal } from '@/game/battle/kinds';
import {
  applyExpedition,
  sendableUnits,
  setAway,
  type ExpeditionOutcome,
} from '@/game/sim/expedition';
import type { FigureView, HomeEffect, Loot, MarchView, PlayerProfile, SiegeView } from './types';

/**
 * Сколько игровых дней укладывается в час реального времени. Осада живёт в
 * мировых часах, а расход еды племя считает за игровой день — перевод должен
 * быть один и стоять здесь, на самом мосту: мир про `DAY_LENGTH` не знает, а
 * племя про мировые часы.
 */
const DAYS_PER_HOUR = 3_600_000 / (DAY_LENGTH * 1000);

/**
 * Кто из дружины сейчас не дома, по видам. Складывается из двух списков мира, и
 * только из них: отряды в пути и войско при полководце. Своего поля в состоянии
 * племени у этого числа нет — иначе оно завелось бы дважды и разошлось.
 */
export function awayTroops(marches: MarchView[], figures: FigureView[] = []): TroopStack {
  const out: TroopStack = {};
  const add = (stack: TroopStack | undefined): void => {
    for (const [id, n] of Object.entries(stack ?? {}) as [TroopId, number][]) {
      if ((n ?? 0) > 0) out[id] = (out[id] ?? 0) + n;
    }
  };
  for (const m of marches) if (m.own) add(m.troops);
  for (const f of figures) if (f.phase !== 'home') add(f.troops);
  return out;
}

/**
 * Гарнизон дома по видам бойцов: ушедшие в обороне не участвуют.
 *
 * Тех, про кого известно, кто именно ушёл (войско при полководце, состав
 * похода), вычитают поимённо по видам. Остаток — те, кто числится одним числом
 * `warriorsAway`, — снимается со слабых, так же как они гибнут (`removeSoldiers`).
 */
export function homeTroops(s: GameState, away: TroopStack = {}): TroopStack {
  const out: TroopStack = {};
  let known = 0;
  for (const id of TROOP_IDS) {
    const gone = Math.min(Math.max(0, s.army?.[id] ?? 0), Math.max(0, away[id] ?? 0));
    known += gone;
    out[id] = Math.max(0, s.army?.[id] ?? 0) - gone;
  }
  let rest = Math.max(0, s.warriorsAway - known);
  for (const id of TROOP_IDS) {
    const gone = Math.min(out[id] ?? 0, rest);
    rest -= gone;
    const left = (out[id] ?? 0) - gone;
    if (left > 0) out[id] = left;
    else delete out[id];
  }
  return out;
}

/**
 * Ополчение: та часть обороны, которую дают не бойцы, а частокол, башня и сами
 * жители. В поле оно выходит пехотой без снаряжения — иначе набеги ИИ, чей
 * потолок считается от `defense()`, били бы по пустому месту.
 */
export const militiaMen = (s: GameState): number =>
  Math.max(0, Math.round((defense(s) - homeArmyPower(s)) / BATTLE_MAN));

/**
 * Сколько ополченцев выходит стрелками, а не пехотой. Это и есть работа башни:
 * людей она не добавляет — их уже посчитал `militiaMen` по общей обороне, — а
 * ставит часть из них на стену с луком. Частокол остаётся плоской обороной,
 * поэтому между двумя укреплениями появляется выбор, а не разница в цене.
 */
export const militiaArchers = (s: GameState): number => {
  const tower = buildingOfType(s, 'tower');
  if (!tower) return 0;
  return Math.min(militiaMen(s), Math.max(0, Math.round(buildingStat(tower, 'archers'))));
};

/**
 * Слепок деревни для мира. Считается заново перед каждым обращением.
 *
 * `away` — кто сейчас не дома по видам: приходит из мира (походы и войско при
 * полководце). Без него гарнизон в слепке был бы больше настоящего, и деревня
 * оборонялась бы теми, кто стоит в поле у чужих ворот.
 */
export function playerProfile(s: GameState, away: TroopStack = {}): PlayerProfile {
  const units = sendableUnits(s);
  // Тайник не «защищает» добро, а прячет его: спрятанного просто нет в слепке,
  // поэтому чужой набег его не находит, как ни считай добычу. Никакой отдельной
  // проверки на стороне мира для этого не нужно, и это правильно — мир не должен
  // знать про здания племени.
  const stash = hiddenStash(s);
  const resources: Loot = {};
  // Тем же проходом собирается и `stock` — весь склад без вычетов. Им платят
  // дань и выкуп, по нему же считается «хватает или нет», и оно обязано
  // совпадать до единицы с тем, что игрок видит в полоске ресурсов: там стоит
  // `Math.floor(s.resources[r])`, здесь — оно же.
  const stock: Loot = {};
  for (const r of RESOURCE_IDS) {
    stock[r] = Math.max(0, Math.floor(s.resources[r]));
    resources[r] = Math.max(0, (stock[r] ?? 0) - stash);
  }
  const army = homeTroops(s, away);
  // Расстановка обороны подрезается по тому, кто сейчас дома: часть могла уйти
  // в поход или погибнуть, а нанятые с прошлого раза встают в резерв.
  let defenseSetup = null;
  if (s.defenseFormation) {
    const { formation, extra } = clampFormation(s.defenseFormation, army);
    const fitted = troopTotal(extra) > 0 ? stashUnplaced(formation, extra) : formation;
    const archers = militiaArchers(s);
    defenseSetup = toArmySetup(fitted, militiaMen(s) - archers, archers);
  }
  return {
    name: 'Наше племя',
    pop: s.pop,
    defense: defense(s),
    // Мощь одного бойца — среднее по составу армии: мир считает отряд числами,
    // а состав знает только племя.
    warriorPower: soldierPower(s),
    units: { warrior: units.warrior, scout: units.scout },
    army,
    militia: militiaMen(s),
    militiaArchers: militiaArchers(s),
    // Час и время года: мир их не толкует, он ставит их отметкой на записи боя,
    // чтобы ролик светил закатом там, где бой и случился на закате.
    time: s.time,
    // Осада считает не добычу, а на сколько хватит хлеба, поэтому здесь весь
    // склад, а не то, что видно набегу: спрятанное в тайнике племя ест наравне
    // с остальным. Два расхода — города и одного бойца — приезжают из того же
    // `foodConsumptionPerDay`, которым племя живёт всегда.
    food: Math.max(0, s.resources.food),
    foodPerHour: townFoodPerDay(s) * DAYS_PER_HOUR,
    soldierFoodPerHour: soldierFoodPerDay(s) * DAYS_PER_HOUR,
    // Дозор и конюшня: мир получает четыре числа и не спрашивает, откуда они.
    warning: warningSeconds(s),
    // Изученная округа: радиус земли, которую Дозор открыл навсегда. Живого
    // обзора он не даёт — открывает местность, и только.
    survey: surveyRadius(s),
    intelKeen: intelKeen(s),
    mountGear: mountGear(s),
    // Статуя Героя: сколько дружины полководец уводит в поле.
    command: commandCap(s),
    defenseSetup,
    // Золото в слепок не кладём: чужой набег уносит со склада, а не из казны.
    resources,
    stock,
  };
}

/**
 * Сколько людей сейчас в походе. Число не хранится дважды: оно выводится из списка
 * походов, поэтому потерянное сохранение мира не оставит деревню без армии навсегда.
 */
export function syncAway(s: GameState, marches: MarchView[], figures: FigureView[] = []): boolean {
  let warriors = 0;
  let scouts = 0;
  let heroSeen = false;
  for (const m of marches) {
    if (!m.own) continue;
    warriors += m.units.warrior ?? 0;
    scouts += m.units.scout ?? 0;
    if (s.hero.marchId === m.id) heroSeen = true;
  }
  // Войско при полководце — тоже войско в поле: пока оно с ним, дома его нет,
  // и оборона деревни считается по ополчению, стенам и башням.
  for (const f of figures) if (f.phase !== 'home') warriors += troopTotal(f.troops);
  // Герой тоже выводится из списка походов, а не хранится дважды: поход мог
  // кончиться без последствия (отозвали, цель исчезла) — тогда герой просто дома.
  // Гибель разбирает `applyExpedition`, и вызывают его раньше этого места.
  const heroChanged = s.hero.marchId !== null && !heroSeen;
  if (heroChanged) s.hero.marchId = null;
  if (s.warriorsAway === warriors && s.scoutsAway === scouts) return heroChanged;
  setAway(s, warriors, scouts);
  return true;
}

/**
 * Осада из мира в племя. Мир считает её в своих часах, племя живёт игровым
 * временем — перевод один и стоит здесь, как и всё, что знают друг о друге эти
 * две стороны.
 *
 * Переводится **остаток**, а не отметка: `starvesAt` — мировые миллисекунды, и
 * положить их в состояние племени значило бы, что тик и офлайн-догон сравнивают
 * секунды партии с часами устройства. Остаток же одинаков в обеих шкалах —
 * игровая секунда идёт ровно секунду.
 *
 * Возвращает `true`, если что-то изменилось: пульс идёт каждые две секунды, и
 * перерисовывать по нему экран без причины не за что.
 */
export function syncSiege(s: GameState, view: SiegeView | null, now: number): boolean {
  if (!view) {
    if (s.siege === null) return false;
    s.siege = null;
    return true;
  }
  const until = s.time + Math.max(0, (view.starvesAt - now) / 1000);
  const same =
    s.siege !== null &&
    s.siege.byName === view.byName &&
    s.siege.garrison === view.garrison &&
    Math.abs(s.siege.until - until) < 1;
  if (same) return false;
  s.siege = { byName: view.byName, until, garrison: view.garrison };
  return true;
}

/** Перевод мирового последствия в понятный племени итог. */
export function toOutcome(e: HomeEffect): ExpeditionOutcome {
  return {
    warriorsLost: e.lost.warrior ?? 0,
    // Бой знает, кто именно погиб: списывать надо тех же, а не «слабых первыми».
    troopsLost: e.lostTroops,
    scoutsLost: e.lost.scout ?? 0,
    resources: e.resources,
    pop: e.pop ?? 0,
    // Золото едет в той же добыче отдельным ключом: складом оно не считается.
    gold: e.resources.gold ?? 0,
    prestige: e.prestige,
    morale: e.morale,
    battle: e.battle,
    sacked: e.sacked ?? 0,
    // Оружие из логова и сам факт того, что логово сожжено: мир отдал число и
    // отметку, во что превратить первое и что засчитать по второй — дело племени.
    arms: e.arms ?? 0,
    lair: e.lair ?? false,
    text: e.text,
    kind: e.good ? 'good' : 'bad',
  };
}

export function applyEffects(s: GameState, effects: HomeEffect[]): void {
  for (const e of effects) applyExpedition(s, toOutcome(e));
}
