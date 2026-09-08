// Случайные события. Все числа здесь считаются от размера посёлка, а не пишутся
// константами: население доходит до сотен, и «+25 еды» или «пришёл один чужак»
// к середине партии перестают что-либо значить.
//
// Люди приходят и уходят толпой. Поимённых жителей в игре нет, поэтому событие
// про человека — это событие про группу: беженцы у ворот, бродячая артель, мор.
import type { GameState, ResourceId } from '../types';
import { DAY_LENGTH, RESOURCE_IDS, RESOURCE_META } from '../constants';
import {
  buildingOfType,
  currentSite,
  dayOf,
  defense,
  housingCapacity,
  isSite,
  jobCounts,
  population,
  storageCap,
} from '../derived';
import { resolveBattle } from '../sim/battle';
import { addPop, killPop } from '../sim/population';
import { chance, rnd } from '../sim/random';
import { log } from '../sim/log';

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
}

/**
 * Посёлок, под который писались числа событий. Всё, что событие даёт или отнимает,
 * умножается на то, во сколько раз нынешнее племя больше этого — иначе к концу
 * партии награда события тонет в дневной выработке.
 */
const REFERENCE_POP = 30;

const scale = (s: GameState): number => Math.max(1, population(s) / REFERENCE_POP);

/** Число под нынешний размер посёлка. */
const amount = (s: GameState, n: number): number => Math.max(1, Math.round(n * scale(s)));

/**
 * Сколько человек приводит толпа: доля посёлка, но не меньше горстки — иначе в
 * первые минуты партии событие про беженцев не про что.
 */
const crowd = (s: GameState, share: number, min: number): number =>
  Math.max(min, Math.round(population(s) * share));

/**
 * Сила случайного противника — доля обороны посёлка. Так волки и разбойники
 * остаются соразмерными игроку и при тридцати жителях, и при семи сотнях:
 * `resolveBattle` бросает нашу оборону в вилке ±15%, поэтому доля ниже единицы —
 * почти верная победа, около единицы — настоящая стычка.
 */
const foePower = (s: GameState, share: number): number => defense(s) * share;

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
    icon: '🐺',
    title: 'Волки',
    text: (s) => `Стая волков кружит у поселения. Их ${amount(s, 3) + Math.floor(dayOf(s.time) / 4)}.`,
    weight: (s) => (s.time > DAY_LENGTH ? 3 : 0),
    options: [
      {
        label: 'Защищаться',
        hint: 'Бой',
        apply: (s) => {
          const r = resolveBattle(s, foePower(s, 0.55), 'волки');
          if (r.won) {
            const h = addRes(s, 'hides', amount(s, 4));
            const b = addRes(s, 'bones', amount(s, 4));
            s.stats.hunts++;
            return `${r.text} Добыча: ${h} шкур, ${b} костей.`;
          }
          return r.text;
        },
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
          if (chance(0.5)) {
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
          if (chance(0.5)) {
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
    icon: '⚔️',
    title: 'Разбойники',
    text: (s) => `Чужие воины требуют дань: ${amount(s, 25)} еды, иначе нападут.`,
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
        hint: 'Бой',
        apply: (s) => {
          const r = resolveBattle(s, foePower(s, 0.85), 'разбойники');
          if (r.won) {
            const w = addRes(s, 'wood', amount(s, 15));
            const h = addRes(s, 'hides', amount(s, 5));
            return `${r.text} Трофеи: ${w} древесины, ${h} шкур.`;
          }
          return r.text;
        },
      },
    ],
  },
  {
    id: 'festival',
    icon: '🎉',
    title: 'Праздник',
    text: 'Вождь предлагает устроить праздник у костра.',
    weight: (s) => (s.resources.food >= amount(s, 25) ? 2 : 0),
    options: [
      {
        label: 'Праздновать',
        hint: 'Мораль +15',
        cost: (s) => ({ food: amount(s, 20) }),
        apply: (s) => {
          s.morale = Math.min(100, s.morale + 15);
          s.prestige += 1;
          return 'Праздник удался. Племя воодушевлено.';
        },
      },
      { label: 'Сберечь еду', apply: () => 'Праздник отложили до лучших времён.' },
    ],
  },
  {
    id: 'good_hunt',
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
  let roll = rnd() * total;
  for (const [e, w] of weighted) {
    roll -= w;
    if (roll <= 0) return e;
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
