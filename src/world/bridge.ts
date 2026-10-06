// Единственное место, где мир и племя знают друг о друге.
//
// Мир получает отсюда слепок деревни (сколько людей, чем обороняется, что можно
// унести) и отдаёт сюда последствия походов. Дальше вниз связи нет: симуляция
// племени не знает про координаты, а мир — про жителей и склад.
import type { GameState } from '@/game/types';
import { RESOURCE_IDS } from '@/game/constants';
import { gameDaysPerHour, gameSecondsOfMs } from '@/game/pace';
import {
  bondedTotal,
  buildingOfType,
  buildingStat,
  defense,
  hiddenStash,
  homeArmyPower,
  faithOf,
  fervour,
  intelKeen,
  mastersFoodPerDay,
  soldierFoodPerDay,
  surveyRadius,
  towerSeats,
  townFoodPerDay,
  warningSeconds,
} from '@/game/derived';
import { BATTLE_MAN } from '@/game/battle/kinds';
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import {
  applyExpedition,
  fallPool,
  sendableUnits,
  setAway,
  type ExpeditionOutcome,
} from '@/game/sim/expedition';
import { pipsOf, retiring, sightBonusOf, stealthOf, traitNumbers, veilOf } from '@/game/sim/agents';
import { readyEngine } from '@/game/sim/tower';
import { fateLocks } from '@/game/sim/tech';
import { syncFaith } from '@/game/sim/faith';
import { woundsHome } from '@/game/sim/infirmary';
import { dropGates, gateCalls, settleGate } from '@/game/sim/gate';
import { FIGURE_IDS } from './data/figures';
import { NOBODY_AWAY, awayOf, homeOf, type Away } from './muster';
import { profileCity } from '@/profile/identity';
import type {
  FigureView,
  HomeEffect,
  Loot,
  MarchView,
  PlayerProfile,
  SiegeView,
  WorldPulse,
} from './types';

/**
 * Сколько игровых дней укладывается в час реального времени. Осада живёт в
 * мировых часах, а расход еды племя считает за игровой день — перевод должен
 * быть один и стоять здесь, на самом мосту: мир про `DAY_LENGTH` не знает, а
 * племя про мировые часы.
 */
const daysPerHour = gameDaysPerHour;

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
 * Орудие башни для слепка — только готовое: сила и расчёт из таблицы орудий и места на
 * башне. Нет орудия — поля нет вовсе, и слепок деревни без башенного орудия тот же, что
 * до орудий, байт в байт. Кто из лучников на башне, мир решает сам: это лучники дома.
 */
function tower(s: GameState): Pick<PlayerProfile, 'tower'> {
  const engine = readyEngine(s);
  return engine ? { tower: { slow: engine.slow, thin: engine.thin, crew: engine.crew, seats: towerSeats(s) } } : {};
}

/** Прибавки навыков агентов для слепка: только ненулевые. */
function skills(s: GameState): Pick<PlayerProfile, 'pips' | 'sightBonus' | 'stealth' | 'veil'> {
  const out: Pick<PlayerProfile, 'pips' | 'sightBonus' | 'stealth' | 'veil'> = {};
  const pips = pipsOf(s);
  const sightBonus = sightBonusOf(s);
  const stealth = stealthOf(s);
  const veil = veilOf(s);
  if (Object.keys(pips).length > 0) out.pips = pips;
  if (sightBonus > 0) out.sightBonus = sightBonus;
  if (stealth > 0) out.stealth = stealth;
  if (veil < 1) out.veil = veil;
  return out;
}

/**
 * Замки гейта на участь для слепка — только если есть что запирать: партия, изучившая
 * ступень, везёт тот же слепок, что до гейта участи, байт в байт.
 */
function locksOut(s: GameState): Pick<PlayerProfile, 'fateLocks'> {
  const locks = fateLocks(s);
  return Object.keys(locks).length > 0 ? { fateLocks: locks } : {};
}

/** Вызовы к воротам для слепка — только если они есть: слепок без событий у ворот тот же, что до них. */
function gateOut(s: GameState): Pick<PlayerProfile, 'gate'> {
  const gate = gateCalls(s);
  return gate.length > 0 ? { gate } : {};
}

/** Черты агентов для слепка: множители, только если они есть. */
function traitsOut(s: GameState): Pick<PlayerProfile, 'traits'> {
  const traits = traitNumbers(s);
  return Object.keys(traits).length > 0 ? { traits } : {};
}

/**
 * Кто стоит на местах агентов — для мира: номер человека, пустует ли место, пора ли на
 * покой. Мир людей не знает и возраста не считает. Место с человеком номер ноль, не
 * пустое и не уходящее, не едет вовсе: слепок новой партии тот же, что до смертных.
 */
function people(s: GameState): Pick<PlayerProfile, 'agents'> {
  const out: NonNullable<PlayerProfile['agents']> = {};
  for (const id of FIGURE_IDS) {
    const p = s.agents[id];
    const row: { person: number; vacant?: true; retiring?: true } = { person: p.person };
    if (p.vacant) row.vacant = true;
    if (retiring(s, id)) row.retiring = true;
    if (row.person > 0 || row.vacant || row.retiring) out[id] = row;
  }
  return Object.keys(out).length > 0 ? { agents: out } : {};
}

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
  return {
    name: 'Наше племя',
    // Имя города — очищенное и с умолчанием: мир называет им дом на карте, в отчётах и в
    // письмах, и второго способа его узнать у мира нет.
    city: profileCity(s.profile),
    pop: s.pop,
    defense: defense(s),
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
    // `foodConsumptionPerDay`, которым племя живёт всегда. Наёмные мастера заперты в городе вместе
    // со всеми и едят из того же амбара — их паёк входит в расход города.
    food: Math.max(0, s.resources.food),
    foodPerHour: (townFoodPerDay(s) + mastersFoodPerDay(s)) * daysPerHour(),
    soldierFoodPerHour: soldierFoodPerDay(s) * daysPerHour(),
    // Дозор и конюшня: мир получает четыре числа и не спрашивает, откуда они.
    warning: warningSeconds(s),
    // Изученная округа: радиус земли, которую Дозор открыл навсегда. Живого
    // обзора он не даёт — открывает местность, и только.
    survey: surveyRadius(s),
    intelKeen: intelKeen(s),
    ...tower(s),
    // Статуя Героя: сколько дружины полководец уводит в поле.
    // Навыки агентов: три прибавки числами. Мир про уровни не знает, а кладёт
    // каждую туда, где у неё своя дверь, — и ни одна не та, которой владеет
    // здание: вместимость дружины остаётся у Статуи, шанс и старение — у Дозора.
    // Ноль не едет вовсе: слепок агентов первого уровня обязан быть тем же, что
    // до опыта, байт в байт, — он лежит в сохранении мира.
    ...skills(s),
    // Места агентов: кто на них и кому пора на покой. Мир ведёт фигуры, племя — людей.
    ...people(s),
    // Вставшие из лазарета раненые отряда полководца — счётчиком партии: мир вернёт их ему. Нуля нет — нет и поля.
    ...(troopTotal(s.risen ?? {}) > 0 ? { risen: { ...s.risen } } : {}),
    ...traitsOut(s),
    // Замки гейта на участь: какие участи игрок объявить не может — готовой строкой
    // двери гейта. Мир не знает ни ветвей, ни уровней, как не знает черт.
    ...locksOut(s),
    // Вера. В мир едут два числа и ни слова о храме: чем деревня верит — чтобы
    // сосед мог отнестись к ней прохладнее (`world/faith.faithAttitude`), — и
    // прибавка к стойкости от идущего обряда. Ни уклада, ни набожности, ни
    // реликвии мир не видит: это дела прихода, а не карты.
    faith: faithOf(s),
    fervour: fervour(s),
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
    // участи взятого города (`world/spoils.fate`): их уводят на ступени «увести
    // людей» и они разбегаются с пожарища. Где они стоят, миру знать не надо.
    bonded: bondedTotal(s),
    // Вызовы к воротам: бой волков и разбойников считает мир той же дверью, что бой у стены (docs/battle_eu4.md, 14.28).
    ...gateOut(s),
  };
}

/**
 * Кто сейчас не в обороне. Состав не хранится дважды: он выводится из списков
 * мира, поэтому потерянное сохранение мира не оставит деревню без армии навсегда.
 *
 * Бойцы считаются тем же правилом, каким мир считает оборону (`world/muster`):
 * отряды в пути и дружина в сборе, в пути, в поле и в лагере — не в гарнизоне и
 * не в обороне; дружина, собранная и стоящая у своих ворот, — в гарнизоне, один
 * раз.
 */
export function syncAway(s: GameState, marches: MarchView[], figures: FigureView[] = []): boolean {
  const troops = awayTroops(s.army, awayOf(marches, figures));
  let scouts = 0;
  for (const m of marches) {
    if (!m.own) continue;
    scouts += m.units.scout ?? 0;
  }
  if (s.scoutsAway === scouts && sameStack(s.away, troops)) return false;
  setAway(s, troops, scouts);
  return true;
}

/**
 * Кто не дома, по видам: всё войско минус гарнизон (`muster.homeOf`). Так отряд,
 * ушедший числом без состава, снимается со слабых ровно тем правилом, каким его
 * снимает гарнизон, и племя с миром не расходятся в том, кто стоит у частокола.
 */
export const awayTroops = (army: TroopStack, who: Away): TroopStack => troopsAfter(army, homeOf(army, who));

const sameStack = (a: TroopStack, b: TroopStack): boolean => TROOP_IDS.every((id) => (a[id] ?? 0) === (b[id] ?? 0));

/**
 * Осада из мира в племя. Мир её кладёт и снимает; племя при игроке своего срока
 * не сверяет — осада идёт, пока поле лежит (`derived.underSiege`).
 *
 * Срок голода едет рядом, переведённым в игровое время, и нужен ровно одному
 * читателю — офлайн-догону, у которого мира нет (`sim/tick`). Переводится
 * **остаток**, а не отметка: `starvesAt` — мировые миллисекунды, и положить их в
 * состояние племени значило бы, что догон сравнивает секунды партии с часами
 * устройства. Остаток же одинаков в обеих шкалах — игровая секунда идёт ровно
 * секунду.
 *
 * Возвращает `true`, если что-то изменилось: пульс идёт часто (`PULSE_MS` в `world/store.ts`), и
 * перерисовывать по нему экран без причины не за что.
 */
export function syncSiege(s: GameState, view: SiegeView | null, now: number): boolean {
  if (!view) {
    if (s.siege === null) return false;
    s.siege = null;
    return true;
  }
  // Срок голода мир называет настоящими миллисекундами, догон племени идёт игровыми секундами.
  const until = s.time + gameSecondsOfMs(Math.max(0, view.starvesAt - now));
  const same = s.siege !== null && s.siege.byName === view.byName && Math.abs(s.siege.until - until) < 1;
  if (same) return false;
  s.siege = { byName: view.byName, until };
  return true;
}

/**
 * Пора ли раненым, лежащим при полководце, ложиться в лазарет (docs/infirmary.md, решение 6): дружина
 * стоит у своих ворот — или её в поле больше нет (полководец погиб, разбит, места нет), и везти их
 * дальше некому. Срок у них идёт с этой минуты.
 */
export function fieldWoundedHome(figures: readonly FigureView[], now: number): boolean {
  const g = figures.find((f) => f.id === 'general');
  return !g || g.gone !== null || g.downUntil > now || g.atHome;
}

/** Перевод мирового последствия в понятный племени итог. */
export function toOutcome(e: HomeEffect): ExpeditionOutcome {
  return {
    warriorsLost: e.lost.warrior ?? 0,
    // Бой знает, кто именно погиб: списывать надо тех же, а не «слабых первыми».
    troopsLost: e.lostTroops,
    // Где пали и ранены ли: бой в поле кладёт раненых при полководце, рассеянные не ранены.
    field: e.field,
    // Чья доля павших дома — отряд полководца: его раненые встанут его бойцами (docs/retinue.md).
    standing: e.standing,
    routed: e.routed ?? false,
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
    castle: e.castle ?? false,
    bonded: e.bonded ?? 0,
    // Горожане взятого города и сгоревшие стройки: числа и отметку решила дверь
    // участи, племя только снимает.
    popLost: e.popLost ?? 0,
    burned: e.burned ?? false,
    // Какие постройки взятого города теряют уровень: список выбран в минуту
    // события, племя его только применяет.
    fallen: e.fallen,
    // Дело и гибель агента: опыт пишет племя, мир только сообщает событие.
    deed: e.deed,
    fell: e.fell,
    retired: e.retired,
    text: e.text,
    kind: e.good ? 'good' : 'bad',
  };
}

export function applyEffects(s: GameState, effects: HomeEffect[]): void {
  for (const e of effects) applyExpedition(s, toOutcome(e));
}

/** Племя, с которым пульсует мир: откуда читать и как менять. */
export interface PulseTribe {
  get(): GameState;
  /**
   * Как менять состояние. Игра меняет его через стор (`useGame.world`), и стор подменяет объект
   * копией, — поэтому всё, что пульс пишет в племя, пишется **одной** правкой по свежему объекту.
   */
  apply(change: (s: GameState) => void): void;
}

/** Крючки прибора: отчёт смотрит на пульс, но пульс от этого не меняется. */
export interface PulseHooks {
  /** Слепок перед отправкой в мир: отчёт может подменить в нём число. */
  profile?: (p: PlayerProfile, away: Away) => void;
  /** Последствие до того, как оно легло в племя. */
  before?: (e: HomeEffect, now: number) => void;
  /** Последствие после того, как легло. */
  after?: (e: HomeEffect, s: GameState) => void;
}

/**
 * Пульс племени — одна дверь на игру (`world/store`) и на автопилот отчётов (`scripts/autopilot.ts`):
 * слепок → мир → последствия → кто не дома → осада → вера. Порядок и состав шагов у них не могут
 * разойтись, потому что это один код. Пока кода было два, они разошлись: автопилот не брал веру,
 * которую мир называет пульсом (docs/defense_mix.md, раздел 6), и мерил деревню без неё.
 *
 * Последствия ложатся раньше, чем пересчитываются ушедшие: в минуту прихода отряда его люди ещё
 * числятся в походе (см. `applyExpedition` и `syncAway`). Всё, что пульс пишет в племя, пишется одной правкой (`PulseTribe.apply`): прежде
 * стор применял последствия через `useGame.world`, который подменяет объект состояния копией, а
 * ушедших и осаду писал полями старого объекта — и в пульсе с последствиями они терялись до
 * следующего пульса (вера лежит во вложенном объекте, общем у копии, и не терялась).
 *
 * `last` — списки мира с прошлого пульса: по ним подрезается расстановка обороны в слепке.
 */
export async function tribePulse(
  world: { sync(profile: PlayerProfile): Promise<WorldPulse> },
  tribe: PulseTribe,
  last: { marches: MarchView[]; figures: FigureView[] },
  hooks: PulseHooks = {},
): Promise<WorldPulse> {
  const away = awayOf(last.marches, last.figures);
  const profile = playerProfile(tribe.get(), away);
  hooks.profile?.(profile, away);
  const pulse = await world.sync(profile);
  tribe.apply((s) => {
    for (const e of pulse.effects) {
      hooks.before?.(e, pulse.now);
      applyEffects(s, [e]);
      // Бой у ворот по событию: при победе — трофеи события.
      if (e.gate) settleGate(s, e);
      hooks.after?.(e, s);
    }
    // Посчитанные вызовы снимаются по списку мира — и сегодняшние, и те, чьё последствие до партии не дошло.
    dropGates(s, pulse.gateDone);
    // Раненые при полководце ложатся в лазарет, когда дружина вернулась к воротам.
    if ((s.wounded ?? []).some((g) => g.until === null) && fieldWoundedHome(pulse.figures, pulse.now)) woundsHome(s);
    syncAway(s, pulse.marches, pulse.figures);
    syncSiege(s, pulse.siege, pulse.now);
    // Вера земли под замком и чужая вера вокруг. Первый ответ мира ставит веру новой партии — до
    // него храм честно говорит, что грамоты из округи ещё не пришли, и подставлять католичество
    // «пока не знаем» нельзя: деревня под Вильнюсом сменила бы веру молча.
    syncFaith(s, pulse.faith.id, pulse.faith.pressure);
  });
  return pulse;
}
