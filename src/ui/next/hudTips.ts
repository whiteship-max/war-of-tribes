/**
 * Подсказки верха нового интерфейса — чистые функции от состояния (правило 18: строка с числом считается
 * функциями игры, и тест сверяет её с функцией — `hudTips.test.ts`). Своей арифметики у строк нет: числа
 * берутся у `upkeepInfo`, `popGrowth`, `moraleBreakdown`, `netPerDay`, `storageCap`, `armyPower`, сроки —
 * у `waitSpan`.
 *
 * Подсказка запаса и показателя (docs/ui_v2.md, 5.2): сколько есть и из скольких, «в день» с разбором — строками
 * слагаемых, которые складываются в итог (`kit/breakdown`), — главные кнопки к постройкам, которые число делают
 * (`kit/sources.makersOf`), и ниже дверь окна числа (`kit/sources.WINDOW`: «Склад», «Дружина», «Мораль»…). Постройки
 * нет в городе — кнопка «Построить» ведёт в «Стройку» ратуши.
 */
import { iconName } from '@/ui/icons/registry';
import type { Tab } from '@/game/store';
import type { Building, BuildingTypeId, GameState, ResourceId } from '@/game/types';
import {
  armyPower,
  armySize,
  buildingOfType,
  buildingProduction,
  buildingStat,
  dayOf,
  defense,
  faithDef,
  faithGoldPerDay,
  faithTilt,
  freeRangeProduction,
  heatingWoodPerDay,
  homeArmy,
  homeArmyPower,
  housingCapacity,
  mastersFoodPerDay,
  moraleBreakdown,
  mouthCount,
  netPerDay,
  orderValue,
  policyMoralePerDay,
  recruitsQueued,
  seasonAfter,
  seasonOf,
  seasonProgress,
  siegeRation,
  siegeSoldierFood,
  storageCap,
  taxIncomePerDay,
  townFoodPerDay,
  upkeepInfo,
  wageOf,
} from '@/game/derived';
import { BASE_DEFENSE, BASE_HOUSING, ORDER_WARN, RESOURCE_META, VILLAGER_DEFENSE } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { SEASON_META, SEASON_SECONDS } from '@/game/data/seasons';
import { popGrowth } from '@/game/sim/population';
import { asGame } from '@/game/pace';
import { daysSpan } from '@/game/span';
import { signed } from '@/ui/parts/signed';
import { plural } from '@/ui/parts/plural';
import { realSpanText, waitSpan } from '@/ui/parts/wait';
import { ENERGY_MAX, MINIGAME_COST } from '@/game/data/minigames';
import { SHOP_DAILY } from '@/game/gemrules';
import { energyFullIn, energyShown } from '@/game/sim/minigames';
import type { RealmView } from '@/ui/realm/open';
import { breakdown, type Part } from '@/ui/kit/breakdown';
import { makersOf, type Source } from '@/ui/kit/sources';
import type { TipContent, TipMaker, TipSection } from './tip';
import { dec, num } from '@/game/num';
import { weatherLine } from '@/ui/parts/weather';

/**
 * Куда ведут ссылки подсказок: раздел шторки, здание, раздел державы; `to` — любая дверь набора (`kit/nav.goTo`): без неё
 * кнопки «Построить» нет.
 */
export interface TipGo {
  tab(t: Tab): void;
  building(id: number): void;
  realm(v: RealmView): void;
  to?(src: Source): void;
}

/** Целое с узким пробелом в разрядах: «4 800» (docs/ui_audit.md, 4.5). */
export function fmtInt(n: number): string {
  return String(Math.floor(Math.max(0, n))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
}

/** Ставка: до сотни — с десятой, дальше — целое; запятая; меньше десятой — ноль без дроби. */
export function fmtRate(n: number): string {
  const a = Math.abs(n);
  if (a < 0.05) return '0';
  return a >= 100 ? fmtInt(a) : dec(a, 1);
}

/** Ставка со знаком без единицы: «+12,4», «−3,0»; ноль — без знака. Строки разбора числа (`ui/kit/breakdown`) — ею же. */
export function rate(n: number): string {
  const s = signed(n);
  const sign = s.startsWith('+') || s.startsWith('−') ? s[0] : '';
  return `${sign}${fmtRate(n)}`;
}

/** Ставка со знаком: «+12,4 в день», «−3,0 в день»; ноль — без знака. */
export function perDay(n: number): string {
  return `${rate(n)} в день`;
}

/** Подпись итога «в день» у разборов верха: запас, золото, жители. */
export const PER_DAY = 'В день';

/**
 * Прирост жителей — с сотыми: в начале партии он меньше человека в день («+0,36»), и десятые съели бы множители веры и
 * пайка целиком. Порог разбора — та же сотая (`POP_EPS`).
 */
export const popRate = (n: number): string => signed(n, 2);
export const POP_EPS = 0.005;

/**
 * Главные кнопки подсказки — постройки, которые делают число (`makersOf`), крупнейшая доля первой: `weight` — что
 * постройка даёт сейчас, при равенстве — порядок таблицы. Постройки в городе нет — «Построить» в «Стройку» ратуши.
 */
function makers(s: GameState, types: readonly BuildingTypeId[], go: TipGo, weight: (type: BuildingTypeId) => number): TipMaker[] {
  const out: (TipMaker & { w: number; i: number })[] = [];
  types.forEach((type, i) => {
    const def = BUILDING_BY_ID[type];
    const icon = iconName('bld', type);
    const b = buildingOfType(s, type);
    if (b) out.push({ label: def.name, icon, go: () => go.building(b.id), w: weight(type), i });
    else if (go.to) out.push({ label: def.name, icon, build: true, go: () => go.to!({ kind: 'build' }), w: -Infinity, i });
  });
  out.sort((a, b) => b.w - a.w || a.i - b.i);
  return out.map(({ label, icon, go: open, build }) => ({ label, icon, go: open, ...(build ? { build } : {}) }));
}

/** Пассив постройки сейчас; постройки нет — ноль. */
const statNow = (s: GameState, type: BuildingTypeId, key: 'housing' | 'morale' | 'defense'): number => {
  const b = buildingOfType(s, type);
  return b ? buildingStat(b, key) : 0;
};

/**
 * Произведение строками (как выход двора, `output.ts`): основа, потом каждый множитель — тем, что он прибавил к уже
 * набранному: «Мораль ×0,80 → −0,6». Строки складываются в произведение на глазах игрока; множитель, равный единице,
 * строки не даёт (её вклад — ноль, `kit/breakdown` нулевых не пишет).
 */
export function productParts(base: Part, factors: readonly { label: string; f: number }[]): Part[] {
  const out: Part[] = [base];
  let run = base.value;
  for (const { label, f } of factors) {
    out.push({ label: `${label} ×${dec(f, 2)}`, value: run * (f - 1) });
    run *= f;
  }
  return out;
}

/**
 * Золото: сбор — налог с головы и вера (`taxIncomePerDay` — одна дверь, вера в ней своим слагаемым), расход — жалованье
 * дружине и мастерам (`upkeepInfo`), пока не идёт отсрочка. Итог — что прибавится за день. Золото не делает ни одна
 * постройка: его дверь — «Указы», где налог.
 */
export function goldTip(s: GameState, go: TipGo): TipContent {
  const up = upkeepInfo(s);
  const faith = faithGoldPerDay(s);
  const paid = up.due > 0;
  const tip = breakdown({
    title: `Золото · ${fmtInt(s.gold)}`,
    body:
      up.amnestyDays > 0
        ? `Жалованье — через ${daysSpan(up.amnestyDays)}.`
        : up.treasuryDays !== null
          ? `Золота хватит на ${daysSpan(up.treasuryDays)}.`
          : undefined,
    total: up.income - up.due,
    parts: [
      { label: 'Налог', value: taxIncomePerDay(s) - faith },
      { label: faithDef(s)?.name ?? 'Вера', value: faith },
      { label: 'Жалованье дружине', value: paid ? -up.armyWages : 0 },
      { label: 'Жалованье мастерам', value: paid ? -up.mastersWages : 0 },
    ],
    sumLabel: PER_DAY,
    link: { label: 'Указы', go: () => go.realm('government') },
  });
  return tip;
}

/**
 * Жители: прирост за день — основа под множителями морали, жилья, еды, пайка и веры (`popGrowth`), — и под ним жильё:
 * предел, из которого «N из M», по постройкам. Главные кнопки — постройки с жильём; дверь — «Прирост».
 */
export function popTip(s: GameState, go: TipGo): TipContent {
  const g = popGrowth(s);
  const factors =
    g.morale < 0
      ? [{ label: 'Мораль', f: g.morale }]
      : [
          { label: 'Мораль', f: g.morale },
          { label: 'Жильё', f: g.housing },
          { label: 'Еда', f: g.food },
          { label: 'Паёк', f: g.ration },
          { label: 'Вера', f: g.faith },
        ];
  const housing = housingCapacity(s);
  const tip = breakdown({
    title: `Жители · ${fmtInt(s.pop)} из ${fmtInt(housing)}`,
    body: g.blocked ?? undefined,
    total: g.perDay,
    parts: productParts({ label: 'Основа', value: g.base }, factors),
    fmt: popRate,
    eps: POP_EPS,
    sumLabel: PER_DAY,
    link: { label: 'Прирост', go: () => go.tab('pop') },
  });
  const roof = housingTip(s, go);
  const more: TipSection = { title: 'Жильё', rows: roof.rows ?? [], sum: roof.sum };
  return { ...tip, more, makers: roof.makers };
}

/**
 * Жильё: предел жителей — основа и постройки с жильём (`makersOf('pop')`) с итогом «Мест» (`housingCapacity`). Им же
 * разбирают жильё подсказка жителей верха (вторым разбором) и строка «Жильё» сводки «Жителей» (docs/ui_v2.md, 5.4).
 * Главные кнопки — те же постройки, у кого больше мест — первой.
 */
export function housingTip(s: GameState, go: TipGo): TipContent {
  const housing = housingCapacity(s);
  const types = makersOf('pop');
  const tip = breakdown({
    title: `Жильё · ${fmtInt(housing)} ${plural(housing, 'место', 'места', 'мест')}`,
    body: `Занято ${fmtInt(s.pop)}, свободно ${fmtInt(Math.max(0, housing - s.pop))}.`,
    total: housing,
    parts: [
      { label: 'Основа', value: BASE_HOUSING },
      ...types.map((type) => ({ label: BUILDING_BY_ID[type].name, value: statNow(s, type, 'housing') })),
    ],
    fmt: (n) => signed(n, 0),
    sumFmt: fmtInt,
    sumLabel: 'Мест',
    eps: 0.5,
  });
  return { ...tip, makers: makers(s, types, go, (type) => statNow(s, type, 'housing')) };
}

/**
 * Мораль: к какой цели она идёт — слагаемые `moraleBreakdown` (основа, строки, налог, пир, обряд, вести) и срез шкалы:
 * цель держится в 0…100, и то, что шкала срезала, — своя строка, а не дыра. Указ и паёк двигают мораль прямо — строкой
 * над разбором. Главные кнопки — постройки с моралью и пиром; дверь — «Мораль», разбор целиком.
 */
export function moraleTip(s: GameState, go: TipGo): TipContent {
  const m = moraleBreakdown(s);
  const after = m.clamped - m.tax + m.feast + m.rite + m.boon;
  const drift = policyMoralePerDay(s);
  const lever = drift === 0 ? '' : ` Указ и паёк: ${perDay(drift)}.`;
  const tip = breakdown({
    title: `Мораль · ${Math.round(s.morale)} из 100`,
    body: `Идёт к ${Math.round(m.target)}.${lever}`,
    total: m.target,
    parts: [
      { label: 'Основа', value: m.base },
      ...m.lines.map((l) => ({ label: l.name, value: l.value })),
      // Шкала срезает сумму до налога и пира (`moraleBreakdown`) и цель — после: оба среза одной строкой, сразу за
      // слагаемыми, где срезает первый.
      { label: 'Предел шкалы', value: m.clamped - m.raw + (m.target - after) },
      { label: 'Налог', value: -m.tax },
      { label: 'Пир', value: m.feast },
      { label: 'Обряд', value: m.rite },
      { label: 'Вести', value: m.boon },
    ],
    sumFmt: (n) => String(Math.round(n)),
    sumLabel: 'Цель',
    link: { label: 'Мораль', go: () => go.tab('morale') },
  });
  const tavern = buildingOfType(s, 'tavern');
  const weight = (type: BuildingTypeId): number => statNow(s, type, 'morale') + (type === 'tavern' && tavern ? m.feast : 0);
  return { ...tip, makers: makers(s, makersOf('morale'), go, weight) };
}

export function orderTip(s: GameState, go: TipGo): TipContent {
  const order = Math.round(orderValue(s));
  return {
    title: `Порядок · ${order}`,
    body: order < ORDER_WARN ? 'Невольники ропщут.' : 'Невольники под надзором.',
    link: { label: 'Порядок', go: () => go.tab('order') },
  };
}

/**
 * Дружина: сколько дома, в походе и на учениях; жалованье за день по видам (`wageOf`) с итогом `upkeepInfo.armyWages`;
 * уходят ли бойцы. Главные кнопки — где учат виды (`makersOf('army')`: казармы, конюшня); дверь — «Дружина».
 */
export function armyTip(s: GameState, go: TipGo): TipContent {
  const up = upkeepInfo(s);
  const all = armySize(s);
  const home = homeArmy(s);
  const queued = recruitsQueued(s);
  const where = [
    all > 0 ? `дома ${fmtInt(home)}` : '',
    all > home ? `в походе ${fmtInt(all - home)}` : '',
    queued > 0 ? `учатся ${fmtInt(queued)}` : '',
  ].filter(Boolean);
  const said = where.length ? `${where.join(', ')}.` : 'Бойцов пока нет.';
  const power = all > 0 ? ` Мощь ${fmtInt(Math.round(armyPower(s)))}.` : '';
  const leave = up.leavingPerDay > 0 ? ` Уходят: ${fmtRate(up.leavingPerDay)} в день.` : '';
  const grace = up.amnestyDays > 0 && all > 0 ? ` Платить — через ${daysSpan(up.amnestyDays)}.` : '';
  const tip = breakdown({
    title: `Дружина · ${fmtInt(all)}`,
    body: `${said[0].toUpperCase()}${said.slice(1)}${power}${leave}${grace}`,
    total: -up.armyWages,
    parts: TROOP_IDS.filter((id) => (s.army?.[id] ?? 0) > 0).map((id) => ({
      label: `${TROOP_BY_ID[id].name} ${fmtInt(s.army[id] ?? 0)}`,
      value: -(s.army[id] ?? 0) * wageOf(s, id),
    })),
    sumLabel: 'Жалованье в день',
    link: { label: 'Дружина', go: () => go.tab('army') },
  });
  const types = makersOf('army');
  return { ...tip, makers: makers(s, types, go, () => 0) };
}

/** Запись оборонного слагаемого: со знаком, без лишних нулей — «+40», «+7,5» (жители по четверти). */
const defensePart = (n: number): string => (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n), 1);

/**
 * Оборона (`derived.defense`, формула одна — `game/build.defenseOf`): дружина дома (мощь тех, кто у стен), укрепления по
 * постройкам, основа и жители с дубинами — всё под стойкостью веры. Вера — множитель, поэтому её строка — что она
 * прибавила к набранному, как множители выхода двора (`productParts`). Итог — тем же округлением, что на экране
 * (`dec(…, 0)`, «Дружина» и сводка «Жителей»). Главные кнопки — постройки с обороной; дверь — «Дружина», где гарнизон.
 */
export function defenseTip(s: GameState, go: TipGo): TipContent {
  const villagers = Math.max(0, s.pop - Math.max(0, s.scoutsAway));
  const types = makersOf('defense');
  const base: Part[] = [
    { label: 'Дружина дома', value: homeArmyPower(s) },
    ...types.map((type) => ({ label: BUILDING_BY_ID[type].name, value: statNow(s, type, 'defense') })),
    { label: 'Основа', value: BASE_DEFENSE },
    { label: `Жители ${fmtInt(villagers)}`, value: villagers * VILLAGER_DEFENSE },
  ];
  const steadfast = faithTilt(s).steadfast;
  const parts = productParts({ label: '', value: base.reduce((t, p) => t + p.value, 0) }, [
    { label: faithDef(s)?.name ?? 'Вера', f: 1 + steadfast },
  ]).slice(1);
  const tip = breakdown({
    title: `Оборона · ${dec(defense(s), 0)}`,
    body: 'Стены, башня, жители, гарнизон и отряд полководца в городе.',
    total: defense(s),
    parts: [...base, ...parts],
    fmt: defensePart,
    sumFmt: (n) => dec(n, 0),
    sumLabel: 'Оборона',
    link: { label: 'Дружина', go: () => go.tab('army') },
  });
  return { ...tip, makers: makers(s, types, go, (type) => statNow(s, type, 'defense')) };
}

/** Сколько игровых секунд до следующего сезона. */
export const seasonLeft = (time: number) => asGame(SEASON_SECONDS * (1 - seasonProgress(time)));

export function seasonTip(s: GameState, go: TipGo): TipContent {
  const season = seasonOf(s.time);
  return {
    title: `${SEASON_META[season].name} · день ${dayOf(s.time)}`,
    // Погода над городом — первой строкой (docs/city.md, 15): «Дождь, ветер с моря». Только вид: на хозяйство не влияет.
    body: `${weatherLine(s)}. ${SEASON_META[seasonAfter(season)].name} через ${waitSpan(seasonLeft(s.time))}.`,
    link: { label: 'Сезон', go: () => go.tab('season') },
  };
}

/**
 * Энергия промыслов: сколько из полного, когда полная, сколько стоит игра (docs/minigames.md, 1). Числа — дверью
 * `sim/minigames`, срок — настоящим временем (`realSpanText`): энергия идёт сутками игрока. Её не делает ни одна
 * постройка — копится сама; дверь — «Промыслы».
 */
export function energyTip(s: GameState, now: number, open: () => void): TipContent {
  const full = energyFullIn(s, now);
  return {
    title: `Энергия · ${energyShown(s, now)} из ${ENERGY_MAX}`,
    body: `${full > 0 ? `Полная через ${realSpanText(Math.ceil(full / 1000))}.` : 'Запас полон.'} Копится ${ENERGY_MAX} за сутки, промысел стоит ${MINIGAME_COST}.`,
    link: { label: 'Промыслы', go: open },
  };
}

/**
 * Алмазы (docs/gems.md): баланс — последнее, что сказал сервер, `null` — ещё не сказал. Город их не добывает: дверь —
 * Сокровищница на «Купить». Строка лавки — сколько покупок сделано сегодня из `SHOP_DAILY`.
 */
export function gemsTip(balance: number | null, used: number, offline: string | null, open: () => void): TipContent {
  return {
    title: `Алмазы · ${balance === null ? 'нет связи' : fmtInt(balance)}`,
    body: `${offline ? `${offline} ` : ''}Город их не добывает — их покупают. Лавка сегодня: ${used} из ${SHOP_DAILY}.`,
    link: { label: 'Сокровищница', go: open },
  };
}

/** Полон ли склад по этому запасу: места меньше единицы (как в полоске прежнего вида). */
export const isFull = (s: GameState, r: ResourceId): boolean => s.resources[r] >= storageCap(s) - 1;

/**
 * Что делает запас за день постройка этого типа: двор — `buildingProduction`, Площадь — вольный сбор
 * (`freeRangeProduction`). Постройки нет — ноль.
 */
function madeBy(s: GameState, type: BuildingTypeId, r: ResourceId): number {
  if (type === 'campfire') return freeRangeProduction(s)[r];
  const b: Building | null = buildingOfType(s, type);
  return b ? buildingProduction(s, b)[r] : 0;
}

/**
 * Расход запаса за день: еду едят жители, бойцы (со строем — новобранцы и раненые, `mouthCount`) и мастера, осадный
 * паёк урезает всё это разом (`siegeRation`); дрова уходят на очаги (`heatingWoodPerDay`). Прочие запасы день не тратит.
 */
function spentParts(s: GameState, r: ResourceId): Part[] {
  if (r === 'wood') return [{ label: 'Очаги', value: -heatingWoodPerDay(s) }];
  if (r !== 'food') return [];
  const eat: Part[] = [
    { label: 'Едят жители', value: -townFoodPerDay(s) },
    // В осаде боец ест паёк жителя (ОС-1, `derived.siegeSoldierFood`) — та же дверь, что у расхода.
    { label: 'Едят бойцы', value: -mouthCount(s) * siegeSoldierFood(s) },
    { label: 'Едят мастера', value: -mastersFoodPerDay(s) },
  ];
  const all = eat.reduce((n, p) => n + p.value, 0);
  return [...eat, { label: 'Осадный паёк', value: -all * (1 - siegeRation(s)) }];
}

/**
 * Запас: сколько есть из вместимости склада; «в день» — что делает каждая постройка (`makersOf`) и что уходит
 * (`spentParts`), итог — `netPerDay`, тот же, что стрелка ячейки. Главные кнопки — постройки, которые запас делают, крупнейшая
 * первой; дверь — «Склад».
 */
export function resTip(s: GameState, r: ResourceId, storage: number | null, go: TipGo): TipContent {
  const types = makersOf(r);
  const made = new Map(types.map((type) => [type, madeBy(s, type, r)]));
  const tip = breakdown({
    title: `${RESOURCE_META[r].name} · ${fmtInt(s.resources[r])} из ${fmtInt(storageCap(s))}`,
    body: isFull(s, r) ? 'Склад полон, лишнее пропадает.' : undefined,
    total: netPerDay(s)[r],
    parts: [
      ...[...types].sort((a, b) => made.get(b)! - made.get(a)!).map((type) => ({ label: BUILDING_BY_ID[type].name, value: made.get(type)! })),
      ...spentParts(s, r),
    ],
    sumLabel: PER_DAY,
    link: storage !== null ? { label: 'Склад', go: () => go.building(storage) } : undefined,
  });
  return { ...tip, makers: makers(s, types, go, (type) => made.get(type) ?? 0) };
}

/**
 * Прирост запаса меньше этого за игровой день — «стоит на месте»: стрелки нет. Иначе стрелка дрожала бы
 * от десятых долей расхода на очаг.
 */
export const TREND_DEAD = 0.5;

/** Куда идёт запас: вверх, вниз или стоит. Полный склад не растёт — стрелки у него нет, число охрой. */
export function trendOf(perDay: number, full: boolean): 'up' | 'down' | null {
  if (full && perDay >= 0) return null;
  if (perDay > TREND_DEAD) return 'up';
  if (perDay < -TREND_DEAD) return 'down';
  return null;
}
