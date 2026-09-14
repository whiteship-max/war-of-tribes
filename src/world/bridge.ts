// Единственное место, где мир и племя знают друг о друге.
//
// Мир получает отсюда слепок деревни (сколько людей, чем обороняется, что можно
// унести) и отдаёт сюда последствия походов. Дальше вниз связи нет: симуляция
// племени не знает про координаты, а мир — про жителей и склад.
import type { GameState } from '@/game/types';
import { DAY_LENGTH, RESOURCE_IDS } from '@/game/constants';
import {
  bondedTotal,
  buildingOfType,
  buildingStat,
  commandCap,
  defense,
  hiddenStash,
  homeArmyPower,
  faithOf,
  fervour,
  intelKeen,
  mountGear,
  soldierFoodPerDay,
  soldierPower,
  surveyRadius,
  townFoodPerDay,
  warningSeconds,
} from '@/game/derived';
import { BATTLE_MAN } from '@/game/battle/kinds';
import { clampFormation, stashUnplaced, toArmySetup } from '@/game/battle/formation';
import { troopTotal } from '@/game/battle/kinds';
import {
  applyExpedition,
  fallPool,
  sendableUnits,
  setAway,
  type ExpeditionOutcome,
} from '@/game/sim/expedition';
import { NOBODY_AWAY, awayMen, awayOf, homeOf, type Away } from './muster';
import type {
  FigureView,
  HomeEffect,
  Loot,
  MarchView,
  PlayerProfile,
  SiegeView,
} from './types';

/**
 * Сколько игровых дней укладывается в час реального времени. Осада живёт в
 * мировых часах, а расход еды племя считает за игровой день — перевод должен
 * быть один и стоять здесь, на самом мосту: мир про `DAY_LENGTH` не знает, а
 * племя про мировые часы.
 */
const DAYS_PER_HOUR = 3_600_000 / (DAY_LENGTH * 1000);

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
 * Войско едет в слепке **целиком**, а не гарнизоном: кто из него дома, мир
 * считает сам, по своим спискам и в ту минуту, когда решает (`world/muster`).
 * Гарнизон, посчитанный здесь, отставал бы на пульс — слепок собирается по
 * спискам мира с прошлого пульса, а дружина уходит к полководцу между ними, — и
 * мир, поверивший ему, отдавал бы тех же бойцов второй раз.
 *
 * `away` — кто не дома, по тем же спискам: по нему здесь подрезается только
 * расстановка обороны — под гарнизон и дружину, собранную дома. В бою мир её
 * подрежет ещё раз, по настоящей обороне в минуту боя.
 */
export function playerProfile(s: GameState, away: Away = NOBODY_AWAY): PlayerProfile {
  const units = sendableUnits(s);
  // Склад едет в мир целиком, а рядом — вместимость тайника числом. Вычитать
  // одно из другого заранее нельзя: делит добычу общее правило (`spoils.plunder`),
  // одно на игрока и на бота, и оно должно получить те же два числа с обеих
  // сторон. Мир при этом про здания племени по-прежнему не знает — он знает,
  // сколько прячется, а не где и во что.
  //
  // Число обязано совпадать до единицы с полоской ресурсов наверху экрана: там
  // стоит `Math.floor(s.resources[r])`, здесь — оно же.
  const stash = hiddenStash(s);
  const stock: Loot = {};
  for (const r of RESOURCE_IDS) stock[r] = Math.max(0, Math.floor(s.resources[r]));
  // Расстановка обороны подрезается по тому, кто сейчас в обороне: часть могла
  // уйти в поход, в сбор или погибнуть, а нанятые с прошлого раза и дружина,
  // вставшая дома, встают в резерв.
  let defenseSetup = null;
  if (s.defenseFormation) {
    const { formation, extra } = clampFormation(s.defenseFormation, homeOf(s.army, away));
    const fitted = troopTotal(extra) > 0 ? stashUnplaced(formation, extra) : formation;
    const archers = militiaArchers(s);
    defenseSetup = toArmySetup(fitted, militiaMen(s) - archers, archers, null, fervour(s));
  }
  return {
    name: 'Наше племя',
    pop: s.pop,
    defense: defense(s),
    // Мощь одного бойца — среднее по составу армии: мир считает отряд числами,
    // а состав знает только племя.
    warriorPower: soldierPower(s),
    // Воинов здесь нет: сколько их дома, мир считает из `army` сам. Число,
    // посчитанное здесь, было бы вторым ответом на тот же вопрос.
    units: { scout: units.scout },
    army: { ...s.army },
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
    // Вера. В мир едут два числа и ни слова о храме: чем деревня верит — чтобы
    // сосед мог отнестись к ней прохладнее (`world/faith.faithAttitude`), — и
    // прибавка к стойкости от идущего обряда. Ни уклада, ни набожности, ни
    // реликвии мир не видит: это дела прихода, а не карты.
    faith: faithOf(s),
    fervour: fervour(s),
    defenseSetup,
    stock,
    stash,
    // Казна едет рядом со складом, а не в нём: платят из них разными дверями,
    // а делит их победитель одним правилом (`spoils.fate`) — тайник прячет
    // столько же золота, сколько зерна. Прежде здесь стояло «золото в слепок не
    // кладём: набег казну не уносит»; это правило отменено решением владельца
    // (docs/DEFEAT_LADDER.md) вместе со следствием: копить опасно всё, кроме
    // снаряжения.
    gold: Math.max(0, Math.floor(s.gold)),
    // Уровни построек, которые может задеть падение города. Мир не знает, что это
    // за постройки: выбирает из списка дверь участи, а какие туда входят,
    // решает племя (`expedition.fallPool`, без тайника).
    levels: fallPool(s),
    // Невольники: одно число, и мир читает его ровно в одном месте — в двери
    // участи взятого города (`world/spoils.fate`), на той ступени, что уводит
    // людей. Где они стоят и на каких работах, миру знать не надо.
    bonded: bondedTotal(s),
  };
}

/**
 * Сколько людей сейчас не в обороне. Число не хранится дважды: оно выводится из
 * списков мира, поэтому потерянное сохранение мира не оставит деревню без армии
 * навсегда.
 *
 * Бойцы считаются тем же правилом, каким мир считает оборону (`world/muster`):
 * отряды в пути и дружина в сборе, в пути, в поле и в лагере — не в гарнизоне и
 * не в обороне; дружина, собранная и стоящая у своих ворот, — в гарнизоне, один
 * раз.
 */
export function syncAway(s: GameState, marches: MarchView[], figures: FigureView[] = []): boolean {
  const warriors = awayMen(awayOf(marches, figures));
  let scouts = 0;
  let heroSeen = false;
  for (const m of marches) {
    if (!m.own) continue;
    scouts += m.units.scout ?? 0;
    if (s.hero.marchId === m.id) heroSeen = true;
  }
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
    bonded: e.bonded ?? 0,
    // Какие постройки взятого города теряют уровень: список выбран в минуту
    // события, племя его только применяет.
    fallen: e.fallen,
    text: e.text,
    kind: e.good ? 'good' : 'bad',
  };
}

export function applyEffects(s: GameState, effects: HomeEffect[]): void {
  for (const e of effects) applyExpedition(s, toOutcome(e));
}
