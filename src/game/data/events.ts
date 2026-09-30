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
  RESOURCE_IDS,
  RESOURCE_META,
  RITE_DAYS,
  START_POP,
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
  population,
  seasonOf,
  storageCap,
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
import { daysBoth } from '../span';

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

/**
 * Всё, что событие даёт или отнимает, умножается на то, во сколько раз нынешнее
 * племя больше стартового (`START_POP` — под него числа событий и писались), —
 * иначе к концу партии награда события тонет в дневной выработке.
 */
const scale = (s: GameState): number => Math.max(1, population(s) / START_POP);

/** Число под нынешний размер посёлка. */
const amount = (s: GameState, n: number): number => Math.max(1, Math.round(n * scale(s)));

/**
 * Сколько человек приводит толпа: доля посёлка, но не меньше горстки — иначе в
 * первые минуты партии событие про беженцев не про что.
 */
const crowd = (s: GameState, share: number, min: number): number =>
  Math.max(min, Math.round(population(s) * share));

/**
 * Сила случайного противника у ворот — по уровню посёлка, таблицей (слово владельца по 14.35, пп. 4 и 6): для типичного
 * гарнизона уровня L ровный бой — сила пришедших, при которой они берут верх в половине боёв, — делённый на перевес
 * «Ограничителя» 1.1. Типичный гарнизон уровня (слово владельца 30.09.2026) — гарнизон игрока «по умолчанию» спора за золото
 * (`pop-gold.typicalTowns`: высокий налог, найм по средствам) в минуту, когда его жители доходят до жителей мерки уровня
 * (`GATE_POP`), всё войско дома, вера — его; ровный бой — медиана по двенадцати потокам случайности. Типичный отбивается чаще,
 * сильный — ещё чаще, слабый — реже; масштаба под нашу силу нет, и стать сильнее имеет смысл. Числа — мощь пришедших уровней
 * 1…10, по строке на противника. **Руками их не правят:** их выводит и сверяет с этими `npm run raid-mix:report`, раздел 4б,
 * на нынешнем ядре боя. Партии мерки бьются у ворот с этой же таблицей, поэтому она — неподвижная точка: выводится заново, пока
 * выведенная не сойдётся с игровой (как сходится и где качается — docs/battle_eu4.md, 14.35, заход 30.09 (день), шаг 2); ядро
 * или шаг кости сдвинулись — выводится заново той же командой. Бьются пришедшие ядром боя у ворот той же дверью, что набег
 * (`sim/gate`, `LocalWorld.gateFight`; docs/battle_eu4.md, 14.28).
 */
export const GATE_POWER: Record<GateFoe, readonly number[]> = {
  wolves: [134, 228, 366, 514, 818, 1548, 2088, 2182, 2273, 2590],
  raiders: [226, 388, 563, 725, 889, 1274, 1474, 1569, 1804, 2009],
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
  return 'Племя вышло к воротам. Чем кончилось — скажет отчёт в «Походах».';
};

/** Сколько беженцев влезет под свободные крыши. Считают это двое: цена и сам выбор. */
const fitting = (s: GameState): number =>
  Math.min(crowd(s, 0.06, 8), Math.max(0, housingCapacity(s) - s.pop));

const addRes = (s: GameState, r: keyof GameState['resources'], n: number): number => {
  const cap = storageCap(s);
  const before = s.resources[r];
  s.resources[r] = Math.max(0, Math.min(cap, before + n));
  return Math.round(s.resources[r] - before);
};

/** Склонение «N человек / человека». */
const people = (n: number): string => {
  const t = n % 100;
  const o = n % 10;
  if (t >= 11 && t <= 14) return `${n} человек`;
  if (o === 1) return `${n} человек`;
  if (o >= 2 && o <= 4) return `${n} человека`;
  return `${n} человек`;
};

export const EVENTS: EventDef[] = [
  {
    id: 'refugees',
    silence: 2,
    icon: '🚶',
    title: 'Беженцы у ворот',
    text: (s) =>
      `С юга пришла толпа: ${people(crowd(s, 0.06, 8))}. Их деревню сожгли, они просятся под стену.`,
    // Когда селить некуда, толпа приходит реже: событие про выбор, а не про отказ.
    weight: (s) => (s.pop < housingCapacity(s) ? 3 : 1),
    options: [
      {
        label: 'Принять всех',
        hint: (s) => `+${crowd(s, 0.06, 8)} чел.`,
        cost: (s) => ({ food: amount(s, 8) }),
        apply: (s) => {
          const n = crowd(s, 0.06, 8);
          addPop(s, n);
          s.stats.born += n;
          const over = s.pop - housingCapacity(s);
          log(s, `Приняты беженцы: +${n} чел.`, 'good');
          return over > 0
            ? `Пришло ${people(n)}. Под крышей тесно: лишних ${over} — мораль просядет, пока не построишь жильё.`
            : `Пришло ${people(n)}. Все под крышей.`;
        },
      },
      {
        label: 'Взять, сколько поместится',
        hint: 'Только под свободные крыши',
        // Кормят ровно тех, кого взяли, поэтому и цена — доля от полной.
        // Считается она тем же `fitting`, каким считается число принятых: иначе
        // показанное «нужно» разошлось бы со списанным при первой же правке.
        cost: (s) => ({ food: Math.round(amount(s, 8) * (fitting(s) / crowd(s, 0.06, 8))) }),
        apply: (s) => {
          const n = fitting(s);
          if (n <= 0) {
            s.morale = Math.max(0, s.morale - 3);
            return 'Свободных крыш нет вовсе. Толпа ушла дальше, и в посёлке об этом говорят.';
          }
          const want = crowd(s, 0.06, 8);
          addPop(s, n);
          s.stats.born += n;
          return `Приняли ${people(n)} из ${want}. Остальные пошли дальше.`;
        },
      },
      {
        label: 'Прогнать',
        hint: 'Мораль −4',
        apply: (s) => {
          s.morale = Math.max(0, s.morale - 4);
          return 'Толпу развернули от ворот. В посёлке этим недовольны.';
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
      `К воротам вышла артель: ${people(crowd(s, 0.03, 5))} с инструментом. Просят кормёжку и место у костра.`,
    weight: (s) => (s.pop >= 20 ? 1.5 : 0.5),
    options: [
      {
        label: 'Взять к себе',
        hint: (s) => `+${crowd(s, 0.03, 5)} чел. и работа на стройке`,
        cost: (s) => ({ food: amount(s, 16) }),
        apply: (s) => {
          const n = crowd(s, 0.03, 5);
          addPop(s, n);
          s.stats.born += n;
          // Артель приходит с инструментом: первое дело — помочь на стройке.
          const site = currentSite(s);
          if (site) {
            const done = Math.min(site.workRequired - site.work, site.workRequired * 0.2);
            site.work += done;
            return `Артель осталась: +${n} чел. С ходу взялись за стройку и подняли её на пятую часть.`;
          }
          return `Артель осталась: +${n} чел. Стройки нет — руки пока свободны.`;
        },
      },
      {
        label: 'Нанять на день',
        hint: 'Стройка заметно продвинётся',
        cost: (s) => ({ gold: amount(s, 20) }),
        apply: (s) => {
          const site = currentSite(s);
          if (!site) return 'Золото заплачено, а работы для них не нашлось. Вождь остался в дураках.';
          site.work = Math.min(site.workRequired, site.work + site.workRequired * 0.35);
          return 'Артель отработала день и ушла. Стройка заметно продвинулась.';
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
    text: (s) => `Стая волков кружит у поселения. Их ${gateMen(s, 'wolves')}.`,
    // Волки — угроза слабого посёлка: к городу, который логово уже замечает, они не приходят (слово владельца по 14.35, п. 6).
    weight: (s) => (s.time > DAY_LENGTH && weakVillage(s) ? 3 : 0),
    options: [
      {
        label: 'Защищаться',
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
        hint: 'Стройка не потеряет ни дня',
        cost: (s) => ({ wood: amount(s, 10) }),
        apply: () => {
          return 'Стройку удалось починить.';
        },
      },
      {
        label: 'Оставить',
        hint: 'Стройка потеряет прогресс',
        apply: (s) => {
          const b = s.buildings.find(isSite);
          if (b) b.work *= 0.5;
          return 'Часть работы придётся переделать.';
        },
      },
    ],
  },
  {
    id: 'trade',
    silence: 1,
    icon: '🤝',
    title: 'Соседи предлагают обмен',
    text: (s) => `Соседнее племя предлагает ${amount(s, 30)} еды за ${amount(s, 20)} древесины.`,
    weight: (s) => (s.resources.wood >= amount(s, 20) ? 2 : 0),
    options: [
      {
        label: 'Обменять',
        hint: (s) => `+${amount(s, 30)} еды`,
        cost: (s) => ({ wood: amount(s, 20) }),
        apply: (s) => {
          addRes(s, 'food', amount(s, 30));
          s.prestige += 1;
          return 'Обмен состоялся. Соседи довольны.';
        },
      },
      { label: 'Отказаться', apply: () => 'Соседи ушли ни с чем.' },
    ],
  },
  {
    id: 'sickness',
    silence: 2,
    icon: '🤒',
    title: 'Мор',
    text: (s) => `По дворам пошла хворь. Слегло уже ${people(crowd(s, 0.04, 3))}.`,
    weight: (s) => (s.pop >= 12 ? 1.5 : 0),
    options: [
      {
        label: 'Молебен жрецов',
        hint: 'Нужен жрец',
        apply: (s) => {
          if (jobCounts(s).priest > 0) {
            s.morale = Math.min(100, s.morale + 4);
            return 'Шаманы обошли дворы. Хворь отступила, племя воодушевлено.';
          }
          if (chance(s, 0.5)) {
            const n = killPop(s, crowd(s, 0.04, 3), 'мор');
            return `Без жреца обряда не вышло. Мор унёс ${people(n)}.`;
          }
          return 'Обряда не было, но хворь ушла сама.';
        },
      },
      {
        label: 'Выхаживать',
        hint: 'Все поправятся, никто не умрёт',
        cost: (s) => ({ food: amount(s, 20) }),
        apply: () => {
          return 'Больных выходили горячим варевом. Все поправились.';
        },
      },
      {
        label: 'Ничего не делать',
        hint: 'Риск',
        apply: (s) => {
          if (chance(s, 0.5)) {
            const n = killPop(s, crowd(s, 0.05, 4), 'мор');
            s.morale = Math.max(0, s.morale - 5);
            return `Мор прошёл по посёлку и унёс ${people(n)}. Племя скорбит.`;
          }
          return 'На этот раз обошлось: хворь отступила сама.';
        },
      },
    ],
  },
  {
    id: 'raiders',
    silence: 1,
    icon: '⚔️',
    title: 'Разбойники',
    text: (s) => `Чужие воины требуют дань: ${amount(s, 25)} еды, иначе нападут. Их ${gateMen(s, 'raiders')}.`,
    weight: (s) => (dayOf(s.time) >= 5 ? 2 : 0),
    options: [
      {
        label: 'Заплатить',
        hint: 'Уйдут без боя, престиж просядет',
        cost: (s) => ({ food: amount(s, 25) }),
        apply: (s) => {
          s.prestige = Math.max(0, s.prestige - 2);
          return 'Дань уплачена. Разбойники ушли, но престиж пострадал.';
        },
      },
      {
        label: 'Сражаться',
        hint: 'Бой у ворот',
        apply: (s) => toGate(s, 'raiders', { wood: amount(s, 15), hides: amount(s, 5) }),
      },
    ],
  },
  {
    id: 'festival',
    silence: 1,
    icon: '🎉',
    title: 'Приход зовёт на праздник',
    text: (s) => {
      const f = faithDef(s);
      const feast = f ? f.feasts[seasonOf(s.time)] : null;
      return feast
        ? `${feast.name}. ${feast.text} Ждут только слова вождя.`
        : 'Вождь предлагает устроить праздник у костра.';
    },
    // Пока обряд справить нельзя — в этом сезоне уже справляли, идёт другой,
    // не хватает добра, — событие не поднимается вовсе: окно с двумя гашеными
    // кнопками игрок читает как сломанную игру.
    weight: (s) => (riteInfo(s).blocked === null ? 3 : 0),
    options: [
      {
        label: 'Справить',
        hint: `Набожность и настроение на ${daysBoth(RITE_DAYS)}`,
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
          s.prestige += 1;
          return f
            ? `${f.feasts[seasonOf(s.time)].name} прошёл как надо. Приход и деревня довольны.`
            : 'Праздник удался. Племя воодушевлено.';
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
    text: 'Легат привёз грамоту с печатью: святой престол собирает на поход и ждёт нашей доли. Отказавших запоминают.',
    // Только у латинского обряда: связь с Римом — его наклон, и ни у кого
    // больше такой грамоты быть не может.
    weight: (s) => (faithOf(s) === 'catholic' ? 2 : 0),
    options: [
      {
        label: 'Дать, сколько просят',
        hint: 'Слава племени растёт, и в Риме это запомнят',
        cost: (s) => ({ gold: amount(s, 60) }),
        apply: (s) => {
          s.prestige += 3;
          return 'Легат уехал довольным. Имя нашего вождя прозвучало в грамоте ответной.';
        },
      },
      {
        label: 'Отказать',
        hint: 'Добро остаётся дома',
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
    text: 'Из дальнего аббатства пришёл обоз: о нашей беде услышали и прислали хлеба, не спросив ничего взамен.',
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
          return `Обоз разгрузили: ${f} еды в закромах. В храме служили благодарственную.`;
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
    text: 'У колодца проповедует чужой: говорит, что в храме лгут, а правда у него. Половина деревни слушает.',
    // Событие поднимается только тогда, когда вера действительно трещит:
    // раскол на здоровом приходе был бы шумом.
    weight: (s) => (heresy(s) ? 4 : 0),
    options: [
      {
        label: 'Позвать учёного проповедника',
        hint: 'Спор выигран словом — надлом затягивается',
        cost: (s) => ({ gold: amount(s, 45) }),
        apply: (s) => {
          // Спор выигран: надлом снимается целиком, а не наполовину — за это и
          // платили. Само по себе это ереси не отменит, если давит округа или
          // пустует храм: набожность считается из всего разом.
          s.faith.strain = 0;
          s.faith.strainAt = s.time;
          return 'Приезжий говорил три дня и переспорил. Чужой ушёл ночью, и приход выдохнул.';
        },
      },
      {
        label: 'Разогнать силой',
        hint: 'Спорить перестанут сразу',
        apply: (s) => {
          s.morale = Math.max(0, s.morale - 6);
          s.faith.strain = Math.max(0, strainNow(s) - FAITH_REFUSAL_STRAIN);
          s.faith.strainAt = s.time;
          return 'Проповедника вывели за ворота. Спорить перестали, но смотрят исподлобья.';
        },
      },
      {
        label: 'Пусть говорят',
        hint: 'Никого не трогаем',
        apply: (s) => {
          addStrain(s, FAITH_REFUSAL_STRAIN);
          s.morale = Math.min(100, s.morale + 4);
          return 'Чужого не тронули. Люди довольны, что их не гонят, — а в храме стало пусто.';
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
        ? `У ворот стоит странник и просится в ${f.temple.toLowerCase()}. Говорит, что несёт святыню — «${f.relic}», — и что ей место у нас.`
        : 'У ворот стоит странник и просится в храм.';
    },
    // Своей святыни ещё нет, вера уже известна. Редко: реликвия должна остаться
    // событием, а не строкой расходов.
    weight: (s) => (faithOf(s) !== null && !s.faith.relic ? 1 : 0),
    options: [
      {
        label: 'Принять святыню',
        hint: 'Пока она в храме, приход крепче',
        cost: (s) => ({ gold: amount(s, 70), hides: amount(s, 12) }),
        apply: (s) => {
          grantRelic(s);
          return 'Странника накормили и одарили. Святыню поставили на видное место.';
        },
      },
      {
        label: 'Накормить и проводить',
        hint: 'Странник уходит своей дорогой',
        apply: () => 'Странника накормили и проводили до просёлка. Что он нёс — так и не узнали.',
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
        label: 'Отлично!',
        hint: (s) => `+${amount(s, 20)} еды, +${amount(s, 5)} шкур`,
        apply: (s) => {
          const f = addRes(s, 'food', amount(s, 20));
          const h = addRes(s, 'hides', amount(s, 5));
          addRes(s, 'bones', amount(s, 3));
          s.stats.hunts++;
          return `Добыто ${f} еды и ${h} шкур.`;
        },
      },
    ],
  },
  {
    id: 'fire',
    silence: 1,
    icon: '🔥',
    title: 'Пожар',
    text: 'Искра от костра попала на крышу одного из дворов!',
    weight: (s) => ((buildingOfType(s, 'houses')?.level ?? 0) >= 2 ? 1 : 0),
    options: [
      {
        label: 'Тушить всем племенем',
        hint: 'Дворы останутся целы',
        cost: (s) => ({ food: amount(s, 10) }),
        apply: () => {
          return 'Двор отстояли. Все устали, но довольны.';
        },
      },
      {
        label: 'Спасать вещи',
        hint: 'Жилища потеряют уровень',
        apply: (s) => {
          // Жилища в посёлке одни: сносить их целиком — значит отнять всё жильё разом.
          // Огонь съедает улицу дворов, то есть один уровень.
          const houses = buildingOfType(s, 'houses');
          if (houses && houses.level > 1) houses.level -= 1;
          addRes(s, 'wood', amount(s, 5));
          return 'Крайние дворы выгорели дотла. Удалось спасти немного древесины.';
        },
      },
    ],
  },
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
  return `Не хватает: ${short.join(', ')}.`;
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
