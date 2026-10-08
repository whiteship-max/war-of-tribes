// Случайные события. Все числа здесь считаются от размера посёлка, а не пишутся
// константами: население доходит до сотен, и «+25 еды» или «пришёл один чужак»
// к середине партии перестают что-либо значить.
//
// Люди приходят и уходят толпой. Поимённых жителей в игре нет, поэтому событие
// про человека — это событие про группу: беженцы у ворот, бродячая артель, мор.
import type { GameState, ResourceId } from '../types';
import {
  DAY_LENGTH,
  FAITH_REFUSAL_STRAIN,
  MUTINY_SUPPRESS_MORALE,
  PIETY_RELIC,
  RESOURCE_IDS,
  RESOURCE_META,
  RITE_DAYS,
  RITE_MORALE,
} from '../constants';
import {
  buildingOfType,
  currentSite,
  dayOf,
  faithDef,
  faithOf,
  foodConsumptionPerDay,
  heresy,
  housingCapacity,
  isSite,
  jobCounts,
  mutinyForecast,
  seasonOf,
  strainNow,
} from '../derived';
import { callGate } from '../sim/gate';
import { troopPower } from '../battle/price';
import { menOfPower } from '@/world/garrison';
import { weakCity } from '@/world/lairs';
import type { GateFoe } from '@/world/types';
import { addStrain, beginRite, grantRelic, riteInfo } from '../sim/faith';
import { mutinyPay, mutinyRelease, mutinySuppress } from '../sim/mutiny';
import { addPop, killPop } from '../sim/population';
import { chance, roll } from '../sim/roll';
import { log } from '../sim/log';
import { MUTINY_EVENT, ORDER_TEXT } from './order';
import { daysSpan } from '../span';
import { addRes, amount, crowd, FameWord, fameWord, moraleWord, MoraleWord, moveFame, moveMorale, people } from './eventKit';
import { CHAIN_SEASONS, TIDING, TIDINGS } from './tidings';
import { BOON_BY_ID, boonWords } from './boons';
import { SEASON_DAYS } from './seasons';
import { grantBoon } from '../sim/boons';
import { scheduleChain } from '../sim/chains';

/** Что вариант просит отдать. Золото — не ресурс, но плата бывает и в нём. */
export type EventCost = Partial<Record<ResourceId | 'gold', number>>;

export interface EventOption {
  label: string;
  hint?: string | ((s: GameState) => string);
  /**
   * Что вариант просит отдать. Считается от размера посёлка, как и всё
   * остальное в событии.
   *
   * Цена вынесена из `apply` в отдельное поле нарочно, и причина не в
   * аккуратности. Пока она жила строкой внутри `apply`, игрок узнавал её
   * из подписи, написанной руками, — то есть из второго места, которое
   * расходится с первым при первой же правке. Хуже: узнать, **хватает ли**,
   * было неоткуда. Окно события закрывает и склад, и всю игру, отложить его
   * нельзя, — и «отдать припасы» приходилось нажимать вслепую.
   *
   * Теперь цена одна на три дела: её показывает `Cost` («нужно / из»), по ней
   * гаснет кнопка, и по ней же списывается добро в `resolveEvent`. `apply`
   * получает состояние уже оплаченным и о цене не знает.
   */
  cost?: (s: GameState) => EventCost;
  /** Применяет выбор и возвращает текст результата. */
  apply: (s: GameState) => string;
}

export interface EventDef {
  id: string;
  icon: string;
  title: string;
  text: string | ((s: GameState) => string);
  options: EventOption[];
  /** Вес выбора (0 — событие сейчас невозможно). */
  weight: (s: GameState) => number;
  /** Чем подписан срок донесения вместо общего «Ждёт ответа» — слова о том, что случится без ответа. */
  waits?: string;
  /**
   * Какой вариант случается, если игрок не ответил. Событие ждёт в почте
   * державы (docs/realm.md, раздел 2.5), и молчание у него — такой же исход,
   * как ответ: называет его само событие, а не список исключений рядом.
   *
   * Правило выбора одно: это вариант «никто ничего не решил» — беженцев не
   * пустили, с волками бились те, кто был у ворот, пожар не тушили всем
   * племенем. Он обязан ничего не стоить: молчание не платит со склада. Держит
   * это тест (`sim/mail.test.ts`).
   */
  silence: number;
}

// Размер посёлка, толпа, склад, мораль и слава словами — общие помощники вестей (`data/eventKit.ts`).

/**
 * Сила случайного противника у ворот — по уровню посёлка, таблицей (слово владельца по 14.35, пп. 4 и 6): для типичного
 * гарнизона уровня L ровный бой — сила пришедших, при которой они берут верх в половине боёв, — делённый на перевес
 * «Ограничителя» 1.1. Типичный гарнизон уровня (слово владельца 30.09.2026) — гарнизон обоих игроков спора за золото,
 * «по умолчанию» и «вложился в админветвь» (`pop-gold.typicalTowns`: высокий налог, найм по средствам; оба — пачка 5,
 * docs/remeasure.md, шаг 0), в минуту, когда его жители доходят до жителей мерки уровня (`GATE_POP`), всё войско дома, вера —
 * его; ровный бой — медиана по двадцати четырём партиям: двенадцать потоков случайности у каждого. Типичный отбивается чаще,
 * сильный — ещё чаще, слабый — реже; масштаба под нашу силу нет, и стать сильнее имеет смысл. Числа — мощь пришедших уровней
 * 1…10, по строке на противника. **Руками их не правят:** их выводит и сверяет с этими `npm run raid-mix:report`, раздел 4б,
 * на нынешнем ядре боя. Партии мерки бьются у ворот с этой же таблицей, поэтому она — неподвижная точка: выводится заново, пока
 * выведенная не сойдётся с игровой (как сходится и где качается — docs/battle_eu4.md, 14.35, заход 30.09 (день), шаг 2); ядро
 * или шаг кости сдвинулись — выводится заново той же командой. Бьются пришедшие ядром боя у ворот той же дверью, что набег
 * (`sim/gate`, `LocalWorld.gateFight`; docs/battle_eu4.md, 14.28). Нынешние — пачка 5, пункт 2 (docs/remeasure.md): W 156,
 * шаг кости 0.0362, лазарет 10 мест на уровень, мерка на обоих игроках; четыре итерации, где строка качается — полусумма
 * (волки 1-го, 5-го и 10-го уровня); выведенная от записанной не дальше 1.7 %.
 */
export const GATE_POWER: Record<GateFoe, readonly number[]> = {
  wolves: [120, 197, 316, 461, 639, 1076, 1883, 2144, 2236, 2698],
  raiders: [201, 338, 505, 670, 806, 1116, 1342, 1544, 1730, 2009],
};

/**
 * Жители посёлка мерки уровней 1…10 — по ним уровень посёлка и читается (выводит и сверяет та же команда). Уровень — зрелость
 * жителями, войска в нём нет: иначе пришедшие росли бы вместе с нашим гарнизоном, и нанятое войско не значило бы ничего.
 * Прямая лестницы логов (`lairs.lairLevel`) здесь не годится: она сглаживает мерку, и посёлки мерки выходят на ней не своим
 * уровнем (раздел 4б печатает, каким), а бой у ворот круче ступени — кривая того же раздела переходит от почти ни одного
 * поражения к почти всем за четверть обороны, — и типичный гарнизон своего уровня встречал бы стаю не своей строки.
 */
export const GATE_POP: readonly number[] = [50, 104, 158, 212, 266, 356, 437, 518, 599, 680];

/**
 * Мощь пришедших к воротам: строка таблицы на жителях посёлка мерки своего уровня, между уровнями — прямой по жителям;
 * жителей меньше, чем у мерки 1-го уровня, — первая строка, больше, чем у 10-го, — десятая.
 */
export const gatePower = (s: GameState, foe: GateFoe): number => {
  const row = GATE_POWER[foe];
  const pop = s.pop;
  if (pop <= GATE_POP[0]) return row[0];
  const hi = GATE_POP.findIndex((p) => p >= pop);
  if (hi < 0) return row[row.length - 1];
  const lo = hi - 1;
  return row[lo] + ((row[hi] - row[lo]) * (pop - GATE_POP[lo])) / (GATE_POP[hi] - GATE_POP[lo]);
};

/** Сколько их придёт к воротам — мерой отрядов мира, которой бой их и выставит (`menOfPower`). */
export const gateMen = (s: GameState, foe: GateFoe): number => menOfPower(gatePower(s, foe));

/**
 * Слабый посёлок: логово его ещё не замечает — ни жителями, ни всем войском он не дорос до порога защиты слабого
 * (`lairs.weakCity`). Его угроза — волки; у разбойников защиты слабого нет (слово владельца по 14.35, п. 6).
 */
export const weakVillage = (s: GameState): boolean => weakCity(s.pop, troopPower(s.army));

/**
 * Выйти к воротам: вызов ложится в партию, бьётся мир на ближайшем пульсе, исход — отчётом в «Походы».
 * Трофеи победы решает событие здесь; мир про них не знает.
 */
const toGate = (s: GameState, foe: GateFoe, spoils: Partial<Record<ResourceId, number>>): string => {
  callGate(s, foe, gatePower(s, foe), spoils);
  return 'Гарнизон вышел к воротам. Исход придёт донесением.';
};

/** Сколько беженцев влезет под свободные крыши. Считают это двое: цена и сам выбор. */
const fitting = (s: GameState): number =>
  Math.min(crowd(s, 0.06, 8), Math.max(0, housingCapacity(s) - s.pop));

/**
 * Сколько мораль события прибавляет или отнимает — одно число на подпись ответа и на `apply` (правило 18; решение
 * владельца, docs/ui_audit.md, 14.4, вопрос 4). Числа те же, что прежде стояли в `apply` руками, — сменилось только то,
 * откуда подпись их берёт. Шкала морали — 0…100, от размера города она не зависит, поэтому `amount()` ей не нужен.
 */
export const EVENT_MORALE = {
  /** Беженцы: взять сколько поместится, а крыш нет. */
  refugeesNoRoom: -3,
  /** Беженцев прогнали. */
  refugeesTurnedAway: -4,
  /** Мор: служители обошли дворы. */
  sicknessPriests: 4,
  /** Мор: ничего не делали, и он унёс людей. */
  sicknessNeglect: -5,
  /** Раскол: проповедника разогнали силой. */
  preacherForce: -6,
  /** Раскол: пусть говорят. */
  preacherTalk: 4,
} as const;

/**
 * Сколько славы событие прибавляет или отнимает — одно число на подпись и на исход (правило 18), как `EVENT_MORALE`.
 * Числа те же, что прежде стояли в `apply` руками; подпись теперь называет их, а не «слава упадёт».
 */
export const EVENT_FAME = {
  /** Обмен с купцами состоялся. */
  trade: 1,
  /** Дань разбойникам. */
  raidersPaid: -2,
  /** Праздник прихода справили. */
  festival: 1,
  /** Дали Риму, сколько просили. */
  romeGave: 3,
} as const;

/** Какую долю стройки делает артель: осевшая — сразу, нанятая на день — за день (числа прежние, из `apply`). */
export const EVENT_WORK = { settle: 0.2, day: 0.35, storm: 0.5 } as const;

/** «+20%» — доля стройки словами. */
const share = (f: number): string => `+${Math.round(f * 100)}%`;

export const EVENTS: EventDef[] = [
  {
    id: 'refugees',
    silence: 2,
    icon: '🚶',
    title: 'Беженцы у ворот',
    text: (s) =>
      `С юга пришли ${people(crowd(s, 0.06, 8))}. Их дома сожгли, они просятся под нашу стену.`,
    // Когда селить некуда, толпа приходит реже: событие про выбор, а не про отказ.
    weight: (s) => (s.pop < housingCapacity(s) ? 3 : 1),
    options: [
      {
        label: 'Принять всех',
        hint: (s) => `+${people(crowd(s, 0.06, 8))}`,
        cost: (s) => ({ food: amount(s, 8) }),
        apply: (s) => {
          const n = crowd(s, 0.06, 8);
          addPop(s, n);
          s.stats.born += n;
          const over = s.pop - housingCapacity(s);
          log(s, `Приняли беженцев, ${people(n)}.`, 'good');
          return over > 0
            ? `Пришло ${people(n)}. Под крышей тесно, лишних ${over}. Мораль упадёт, пока всем не хватит крыш.`
            : `Пришло ${people(n)}. Все под крышей.`;
        },
      },
      {
        label: 'Взять, сколько поместится',
        hint: (s) => (fitting(s) > 0 ? `+${people(fitting(s))}` : `Свободных крыш нет, ${moraleWord(EVENT_MORALE.refugeesNoRoom)}`),
        // Кормят ровно тех, кого взяли, поэтому и цена — доля от полной.
        // Считается она тем же `fitting`, каким считается число принятых: иначе
        // показанное «нужно» разошлось бы со списанным при первой же правке.
        cost: (s) => ({ food: Math.round(amount(s, 8) * (fitting(s) / crowd(s, 0.06, 8))) }),
        apply: (s) => {
          const n = fitting(s);
          if (n <= 0) {
            moveMorale(s, EVENT_MORALE.refugeesNoRoom);
            return 'Свободных крыш нет. Беженцы ушли дальше, в городе недовольны.';
          }
          const want = crowd(s, 0.06, 8);
          addPop(s, n);
          s.stats.born += n;
          return `Приняли ${people(n)} из ${want}. Остальные пошли дальше.`;
        },
      },
      {
        label: 'Прогнать',
        hint: MoraleWord(EVENT_MORALE.refugeesTurnedAway),
        apply: (s) => {
          moveMorale(s, EVENT_MORALE.refugeesTurnedAway);
          return 'Беженцев прогнали. В городе недовольны.';
        },
      },
    ],
  },
  {
    id: 'wanderers',
    silence: 2,
    icon: '🧰',
    title: 'Бродячая артель',
    text: (s) =>
      `К воротам вышла артель, ${people(crowd(s, 0.03, 5))} с инструментом. Просят еды и крыши.`,
    weight: (s) => (s.pop >= 20 ? 1.5 : 0.5),
    options: [
      {
        label: 'Взять к себе',
        hint: (s) => `+${people(crowd(s, 0.03, 5))}${currentSite(s) ? `, стройка ${share(EVENT_WORK.settle)}` : ''}`,
        cost: (s) => ({ food: amount(s, 16) }),
        apply: (s) => {
          const n = crowd(s, 0.03, 5);
          addPop(s, n);
          s.stats.born += n;
          // Артель приходит с инструментом: первое дело — помочь на стройке.
          const site = currentSite(s);
          if (site) {
            const done = Math.min(site.workRequired - site.work, site.workRequired * EVENT_WORK.settle);
            site.work += done;
            return `Артель осталась, ${people(n)}. Сразу взялись за стройку.`;
          }
          return `Артель осталась, ${people(n)}. Стройки нет, прибавилось свободных рук.`;
        },
      },
      {
        label: 'Нанять на день',
        hint: (s) => (currentSite(s) ? `Стройка ${share(EVENT_WORK.day)}` : 'Стройки нет, работы не будет'),
        cost: (s) => ({ gold: amount(s, 20) }),
        apply: (s) => {
          const site = currentSite(s);
          if (!site) return 'Золото заплачено, а стройки нет. Артель ушла.';
          site.work = Math.min(site.workRequired, site.work + site.workRequired * EVENT_WORK.day);
          return 'Артель отработала день и ушла. Стройка продвинулась.';
        },
      },
      { label: 'Отказать', apply: () => 'Артель ушла к соседям.' },
    ],
  },
  {
    id: 'wolves',
    silence: 0,
    icon: '🐺',
    title: 'Волки',
    text: (s) => `Стая волков кружит у города. Их ${gateMen(s, 'wolves')}.`,
    // Волки — угроза слабого посёлка: к городу, который логово уже замечает, они не приходят (слово владельца по 14.35, п. 6).
    weight: (s) => (s.time > DAY_LENGTH && weakVillage(s) ? 3 : 0),
    options: [
      {
        label: 'Принять бой',
        hint: 'Бой у ворот',
        apply: (s) => toGate(s, 'wolves', { hides: amount(s, 4), bones: amount(s, 4) }),
      },
      {
        label: 'Отдать запасы',
        hint: 'Волки уйдут без боя',
        cost: (s) => ({ food: amount(s, 15) }),
        apply: () => {
          return 'Волки утащили часть запасов и ушли.';
        },
      },
    ],
  },
  {
    id: 'berries',
    silence: 0,
    icon: '🍇',
    title: 'Ягодная поляна',
    text: 'Собиратели нашли богатую ягодную поляну.',
    weight: () => 2,
    options: [
      {
        label: 'Собрать всё',
        hint: (s) => `+${amount(s, 25)} еды`,
        apply: (s) => {
          const n = addRes(s, 'food', amount(s, 25));
          return `Собрано ${n} еды.`;
        },
      },
    ],
  },
  {
    id: 'storm',
    silence: 1,
    icon: '🌩️',
    title: 'Буря',
    text: 'Ночью налетела буря и повалила леса на стройке.',
    weight: (s) => (s.buildings.some(isSite) ? 2 : 0),
    options: [
      {
        label: 'Починить',
        hint: 'Стройка не пострадает',
        cost: (s) => ({ wood: amount(s, 10) }),
        apply: () => {
          return 'Стройку починили.';
        },
      },
      {
        label: 'Не чинить',
        hint: `Стройка −${Math.round(EVENT_WORK.storm * 100)}% сделанного`,
        apply: (s) => {
          const b = s.buildings.find(isSite);
          if (b) b.work *= 1 - EVENT_WORK.storm;
          return 'Часть работы придётся переделать.';
        },
      },
    ],
  },
  {
    id: 'trade',
    silence: 1,
    icon: '🤝',
    title: 'Купцы у ворот',
    text: (s) => `Купцы предлагают ${amount(s, 30)} еды за ${amount(s, 20)} древесины.`,
    weight: (s) => (s.resources.wood >= amount(s, 20) ? 2 : 0),
    options: [
      {
        label: 'Обменять',
        hint: (s) => `+${amount(s, 30)} еды, ${fameWord(EVENT_FAME.trade)}`,
        cost: (s) => ({ wood: amount(s, 20) }),
        apply: (s) => {
          addRes(s, 'food', amount(s, 30));
          moveFame(s, EVENT_FAME.trade);
          return 'Обмен состоялся. Купцы довольны.';
        },
      },
      { label: 'Отказаться', apply: () => 'Купцы ушли ни с чем.' },
    ],
  },
  {
    id: 'sickness',
    silence: 2,
    icon: '🤒',
    title: 'Мор',
    text: (s) => `По домам пошла хворь. Слегло уже ${people(crowd(s, 0.04, 3))}.`,
    weight: (s) => (s.pop >= 12 ? 1.5 : 0),
    options: [
      {
        label: 'Позвать служителей',
        hint: (s) =>
          jobCounts(s).priest > 0
            ? `Хворь отступит, ${moraleWord(EVENT_MORALE.sicknessPriests)}`
            : `Служителей нет. Может унести ${people(crowd(s, 0.04, 3))}`,
        apply: (s) => {
          if (jobCounts(s).priest > 0) {
            moveMorale(s, EVENT_MORALE.sicknessPriests);
            return `${faithDef(s)?.priests ?? 'Служители'} обошли дома, хворь отступила.`;
          }
          if (chance(s, 0.5)) {
            const n = killPop(s, crowd(s, 0.04, 3), 'мор');
            return `Служителей нет, обряда не было. Мор унёс ${people(n)}.`;
          }
          return 'Обряда не было, но хворь ушла сама.';
        },
      },
      {
        label: 'Выхаживать',
        hint: 'Никто не умрёт',
        cost: (s) => ({ food: amount(s, 20) }),
        apply: () => {
          return 'Больных выходили горячим варевом. Все поправились.';
        },
      },
      {
        label: 'Ничего не делать',
        hint: (s) => `Может унести ${people(crowd(s, 0.05, 4))}, тогда ${moraleWord(EVENT_MORALE.sicknessNeglect)}`,
        apply: (s) => {
          if (chance(s, 0.5)) {
            const n = killPop(s, crowd(s, 0.05, 4), 'мор');
            moveMorale(s, EVENT_MORALE.sicknessNeglect);
            return `Мор прошёл по городу и унёс ${people(n)}.`;
          }
          return 'На этот раз обошлось, хворь ушла сама.';
        },
      },
    ],
  },
  {
    id: 'raiders',
    silence: 1,
    icon: '⚔️',
    title: 'Разбойники',
    text: (s) => `Пришли разбойники, их ${gateMen(s, 'raiders')}. Требуют ${amount(s, 25)} еды, иначе нападут.`,
    weight: (s) => (dayOf(s.time) >= 5 ? 2 : 0),
    options: [
      {
        label: 'Заплатить',
        hint: `Уйдут без боя, ${fameWord(EVENT_FAME.raidersPaid)}`,
        cost: (s) => ({ food: amount(s, 25) }),
        apply: (s) => {
          moveFame(s, EVENT_FAME.raidersPaid);
          return 'Дань уплачена, разбойники ушли. Слава упала.';
        },
      },
      {
        label: 'Принять бой',
        hint: 'Бой у ворот',
        apply: (s) => toGate(s, 'raiders', { wood: amount(s, 15), hides: amount(s, 5) }),
      },
    ],
  },
  {
    id: 'mercenaries',
    silence: 1,
    icon: '🛡️',
    title: 'Вольная рота',
    text: (s) => `У ворот встала вольная рота, их ${gateMen(s, 'raiders')}. Ищут найма на сезон, а нет — пойдут искать добычи.`,
    weight: (s) => (dayOf(s.time) >= 5 ? 1 : 0),
    options: [
      {
        label: 'Нанять на стройку',
        hint: `${boonWords(BOON_BY_ID.mercs)} на ${daysSpan(BOON_BY_ID.mercs.days)}`,
        cost: (s) => ({ gold: amount(s, 30) }),
        apply: (s) => {
          grantBoon(s, 'mercs');
          return 'Рота взялась за топоры и носилки. Частокол растёт на глазах.';
        },
      },
      {
        label: 'Отказать',
        hint: `Могут вернуться к воротам через ${daysSpan(CHAIN_SEASONS.free_company * SEASON_DAYS)}, риск ${Math.round(TIDING.risk * 100)}%`,
        apply: (s) => {
          if (chance(s, TIDING.risk) && scheduleChain(s, 'free_company', CHAIN_SEASONS.free_company)) {
            return 'Рота ушла, но недалеко: их костры видны с башни.';
          }
          return 'Рота ушла искать найма у соседей.';
        },
      },
    ],
  },
  {
    id: 'free_company',
    silence: 1,
    icon: '⚔️',
    title: 'Рота у ворот',
    text: (s) => `Вольная рота вернулась, их ${gateMen(s, 'raiders')}. Требуют ${amount(s, 25)} золота за то, чтобы уйти.`,
    // Только следствием отказа роте. Бьётся она у ворот силой разбойников — той же таблицей и той же дверью.
    weight: () => 0,
    options: [
      {
        label: 'Откупиться',
        hint: `Уйдут без боя, ${fameWord(EVENT_FAME.raidersPaid)}`,
        cost: (s) => ({ gold: amount(s, 25) }),
        apply: (s) => {
          moveFame(s, EVENT_FAME.raidersPaid);
          return 'Роте заплатили, и она ушла за холмы.';
        },
      },
      {
        label: 'Принять бой',
        hint: 'Бой у ворот',
        apply: (s) => toGate(s, 'raiders', { wood: amount(s, 15), hides: amount(s, 5) }),
      },
    ],
  },
  {
    id: 'festival',
    silence: 1,
    icon: '🎉',
    title: 'Праздник прихода',
    text: (s) => {
      const f = faithDef(s);
      const feast = f ? f.feasts[seasonOf(s.time)] : null;
      return feast
        ? `${feast.name}. ${feast.text} Ждут твоего слова.`
        : 'Люди просят праздника на площади.';
    },
    // Пока обряд справить нельзя — в этом сезоне уже справляли, идёт другой,
    // не хватает добра, — событие не поднимается вовсе: окно с двумя гашеными
    // кнопками игрок читает как сломанную игру.
    weight: (s) => (riteInfo(s).blocked === null ? 3 : 0),
    options: [
      {
        label: 'Справить',
        hint: `${MoraleWord(RITE_MORALE)} и набожность на ${daysSpan(RITE_DAYS)}, ${fameWord(EVENT_FAME.festival)}`,
        cost: (s) => {
          const r = riteInfo(s);
          return { food: r.food, gold: r.gold };
        },
        apply: (s) => {
          // Плату уже сняло событие (`payEventCost`), поэтому зовём `beginRite`,
          // а не `holdRite`: тот взял бы её второй раз. Отметки при этом ставит
          // одна и та же функция — двух правд о начавшемся обряде быть не должно.
          const f = faithDef(s);
          beginRite(s);
          moveFame(s, EVENT_FAME.festival);
          return f
            ? `${f.feasts[seasonOf(s.time)].name}. Праздник справили, приход доволен.`
            : 'Праздник справили.';
        },
      },
      { label: 'Не время', apply: () => 'Праздник отложили до лучших времён.' },
    ],
  },
  {
    id: 'rome_letter',
    silence: 1,
    icon: '📜',
    title: 'Грамота из Рима',
    text: 'Легат привёз грамоту с печатью. Рим собирает на поход и ждёт нашей доли, отказавших запомнит.',
    // Только у латинского обряда: связь с Римом — его наклон, и ни у кого
    // больше такой грамоты быть не может.
    weight: (s) => (faithOf(s) === 'catholic' ? 2 : 0),
    options: [
      {
        label: 'Дать, сколько просят',
        hint: FameWord(EVENT_FAME.romeGave),
        cost: (s) => ({ gold: amount(s, 60) }),
        apply: (s) => {
          moveFame(s, EVENT_FAME.romeGave);
          return 'Легат уехал довольным. Имя правителя прочтут в Риме.';
        },
      },
      {
        label: 'Отказать',
        hint: `Надлом веры +${FAITH_REFUSAL_STRAIN}`,
        apply: (s) => {
          addStrain(s, FAITH_REFUSAL_STRAIN);
          return 'Легат уехал ни с чем. Священник служил в тот день молча, и приход это заметил.';
        },
      },
    ],
  },
  {
    id: 'rome_relief',
    silence: 0,
    icon: '🕊️',
    title: 'Заступничество',
    text: 'Из дальнего аббатства пришёл обоз с хлебом. О нашей беде услышали и ничего не просят взамен.',
    // Заступничество приходит только к тем, кто платит за связь с Римом, и
    // только когда действительно плохо: голод или чужие под стенами. Это и есть
    // вторая половина католического наклона — за десятину есть что получить.
    weight: (s) => {
      if (faithOf(s) !== 'catholic') return 0;
      const hungry = s.resources.food / Math.max(1, foodConsumptionPerDay(s)) < 1.5;
      return hungry || s.siege ? 3 : 0;
    },
    options: [
      {
        label: 'Принять с благодарностью',
        hint: (s) => `+${amount(s, 90)} еды`,
        apply: (s) => {
          const f = addRes(s, 'food', amount(s, 90));
          return `Обоз разгрузили, еды прибавилось на ${f}. В храме отслужили молебен.`;
        },
      },
    ],
  },
  {
    id: 'heresy_split',
    silence: 2,
    icon: '🔥',
    title: 'Раскол в приходе',
    // Имя служителя тут не склоняется нарочно: у четырёх вер это священник,
    // имам и волхв, и правило «прибавить „и“» даёт «имами». Падежи руками — в
    // `data/faiths.ts`, а здесь обходимся общим словом.
    text: 'У колодца проповедует пришлый. Говорит, что в храме лгут, и люди его слушают.',
    // Событие поднимается только тогда, когда вера действительно трещит:
    // раскол на здоровом приходе был бы шумом.
    weight: (s) => (heresy(s) ? 4 : 0),
    options: [
      {
        label: 'Позвать учёного проповедника',
        hint: 'Надлом веры уйдёт',
        cost: (s) => ({ gold: amount(s, 45) }),
        apply: (s) => {
          // Спор выигран: надлом снимается целиком, а не наполовину — за это и
          // платили. Само по себе это ереси не отменит, если давит округа или
          // пустует храм: набожность считается из всего разом.
          s.faith.strain = 0;
          s.faith.strainAt = s.time;
          return 'Приезжий переспорил пришлого, и тот ушёл ночью. Приход успокоился.';
        },
      },
      {
        label: 'Разогнать силой',
        hint: `Надлом веры −${FAITH_REFUSAL_STRAIN}, ${moraleWord(EVENT_MORALE.preacherForce)}`,
        apply: (s) => {
          moveMorale(s, EVENT_MORALE.preacherForce);
          s.faith.strain = Math.max(0, strainNow(s) - FAITH_REFUSAL_STRAIN);
          s.faith.strainAt = s.time;
          return 'Проповедника вывели за ворота. Спорить перестали, но смотрят исподлобья.';
        },
      },
      {
        label: 'Пусть говорят',
        hint: `${MoraleWord(EVENT_MORALE.preacherTalk)}, надлом веры +${FAITH_REFUSAL_STRAIN}`,
        apply: (s) => {
          addStrain(s, FAITH_REFUSAL_STRAIN);
          moveMorale(s, EVENT_MORALE.preacherTalk);
          return 'Пришлого не тронули. Люди довольны, а храм пустеет.';
        },
      },
    ],
  },
  {
    id: MUTINY_EVENT,
    silence: 0,
    icon: ORDER_TEXT.mutiny.icon,
    title: ORDER_TEXT.mutiny.title,
    // Лёг мятеж туда же, куда ересь: в эту таблицу, с выбором. Своей механики у
    // него нет — ни бунта деревни (его в игре нет вовсе), ни окна мира. Отличие
    // одно: случаем он не выпадает (вес ноль), его поднимает срок ропота
    // (`sim/mutiny.unrestTick`). Ждёт ответа он сутки, как любое донесение, и невольники
    // на это время стоят.
    text: (s) => {
      const f = mutinyForecast(s);
      return ORDER_TEXT.mutiny.text(f.bonded, f.guards);
    },
    weight: () => 0,
    waits: ORDER_TEXT.mutiny.silence,
    options: [
      {
        // Первым и бесплатным нарочно: ровно это случится, если не ответить.
        label: ORDER_TEXT.mutiny.suppress,
        hint: (s) => {
          const f = mutinyForecast(s);
          return ORDER_TEXT.mutiny.suppressHint({
            holds: f.holds,
            flee: f.flee,
            leave: f.leave,
            morale: MUTINY_SUPPRESS_MORALE,
          });
        },
        apply: (s) => mutinySuppress(s),
      },
      {
        label: ORDER_TEXT.mutiny.release,
        hint: (s) => ORDER_TEXT.mutiny.releaseHint(mutinyForecast(s).bonded),
        apply: (s) => mutinyRelease(s),
      },
      {
        label: ORDER_TEXT.mutiny.pay,
        hint: ORDER_TEXT.mutiny.payHint,
        cost: (s) => {
          const f = mutinyForecast(s);
          return { food: f.payFood, gold: f.payGold };
        },
        apply: (s) => mutinyPay(s),
      },
    ],
  },
  {
    id: 'relic_offer',
    silence: 1,
    icon: '📿',
    title: 'Странник со святыней',
    text: (s) => {
      const f = faithDef(s);
      return f
        ? `У ворот странник. Он несёт святыню «${f.relic}» и просит поставить её в ${f.temple.toLowerCase()}.`
        : 'У ворот стоит странник и просится в храм.';
    },
    // Своей святыни ещё нет, вера уже известна. Редко: реликвия должна остаться
    // событием, а не строкой расходов.
    weight: (s) => (faithOf(s) !== null && !s.faith.relic ? 1 : 0),
    options: [
      {
        label: 'Принять святыню',
        hint: `Набожность +${PIETY_RELIC}, пока святыня в храме`,
        cost: (s) => ({ gold: amount(s, 70), hides: amount(s, 12) }),
        apply: (s) => {
          grantRelic(s);
          return 'Странника накормили и одарили. Святыню поставили на видное место.';
        },
      },
      {
        label: 'Накормить и проводить',
        hint: 'Странник уходит своей дорогой',
        apply: () => 'Странника накормили и проводили до просёлка. Что он нёс, так и не узнали.',
      },
    ],
  },
  {
    id: 'good_hunt',
    silence: 0,
    icon: '🦌',
    title: 'Удачная охота',
    text: 'Охотники выследили стадо оленей.',
    weight: (s) => (jobCounts(s).hunter > 0 ? 2 : 0),
    options: [
      {
        label: 'Забрать добычу',
        hint: (s) => `Еда +${amount(s, 20)}, шкуры +${amount(s, 5)}, кости +${amount(s, 3)}`,
        apply: (s) => {
          const f = addRes(s, 'food', amount(s, 20));
          const h = addRes(s, 'hides', amount(s, 5));
          const b = addRes(s, 'bones', amount(s, 3));
          s.stats.hunts++;
          return `Еды прибавилось на ${f}, шкур на ${h}, костей на ${b}.`;
        },
      },
    ],
  },
  {
    id: 'fire',
    silence: 1,
    icon: '🔥',
    title: 'Пожар',
    text: 'Искра из очага попала на крышу дома.',
    weight: (s) => ((buildingOfType(s, 'houses')?.level ?? 0) >= 2 ? 1 : 0),
    options: [
      {
        label: 'Тушить всем городом',
        hint: 'Дома останутся целы',
        cost: (s) => ({ food: amount(s, 10) }),
        apply: () => {
          return 'Дом отстояли.';
        },
      },
      {
        label: 'Спасать пожитки',
        hint: (s) => `${(buildingOfType(s, 'houses')?.level ?? 0) > 1 ? 'Жилища −1 ур., д' : 'Д'}ревесина +${amount(s, 5)}`,
        apply: (s) => {
          // Жилища в посёлке одни: сносить их целиком — значит отнять всё жильё разом.
          // Огонь съедает улицу дворов, то есть один уровень.
          const houses = buildingOfType(s, 'houses');
          if (houses && houses.level > 1) houses.level -= 1;
          addRes(s, 'wood', amount(s, 5));
          return 'Крайние дома выгорели дотла. Удалось спасти немного древесины.';
        },
      },
    ],
  },
  // Сезонные, случайные и цепочки — своей таблицей (`data/tidings.ts`, docs/events.md).
  ...TIDINGS,
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e])) as Record<string, EventDef>;

export function pickEvent(s: GameState): EventDef | null {
  const weighted = EVENTS.map((e) => [e, e.weight(s)] as const).filter(([, w]) => w > 0);
  const total = weighted.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return null;
  let left = roll(s) * total;
  for (const [e, w] of weighted) {
    left -= w;
    if (left <= 0) return e;
  }
  return weighted[weighted.length - 1][0];
}

export const eventText = (e: EventDef, s: GameState): string => (typeof e.text === 'function' ? e.text(s) : e.text);

/**
 * Подсказка варианта: числа в ней тоже считаются от размера посёлка.
 *
 * Цены в ней нет и быть не должно — цену показывает `Cost` значками и вместе с
 * тем, сколько этого есть на складе. Строка объясняет, что игрок **получит**;
 * что он за это отдаст, стоит строкой ниже и не переписывается словами второй
 * раз.
 */
export const optionHint = (o: EventOption, s: GameState): string | undefined =>
  typeof o.hint === 'function' ? o.hint(s) : o.hint;

/** Что вариант просит отдать прямо сейчас. Пусто — не просит ничего. */
export const eventCost = (o: EventOption, s: GameState): EventCost =>
  o.cost ? o.cost(s) : {};

/**
 * Почему этот вариант сейчас не нажимается. null — нажимается.
 *
 * Причина одна и всегда одна и та же — не хватает добра, — и считается она по
 * тому же складу, который стоит у игрока перед глазами. Гаснущая кнопка здесь
 * не строгость, а честность: окно события закрывает собой всю игру, склад из-под
 * него не посмотреть, и «отдать припасы» нажималось вслепую. Тупика из этого не
 * выйдет — у каждого события есть вариант, который ничего не стоит, и это
 * проверяет тест.
 */
export function eventBlock(o: EventOption, s: GameState): string | null {
  const cost = eventCost(o, s);
  const short: string[] = [];
  for (const r of RESOURCE_IDS) {
    const need = cost[r] ?? 0;
    if (need > Math.floor(s.resources[r])) short.push(RESOURCE_META[r].name.toLowerCase());
  }
  if ((cost.gold ?? 0) > Math.floor(s.gold)) short.push('золото');
  if (short.length === 0) return null;
  return 'Не хватает';
}

/**
 * Списать цену варианта. Единственное место, где событие берёт со склада: сам
 * `apply` получает состояние уже оплаченным и про цену не знает.
 */
export function payEventCost(o: EventOption, s: GameState): void {
  const cost = eventCost(o, s);
  for (const r of RESOURCE_IDS) {
    const need = cost[r] ?? 0;
    if (need > 0) s.resources[r] = Math.max(0, s.resources[r] - need);
  }
  const gold = cost.gold ?? 0;
  if (gold > 0) s.gold = Math.max(0, s.gold - gold);
}
