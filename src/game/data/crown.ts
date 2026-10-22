// Вести державы (СБ-2, docs/stability.md, «СБ-2»): таблица — заголовок, кто пишет, заставка, условия и вес, ответы с ценой
// и последствиями. Стабильность и очки каждого ответа — в общей с сервером таблице правил (`crownrules.CROWN_RULES`), здесь
// их нет: число у ответа одно. Текст вести и исход словами летописи — своим куском (`data/crownWords.ts`): шагу партии
// слова не нужны, и первая загрузка за них не платит.
//
// **Вес — это условие и его сила** (как `modifier factor` у EU4): ноль — вести сейчас не бывает, единица — обычная частота,
// три — условие гонит её втрое чаще. Среднее время до наступления — срок по редкости, делённый на вес (`sim/crown`).
//
// Последствия — данными (`Fx`), а не кодом в ответе: по ним одним ответ исполняется (`sim/crown.applyCrown`), подпись
// называет числа и окно рисует «что изменится» (правило 18). Склад и золото — от размера города (`amount`), как у прочих
// вестей; обида и милость групп — усилители (`data/boons`, `MOOD_*`), вера — надлом той же двери, что отказ Риму.
import type { EstateId, GameState, RealmBranch, ResourceId } from '../types';
import type { EventCost } from './events';
import { FAITH_REFUSAL_STRAIN } from '../constants';
import {
  armySize,
  bondedTotal,
  buildingOfType,
  dayOf,
  estateGiftPrice,
  estatesNow,
  faithDef,
  faithOf,
  foodConsumptionPerDay,
  heresy,
  jobCounts,
  marketLevel,
  orderState,
  seasonOf,
} from '../derived';
import { amount, crowd } from './eventKit';
import { barsOf, stabLevel, stabOf, STAB_GROUPS } from '../sim/stability';
import { rulerAging } from '../sim/dynasty';
import { DISLOYAL, ESTATES, ESTATE_DOMINANT, ESTATE_EVEN, LOYAL, PRIV_MAX, privOf } from '../estaterules';
import { ESTATE_META, estateVerb } from './estates';
import { estateBoon } from './boons';

/** Заставка вести — сцена города или покоев, нарисованная кодом (`ui/realm/crownScene.tsx`). */
export type CrownScene =
  | 'church'
  | 'hall'
  | 'chamber'
  | 'square'
  | 'market'
  | 'field'
  | 'sky'
  | 'fire'
  | 'gate'
  | 'road'
  | 'lists';

/** Последствие ответа, кроме стабильности и притока очков — их называет таблица правил. */
export type Fx =
  /** Усилитель: обида или милость группы, засуха, грамота (`data/boons`). */
  | { k: 'boon'; id: string }
  | { k: 'res'; r: ResourceId; n: number }
  | { k: 'gold'; n: number }
  | { k: 'fame'; n: number }
  | { k: 'morale'; n: number }
  /** Надлом веры — той же дверью, что отказ Риму (`sim/faith.addStrain`). */
  | { k: 'strain'; n: number }
  /** Люди уходят из города (минус) — дверью населения; `died` — умирают (мор), иначе уходят живыми. */
  | { k: 'pop'; n: number; died?: true }
  /** Невольники уходят — дверью населения. */
  | { k: 'bonded'; n: number }
  /** В храме появляется святыня, если её ещё нет. */
  | { k: 'relic' }
  /** Следствие: весть `id` через `seasons` сезонов с вероятностью `p`. */
  | { k: 'chain'; id: string; p: number; seasons: number }
  /** Сословию — следующая привилегия (`sim/estates.grantPrivilege`); `name` — её имя, названное окну до ответа. */
  | { k: 'priv'; e: EstateId; name: string };

export interface CrownOpt {
  label: string;
  /** Что ответ просит со склада и из золота — от размера города. */
  cost?: (s: GameState) => EventCost;
  /** Что ответ просит из очков правителя. */
  points?: Partial<Record<RealmBranch, number>>;
  /** Что ответ даёт и отнимает сверх стабильности и очков. */
  fx?: (s: GameState) => Fx[];
}

export interface CrownDef {
  id: string;
  title: string;
  from: string | ((s: GameState) => string);
  scene: CrownScene;
  /** Условие и его сила: 0 — вести сейчас не бывает. Следствие случаем не выпадает — у него вес не спрашивается. */
  weight: (s: GameState) => number;
  /** Какой ответ случается, если игрок не ответил за сутки: бесплатный, «никто ничего не решил». */
  silence: number;
  opts: CrownOpt[];
}

// ---------- Мерки условий ----------

const day = (s: GameState): number => dayOf(s.time);
const on = (c: boolean, w = 1): number => (c ? w : 0);
/** Сколько дней город ест из закромов. */
const foodDays = (s: GameState): number => s.resources.food / Math.max(1e-9, foodConsumptionPerDay(s));
/** Беды нет: ни осады, ни мятежа, ни одной полосы выше четверти, стабильность не ниже «Мира». */
const quiet = (s: GameState): boolean => {
  const bars = barsOf(s);
  return !s.siege && !stabOf(s).revolt && stabLevel(s) >= 0 && STAB_GROUPS.every((g) => bars[g] < 25);
};
const skill = (s: GameState, b: RealmBranch): number => s.realm?.ruler?.skills?.[b] ?? 0;
const priest = (s: GameState): string => faithDef(s)?.priest ?? 'Настоятель';
/** Вера, у которой бывает поход за веру. */
const holyWar = (s: GameState): boolean => {
  const f = faithOf(s);
  return f === 'catholic' || f === 'orthodox' || f === 'islam';
};

// ---------- Числа последствий ----------

/** Надлом веры: отказ Риму — `FAITH_REFUSAL_STRAIN`; вольная проповедь — половина; запрет похода и чужие проповедники — треть. */
const STRAIN = { refuse: FAITH_REFUSAL_STRAIN, sermon: FAITH_REFUSAL_STRAIN / 2, small: FAITH_REFUSAL_STRAIN / 3 } as const;

const gold = (n: number) => (s: GameState): EventCost => ({ gold: amount(s, n) });

/** Лояльность сословия от ответа (РТ-2): расположение или обида — зависть одной привилегии на сезон (`data/boons`). */
const up = (e: EstateId): Fx => ({ k: 'boon', id: estateBoon('up', e) });
const down = (e: EstateId): Fx => ({ k: 'boon', id: estateBoon('down', e) });

// ---------- Вести сословий (РТ-2) ----------
//
// Три вида на каждое сословие (docs/stability.md, Р1.7): **дар** — сословие верно; **жалоба** — ропщет, и чем больше его влияние,
// тем чаще; **требует власти** — держит перевес, и неверное требует втрое чаще. В ровной игре (без привилегий, лояльность 50,
// без перевеса) вес у всех ноль: частота вестей державы и её срок (`CROWN_MTTH`) не едут. Стабильность и очки ответов — в
// таблице правил (`crownrules`), слова — `crownWords`.

/** Вид вести сословия. */
export const estateCrownId = (kind: 'gift' | 'plea' | 'power', e: EstateId): string => `cr_es_${kind}_${e}`;

/** Кто говорит от сословия. */
const ESTATE_VOICE: Record<EstateId, string | ((s: GameState) => string)> = {
  merchants: 'Старшина купцов',
  guilds: 'Цеховой старшина',
  peasants: 'Староста общины',
  knights: 'Старший рыцарь',
  clergy: priest,
};

/** Где сословие: торг, площадь, поле, ристалище, храм. */
const ESTATE_SCENE: Record<EstateId, CrownScene> = { merchants: 'market', guilds: 'square', peasants: 'field', knights: 'lists', clergy: 'church' };

/** Что сословие приносит в дар: купцы — золото, цехи — руки на стройку, крестьяне — хлеб; рыцари — очки войны и духовенство —
 * стабильность — в таблице правил. */
const GIFT_FX: Record<EstateId, (s: GameState) => Fx[]> = {
  merchants: (s) => [{ k: 'gold', n: amount(s, 40) }],
  guilds: () => [{ k: 'boon', id: 'mercs' }],
  peasants: (s) => [{ k: 'res', r: 'food', n: amount(s, 60) }],
  knights: () => [],
  clergy: () => [],
};

/** Следующая привилегия сословию; обе дарованы — расположение. */
const nextPriv = (s: GameState, e: EstateId): Fx => {
  const n = privOf(s.estates?.priv, e);
  return n < PRIV_MAX ? { k: 'priv', e, name: ESTATE_META[e].priv[n] } : up(e);
};

function estateCrown(): CrownDef[] {
  return ESTATES.flatMap((e): CrownDef[] => {
    const m = ESTATE_META[e];
    const now = (s: GameState) => estatesNow(s)[e];
    return [
      {
        id: estateCrownId('gift', e),
        title: `Дар: ${m.name.toLowerCase()}`,
        from: ESTATE_VOICE[e],
        scene: ESTATE_SCENE[e],
        weight: (s) => on(now(s).loyalty >= LOYAL),
        silence: 1,
        opts: [
          // Почёт — пир: хлебом, а крестьянам, что везут хлеб, — золотом (цена и дар не одним добром).
          { label: 'Принять с почётом', cost: (s) => (e === 'peasants' ? { gold: amount(s, 10) } : { food: amount(s, 10) }), fx: (s) => [...GIFT_FX[e](s), up(e)] },
          { label: 'Принять дар', fx: (s) => GIFT_FX[e](s) },
        ],
      },
      {
        id: estateCrownId('plea', e),
        title: `Жалоба: ${m.name.toLowerCase()}`,
        from: ESTATE_VOICE[e],
        scene: ESTATE_SCENE[e],
        // Чем сильнее ропщущее сословие, тем чаще оно жалуется: вес — его влияние в ровных долях.
        weight: (s) => on(now(s).loyalty < DISLOYAL, Math.max(1, now(s).infl / ESTATE_EVEN)),
        silence: 2,
        opts: [
          { label: 'Одарить', cost: (s) => estateGiftPrice(s, e), fx: () => [{ k: 'boon', id: estateBoon('gift', e) }] },
          { label: 'Выслушать в совете', points: { admin: 20 }, fx: () => [up(e)] },
          { label: 'Отказать', fx: () => [down(e)] },
        ],
      },
      {
        id: estateCrownId('power', e),
        title: `${m.name} ${estateVerb(e, 'требует', 'требуют')} власти`,
        from: ESTATE_VOICE[e],
        scene: 'hall',
        weight: (s) => on(now(s).infl >= ESTATE_DOMINANT, now(s).loyalty < LOYAL ? 3 : 1),
        silence: 2,
        opts: [
          { label: 'Даровать привилегию', fx: (s) => [nextPriv(s, e)] },
          { label: 'Созвать все сословия', points: { diplo: 30 }, fx: () => [up(e)] },
          { label: 'Отказать', fx: () => [down(e), { k: 'boon', id: 'cr_promise' }] },
        ],
      },
    ];
  });
}

// ---------- Таблица ----------

export const CROWN: CrownDef[] = [
  // ---------- Добрые ----------
  {
    id: 'cr_miracle',
    title: 'Чудо у святыни',
    from: priest,
    scene: 'church',
    weight: (s) => on(faithOf(s) !== null && !!s.faith.relic && day(s) >= 5),
    silence: 1,
    opts: [
      { label: 'Ход со святыней', cost: (s) => ({ food: amount(s, 15) }), fx: () => [{ k: 'fame', n: 2 }, { k: 'morale', n: 2 }] },
      { label: 'Возблагодарить тихо' },
    ],
  },
  {
    id: 'cr_good_year',
    title: 'Год без беды',
    from: 'Летописец',
    scene: 'hall',
    weight: (s) => on(day(s) >= 20 && quiet(s)),
    silence: 1,
    opts: [{ label: 'Отслужить молебен', cost: gold(15) }, { label: 'Записать в летопись' }],
  },
  {
    id: 'cr_wedding',
    title: 'Свадьба в знатном доме',
    from: 'Управитель',
    scene: 'hall',
    weight: (s) => on(s.pop >= 40 && day(s) >= 5),
    silence: 1,
    opts: [{ label: 'Почтить пир дарами', cost: gold(20), fx: () => [{ k: 'fame', n: 1 }] }, { label: 'Послать поздравление' }],
  },
  {
    id: 'cr_vow',
    title: 'Клятва верности',
    from: 'Герольд',
    scene: 'hall',
    weight: (s) => on(s.stats.battlesWon >= 3 || s.prestige >= 30),
    silence: 1,
    opts: [
      { label: 'Принять клятву на пиру', cost: (s) => ({ food: amount(s, 15), gold: amount(s, 10) }), fx: () => [{ k: 'fame', n: 2 }, up('knights')] },
      { label: 'Принять без пира' },
    ],
  },
  {
    id: 'cr_scholar',
    title: 'Учёный муж',
    from: 'Управитель',
    scene: 'chamber',
    weight: (s) => on(day(s) >= 10),
    silence: 1,
    opts: [{ label: 'Дать кров и жалованье', cost: gold(25) }, { label: 'Отпустить с миром' }],
  },
  {
    id: 'cr_song',
    title: 'Песнь о победе',
    from: 'Глашатай',
    scene: 'square',
    weight: (s) => on(s.stats.battlesWon >= 1),
    silence: 1,
    opts: [{ label: 'Наградить певцов', cost: gold(10), fx: () => [{ k: 'fame', n: 2 }] }, { label: 'Слушать у огня' }],
  },
  {
    id: 'cr_fair_right',
    title: 'Грамота на ярмарку',
    from: 'Гонец короны',
    scene: 'market',
    weight: (s) => on(marketLevel(s) > 0),
    silence: 1,
    opts: [
      { label: 'Выкупить грамоту', cost: gold(40), points: { diplo: 30 }, fx: () => [{ k: 'boon', id: 'cr_fair_right' }] },
      { label: 'Не по карману' },
    ],
  },
  {
    id: 'cr_wise_judge',
    title: 'Суд правителя',
    from: 'Писец',
    scene: 'hall',
    // Характер правителя открывает весть, а платит за её пользу он очками: правитель по-прежнему делает одно — даёт очки.
    weight: (s) => on(skill(s, 'admin') >= 4 && day(s) >= 5),
    silence: 1,
    opts: [
      { label: 'Записать решение в закон', points: { admin: 30 }, fx: () => [{ k: 'boon', id: 'cr_law' }] },
      { label: 'Судить по обычаю' },
    ],
  },

  // ---------- Дурные ----------
  {
    id: 'cr_comet',
    title: 'Хвостатая звезда',
    from: 'Летописец',
    scene: 'sky',
    weight: (s) => on(day(s) >= 5),
    silence: 2,
    opts: [
      { label: 'Молебен всем городом', cost: (s) => ({ food: amount(s, 10), gold: amount(s, 15) }) },
      { label: 'Велеть звездочёту толковать', points: { admin: 20 }, fx: () => [{ k: 'fame', n: 1 }] },
      { label: 'Пусть шепчутся', fx: () => [{ k: 'boon', id: 'cr_omen' }] },
    ],
  },
  {
    id: 'cr_drought',
    title: 'Засуха',
    from: 'Управитель',
    scene: 'field',
    weight: (s) => on(seasonOf(s.time) === 'summer' && jobCounts(s).farmer > 0),
    silence: 2,
    opts: [
      { label: 'Нанять водовозов', cost: gold(20) },
      {
        label: 'Ход о дожде',
        cost: (s) => ({ food: amount(s, 10) }),
        fx: () => [{ k: 'boon', id: 'cr_drought' }, { k: 'chain', id: 'cr_rain', p: 0.5, seasons: 1 }],
      },
      { label: 'Ждать дождя', fx: () => [{ k: 'boon', id: 'cr_drought_hard' }] },
    ],
  },
  {
    id: 'cr_lower_fire',
    title: 'Пожар в нижнем городе',
    from: 'Старший стражи',
    scene: 'fire',
    weight: (s) => on((buildingOfType(s, 'houses')?.level ?? 0) >= 2 && (seasonOf(s.time) === 'summer' || seasonOf(s.time) === 'autumn')),
    silence: 2,
    opts: [
      { label: 'Отстроить за счёт города', cost: (s) => ({ gold: amount(s, 25), wood: amount(s, 20) }) },
      { label: 'Найти поджигателя', fx: () => [{ k: 'fame', n: -2 }, { k: 'boon', id: 'cr_culprit' }] },
      { label: 'Пусть строятся сами', fx: () => [{ k: 'boon', id: 'cr_ashes' }] },
    ],
  },
  {
    id: 'cr_plague_near',
    title: 'Мор у соседей',
    from: 'Привратник',
    scene: 'gate',
    weight: (s) => on(day(s) >= 10),
    silence: 2,
    opts: [
      { label: 'Закрыть ворота купцам', fx: (s) => [{ k: 'gold', n: -amount(s, 15) }, { k: 'boon', id: 'cr_shut_gates' }] },
      { label: 'Позвать лекаря', cost: gold(25) },
      { label: 'Торговать как прежде', fx: () => [{ k: 'chain', id: 'cr_plague', p: 0.5, seasons: 1 }] },
    ],
  },
  {
    id: 'cr_escape',
    title: 'Побег невольников',
    from: 'Надсмотрщик',
    scene: 'gate',
    weight: (s) => on(bondedTotal(s) >= 6, orderState(s) === 'unrest' ? 2 : 1),
    silence: 1,
    opts: [
      { label: 'Погоня с собаками', cost: (s) => ({ food: amount(s, 10) }), points: { war: 20 } },
      { label: 'Закрыть ворота и считать', fx: (s) => [{ k: 'bonded', n: -crowdOf(bondedTotal(s), 0.1) }] },
      {
        label: 'Отпустить с миром',
        fx: (s) => [{ k: 'bonded', n: -crowdOf(bondedTotal(s), 0.2) }, { k: 'fame', n: 1 }, { k: 'boon', id: 'cr_mercy' }],
      },
    ],
  },
  {
    id: 'cr_crown_debt',
    title: 'Долги короне',
    from: 'Гонец короны',
    scene: 'hall',
    weight: (s) => on(s.tax !== 'none' && day(s) >= 15),
    silence: 2,
    opts: [
      { label: 'Уплатить сполна', cost: gold(40), fx: () => [{ k: 'fame', n: 1 }] },
      { label: 'Просить отсрочки', points: { diplo: 30 }, fx: () => [{ k: 'chain', id: 'cr_collector', p: 1, seasons: 2 }] },
      { label: 'Отказать', fx: () => [{ k: 'fame', n: -2 }, { k: 'chain', id: 'cr_collector', p: 0.5, seasons: 1 }] },
    ],
  },
  {
    id: 'cr_ruler_ill',
    title: 'Хворь правителя',
    from: 'Лекарь',
    scene: 'chamber',
    weight: (s) => on(rulerAging(s)),
    silence: 2,
    opts: [
      { label: 'Позвать лекарей', cost: gold(20) },
      { label: 'Назвать наследника', points: { diplo: 30 } },
      { label: 'Скрыть хворь' },
    ],
  },
  {
    id: 'cr_bad_harvest',
    title: 'Неурожай',
    from: 'Управитель',
    scene: 'market',
    weight: (s) => on(seasonOf(s.time) === 'autumn' && foodDays(s) < 6, foodDays(s) < 3 ? 2 : 1),
    silence: 2,
    opts: [
      { label: 'Купить зерно у купцов', cost: gold(30), fx: (s) => [{ k: 'res', r: 'food', n: amount(s, 30) }, { k: 'boon', id: 'cr_grain' }] },
      { label: 'Отнять у перекупщиков', fx: (s) => [{ k: 'res', r: 'food', n: amount(s, 15) }, { k: 'fame', n: -1 }, down('merchants'), up('peasants')] },
      { label: 'Ждать весны', fx: () => [{ k: 'boon', id: 'cr_famine' }] },
    ],
  },

  // ---------- Выбор с ценой ----------
  {
    id: 'cr_preacher',
    title: 'Проповедник на площади',
    from: priest,
    scene: 'square',
    weight: (s) => on(faithOf(s) !== null && day(s) >= 5, heresy(s) ? 3 : 1),
    silence: 2,
    opts: [
      { label: 'Схватить и выдать храму', fx: () => [{ k: 'boon', id: 'cr_martyr' }, up('clergy')] },
      { label: 'Дать проповедовать', fx: () => [{ k: 'strain', n: STRAIN.sermon }, { k: 'boon', id: 'cr_sermon' }] },
      { label: 'Выслать за ворота' },
    ],
  },
  {
    id: 'cr_guild',
    title: 'Цех против купцов',
    from: 'Управитель',
    scene: 'market',
    weight: (s) => on(jobCounts(s).crafter > 0 && day(s) >= 5),
    silence: 0,
    opts: [
      { label: 'Оставить по-старому', fx: () => [up('guilds'), down('merchants')] },
      { label: 'Пустить купцов', fx: (s) => [{ k: 'gold', n: amount(s, 25) }, { k: 'boon', id: 'cr_guild_anger' }, up('merchants'), down('guilds')] },
      { label: 'Рассудить по грамоте', points: { admin: 30 } },
    ],
  },
  {
    id: 'cr_legate',
    title: 'Папский легат',
    from: 'Папский легат',
    scene: 'church',
    weight: (s) => on(faithOf(s) === 'catholic' && day(s) >= 10),
    silence: 2,
    opts: [
      { label: 'Дать десятину', cost: gold(40), fx: () => [{ k: 'fame', n: 2 }, up('clergy')] },
      { label: 'Дать что можем', cost: gold(15) },
      { label: 'Отказать легату', fx: () => [{ k: 'strain', n: STRAIN.refuse }, { k: 'chain', id: 'cr_interdict', p: 0.5, seasons: 1 }, down('clergy')] },
    ],
  },
  {
    id: 'cr_commune',
    title: 'Горожане просят хартию',
    from: 'Городской староста',
    scene: 'square',
    weight: (s) => on(s.pop >= 60),
    silence: 1,
    opts: [
      { label: 'Даровать хартию', points: { admin: 40 }, fx: () => [{ k: 'boon', id: 'cr_liberty' }, up('merchants'), up('guilds')] },
      { label: 'Обещать подумать', fx: () => [{ k: 'boon', id: 'cr_promise' }] },
    ],
  },
  {
    id: 'cr_crusade',
    title: 'Зов в поход за веру',
    from: priest,
    scene: 'road',
    weight: (s) => on(holyWar(s) && s.pop >= 30 && day(s) >= 10),
    silence: 2,
    opts: [
      { label: 'Благословить охочих', fx: (s) => [{ k: 'pop', n: -crowd(s, 0.02, 2) }, { k: 'fame', n: 3 }] },
      { label: 'Снарядить обоз', cost: (s) => ({ food: amount(s, 20), gold: amount(s, 20) }), fx: () => [{ k: 'fame', n: 4 }] },
      { label: 'Запретить уходить', fx: () => [{ k: 'strain', n: STRAIN.small }] },
    ],
  },
  {
    id: 'cr_match',
    title: 'Сватовство к наследнику',
    from: 'Управитель',
    scene: 'chamber',
    weight: (s) => on(day(s) >= 10),
    silence: 2,
    opts: [
      { label: 'Купеческая дочь', fx: (s) => [{ k: 'gold', n: amount(s, 40) }] },
      { label: 'Дочь старого рода', cost: gold(15), fx: () => [{ k: 'fame', n: 2 }] },
      { label: 'Подождать' },
    ],
  },
  {
    id: 'cr_tournament',
    title: 'Турнир',
    from: 'Герольд',
    scene: 'lists',
    weight: (s) => on(skill(s, 'war') >= 3 || armySize(s) >= 20),
    silence: 1,
    opts: [
      {
        label: 'Устроить турнир',
        cost: (s) => ({ food: amount(s, 15), gold: amount(s, 25) }),
        fx: () => [{ k: 'fame', n: 3 }, { k: 'morale', n: 2 }, up('knights')],
      },
      { label: 'Не до забав' },
    ],
  },
  {
    id: 'cr_deserters',
    title: 'Беглецы из дружины',
    from: 'Старший стражи',
    scene: 'gate',
    weight: (s) => on(armySize(s) >= 10 && ((s.pay?.late ?? 0) > 0 || s.morale < 50), (s.pay?.late ?? 0) > 0 ? 2 : 1),
    silence: 2,
    opts: [
      { label: 'Повесить у ворот', fx: () => [{ k: 'morale', n: -3 }] },
      { label: 'Простить и вернуть в строй', cost: gold(10) },
      { label: 'Выгнать с позором' },
    ],
  },
  {
    id: 'cr_missionaries',
    title: 'Проповедники с запада',
    from: 'Старейшина',
    scene: 'gate',
    weight: (s) => on(faithOf(s) === 'pagan' && day(s) >= 10),
    silence: 1,
    opts: [
      { label: 'Выслушать и одарить', cost: gold(10), fx: () => [{ k: 'strain', n: STRAIN.small }, { k: 'fame', n: 1 }] },
      { label: 'Прогнать за реку', fx: () => [{ k: 'fame', n: -1 }] },
    ],
  },
  {
    id: 'cr_tsargrad',
    title: 'Вести из Царьграда',
    from: 'Купец с юга',
    scene: 'road',
    weight: (s) => on((faithOf(s) === 'catholic' || faithOf(s) === 'orthodox') && day(s) >= 20),
    silence: 2,
    opts: [
      { label: 'Отслужить по павшим', cost: gold(10) },
      { label: 'Купить святыню', cost: gold(50), fx: () => [{ k: 'relic' }] },
      { label: 'Промолчать' },
    ],
  },

  // ---------- Следствия: приходят ответом на прежнюю весть, случаем не выпадают ----------
  {
    id: 'cr_rain',
    title: 'Дождь',
    from: 'Управитель',
    scene: 'field',
    weight: () => 0,
    silence: 1,
    opts: [
      { label: 'Праздник всем городом', cost: (s) => ({ food: amount(s, 10) }), fx: () => [{ k: 'boon', id: 'silt_field' }, { k: 'morale', n: 2 }] },
      { label: 'Возблагодарить небо', fx: () => [{ k: 'boon', id: 'silt_field' }] },
    ],
  },
  {
    id: 'cr_plague',
    title: 'Мор в городе',
    from: 'Лекарь',
    scene: 'square',
    weight: () => 0,
    silence: 1,
    opts: [
      { label: 'Жечь заражённые дворы', cost: (s) => ({ wood: amount(s, 15) }), fx: (s) => [{ k: 'pop', n: -crowd(s, 0.02, 1), died: true }] },
      { label: 'Молиться и ждать', fx: (s) => [{ k: 'pop', n: -crowd(s, 0.05, 2), died: true }, { k: 'boon', id: 'cr_pestilence' }] },
    ],
  },
  {
    id: 'cr_collector',
    title: 'Сборщик короны',
    from: 'Привратник',
    scene: 'gate',
    weight: () => 0,
    silence: 1,
    opts: [
      { label: 'Уплатить с лихвой', cost: gold(50) },
      { label: 'Не открывать ворот', fx: () => [{ k: 'fame', n: -3 }, { k: 'boon', id: 'cr_crown_wrath' }] },
    ],
  },
  {
    id: 'cr_interdict',
    title: 'Интердикт',
    from: 'Папский легат',
    scene: 'church',
    weight: () => 0,
    silence: 1,
    opts: [{ label: 'Покаяться и заплатить', cost: gold(60) }, { label: 'Стоять на своём', fx: () => [{ k: 'boon', id: 'cr_interdict' }] }],
  },
  ...estateCrown(),
];

/** Доля невольников: не меньше одного, если они есть. */
function crowdOf(total: number, share: number): number {
  return total > 0 ? Math.max(1, Math.round(total * share)) : 0;
}

export const CROWN_BY_ID = Object.fromEntries(CROWN.map((d) => [d.id, d])) as Record<string, CrownDef>;
