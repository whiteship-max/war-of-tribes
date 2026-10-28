// Случайные события. Все числа здесь считаются от размера посёлка, а не пишутся
// константами: население доходит до сотен, и «+25 еды» или «пришёл один чужак»
// к середине партии перестают что-либо значить.
//
// Люди приходят и уходят толпой. Поимённых жителей в игре нет, поэтому событие
// про человека — это событие про группу: беженцы у ворот, бродячая артель, мор.
import type { EventCost, GameState, LogTopic, RealmBranch, ResourceId } from '../types';
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
import { addStrain, beginRite, grantRelic, riteClosed, riteInfo } from '../sim/faith';
import { mutinyPay, mutinyRelease, mutinySuppress } from '../sim/mutiny';
import {
  DECLINE,
  concession,
  handout,
  revoltConcede,
  revoltNow,
  revoltSuppress,
  revoltWait,
  termsConcede,
  termsRefuse,
} from '../sim/stability';
import { REVOLT_EVENT, REVOLT_TEXT, TERMS_EVENT, concedeWords } from './stability';
import { DECREE_BY_ID, TAX_BY_ID } from './policy';
import { addPop, killPop } from '../sim/population';
import { chance, roll } from '../sim/roll';
import { log } from '../sim/log';
import { MUTINY_EVENT, ORDER_TEXT } from './order';
import { daysSpan } from '../span';
import { addRes, amount, crowd, FameWord, sizeOf, fameWord, moraleWord, MoraleWord, moveFame, moveMorale, people } from './eventKit';
import { CHAIN_SEASONS, TIDING, TIDINGS } from './tidings';
import { ADVISOR_POSTS } from '../councilrules';
import { vacancyDef } from '../sim/council';
import { agentVacancyDef } from '../sim/recruit';
import { commandVacancyDef } from '../sim/command';
import { FLANKS } from '../commandrules';
import { AGENT_ROLES } from '../agentrules';
import { BOON_BY_ID, boonWords } from './boons';
import { SEASON_DAYS } from './seasons';
import { grantBoon } from '../sim/boons';
import { scheduleChain } from '../sim/chains';
import { crownEvents } from '../sim/crown';
import { pointsOf, spend } from '../sim/points';
import { BRANCH_NAME, REALM_BRANCHES } from './realm';

export type { EventCost };

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
  /**
   * Что вариант просит из очков правителя (вести державы, СБ-2): та же цена на три дела, что `cost` — показ, запрет и
   * списание; списывает одна дверь трат (`sim/points.spend`).
   */
  points?: Partial<Record<RealmBranch, number>>;
  /**
   * Почему вариант сейчас не нажимается, кроме цены (ECO-3): условие, при котором весть пришла, с тех пор пропало —
   * обряд в этом сезоне уже справили, святыня уже стоит, стройки нет. Весть ждёт ответа сутки, и без этого ответ платил бы
   * за то, чего уже не бывает. null — нажимается. Общего правила «вес ноль — отказ» нет нарочно: в весе есть кость и
   * календарь, а ярмарка, пришедшая летом, осенью не гаснет. У молчания (`EventDef.silence`) поля нет — это тест.
   */
  block?: (s: GameState) => string | null;
  /** Применяет выбор и возвращает текст результата. */
  apply: (s: GameState) => string;
}

export interface EventDef {
  id: string;
  title: string;
  /**
   * Кто пишет весть — человек эпохи, а не «город»: привратник, управитель, старший стражи, служитель веры
   * (docs/voice.md, 11). Голос письма — один из пяти голосов игры: привратник и стража говорят как гонец,
   * управитель и мастера — как управитель, служитель — как летописец о вере.
   */
  from: string | ((s: GameState) => string);
  /**
   * Текст вести. Нет поля — текст едет куском «Вестей» (вести державы, `data/crownWords`): шагу партии он не нужен, и первая
   * загрузка за него не платит.
   */
  text?: string | ((s: GameState) => string);
  options: EventOption[];
  /** Род строки летописи, которую оставит ответ (`sim/log`): у вестей державы — «Стабильность». */
  topic?: LogTopic;
  /** Исход не называет выбранного ответа — летопись ставит его перед исходом сама (`sim/mail.closeEvent`). */
  named?: true;
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
 * (волки 1-го, 5-го и 10-го уровня); выведенная от записанной не дальше 1.7 %. **Осада 2в** (W 128, шаг кости 0.035 —
 * стена-проход, docs/siege_v2.md, 15; docs/battle_eu4.md, «Осада 2в»): выводится заново той же командой, итерации — там.
 * **Полная приёмка осады** (W 94, шаг кости 0.0368 — docs/siege_v2.md, 19.4): заново, три шага; строки, не севшие за три
 * шага (волки 4-го и 5-го уровня, разбойники 4-го), — полусуммой записанного и выведенного, прочие — третьим шагом, от
 * записанной не дальше 1 %; итерации (и прежний вывод на W 90) — docs/battle_eu4.md, «Осада: W и таблица у ворот на полной
 * приёмке». **Слияние UI-8** (полководец в городе без отряда защищает стены — 6.10; W 97, шаг кости 0.0364 —
 * docs/siege_v2.md, 20): заново, три шага; строки, не севшие за три шага в 1 % (волки 5-го и 8–10-го уровня, разбойники 5-го,
 * 8-го и 9-го), — полусуммой записанного и выведенного третьим шагом, прочие — третьим шагом; итерации — docs/siege_v2.md, 20.
 * **Слияние Р-1…Р-5 и ДП-1** (кольцо блокады, хлеб окна при падении, обстрел; W 95, шаг кости 0.0355 — docs/siege_v2.md,
 * 22.2): заново, три шага; не севшие за три шага в 1 % (волки 2-го, 6–8-го и 10-го уровня, разбойники 6-го и 8-го) —
 * полусуммой записанного и выведенного третьим шагом, прочие — третьим шагом; итерации — docs/siege_v2.md, 22.2.
 * **Слияние `game/rt-2`** (объединённые дворы, сословия, стабильность; W 102, шаг кости 0.0357 — docs/siege_v2.md, 22.4):
 * заново двумя кругами по три шага (`npm run derive -- gate --write`); не севшие (волки и разбойники 8-го уровня в первом
 * круге, 10-го — во втором) — полусуммой; ступень 7 → 8 — от полки жителей автопилота у 415…475 (там же).
 * **Слияние `game/dr-5`** (W 113, шаг кости 0.0341 — docs/siege_v2.md, 22.6): заново, два шага (`npm run derive -- gate --write
 * --steps 5 --pause 0`); повернувшие назад на втором шаге (волки 2-го, 5-го, 8-го и 9-го уровня, разбойники 5-го и 9-го) —
 * полусуммой, прочие — вторым шагом, от записанной не дальше 1 %. **Часть 2** (W 110, шаг кости 0.0344 — docs/siege_v2.md, 22.8):
 * заново, два шага; волки 9-го уровня повернули назад — полусуммой, прочие — вторым шагом, от записанной не дальше 1 %.
 * **Приёмка pn-0 на сервере** (W 103, шаг кости 0.0445 — docs/siege_v2.md, 31.7): заново, три шага (`npm run derive -- gate --write
 * --pause 0`); на третьем все строки в 1 % от записанной — таблица села, записан третий шаг.
 */
/** Пришедшие по вести, у которых сила — таблица по уровню посёлка; у мятежников сила — их число (`sim/stability`). */
export type EventFoe = Exclude<GateFoe, 'rebels'>;

export const GATE_POWER: Record<EventFoe, readonly number[]> = {
  wolves: [120, 213, 364, 598, 950, 1422, 1627, 2035, 2695, 3392],
  raiders: [199, 339, 480, 629, 795, 995, 1116, 1400, 1604, 1875],
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
export const gatePower = (s: GameState, foe: EventFoe): number => {
  const row = GATE_POWER[foe];
  const pop = sizeOf(s).folk;
  if (pop <= GATE_POP[0]) return row[0];
  const hi = GATE_POP.findIndex((p) => p >= pop);
  if (hi < 0) return row[row.length - 1];
  const lo = hi - 1;
  return row[lo] + ((row[hi] - row[lo]) * (pop - GATE_POP[lo])) / (GATE_POP[hi] - GATE_POP[lo]);
};

/** Сколько их придёт к воротам — мерой отрядов мира, которой бой их и выставит (`menOfPower`). */
export const gateMen = (s: GameState, foe: EventFoe): number => menOfPower(gatePower(s, foe));

/**
 * Слабый посёлок: логово его ещё не замечает — ни жителями, ни всем войском он не дорос до порога защиты слабого
 * (`lairs.weakCity`). Его угроза — волки; у разбойников защиты слабого нет (слово владельца по 14.35, п. 6).
 */
export const weakVillage = (s: GameState): boolean => weakCity(s.pop, troopPower(s.army));

/**
 * Выйти к воротам: вызов ложится в партию, бьётся мир на ближайшем пульсе, исход — отчётом в «Походы».
 * Трофеи победы решает событие здесь; мир про них не знает.
 */
const toGate = (s: GameState, foe: EventFoe, spoils: Partial<Record<ResourceId, number>>): string => {
  callGate(s, foe, gatePower(s, foe), spoils);
  return 'Гарнизон вышел за ворота. Чем кончилось, скажет донесение.';
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

/** Почему гаснет вариант, которому нужна стройка, а её уже нет (ECO-3). */
const NO_SITE = 'Стройки нет.';

/** «+20%» — доля стройки словами. */
const share = (f: number): string => `+${Math.round(f * 100)}%`;

export const EVENTS: EventDef[] = [
  {
    id: 'refugees',
    silence: 2,
    title: 'Беженцы у ворот',
    from: 'Привратник',
    text: (s) =>
      `С юга пришли ${people(crowd(s, 0.06, 8))}. Сёла их сожжены, дети на руках. Просятся под нашу стену.`,
    // Когда селить некуда, толпа приходит реже: событие про выбор, а не про отказ.
    weight: (s) => (s.pop < housingCapacity(s) ? 3 : 1),
    options: [
      {
        label: 'Открыть ворота всем',
        hint: (s) => `+${people(crowd(s, 0.06, 8))}`,
        cost: (s) => ({ food: amount(s, 8) }),
        apply: (s) => {
          const n = crowd(s, 0.06, 8);
          addPop(s, n);
          s.stats.born += n;
          const over = s.pop - housingCapacity(s);
          log(s, `Город принял беженцев с юга, ${people(n)}.`, 'good');
          return over > 0
            ? `Вошли ${people(n)}. Ночуют по сеням и сеновалам, лишних ${over}. Пока крыш не прибавится, мораль будет падать.`
            : `Вошли ${people(n)}. Всем нашлись угол и миска.`;
        },
      },
      {
        label: 'Впустить, сколько вместим',
        hint: (s) => (fitting(s) > 0 ? `+${people(fitting(s))}` : `Свободных крыш нет, ${moraleWord(EVENT_MORALE.refugeesNoRoom)}`),
        // Кормят ровно тех, кого взяли, поэтому и цена — доля от полной.
        // Считается она тем же `fitting`, каким считается число принятых: иначе
        // показанное «нужно» разошлось бы со списанным при первой же правке.
        cost: (s) => ({ food: Math.round(amount(s, 8) * (fitting(s) / crowd(s, 0.06, 8))) }),
        apply: (s) => {
          const n = fitting(s);
          if (n <= 0) {
            moveMorale(s, EVENT_MORALE.refugeesNoRoom);
            return 'Свободных углов не нашлось, и беженцы побрели дальше. В городе этим недовольны.';
          }
          const want = crowd(s, 0.06, 8);
          addPop(s, n);
          s.stats.born += n;
          return `Впустили ${people(n)} из ${want}. Остальные побрели дальше по дороге.`;
        },
      },
      {
        label: 'Затворить ворота',
        hint: MoraleWord(EVENT_MORALE.refugeesTurnedAway),
        apply: (s) => {
          moveMorale(s, EVENT_MORALE.refugeesTurnedAway);
          return 'Ворота затворили. Беженцы ночевали под стеной и к утру ушли. В городе этого не одобрили.';
        },
      },
    ],
  },
  {
    id: 'wanderers',
    silence: 2,
    title: 'Бродячая артель',
    from: 'Десятник стройки',
    text: (s) =>
      `Пришла артель, ${people(crowd(s, 0.03, 5))} с топорами и пилами. Плотники и каменщики. Просят еды и крыши, готовы осесть.`,
    weight: (s) => (s.pop >= 20 ? 1.5 : 0.5),
    options: [
      {
        label: 'Принять в город',
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
            return `Артель осела у нас, ${people(n)}. Наутро они уже стояли на лесах.`;
          }
          return `Артель осела у нас, ${people(n)}. Стройки нет, и руки пока свободны.`;
        },
      },
      {
        label: 'Нанять на день',
        hint: (s) => (currentSite(s) ? `Стройка ${share(EVENT_WORK.day)}` : 'Стройки нет, работы не будет'),
        cost: (s) => ({ gold: amount(s, 20) }),
        block: (s) => (currentSite(s) ? null : NO_SITE),
        apply: (s) => {
          const site = currentSite(s);
          if (!site) return 'Золото отдали, а строить нечего. Артель ушла.';
          site.work = Math.min(site.workRequired, site.work + site.workRequired * EVENT_WORK.day);
          return 'Артель отработала день от зари до зари. Стройка заметно подвинулась.';
        },
      },
      { label: 'Отпустить с миром', apply: () => 'Артель ушла искать работы у соседей.' },
    ],
  },
  {
    id: 'wolves',
    silence: 0,
    title: 'Волки',
    from: 'Старший стражи',
    text: (s) =>
      `Всю ночь у стен выла стая, к утру насчитали ${gateMen(s, 'wolves')}. Режут скот на выгонах и к воротам подходят без страха.`,
    // Волки — угроза слабого посёлка: к городу, который логово уже замечает, они не приходят (слово владельца по 14.35, п. 6).
    weight: (s) => (s.time > DAY_LENGTH && weakVillage(s) ? 3 : 0),
    options: [
      {
        label: 'Выйти на стаю',
        hint: 'Бой у ворот',
        apply: (s) => toGate(s, 'wolves', { hides: amount(s, 4) }),
      },
      {
        label: 'Бросить им мяса',
        hint: 'Стая уйдёт без боя',
        cost: (s) => ({ food: amount(s, 15) }),
        apply: () => {
          return 'Мясо вынесли за ворота. Стая взяла своё и ушла в лес.';
        },
      },
    ],
  },
  {
    id: 'berries',
    silence: 0,
    title: 'Ягодная поляна',
    from: 'Управитель',
    text: 'Собиратели нашли за ручьём поляну, красную от ягоды. Своих корзин не хватит, пришли людей.',
    weight: () => 2,
    options: [
      {
        label: 'Послать людей',
        hint: (s) => `+${amount(s, 25)} еды`,
        apply: (s) => {
          const n = addRes(s, 'food', amount(s, 25));
          return `Носили до темноты. В амбар легло ${n} еды.`;
        },
      },
    ],
  },
  {
    id: 'storm',
    silence: 1,
    title: 'Буря',
    from: 'Десятник стройки',
    text: 'Ночью налетела буря. Леса на стройке повалило, брёвна раскидало по двору.',
    weight: (s) => (s.buildings.some(isSite) ? 2 : 0),
    options: [
      {
        label: 'Поставить леса заново',
        hint: 'Стройка не пострадает',
        cost: (s) => ({ wood: amount(s, 10) }),
        block: (s) => (currentSite(s) ? null : NO_SITE),
        apply: () => {
          return 'Леса подняли заново. К полудню снова стучали топоры.';
        },
      },
      {
        label: 'Оставить как есть',
        hint: `Стройка −${Math.round(EVENT_WORK.storm * 100)}% сделанного`,
        apply: (s) => {
          const b = currentSite(s);
          if (b) b.work *= 1 - EVENT_WORK.storm;
          return 'Что повалило, то пропало. Часть работы начнут сызнова.';
        },
      },
    ],
  },
  {
    id: 'trade',
    silence: 1,
    title: 'Купцы у ворот',
    from: 'Управитель',
    text: (s) =>
      `Пришли купцы с реки. Дают ${amount(s, 30)} еды за ${amount(s, 20)} древесины. Зерно доброе, я сам смотрел.`,
    weight: (s) => (s.resources.wood >= amount(s, 20) ? 2 : 0),
    options: [
      {
        label: 'Ударить по рукам',
        hint: (s) => `+${amount(s, 30)} еды, ${fameWord(EVENT_FAME.trade)}`,
        cost: (s) => ({ wood: amount(s, 20) }),
        apply: (s) => {
          addRes(s, 'food', amount(s, 30));
          moveFame(s, EVENT_FAME.trade);
          return 'Ударили по рукам. Струги разгрузили, и купцы уплыли довольные.';
        },
      },
      { label: 'Отпустить купцов', apply: () => 'Купцы уплыли ни с чем.' },
    ],
  },
  {
    id: 'sickness',
    silence: 2,
    title: 'Мор',
    from: 'Управитель',
    text: (s) => `По домам пошла хворь, слегло уже ${people(crowd(s, 0.04, 3))}. Жар и кашель, в двух дворах плачут.`,
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
            return `${faithDef(s)?.priests ?? 'Служители'} обошли дома с молитвой. Хворь отступила.`;
          }
          if (chance(s, 0.5)) {
            const n = killPop(s, crowd(s, 0.04, 3), 'мор');
            return `Служителей в городе не нашлось. Мор унёс ${people(n)}.`;
          }
          return 'Служителей не нашлось, но хворь ушла сама.';
        },
      },
      {
        label: 'Выхаживать больных',
        hint: 'Никто не умрёт',
        cost: (s) => ({ food: amount(s, 20) }),
        apply: () => {
          return 'Больных отпаивали горячим варевом. Поднялись все.';
        },
      },
      {
        label: 'Переждать',
        hint: (s) => `Может унести ${people(crowd(s, 0.05, 4))}, тогда ${moraleWord(EVENT_MORALE.sicknessNeglect)}`,
        apply: (s) => {
          if (chance(s, 0.5)) {
            const n = killPop(s, crowd(s, 0.05, 4), 'мор');
            moveMorale(s, EVENT_MORALE.sicknessNeglect);
            return `Мор прошёл по улицам и унёс ${people(n)}.`;
          }
          return 'Переждали. Хворь ушла сама, никого не взяв.';
        },
      },
    ],
  },
  {
    id: 'raiders',
    silence: 1,
    title: 'Разбойники',
    from: 'Старший стражи',
    text: (s) =>
      `У ворот разбойники, ${gateMen(s, 'raiders')} при оружии. Главарь требует ${amount(s, 25)} еды, иначе к ночи полезут на стены.`,
    weight: (s) => (dayOf(s.time) >= 5 ? 2 : 0),
    options: [
      {
        label: 'Откупиться',
        hint: `Уйдут без боя, ${fameWord(EVENT_FAME.raidersPaid)}`,
        cost: (s) => ({ food: amount(s, 25) }),
        apply: (s) => {
          moveFame(s, EVENT_FAME.raidersPaid);
          return 'Дань вынесли за ворота, и разбойники ушли. По округе говорят, что мы платим.';
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
    title: 'Вольная рота',
    from: 'Старший стражи',
    text: (s) =>
      `Под стенами встала вольная рота, ${people(gateMen(s, 'raiders'))} при оружии. Капитан ищет найма на сезон. Откажем — пойдёт искать добычи.`,
    weight: (s) => (dayOf(s.time) >= 5 ? 1 : 0),
    options: [
      {
        label: 'Нанять на стройку',
        hint: `${boonWords(BOON_BY_ID.mercs)} на ${daysSpan(BOON_BY_ID.mercs.days)}`,
        cost: (s) => ({ gold: amount(s, 30) }),
        apply: (s) => {
          grantBoon(s, 'mercs');
          return 'Наёмники взялись за топоры и носилки. Стены растут на глазах.';
        },
      },
      {
        label: 'Отказать капитану',
        hint: `Могут вернуться к воротам через ${daysSpan(CHAIN_SEASONS.free_company * SEASON_DAYS)}, риск ${Math.round(TIDING.risk * 100)}%`,
        apply: (s) => {
          if (chance(s, TIDING.risk) && scheduleChain(s, 'free_company', CHAIN_SEASONS.free_company)) {
            return 'Рота снялась, но ушла недалеко. Ночью с башни видны их костры.';
          }
          return 'Рота ушла искать найма у соседей.';
        },
      },
    ],
  },
  {
    id: 'free_company',
    silence: 1,
    title: 'Рота у ворот',
    from: 'Старший стражи',
    text: (s) =>
      `Вольная рота вернулась, ${people(gateMen(s, 'raiders'))} при оружии. Капитан требует ${amount(s, 25)} золота, чтобы уйти по-хорошему.`,
    // Только следствием отказа роте. Бьётся она у ворот силой разбойников — той же таблицей и той же дверью.
    weight: () => 0,
    options: [
      {
        label: 'Откупиться',
        hint: `Уйдут без боя, ${fameWord(EVENT_FAME.raidersPaid)}`,
        cost: (s) => ({ gold: amount(s, 25) }),
        apply: (s) => {
          moveFame(s, EVENT_FAME.raidersPaid);
          return 'Капитан взвесил кошель на ладони и увёл роту за холмы.';
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
    title: 'Праздник прихода',
    from: (s) => faithDef(s)?.priest ?? 'Управитель',
    text: (s) => {
      const f = faithDef(s);
      const feast = f ? f.feasts[seasonOf(s.time)] : null;
      return feast
        ? `${feast.name}. ${feast.text} Ждут твоего слова.`
        : 'Люди просят праздника на площади. Ждут твоего слова.';
    },
    // Пока обряд справить нельзя — в этом сезоне уже справляли, идёт другой,
    // не хватает добра, — событие не поднимается вовсе: окно с двумя гашеными
    // кнопками игрок читает как сломанную игру.
    weight: (s) => (riteInfo(s).blocked === null ? 3 : 0),
    options: [
      {
        label: 'Справить праздник',
        hint: `${MoraleWord(RITE_MORALE)} и набожность на ${daysSpan(RITE_DAYS)}, ${fameWord(EVENT_FAME.festival)}`,
        cost: (s) => {
          const r = riteInfo(s);
          return { food: r.food, gold: r.gold };
        },
        // Цену держит весть (цена прихода), поэтому здесь — только «нельзя»: обряд идёт или уже был в этом сезоне.
        block: riteClosed,
        apply: (s) => {
          // Плату уже сняло событие (`payEventCost`), поэтому зовём `beginRite`,
          // а не `holdRite`: тот взял бы её второй раз. Отметки при этом ставит
          // одна и та же функция — двух правд о начавшемся обряде быть не должно.
          const f = faithDef(s);
          beginRite(s);
          moveFame(s, EVENT_FAME.festival);
          return f
            ? `${f.feasts[seasonOf(s.time)].name}. Отстояли службу и сели за столы. Приход доволен.`
            : 'Праздник справили всем городом.';
        },
      },
      { label: 'Не время', apply: () => 'Праздник отложили до лучших дней.' },
    ],
  },
  {
    id: 'rome_letter',
    silence: 1,
    title: 'Грамота из Рима',
    from: 'Папский легат',
    text: 'Святой престол собирает на поход за море и ждёт доли от каждого прихода. Отказавших в Риме запомнят.',
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
        label: 'Отказать Риму',
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
    title: 'Заступничество',
    from: 'Настоятель аббатства',
    text: 'Слышали мы о беде твоего города. Шлём обоз с хлебом и взамен ничего не просим. Помолись о нас.',
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
    title: 'Раскол в приходе',
    // Имя служителя тут не склоняется нарочно: у четырёх вер это священник,
    // имам и волхв, и правило «прибавить „и“» даёт «имами». Падежи руками — в
    // `data/faiths.ts`, а здесь обходимся общим словом.
    from: (s) => faithDef(s)?.priest ?? 'Управитель',
    text: 'У колодца проповедует пришлый. Говорит, что в храме лгут, и люди слушают его до темноты.',
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
    title: ORDER_TEXT.mutiny.title,
    from: ORDER_TEXT.mutiny.from,
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
  ...revoltEvents(),
  ...crownEvents(),
  // Пустое место в совете Ратуши (РТ-1): весть кладёт конец службы (`sim/tick`), случаем она не выпадает.
  ...ADVISOR_POSTS.map(vacancyDef),
  // Пустое место агента (АГ-1): весть кладёт гибель или покой (`sim/expedition`), случаем она не выпадает.
  ...AGENT_ROLES.map(agentVacancyDef),
  // Пустое место командира фланга (ДР-5): весть кладёт гибель в бою (`sim/expedition`) или покой (`sim/tick`).
  ...FLANKS.map(commandVacancyDef),
  {
    id: 'relic_offer',
    silence: 1,
    title: 'Странник со святыней',
    from: 'Привратник',
    text: (s) => {
      const f = faithDef(s);
      return f
        ? `У ворот странник в пыльном плаще. Несёт святыню «${f.relic}» и просит поставить её в ${f.temple.toLowerCase()}.`
        : 'У ворот странник в пыльном плаще. Просится в храм.';
    },
    // Своей святыни ещё нет, вера уже известна. Редко: реликвия должна остаться
    // событием, а не строкой расходов.
    weight: (s) => (faithOf(s) !== null && !s.faith.relic ? 1 : 0),
    options: [
      {
        label: 'Принять святыню',
        hint: `Набожность +${PIETY_RELIC}, пока святыня в храме`,
        cost: (s) => ({ gold: amount(s, 70), hides: amount(s, 12) }),
        block: (s) => (s.faith.relic ? 'Святыня уже стоит в храме.' : faithOf(s) ? null : 'Вера города ещё не ясна.'),
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
    title: 'Удачная охота',
    from: 'Ловчий',
    text: 'Охотники выследили в дубраве стадо оленей. Пошли людей с волокушами, и к вечеру мясо будет в городе.',
    weight: (s) => (jobCounts(s).hunter > 0 ? 2 : 0),
    options: [
      {
        label: 'Забрать добычу',
        hint: (s) => `Еда +${amount(s, 20)}, шкуры +${amount(s, 5)}`,
        apply: (s) => {
          const f = addRes(s, 'food', amount(s, 20));
          const h = addRes(s, 'hides', amount(s, 5));
          s.stats.hunts++;
          return `Туши привезли на волокушах. Еды прибавилось на ${f}, шкур на ${h}.`;
        },
      },
    ],
  },
  {
    id: 'fire',
    silence: 1,
    title: 'Пожар',
    from: 'Старший стражи',
    text: 'Искра из очага ушла под стреху. Горит дом у стены, огонь уже лижет соседний.',
    weight: (s) => ((buildingOfType(s, 'houses')?.level ?? 0) >= 2 ? 1 : 0),
    options: [
      {
        label: 'Тушить всем городом',
        hint: 'Дома останутся целы',
        cost: (s) => ({ food: amount(s, 10) }),
        apply: () => {
          return 'Таскали вёдра от колодца до темноты. Дом отстояли.';
        },
      },
      {
        label: 'Спасать пожитки',
        hint: (s) => `${(buildingOfType(s, 'houses')?.level ?? 0) > 1 ? 'Дома −1 ур., д' : 'Д'}ревесина +${amount(s, 5)}`,
        apply: (s) => {
          // Жилища в посёлке одни: сносить их целиком — значит отнять всё жильё разом.
          // Огонь съедает улицу дворов, то есть один уровень.
          const houses = buildingOfType(s, 'houses');
          if (houses && houses.level > 1) houses.level -= 1;
          addRes(s, 'wood', amount(s, 5));
          return 'Крайние дома выгорели дотла. Из огня вынесли немного древесины.';
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

export const eventText = (e: EventDef, s: GameState): string => (typeof e.text === 'function' ? e.text(s) : (e.text ?? ''));

/** Кто пишет весть — словами самой вести (`EventDef.from`). */
export const eventFrom = (e: EventDef, s: GameState): string => (typeof e.from === 'function' ? e.from(s) : e.from);

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

/**
 * Что вариант просит отдать. `frozen` — цена, которую весть посчитала в минуту прихода (`ActiveEvent.cost`, ECO-3): она и
 * есть цена; нет её — считается сейчас. Пусто — не просит ничего.
 */
export const eventCost = (o: EventOption, s: GameState, frozen?: EventCost): EventCost =>
  frozen ?? (o.cost ? o.cost(s) : {});

/**
 * Почему этот вариант сейчас не нажимается. null — нажимается.
 *
 * Причин две. Первая — не хватает добра, — и считается она по
 * тому же складу, который стоит у игрока перед глазами. Гаснущая кнопка здесь
 * не строгость, а честность: окно события закрывает собой всю игру, склад из-под
 * него не посмотреть, и «отдать припасы» нажималось вслепую. Вторая — условие
 * варианта пропало, пока весть ждала ответа (`EventOption.block`, ECO-3). Тупика
 * из этого не выйдет — у каждого события есть вариант, который ничего не стоит и
 * не гаснет, и это проверяет тест.
 */
export function eventBlock(o: EventOption, s: GameState, frozen?: EventCost): string | null {
  const cost = eventCost(o, s, frozen);
  const short: string[] = [];
  for (const r of RESOURCE_IDS) {
    const need = cost[r] ?? 0;
    if (need > Math.floor(s.resources[r])) short.push(RESOURCE_META[r].name.toLowerCase());
  }
  if ((cost.gold ?? 0) > Math.floor(s.gold)) short.push('золото');
  for (const b of REALM_BRANCHES) if ((o.points?.[b] ?? 0) > pointsOf(s, b)) short.push(BRANCH_NAME[b].toLowerCase());
  if (short.length > 0) return 'Не хватает';
  return o.block?.(s) ?? null;
}

/**
 * Списать цену варианта. Единственное место, где событие берёт со склада: сам
 * `apply` получает состояние уже оплаченным и про цену не знает.
 */
export function payEventCost(o: EventOption, s: GameState, frozen?: EventCost): void {
  const cost = eventCost(o, s, frozen);
  for (const r of RESOURCE_IDS) {
    const need = cost[r] ?? 0;
    if (need > 0) s.resources[r] = Math.max(0, s.resources[r] - need);
  }
  const gold = cost.gold ?? 0;
  if (gold > 0) s.gold = Math.max(0, s.gold - gold);
  for (const b of REALM_BRANCHES) {
    const need = o.points?.[b] ?? 0;
    if (need > 0) spend(s, b, need);
  }
}

/**
 * Вести мятежа податных и голодных (docs/stability.md, 2.4) — в общей таблице, как мятеж невольников: случаем не выпадают
 * (вес ноль), их поднимает полоса недовольства (`sim/stability.stabilityTick`), лежат в своей ячейке стола и ждут ответа
 * сутки. Молчание — «Подавить силой»: стража выходит сама, как у мятежа невольников.
 */
function revoltEvents(): EventDef[] {
  const decline = daysSpan(DECLINE / DAY_LENGTH);
  /** Подпись уступки — что она поменяет у этого города сейчас (правило 18: словами того же правила, что применит ответ). */
  const concedeHint = (s: GameState): string => {
    if (revoltNow(s).group === 'hungry') return concedeWords.pay;
    const c = concession(s);
    if (c.tax) return concedeWords.tax(TAX_BY_ID[c.tax[0]].name, TAX_BY_ID[c.tax[1]].name);
    if (c.decree) return concedeWords.decree(DECREE_BY_ID.freedom.name);
    return concedeWords.nothing;
  };
  const concedeCost = (s: GameState): EventCost => (revoltNow(s).group === 'hungry' ? handout(s) : {});
  const revolt = (g: 'folk' | 'hungry'): EventDef => ({
    id: REVOLT_EVENT[g],
    silence: 0,
    title: REVOLT_TEXT.title[g],
    from: REVOLT_TEXT.from,
    text: (s) => REVOLT_TEXT.text[g](revoltNow(s).rebels),
    weight: () => 0,
    waits: REVOLT_TEXT.waits,
    options: [
      {
        label: REVOLT_TEXT.suppress,
        hint: (s) => REVOLT_TEXT.suppressHint(revoltNow(s).rebels),
        apply: (s) => {
          revoltSuppress(s);
          return REVOLT_TEXT.suppressed;
        },
      },
      {
        label: REVOLT_TEXT.concede[g],
        hint: concedeHint,
        ...(g === 'hungry' ? { cost: concedeCost } : {}),
        apply: (s) => {
          revoltConcede(s);
          return REVOLT_TEXT.conceded;
        },
      },
      {
        label: REVOLT_TEXT.wait,
        hint: REVOLT_TEXT.waitHint(decline),
        apply: (s) => {
          revoltWait(s);
          return REVOLT_TEXT.waited;
        },
      },
    ],
  });
  return [
    revolt('folk'),
    revolt('hungry'),
    {
      id: TERMS_EVENT,
      silence: 1,
      title: REVOLT_TEXT.termsTitle,
      from: REVOLT_TEXT.from,
      text: REVOLT_TEXT.termsText,
      weight: () => 0,
      waits: REVOLT_TEXT.termsRefuseHint(daysSpan((2 * DECLINE) / DAY_LENGTH)),
      options: [
        {
          label: REVOLT_TEXT.termsConcede,
          hint: concedeHint,
          cost: concedeCost,
          apply: (s) => {
            termsConcede(s);
            return REVOLT_TEXT.conceded;
          },
        },
        {
          label: REVOLT_TEXT.termsRefuse,
          hint: REVOLT_TEXT.termsRefuseHint(daysSpan((2 * DECLINE) / DAY_LENGTH)),
          apply: (s) => {
            termsRefuse(s);
            return REVOLT_TEXT.refused;
          },
        },
      ],
    },
  ];
}
