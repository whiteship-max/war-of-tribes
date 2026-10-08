// Вести по образцу EU4: сезонные, случайные и цепочки (docs/events.md).
//
// Это те же события, что в `data/events.ts`, — та же почта, тот же стол, то же молчание и та же
// цена полем, — и стоят они в общем списке `EVENTS`. Своей таблицей они лежат затем, чтобы
// прежние вести не тонули среди новых, и затем, чтобы числа новых были видны разом, сверху файла.
//
// Что здесь нового по устройству, и где оно живёт:
// - **сезон** — вес вести спрашивает `seasonOf(s.time)`: праздник урожая ходит осенью, разлив — весной;
// - **временный усилитель** — ответ кладёт его дверью `sim/boons.grantBoon`, числа — `data/boons.ts`;
// - **цепочка** — ответ откладывает следующую весть дверью `sim/chains.scheduleChain`, на стол её
//   кладёт почта; у вести-следствия вес ноль: случаем она не выпадает, только следствием;
// - **вера** — паломники идут к своей святыне: куда — говорит вера города (`data/faiths.ts`), а вера —
//   это и есть регион: её называет мир по клетке, на которой стоит замок (`world/faith.ts`).
//
// Алмазов здесь нет ни в одном исходе и быть не может: начисление покупного одно, с распиской сервера
// (`sim/gems`), — тест по исходнику (`sim/tidings.test.ts`).
import type { GameState } from '../types';
import { FAITH_REFUSAL_STRAIN, RITE_FOOD_PER_POP } from '../constants';
import { dayOf, faithOf, jobCounts, population, seasonOf, strainNow } from '../derived';
import { addStrain } from '../sim/faith';
import { addPop, killPop, losePop } from '../sim/population';
import { chance } from '../sim/roll';
import { grantBoon } from '../sim/boons';
import { chainPending, scheduleChain } from '../sim/chains';
import { daysSpan } from '../span';
import { BOON_BY_ID, BOON_UP, boonWords } from './boons';
import { SEASON_DAYS } from './seasons';
import {
  addRes,
  amount,
  crowd,
  FameWord,
  fameWord,
  moraleWord,
  MoraleWord,
  moveFame,
  moveMorale,
  people,
} from './eventKit';
import type { EventDef } from './events';

/**
 * Числа вестей — одной таблицей, подпись и исход читают отсюда (правило 18). Своих новых величин почти нет:
 * - мораль ответа — та же шкала, что у прежних вестей (`EVENT_MORALE`: от 3 до 6), слава — та же, что у прежних
 *   (`EVENT_FAME`: от 1 до 3), и долг, не отданный купцу, стоит вдвое больше отданного;
 * - риск следствия — половина, как у мора без присмотра (`events.ts`, «Ничего не делать»): весть честно говорит
 *   «может», и игрок видит это числом;
 * - лихва купца — четверть, тем же числом, что сила доброй вести (`BOON_UP` ×1.25): ростовщик 1200 года брал
 *   от пятой до третьей части, и середина этой вилки совпала со своим числом в игре;
 * - отсрочка следствия — один или два сезона (`SEASON_DAYS`, 2 ч 30 мин настоящих на сезон): короче шага сетки
 *   вестей (8 ч), иначе следствие пришло бы позже следующей вести и не читалось бы ответом на прежнюю;
 * - доли толпы и размеры даров — в мерах прежних вестей: артель — 3 % посёлка, беженцы — 6 %, дары — 10–40 на
 *   стартовые 30 жителей (`amount`).
 */
export const TIDING = {
  /** Мораль: малая радость или досада одного ответа. */
  moraleSmall: 2,
  /** Мораль: заметная обида или радость. */
  moraleMid: 3,
  /** Мораль: беда, которую не остановили. */
  moraleBig: 4,
  /** Слава: малая. */
  fameSmall: 1,
  /** Слава: заметная. */
  fameMid: 2,
  /** Слава: долг, который не отдали. */
  fameDebt: -4,
  /** Надлом веры от корысти на святом деле — треть отказа Риму. */
  greedStrain: FAITH_REFUSAL_STRAIN / 3,
  /** Риск, что следствие придёт. */
  risk: 0.5,
  /** Лихва купца сверх взятого. */
  interest: BOON_UP - 1,
} as const;

/** Через сколько сезонов приходит следствие. */
export const CHAIN_SEASONS: Record<string, number> = {
  silt: 1,
  feud: 1,
  deserters_flee: 1,
  mine_collapse: 1,
  free_company: 1,
  pilgrims_gift: 2,
  merchant_due: 2,
};

/** Сколько в долг даёт купец — и сколько он придёт взыскать: долг и лихва сверху. */
const LOAN = 40;
const loan = (s: GameState): number => amount(s, LOAN);
const debt = (s: GameState): number => amount(s, LOAN * (1 + TIDING.interest));

/** Через сколько настоящего времени придёт следствие — словами. */
const after = (id: string): string => daysSpan(CHAIN_SEASONS[id] * SEASON_DAYS);

/** Отложить следствие на его срок. */
const later = (s: GameState, id: string): boolean => scheduleChain(s, id, CHAIN_SEASONS[id]);

/** Риск словами. */
const riskWord = `риск ${Math.round(TIDING.risk * 100)}%`;

/** Подпись усилителя: что он даёт и сколько держится. */
const boonHint = (id: string): string => `${boonWords(BOON_BY_ID[id])} на ${daysSpan(BOON_BY_ID[id].days)}`;

/** Снять надлом веры: как спор, выигранный силой (`events.ts`, раскол). */
const easeStrain = (s: GameState, n: number): void => {
  s.faith.strain = Math.max(0, strainNow(s) - n);
  s.faith.strainAt = s.time;
};

/** Сколько людей приводят перебежчики — мерой артели. */
const deserters = (s: GameState): number => crowd(s, 0.03, 4);

/** Куда идут паломники — по вере города. */
const PILGRIMS: Record<string, string> = {
  catholic: 'Паломники идут к мощам святого Иакова и просят ночлега у нашего костёла.',
  orthodox: 'Паломники идут поклониться святыням Царьграда и просят ночлега у нашего храма.',
  islam: 'Хаджи идут к Мекке и просят ночлега у нашей мечети.',
  pagan: 'К священной роще идут люди дальних родов. Просят ночлега у капища.',
};

export const TIDINGS: EventDef[] = [
  // ---------- Сезонные ----------
  {
    id: 'harvest_feast',
    silence: 2,
    icon: '🌾',
    title: 'Праздник урожая',
    text: 'Последний сноп связан. Люди ждут праздника, старосты — твоего слова.',
    weight: (s) => (seasonOf(s.time) === 'autumn' && jobCounts(s).farmer > 0 ? 3 : 0),
    options: [
      {
        label: 'Справить праздник',
        hint: () => `${boonHint('harvest_joy')}, ${fameWord(TIDING.fameSmall)}`,
        // Праздник урожая — обряд без храма: еды столько же, сколько у обряда, на каждый рот.
        cost: (s) => ({ food: Math.max(1, Math.round(population(s) * RITE_FOOD_PER_POP)) }),
        apply: (s) => {
          grantBoon(s, 'harvest_joy');
          moveFame(s, TIDING.fameSmall);
          return 'Пели до рассвета, жгли костры на жнивье. Про этот год будут вспоминать.';
        },
      },
      {
        label: 'Свезти в амбар',
        hint: (s) => `+${amount(s, 20)} еды, ${moraleWord(-TIDING.moraleSmall)}`,
        apply: (s) => {
          const n = addRes(s, 'food', amount(s, 20));
          moveMorale(s, -TIDING.moraleSmall);
          return `Всё до колоса ушло в амбар, еды прибавилось на ${n}. В городе ворчат.`;
        },
      },
      { label: 'Как всегда', hint: 'Без праздника и без потерь', apply: () => 'Праздновали по дворам, тихо.' },
    ],
  },
  {
    id: 'fair',
    silence: 2,
    icon: '🎪',
    title: 'Ярмарка',
    text: 'Купцы из трёх земель просят места на площади. Привезут сукно, соль и новости.',
    weight: (s) => {
      const season = seasonOf(s.time);
      return (season === 'summer' || season === 'autumn') && dayOf(s.time) >= 5 ? 2 : 0;
    },
    options: [
      {
        label: 'Открыть ярмарку',
        hint: () => boonHint('fair'),
        cost: (s) => ({ gold: amount(s, 20) }),
        apply: (s) => {
          grantBoon(s, 'fair');
          return 'Поставили помост и навесы. Мастерские едва поспевают за спросом.';
        },
      },
      {
        label: 'Взять пошлину',
        hint: (s) => `+${amount(s, 25)} золота, ${fameWord(-TIDING.fameSmall)}`,
        apply: (s) => {
          s.gold += amount(s, 25);
          moveFame(s, -TIDING.fameSmall);
          return 'Пошлину собрали у ворот. Купцы расторговались и уехали, браня нашу жадность.';
        },
      },
      { label: 'Не до ярмарки', hint: 'Купцы проедут мимо', apply: () => 'Купцы постояли у ворот и свернули к соседям.' },
    ],
  },
  {
    id: 'spring_flood',
    silence: 1,
    icon: '🌊',
    title: 'Весенний разлив',
    text: 'Река вышла из берегов и подступает к нижним полям. До утра вода будет у межи.',
    weight: (s) => (seasonOf(s.time) === 'spring' && jobCounts(s).farmer > 0 ? 3 : 0),
    options: [
      {
        label: 'Насыпать вал',
        hint: 'Поля останутся сухими',
        cost: (s) => ({ wood: amount(s, 12), stone: amount(s, 8) }),
        apply: () => 'Всю ночь таскали землю и камень. Вода постояла у вала и ушла.',
      },
      {
        label: 'Пусть разольётся',
        hint: () => `${boonHint('flood')}. Вода оставит ил через ${after('silt')}`,
        apply: (s) => {
          grantBoon(s, 'flood');
          later(s, 'silt');
          return 'Нижние поля ушли под воду. Старики говорят, что после воды земля родит лучше.';
        },
      },
    ],
  },
  {
    id: 'silt',
    silence: 1,
    icon: '🌱',
    title: 'Ил на полях',
    text: 'Вода ушла и оставила на лугах жирный чёрный ил. Земля просит рук.',
    // Только следствием разлива.
    weight: () => 0,
    options: [
      {
        label: 'Засеять',
        hint: () => boonHint('silt_field'),
        cost: (s) => ({ food: amount(s, 10) }),
        apply: (s) => {
          grantBoon(s, 'silt_field');
          return 'Луга засеяли по илу. Всходы поднялись дружно.';
        },
      },
      {
        label: 'Пустить скот',
        hint: () => boonHint('silt_pasture'),
        apply: (s) => {
          grantBoon(s, 'silt_pasture');
          return 'На заливной луг выгнали стадо. Трава там по колено.';
        },
      },
    ],
  },
  {
    id: 'hard_winter',
    silence: 2,
    icon: '❄️',
    title: 'Суровая зима',
    text: 'Мороз такой, что трещат брёвна. Дров уходит вдвое, и старики не помнят такой зимы.',
    weight: (s) => (seasonOf(s.time) === 'winter' ? 3 : 0),
    options: [
      {
        label: 'Раздать дрова',
        hint: 'Холод обойдёт город',
        cost: (s) => ({ wood: amount(s, 20) }),
        apply: () => 'Дрова развезли по дворам. Никто не замёрз.',
      },
      {
        label: 'Рубить лес всем городом',
        hint: () => boonHint('timber'),
        apply: (s) => {
          grantBoon(s, 'timber');
          return 'Мужчины ушли в лес с топорами. Стройка встала, зато поленницы растут.';
        },
      },
      {
        label: 'Терпеть',
        hint: () => boonHint('cold'),
        apply: (s) => {
          grantBoon(s, 'cold');
          return 'Топили чем было и терпели. Зима злая, и люди злы.';
        },
      },
    ],
  },
  {
    id: 'pilgrims',
    silence: 2,
    icon: '🙏',
    title: 'Паломники',
    text: (s) => PILGRIMS[faithOf(s) ?? ''] ?? 'Паломники просят ночлега у нашего храма.',
    weight: (s) => {
      const season = seasonOf(s.time);
      return faithOf(s) !== null && (season === 'spring' || season === 'summer') ? 2 : 0;
    },
    options: [
      {
        label: 'Дать кров',
        hint: () => `${FameWord(TIDING.fameMid)}. Через ${after('pilgrims_gift')} могут вернуться с даром`,
        cost: (s) => ({ food: amount(s, 12) }),
        apply: (s) => {
          moveFame(s, TIDING.fameMid);
          if (chance(s, TIDING.risk)) later(s, 'pilgrims_gift');
          return 'Паломников накормили и уложили в тепле. Утром они ушли с молитвой за город.';
        },
      },
      {
        label: 'Брать за постой',
        hint: (s) => `+${amount(s, 15)} золота, надлом веры +${TIDING.greedStrain}`,
        apply: (s) => {
          s.gold += amount(s, 15);
          addStrain(s, TIDING.greedStrain);
          return 'С паломников взяли за ночлег. Служитель промолчал, но запомнил.';
        },
      },
      { label: 'Пусть идут мимо', hint: 'Ни дара, ни молвы', apply: () => 'Паломники ушли дальше по дороге.' },
    ],
  },
  {
    id: 'pilgrims_gift',
    silence: 0,
    icon: '🎁',
    title: 'Дар паломников',
    text: 'Паломники, что ночевали у нас, вернулись от святыни. Принесли дар в благодарность.',
    // Только следствием ночлега.
    weight: () => 0,
    options: [
      {
        label: 'Принять дар',
        hint: (s) => `+${amount(s, 30)} золота, ${fameWord(TIDING.fameSmall)}`,
        apply: (s) => {
          s.gold += amount(s, 30);
          moveFame(s, TIDING.fameSmall);
          return 'Дар положили в казну. О нашем гостеприимстве говорят на дорогах.';
        },
      },
    ],
  },

  // ---------- Случайные ----------
  {
    id: 'noble_dispute',
    silence: 2,
    icon: '⚖️',
    title: 'Спор знати',
    text: 'Два старших рода не поделили покос у реки. Оба пришли к тебе, оба при оружии.',
    weight: (s) => (population(s) >= 40 ? 1.5 : 0),
    options: [
      {
        label: 'За старший род',
        hint: () => `${FameWord(TIDING.fameMid)}, ${moraleWord(-TIDING.moraleMid)}`,
        apply: (s) => {
          moveFame(s, TIDING.fameMid);
          moveMorale(s, -TIDING.moraleMid);
          return 'Покос отдали старшему роду. Младший смолчал, но обиду унёс.';
        },
      },
      {
        label: 'Поделить землю',
        hint: () => MoraleWord(TIDING.moraleMid),
        cost: (s) => ({ gold: amount(s, 25) }),
        apply: (s) => {
          moveMorale(s, TIDING.moraleMid);
          return 'Покос поделили межой, обиженному доплатили из казны. Оба рода довольны.';
        },
      },
      {
        label: 'Пусть решают сами',
        hint: () => `Может вспыхнуть вражда через ${after('feud')}, ${riskWord}`,
        apply: (s) => {
          if (chance(s, TIDING.risk) && later(s, 'feud')) return 'Роды ушли, глядя друг на друга волками.';
          return 'Роды поспорили и поладили сами.';
        },
      },
    ],
  },
  {
    id: 'feud',
    silence: 2,
    icon: '🗡️',
    title: 'Кровная вражда',
    text: 'Спор о покосе дошёл до крови. У реки нашли убитого, и род его требует мести.',
    // Только следствием неразобранного спора.
    weight: () => 0,
    options: [
      {
        label: 'Помирить на пиру',
        hint: () => MoraleWord(TIDING.moraleSmall),
        cost: (s) => ({ food: amount(s, 15), gold: amount(s, 10) }),
        apply: (s) => {
          moveMorale(s, TIDING.moraleSmall);
          return 'Роды сели за один стол и выпили мировую. Виру заплатила казна.';
        },
      },
      {
        label: 'Казнить зачинщиков',
        hint: (s) => `−${people(crowd(s, 0.01, 2))}, ${fameWord(TIDING.fameMid)}, ${moraleWord(-TIDING.moraleMid)}`,
        apply: (s) => {
          const n = killPop(s, crowd(s, 0.01, 2), 'казнь зачинщиков вражды');
          moveFame(s, TIDING.fameMid);
          moveMorale(s, -TIDING.moraleMid);
          return `Зачинщиков повесили у ворот, ${people(n)}. Вражда стихла, но город притих.`;
        },
      },
      {
        label: 'Не вмешиваться',
        hint: (s) => `Погибнет ${people(crowd(s, 0.02, 3))}, ${moraleWord(-TIDING.moraleBig)}`,
        apply: (s) => {
          const n = killPop(s, crowd(s, 0.02, 3), 'кровная вражда');
          moveMorale(s, -TIDING.moraleBig);
          return `Роды резались три ночи. Похоронили ${people(n)}.`;
        },
      },
    ],
  },
  {
    id: 'deserters',
    silence: 2,
    icon: '🏳️',
    title: 'Перебежчики',
    text: (s) => `Из лесной ватаги ушли ${people(deserters(s))}. Просятся к нам и клянутся служить честно.`,
    weight: (s) => (dayOf(s.time) >= 5 ? 1.5 : 0),
    options: [
      {
        label: 'Принять',
        hint: (s) => `+${people(deserters(s))}. Могут сбежать через ${after('deserters_flee')}, ${riskWord}`,
        apply: (s) => {
          const n = addPop(s, deserters(s));
          s.stats.born += n;
          if (chance(s, TIDING.risk)) later(s, 'deserters_flee');
          return `Перебежчиков приняли, ${people(n)}. Глаз с них пока не спускают.`;
        },
      },
      {
        label: 'Выдать соседям',
        hint: () => FameWord(TIDING.fameSmall),
        apply: (s) => {
          moveFame(s, TIDING.fameSmall);
          return 'Перебежчиков связали и отвезли к соседям на суд. Там это запомнят.';
        },
      },
      { label: 'Прогнать', hint: 'Уйдут обратно в лес', apply: () => 'Перебежчиков прогнали от ворот.' },
    ],
  },
  {
    id: 'deserters_flee',
    silence: 1,
    icon: '🌙',
    title: 'Ночной побег',
    text: (s) => `Перебежчики ушли ночью и сманили с собой своих. Пропало ${people(deserters(s))}.`,
    // Только следствием принятых перебежчиков.
    weight: () => 0,
    options: [
      {
        label: 'Снарядить погоню',
        hint: () => `Всех вернут, ${fameWord(TIDING.fameSmall)}`,
        cost: (s) => ({ food: amount(s, 5) }),
        apply: (s) => {
          moveFame(s, TIDING.fameSmall);
          return 'Погоня настигла беглецов у брода и вернула всех.';
        },
      },
      {
        label: 'Махнуть рукой',
        hint: (s) => `−${people(deserters(s))}, ${fameWord(-TIDING.fameSmall)}`,
        apply: (s) => {
          const n = losePop(s, Math.min(deserters(s), Math.max(0, s.pop - 1)));
          moveFame(s, -TIDING.fameSmall);
          return `Ушли и не вернулись, ${people(n)}. Над нами смеются.`;
        },
      },
    ],
  },
  {
    id: 'mine_find',
    silence: 2,
    icon: '⛏️',
    title: 'Находка в руднике',
    text: 'Рудокопы пробили стену забоя и нашли серебряную жилу. Идёт глубоко под старую выработку.',
    weight: (s) => (jobCounts(s).miner > 0 ? 1.5 : 0),
    options: [
      {
        label: 'Копать глубже',
        hint: (s) =>
          `+${amount(s, 20)} золота, ${boonHint('vein').toLowerCase()}. Может обвалиться через ${after('mine_collapse')}, ${riskWord}`,
        cost: (s) => ({ food: amount(s, 10) }),
        apply: (s) => {
          s.gold += amount(s, 20);
          grantBoon(s, 'vein');
          if (chance(s, TIDING.risk)) later(s, 'mine_collapse');
          return 'Жилу взяли в работу. Серебро пошло в казну, а забой уходит всё глубже.';
        },
      },
      {
        label: 'Отдать на храм',
        hint: () => `Надлом веры −${FAITH_REFUSAL_STRAIN}, ${fameWord(TIDING.fameSmall)}`,
        apply: (s) => {
          easeStrain(s, FAITH_REFUSAL_STRAIN);
          moveFame(s, TIDING.fameSmall);
          return 'Первое серебро отдали на храм. В приходе говорят, что это знак.';
        },
      },
      { label: 'Не трогать', hint: 'Жила подождёт', apply: () => 'Забой подперли брёвнами и оставили как есть.' },
    ],
  },
  {
    id: 'mine_collapse',
    silence: 1,
    icon: '💥',
    title: 'Обвал в руднике',
    text: 'Глубокий забой обвалился. Под землёй остались рудокопы, слышно, как они стучат.',
    // Только следствием глубокой выработки.
    weight: () => 0,
    options: [
      {
        label: 'Откопать людей',
        hint: 'Все выйдут живыми',
        cost: (s) => ({ wood: amount(s, 10) }),
        apply: () => 'Крепь ставили сутки без сна. Всех вывели живыми.',
      },
      {
        label: 'Закрыть забой',
        hint: (s) => `−${people(crowd(s, 0.01, 2))}, ${boonHint('shut_vein').toLowerCase()}`,
        apply: (s) => {
          const n = killPop(s, crowd(s, 0.01, 2), 'обвал в руднике');
          grantBoon(s, 'shut_vein');
          return `Забой завалили. Под землёй остались ${people(n)}.`;
        },
      },
    ],
  },
  {
    id: 'merchant_loan',
    silence: 1,
    icon: '🧳',
    title: 'Щедрый купец',
    text: (s) => `Заезжий купец предлагает ${loan(s)} золота в долг. Вернуть просит с лихвой, когда поедет обратно.`,
    // Пока прежний долг не взыскан, второго купец не даёт.
    weight: (s) => (dayOf(s.time) >= 5 && !chainPending(s, 'merchant_due') ? 1 : 0),
    options: [
      {
        label: 'Взять в долг',
        hint: (s) => `+${loan(s)} золота. Через ${after('merchant_due')} придёт взыскать ${debt(s)}`,
        apply: (s) => {
          s.gold += loan(s);
          later(s, 'merchant_due');
          return 'Купец отсчитал золото и уехал по своим делам. Обещал вернуться.';
        },
      },
      { label: 'Поблагодарить', hint: 'Без долга', apply: () => 'Купца поблагодарили и проводили.' },
    ],
  },
  {
    id: 'merchant_due',
    silence: 1,
    icon: '📜',
    title: 'Купец за долгом',
    text: (s) => `Купец вернулся с распиской. Ждёт ${debt(s)} золота, как уговаривались.`,
    // Только следствием взятого долга.
    weight: () => 0,
    options: [
      {
        label: 'Вернуть с лихвой',
        hint: () => FameWord(TIDING.fameMid),
        cost: (s) => ({ gold: debt(s) }),
        apply: (s) => {
          moveFame(s, TIDING.fameMid);
          return 'Долг вернули до монеты. Купец пообещал хвалить нас на всех торгах.';
        },
      },
      {
        label: 'Не отдавать',
        hint: () => FameWord(TIDING.fameDebt),
        apply: (s) => {
          moveFame(s, TIDING.fameDebt);
          return 'Купца выставили за ворота с его распиской. О нашем слове будут говорить дурное.';
        },
      },
    ],
  },
];
