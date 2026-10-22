// Последствия походов для племени. Мир считает исход боя сам; сюда приезжает
// готовый итог, и племя применяет его к себе. Про карту, соседей и координаты
// эта сторона по-прежнему ничего не знает.
import type { BuildingTypeId, EquipmentId, GameState, LogEntry, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID, jobsOf } from '../data/buildings';
import { YARD_BY_JOB } from '../data/yards';
import { keptType } from '../merged';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import {
  buildingOfType,
  buildingTitle,
  deedHands,
  homeArmy,
  idleCount,
  isOutsideWall,
  isSite,
  storageCap,
} from '../derived';
import { removeSoldiers } from './army';
import { TROOP_IDS } from '../data/troops';
import type { TroopStack } from '../battle/kinds';
import { ORDER_TEXT } from '../data/order';
import { addBonded, addPop, loseBonded, losePop } from './population';
import { log, tagSince } from './log';
import { woundLine, woundsOfBattle } from './infirmary';
import { recordDeath, recordDeed, recordRetire, recordSiege, reputeMorale, type Deed } from './agents';
import { hireWhere } from './hire';
import type { HomeEffect } from '@/world/types';
import { loseRelic } from './faith';
import { outlay } from './pay';
import { stabAfterBattle } from './stability';
import { recordBattle, recordLairBurned, recordLoot, recordRaidLoss, recordTroopsLost } from '@/profile/stats';
import { count } from '@/ui/parts/plural';

/** Что случилось с деревней, пока отряд был в пути. */
export interface ExpeditionOutcome {
  /** Погибшие воины и разведчики. */
  warriorsLost: number;
  scoutsLost: number;
  /**
   * Кто именно не вернулся. Бой считает по составу отряда, поэтому потери
   * приходят поимённо по видам, а не одним числом: иначе поход из латников
   * списывал бы дубинщиков, оставшихся дома.
   */
  troopsLost?: TroopStack;
  /** Сколько из `troopsLost` пало при полководце в поле: их раненые лягут, когда дружина вернётся. */
  field?: TroopStack;
  /** Сколько из `troopsLost` дома было отрядом полководца: их раненые встанут его бойцами (docs/retinue.md). */
  standing?: TroopStack;
  /** Потери рассеяны, а не ранены: падение голодом, разгром полководца. Раненых нет. */
  routed?: boolean;
  /** Плюс — привезли добычу, минус — унесли у нас. */
  resources: Partial<Record<ResourceId, number>>;
  /**
   * Сколько людей прибавилось в племени. Только плюс, и своей строки в летописи
   * у него нет: единственный источник — выкуп пленных, а про него сказано в
   * тексте самого последствия.
   */
  pop?: number;
  /** Золото из чужой казны. Вместимость склада на него не действует. */
  gold: number;
  prestige: number;
  morale: number;
  /** Для статистики племени: только настоящие бои. */
  battle: 'won' | 'lost' | null;
  /**
   * Насколько плохо кончился бой у стены, 0..1. Больше нуля — чужие хозяйничали
   * в поле: см. `sackOutskirts`. Ноль — набега не было или его отбили.
   */
  sacked?: number;
  /**
   * Сколько оружия взято в логове, штук. Мир отдаёт число, а какие это будут
   * предметы, решает племя (`ARMS_TROPHY`): про кузницу и её список мир не
   * знает и знать не должен — та же условность, что у `sacked`.
   */
  arms?: number;
  /** Логово сожжено этим походом: его считает профиль. */
  lair?: boolean;
  /** Взят замок: его считает профиль — отметкой, а не по золоту. */
  castle?: boolean;
  /**
   * Невольники: плюс — приведены из взятого города, минус — уведены из нашего или
   * разбежались с пожарища. Кого и сколько, решает мир одной дверью участи на обе
   * стороны (`world/spoils.fate`); племя только прибавляет или убавляет число.
   */
  bonded?: number;
  /**
   * Сколько горожан ушло из взятого города — уведены или разошлись. Мир решил число;
   * племя снимает его тем же порядком, что голод и мятеж (`losePop`), и последний
   * житель не уходит никогда.
   */
  popLost?: number;
  /** Город сожжён: улучшения в работе сгорают без возврата. Тайника это не касается. */
  burned?: boolean;
  /**
   * Город взят голодом: хлеба в нём не осталось — по окну осады, которое решило исход (docs/siege_v2.md, 21.1). Склад
   * племени мог держать больше: офлайн-догон не знал об осаде, начатой без игрока. Остаток списывается — съеден.
   */
  starved?: boolean;
  /**
   * Наш город взят: на какие постройки пришёлся удар и с какого уровня на
   * какой. Выбрал их мир одной дверью участи (`world/spoils.fate`) в минуту
   * события; племя ничего не выбирает, а только снимает уровни (`fallBuildings`).
   * `id` — тип постройки.
   */
  fallen?: { id: string; from: number; to: number }[];
  /** Дело агента карты: опыт запишет `sim/agents.recordDeed`. */
  deed?: Deed;
  /** Наш лагерь довёл осаду до конца: опыт осад полководца (`sim/agents.recordSiege`). */
  siege?: boolean;
  /** Агент карты погиб: `sim/agents.recordDeath`. Строка прежнего вида (до смертных агентов) не читается. */
  fell?: HomeEffect['fell'] | string;
  /** Агент карты ушёл на покой: `sim/agents.recordRetire`. */
  retired?: HomeEffect['retired'];
  /** Строка летописи. Пустая — у последствия нет события, только дело агента. */
  text: string;
  /** Ключ последствия мира (`HomeEffect.id`): им метятся все строки летописи этого последствия (`tagSince`). */
  ref?: string;
  kind: LogEntry['kind'];
}

/**
 * Какие постройки не теряют уровня при взятии города. Тайник — и это решение,
 * а не недосмотр: у него нет дела, кроме поражения. Обесценься он ровно в ту
 * минуту, когда нужен, — его незачем было бы строить. По той же причине он не
 * горит при сожжении (docs/DEFEAT_LADDER.md).
 */
export const FALL_SPARED: BuildingTypeId[] = ['cache'];

/**
 * Какие постройки может задеть падение города — все, кроме `FALL_SPARED`, с их
 * уровнями. Список уезжает в мир слепком (`PlayerProfile.levels`), и мир
 * выбирает из него, не зная, что это за постройки.
 */
export function fallPool(s: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of s.buildings) if (!FALL_SPARED.includes(b.type)) out[b.type] = b.level;
  return out;
}

/**
 * Сжигает улучшения в работе: заплачено вперёд, построено не было, возврата нет.
 * Тайник не горит — ни уровнем, ни стройкой (`FALL_SPARED`). Возвращает, что сгорело.
 */
export function burnWorks(s: GameState): BuildingTypeId[] {
  const out: BuildingTypeId[] = [];
  for (const b of s.buildings) {
    if (FALL_SPARED.includes(b.type) || !isSite(b)) continue;
    b.work = 0;
    b.workRequired = 0;
    out.push(b.type);
  }
  return out;
}

/** Постройка, на деле потерявшая уровень, — для летописи и отчёта. */
export interface LevelLoss {
  type: BuildingTypeId;
  from: number;
  to: number;
}

/**
 * Снимает уровни, выбранные дверью участи. Каждой выбранной постройке — ровно
 * столько, сколько сказано (`from − to`), от её нынешнего уровня и не ниже
 * первого: сносить здание нельзя, зданий по одному. `FALL_SPARED` проверяется и
 * здесь, а не только в списке для мира: старый слепок в сохранении мира мог
 * уехать без него.
 *
 * Улучшение, шедшее на такой постройке, не отменяется: оно закончится на
 * уровень ниже, чем было заказано, — заплачено было вперёд.
 */
export function fallBuildings(s: GameState, fallen: { id: string; from: number; to: number }[]): LevelLoss[] {
  const out: LevelLoss[] = [];
  for (const f of fallen) {
    // Участь, выбранная до объединения дворов (ЗД-1), может назвать прежнюю постройку — уровень теряет её двор.
    const type = keptType(f.id);
    if (!type || FALL_SPARED.includes(type)) continue;
    const b = buildingOfType(s, type);
    const drop = Math.max(0, Math.floor(f.from - f.to));
    if (!b || drop <= 0) continue;
    const from = b.level;
    b.level = Math.max(1, b.level - drop);
    if (b.level < from) out.push({ type, from, to: b.level });
  }
  return out;
}

/**
 * Список словами — один на летопись и на отчёт: «Кузница 6 → 5, Склад 4 → 3».
 * `struck` — на сколько построек пришёлся удар: те, что стоят на первом уровне,
 * названы числом, а не опущены молча, иначе «пять построек» в правиле и три в
 * списке читались бы как ошибка.
 */
export function levelLossText(s: GameState, lost: LevelLoss[], struck = lost.length): string {
  const names = lost.map((l) => `${buildingTitle(s, l.type)} ${l.from} → ${l.to}`).join(', ');
  const floor = Math.max(0, struck - lost.length);
  if (floor === 0) return names;
  const rest = `${floor} ${floor === 1 ? 'стоит' : 'стоят'} на ур. 1, ниже некуда`;
  return names ? `${names}; ещё ${rest}` : `все ${rest}`;
}

/** То, что уехало в отчёт мира (`Report.fallen`), — теми же словами, что в летописи. */
export function fallenText(s: GameState, fallen: { id: string; from: number; to: number }[]): string {
  const lost: LevelLoss[] = fallen
    .filter((f) => f.to < f.from && keptType(f.id) !== null)
    .map((f) => ({ type: keptType(f.id)!, from: f.from, to: f.to }));
  return levelLossText(s, lost, fallen.length);
}

/**
 * Во что превращается взятое в логове оружие. Разбойничье снаряжение простое:
 * мечей и доспехов у них не водится — за ними в кузницу. Порядок — порядок
 * раздачи: остаток от деления достаётся первым в списке, ровно так же, как мир
 * делит добычу между ресурсами.
 */
export const ARMS_TROPHY: EquipmentId[] = ['spear', 'bow', 'axe', 'shield'];

/**
 * Раскладывает взятое оружие по видам. Вместимость склада на снаряжение не
 * действует, поэтому обрезать тут нечего: полный склад не должен молча съедать
 * трофей — по той же причине, по которой он не останавливает кузницу.
 */
export function takeArms(s: GameState, arms: number): Partial<Record<EquipmentId, number>> {
  const total = Math.max(0, Math.round(arms));
  if (total <= 0) return {};
  const out: Partial<Record<EquipmentId, number>> = {};
  const per = Math.floor(total / ARMS_TROPHY.length);
  let rest = total - per * ARMS_TROPHY.length;
  for (const id of ARMS_TROPHY) {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    const n = per + extra;
    if (n <= 0) continue;
    out[id] = n;
    s.equipment[id] = Math.max(0, (s.equipment[id] ?? 0) + n);
  }
  return out;
}

/**
 * Что набег делает с хозяйством за стеной.
 *
 * Стена защищает ровно то, что за ней: до жилья, склада, кузницы и казарм чужие
 * не доходят никогда, до дворов в поле — всегда, если прорвались. В этом и смысл
 * укреплений помимо кражи со склада, и цена того, что производство вынесено
 * наружу. Что именно стоит снаружи, знает `isOutsideWall`, а не план поселения.
 *
 * Разор устроен так: работники разбегаются по всем разорённым делам дворов — дело стоит, пока игрок не вернёт туда
 * людей. Бьёт набег **по делам, а не по зданиям** (ЗД-1): поле и загон — два двора работы, как были два прежних здания,
 * и от объединения в одну Ферму разор не стал ни шире, ни уже. Уровней набег здесь не снимает: у
 * падения уровней один источник — участь взятого города (`fallBuildings`), а
 * разбежавшиеся работники — последствие боя у стены, а не участи.
 */
export function sackOutskirts(s: GameState, severity: number): string[] {
  const hurt = Math.max(0, Math.min(1, severity));
  if (hurt <= 0) return [];
  // Дел трогается от одного до трёх — по тому, насколько плохо кончился бой.
  const count = 1 + Math.floor(hurt * 2.99);
  // Цель выбирается не случайно: чужие идут туда, где людно, — там и добро,
  // и работа. При равенстве вперёд идёт двор постарше. Людно — это все руки на
  // местах: невольники в поле стоят там же, где вольные.
  const deeds = s.buildings
    .filter((b) => isOutsideWall(b.type))
    .flatMap((b) => jobsOf(b.type).map((job) => ({ b, job })))
    .sort((x, y) => deedHands(s, y.job) - deedHands(s, x.job) || y.b.level - x.b.level);

  const names: string[] = [];
  for (const { b, job } of deeds.slice(0, count)) {
    if (deedHands(s, job) === 0) continue;
    delete s.workers[job];
    // Невольников набег не уводит — уводит их только ступень участи, уводящая
    // людей. С места их сгоняет так же, как вольных: дело стоит, пока их не вернут.
    delete s.bondedWork[job];
    const yard = YARD_BY_JOB.get(job);
    const name = BUILDING_BY_ID[b.type].name;
    names.push(jobsOf(b.type).length > 1 && yard ? `${name}: ${yard.deed.toLowerCase()}` : name);
  }
  return names;
}

/**
 * Кого можно отправить прямо сейчас: бойцы из армии и свободные жители под разведку.
 * Отдельной профессии «воин» больше нет — армия живёт счётчиками в s.army.
 */
export function sendableUnits(s: GameState): { warrior: number; scout: number } {
  return {
    warrior: homeArmy(s),
    scout: Math.max(0, idleCount(s) - Math.max(0, s.scoutsAway)),
  };
}

/** Кто из войска и сколько разведчиков числится не дома. Считается миром и переставляется целиком. */
export function setAway(s: GameState, away: TroopStack, scouts: number): void {
  s.away = { ...away };
  s.scoutsAway = Math.max(0, Math.round(scouts));
}

/** Убирает не вернувшихся разведчиков. Племя не вымирает целиком из-за разведки. */
function takeFallenScouts(s: GameState, n: number): number {
  return losePop(s, Math.min(Math.max(0, n), Math.max(0, s.pop - 1)));
}

/**
 * Применяет итог похода: погибшие, добыча или потери склада, слава и мораль.
 * Ушедших в поход пересчитывает мир — здесь их число не трогаем.
 */
export function applyExpedition(s: GameState, o: ExpeditionOutcome): void {
  // Отметка летописи до последствия: всё, что ляжет выше неё, — строки этого события (ВС-2).
  const head = s.log[0];
  // Бойцы гибнут по составу отряда; если состава нет (старый поход) — слабые первыми.
  const before = { ...s.army };
  let soldiersLost = 0;
  if (o.troopsLost) {
    for (const id of TROOP_IDS) {
      const n = Math.min(Math.max(0, s.army[id] ?? 0), Math.max(0, o.troopsLost[id] ?? 0));
      if (n > 0) {
        s.army[id] -= n;
        soldiersLost += n;
      }
    }
  }
  if (soldiersLost === 0) soldiersLost = removeSoldiers(s, o.warriorsLost);
  const lost: TroopStack = {};
  for (const id of TROOP_IDS) if ((before[id] ?? 0) > (s.army[id] ?? 0)) lost[id] = (before[id] ?? 0) - (s.army[id] ?? 0);
  const fallen = takeFallenScouts(s, o.scoutsLost);

  // Лазарет: доля павших ранена и встанет в строй тем же бойцом (`sim/infirmary`). Разведчики —
  // не бойцы строя, и рассеянные не ранены: они погибшими и записываются.
  const care = woundsOfBattle(s, lost, o.field, o.routed ?? false, o.standing);
  s.stats.died += Math.max(0, soldiersLost + fallen - care.laid - care.carried);
  recordTroopsLost(s, soldiersLost);

  const cap = storageCap(s);
  // Плюс — привезли своё, минус — унесли у нас. Профиль считает и то, и другое:
  // привезённое итогом, унесённое по ресурсам — на вопрос «что утекает» итог
  // не отвечает.
  const brought: Partial<Record<ResourceId, number>> = {};
  const taken: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_IDS) {
    const n = o.resources[r];
    if (!n) continue;
    const before = s.resources[r];
    s.resources[r] = Math.max(0, Math.min(cap, s.resources[r] + n));
    const delta = s.resources[r] - before;
    if (delta > 0) brought[r] = delta;
    else if (delta < 0) taken[r] = -delta;
  }
  recordRaidLoss(s, taken);
  // Взят голодом — хлеб съеден до крошки: в обоз он не лёг (добычу посчитал мир без него), со склада он ушёл осадой.
  const eaten = o.starved ? Math.max(0, s.resources.food) : 0;
  if (eaten > 0) s.resources.food = 0;

  // Выкупленные пленные возвращаются в племя людьми, а не в строй: боец
  // потерян, снаряжение потрачено, человек жив — то же правило, что у лазарета.
  if (o.pop && o.pop > 0) addPop(s, Math.round(o.pop));
  // Невольники из павшего города — и уведённые из нашего. Число решил мир.
  const bondedIn = o.bonded && o.bonded > 0 ? addBonded(s, o.bonded) : 0;
  const bondedOut = o.bonded && o.bonded < 0 ? loseBonded(s, -o.bonded) : 0;
  // Горожане взятого города: уведены или разошлись. Последний житель остаётся.
  const popOut = o.popLost && o.popLost > 0 ? losePop(s, Math.min(Math.round(o.popLost), Math.max(0, s.pop - 1))) : 0;
  if (o.gold) s.gold = Math.max(0, s.gold + o.gold);
  const arms = takeArms(s, o.arms ?? 0);
  recordLoot(s, brought, Math.max(0, o.gold));
  // Сожжённое логово считается само по себе, а не по добыче: пустое логово тоже
  // сожжено, и победа над ним стоила того же похода.
  if (o.lair) recordLairBurned(s);
  // Замок считается отметкой мира, а не по золоту: золото везут и из логова.
  if (o.castle) s.stats.castles = (s.stats.castles ?? 0) + 1;
  if (o.prestige) s.prestige = Math.max(0, s.prestige + o.prestige);
  // Слава полководца ложится на мораль исхода боя: победы «Победоносного» радуют
  // сильнее, поражения «Битого» горше. Считается по чертам до этого боя — поэтому
  // до того, как дело попадёт в счёт.
  const repute = o.deed ? reputeMorale(s, o.deed) : 0;
  if (o.morale || repute) s.morale = Math.max(0, Math.min(100, s.morale + o.morale + repute));
  if (o.battle === 'won') recordBattle(s, 'won');
  if (o.battle === 'lost') recordBattle(s, 'lost');
  // Бой и падение двигают стабильность одной дверью (docs/stability.md, 2.2): бой — сдвигом мерой его морали, павший город —
  // ступенью вниз.
  stabAfterBattle(s, { battle: o.battle, morale: o.morale, fallen: o.fallen });
  // Добро без дела: последствие положило добро, а ни боя, ни логова, ни замка — счётчиков дел этой двери — в нём нет
  // (дань по договору, кража лазутчика). Оно — разовое дело описи (`stats.windfalls`): иначе рост склада сервер счёл бы
  // флагом (docs/security.md, раздел 8). С боем, логовом или замком дело уже засчитано, второй раз его не считают.
  const counted = !!o.battle || o.lair || o.castle;
  if (!counted && (Object.keys(brought).length > 0 || o.gold > 0)) s.stats.windfalls = (s.stats.windfalls ?? 0) + 1;
  // Убыль без дела — дань, починка пролома, кража у нас: разовая трата (`sim/pay.outlay`), иначе книга запасов сервера
  // сочла бы её спрятанным добром (docs/security.md, ЗЩ-2).
  if (!counted && (Object.keys(taken).length > 0 || o.gold < 0 || eaten > 0)) outlay(s);

  // Прорвавшийся набег хозяйничает в поле: до того, что за стеной, он не дошёл.
  const sacked = o.sacked ? sackOutskirts(s, o.sacked) : [];
  // Город сожжён: сперва сгорает то, что строилось, — потом падают уровни.
  const burnedWorks = o.burned ? burnWorks(s) : [];
  // Город взят: постройки теряют уровни, которые выбрала дверь участи.
  const levelsLost = o.fallen ? fallBuildings(s, o.fallen) : [];
  // Реликвию уносят вместе с остальным: она вещь, а не обещание, и цена ей —
  // ровно та, что её можно потерять. Тайник её не прячет: святыню держат в
  // храме на виду, иначе она не значила бы для прихода ничего.
  const relicLost = o.sacked ? loseRelic(s) : null;

  if (o.text) log(s, o.text, o.kind);
  // Дело — сразу после строки события: уровень, взятый боем, стоит рядом с самим боем.
  // Павшие и сожжённое логово едут в счёт дел вместе с делом: из них выводятся черты.
  if (o.deed) recordDeed(s, { ...o.deed, lost: o.warriorsLost, lair: o.lair });
  // Осада, доведённая до конца нашим лагерем, — опыт осад полководца (отметка «осада», этап 2е).
  if (o.siege) recordSiege(s);
  // Весть о гибели — объектом с номером человека. Строкой её слал мир до смертных
  // агентов, и значила она «выбыл на `FIGURE_DOWN`»: убивать по ней нельзя.
  if (o.fell && typeof o.fell === 'object') recordDeath(s, o.fell, (a) => hireWhere(s, a));
  if (o.retired) recordRetire(s, o.retired, (a) => hireWhere(s, a));
  if (sacked.length > 0) {
    log(s, `За стеной разорили: ${sacked.join(', ')}. Работники разбежались.`, 'bad');
  }
  if (relicLost) log(s, `${relicLost} унесли из храма. Приход осиротел.`, 'bad');
  if (bondedOut > 0) log(s, ORDER_TEXT.ledAway(bondedOut), 'bad');
  if (bondedIn > 0) log(s, ORDER_TEXT.broughtIn(bondedIn), 'info');
  if (popOut > 0) log(s, `Жителей стало меньше на ${popOut}.`, 'bad');
  if (burnedWorks.length > 0) {
    log(s, `Сгорело недостроенное: ${burnedWorks.map((t) => buildingTitle(s, t)).join(', ')}. Заплаченное не вернуть.`, 'bad');
  }
  if (o.fallen && o.fallen.length > 0) {
    log(s, `Постройки потеряли уровни: ${levelLossText(s, levelsLost, o.fallen.length)}.`, 'bad');
  }
  if (o.gold > 0) log(s, `Золота прибыло: ${Math.round(o.gold)}.`, 'good');
  if (o.gold < 0) log(s, `Золота унесли: ${Math.round(-o.gold)}.`, 'bad');
  const armsText = Object.entries(arms)
    .map(([id, n]) => `${EQUIPMENT_BY_ID[id as EquipmentId].name.toLowerCase()} ${n}`)
    .join(', ');
  if (armsText) log(s, `Из логова принесли снаряжение: ${armsText}.`, 'good');
  if (soldiersLost > 0) log(s, `Не вернулись из похода: ${count(soldiersLost, 'боец', 'бойца', 'бойцов')}.`, 'bad');
  if (fallen > 0) log(s, `Не вернулись из разведки: ${fallen}.`, 'bad');
  if (care.laid + care.carried + care.noBed > 0) log(s, woundLine(care), care.noBed > 0 ? 'bad' : 'info');
  if (o.ref) tagSince(s, head, o.ref);
}
