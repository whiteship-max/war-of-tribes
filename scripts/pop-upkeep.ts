// Содержание войска — раздел `pop:report`.
//
// **Пока это предложение, а не игра.** Жалованья в игре нет; раздел считает, каким
// ему быть, и на этих таблицах владелец решает. Всё, что игра уже умеет считать,
// берётся у неё, а не переписывается: налог и десятина — `taxIncomePerDay` на копии
// посёлка с нужной армией (боец платит налог как человек, и это видно само), еда —
// `productionPerDay`, `townFoodPerDay`, `soldierFoodPerDay`, посёлок на каждом этапе —
// настоящий прогон автопилота. Своими здесь стоят только числа предложения
// (`WAGE_HEAD`, `WAGE_MAN`, `GRACE_DAYS`, `DESERT`, `AMNESTY_DAYS`) и шаг ухода:
// после решения они переедут в игру, и раздел будет звать уже её.
//
// Все пороги — в долях и в игровых днях, а не в минутах: доход, еда и жалованье
// считаются за игровой день, и замедление дня двигает их вместе.
import type { FaithId, GameState, Season, TroopId } from '@/game/types';
import type { TaxId } from '@/game/data/policy';
import { createInitialState } from '@/game/state';
import { catchUp } from '@/game/sim/tick';
import { seeded, setRandom } from '@/game/sim/random';
import {
  armyPower,
  productionPerDay,
  seasonModsFor,
  soldierFoodPerDay,
  taxIncomePerDay,
  templeLevel,
  townFoodPerDay,
} from '@/game/derived';
import { DAY_LENGTH, SOLDIER_FOOD } from '@/game/constants';
import { TAX_PER_POP } from '@/game/data/policy';
import { SEASONS } from '@/game/data/seasons';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { weightOf } from '@/game/battle/kinds';
import { build, staff } from './autopilot';

/**
 * Жалованье бойца за игровой день — в долях полного сбора с человека
 * (`TAX_PER_POP`), из двух частей: с головы и с бойца строя. Боец строя — та же
 * мерка, какой мощь вида переводится в бой (`weightOf`): дубинщик один, копейщик
 * два, латник восемь.
 *
 * Часть с головы нужна потому, что боец платит налог как человек: при жалованье
 * только по силе дубинщик на высоком налоге стоит казне 0.07 в день, и армию
 * дубинщиков не держит ничто, кроме еды (таблица «Как делить жалованье»).
 */
const WAGE_HEAD = 0.5;
const WAGE_MAN = 0.85;
/** Кандидаты на еду бойца за день; первый — нынешний `SOLDIER_FOOD`. */
const SOLDIER_FOODS = [SOLDIER_FOOD, 4, 8];
/** Сколько игровых дней долга жалованья войско терпит, прежде чем начать уходить. */
const GRACE_DAYS = 2;
/** Какая доля неоплаченной части войска уходит за игровой день. */
const DESERT = 0.15;
/** Сколько дней после перехода старая партия не платит жалованья вовсе. */
const AMNESTY_DAYS = 10;

const STAGES: [string, number][] = [
  ['новичок', 20 * 60],
  ['начало', 60 * 60],
  ['середина', 2 * 3600],
  ['потолок', 5 * 3600],
];
const STEP = 15;

interface Wage {
  head: number;
  man: number;
}
const WAGE: Wage = { head: WAGE_HEAD, man: WAGE_MAN };
const wageOf = (troop: TroopId, w: Wage = WAGE): number => TAX_PER_POP * (w.head + w.man * weightOf(troop));

type Army = Partial<Record<TroopId, number>>;
const total = (a: Army): number => TROOP_IDS.reduce((k, id) => k + (a[id] ?? 0), 0);
const wages = (a: Army): number => TROOP_IDS.reduce((k, id) => k + (a[id] ?? 0) * wageOf(id), 0);

const clone = (s: GameState): GameState => structuredClone(s);

const withArmy = (s: GameState, army: Army): GameState => {
  const w = clone(s);
  for (const id of TROOP_IDS) w.army[id] = army[id] ?? 0;
  return w;
};

const withPolicy = (s: GameState, tax: TaxId, faith: FaithId | null): GameState => {
  const w = clone(s);
  w.tax = tax;
  w.faith.id = faith;
  return w;
};

const last = <T>(xs: T[]): T => xs[xs.length - 1];
const n = (x: number): string => (Number.isFinite(x) ? String(Math.round(x)) : '∞');
const pad = (x: string | number, w: number): string => String(x).padStart(w);

interface Run {
  gold: number[];
  stages: GameState[];
}

/** Партия автопилотом с налогом и верой: казна по часам и посёлок на этапах. */
function play(tax: TaxId, faith: FaithId | null, hours: number): Run {
  setRandom(seeded(1));
  const s = createInitialState();
  s.tutorialDone = true;
  s.tax = tax;
  s.faith.id = faith;
  const gold: number[] = [];
  const stages: GameState[] = [];
  for (let t = STEP; t <= hours * 3600; t += STEP) {
    staff(s);
    build(s);
    catchUp(s, STEP, 1);
    if (t % 3600 === 0) gold.push(Math.round(s.gold));
    for (const [, at] of STAGES) if (t === at) stages.push(clone(s));
  }
  return { gold, stages };
}

/**
 * Потолок по золоту: сколько бойцов одного вида казна держит без убыли. Доход —
 * игрой на двух армиях (ноль и один боец): он линеен по армии, боец платит налог.
 */
function goldCeiling(s: GameState, troop: TroopId, w: Wage = WAGE): number {
  const i0 = taxIncomePerDay(withArmy(s, {}));
  const di = taxIncomePerDay(withArmy(s, { [troop]: 1 })) - i0;
  if (i0 <= 0) return 0;
  const net = wageOf(troop, w) - di;
  return net <= 0 ? Infinity : i0 / net;
}

/**
 * Потолок по еде: излишек посёлка без бойцов, делённый на пай бойца. «Год» —
 * четыре сезона вместе: столько армия ест, если летний излишек лёг в запас на
 * зиму. Год второй: смягчения первой зимы нет.
 */
function foodCeiling(s: GameState, food: number, season: Season | 'year'): number {
  let spare = 0;
  let per = 0;
  for (const one of season === 'year' ? SEASONS : [season]) {
    const mods = seasonModsFor(one, 2);
    spare += productionPerDay(s, mods).food - townFoodPerDay(s, mods);
    per += soldierFoodPerDay(s, mods) * (food / SOLDIER_FOOD);
  }
  return Math.max(0, spare / per);
}

interface DesertOpts {
  gold: number;
  days: number;
  order: 'cheap' | 'share';
  /** Столько первых дней жалованье не платится вовсе. */
  amnesty?: number;
  /** В этот день игрок кладёт в казну столько-то золота. */
  pay?: { day: number; gold: number };
  /** В этот день игрок ставит налог. */
  taxAt?: { day: number; tax: TaxId };
}

interface Point {
  day: number;
  army: Army;
  debt: number;
  gold: number;
}

/**
 * Шаг ухода — предложение. Жалованье снимается с казны непрерывно; не хватило —
 * копится долг. Долг дольше `GRACE_DAYS` дней — за день уходит `DESERT` от
 * неоплаченной части войска (дефицит, делённый на жалованье). Ушедшие уносят свою
 * долю долга. Доход покрыл жалованье — уход встаёт сам; казна погасила долг —
 * отсчёт терпения начинается заново.
 */
function desert(s0: GameState, start: Army, o: DesertOpts): Point[] {
  const dt = 0.05;
  const army: Army = { ...start };
  const s = clone(s0);
  let gold = o.gold;
  let debt = 0;
  let late = 0;
  const out: Point[] = [];
  for (let step = 0; step * dt <= o.days + 1e-9; step++) {
    const day = step * dt;
    if (o.taxAt && step === Math.round(o.taxAt.day / dt)) s.tax = o.taxAt.tax;
    if (o.pay && step === Math.round(o.pay.day / dt)) gold += o.pay.gold;
    out.push({ day, army: { ...army }, debt, gold });
    const income = taxIncomePerDay(withArmy(s, army));
    const due = day < (o.amnesty ?? 0) ? 0 : wages(army);
    gold += (income - due) * dt;
    if (gold < 0) {
      debt -= gold;
      gold = 0;
    } else if (debt > 0) {
      const back = Math.min(gold, debt);
      debt -= back;
      gold -= back;
    }
    late = debt > 1e-6 ? late + dt : 0;
    if (late <= GRACE_DAYS || due <= income) continue;
    const unpaid = (due - income) / due;
    if (o.order === 'share') {
      for (const id of TROOP_IDS) army[id] = (army[id] ?? 0) * (1 - DESERT * unpaid * dt);
    } else {
      // Уходит жалованье на ту же сумму, но с дешёвого конца списка казарм.
      let leave = DESERT * unpaid * due * dt;
      for (const id of TROOP_IDS) {
        const have = army[id] ?? 0;
        if (have <= 0 || leave <= 0) continue;
        const take = Math.min(have, leave / wageOf(id));
        army[id] = have - take;
        leave -= take * wageOf(id);
      }
    }
    // Долг — это неоплаченная часть, и уносят его те, кто уходит: сократился
    // дефицит — сократился и долг. Сошлись доход и жалованье — долга нет, и
    // следующий наём снова начинает с терпения, а не с ухода.
    debt *= Math.max(0, wages(army) - income) / (due - income);
  }
  return out;
}

const at = (pts: Point[], day: number): Point =>
  pts.reduce((best, p) => (Math.abs(p.day - day) < Math.abs(best.day - day) ? p : best));

const firstLeave = (pts: Point[]): string => {
  const t0 = total(pts[0].army);
  const p = pts.find((q) => total(q.army) < t0 - 0.5);
  return p ? `${p.day.toFixed(1)} дн.` : 'нет';
};

export function upkeepSection(): void {
  console.log('\n══════ Содержание войска: предложение (в игре его пока нет) ══════');
  console.log(
    `Жалованье в день: ${WAGE_HEAD} полного сбора с человека (${TAX_PER_POP} зол.) с головы и ${WAGE_MAN} — ` +
      `с бойца строя. Выходит: ` +
      TROOP_IDS.map((id) => `${TROOP_BY_ID[id].one} ${wageOf(id).toFixed(2)}`).join(', ') +
      `. Еда бойца сейчас ${SOLDIER_FOOD} в день.`,
  );

  // --- Казна как есть ---
  const runs: [string, TaxId, FaithId | null][] = [
    ['без налога', 'none', null],
    ['умеренный', 'moderate', null],
    ['высокий', 'high', null],
    ['без налога, католики', 'none', 'catholic'],
    ['умеренный, католики', 'moderate', 'catholic'],
    ['без налога, ислам', 'none', 'islam'],
  ];
  console.log('\nКазна как есть (автопилот 6 ч, армии нет, стартовые 320, уклад прихода обычный):');
  console.log('  налог и вера           |    1 ч |    2 ч |    3 ч |    4 ч |    5 ч |    6 ч');
  let base: Run | null = null;
  for (const [name, tax, faith] of runs) {
    const r = play(tax, faith, 6);
    if (tax === 'moderate' && !faith) base = r;
    console.log(`  ${name.padEnd(22)} | ${r.gold.map((g) => pad(g, 6)).join(' | ')}`);
  }
  const stages = base!.stages;

  // --- Этапы ---
  console.log('\nЭтапы партии (посёлок из прогона с умеренным налогом), доход казны за игровой день без армии:');
  console.log('  этап     | люди | храм | без нал. | умер. | выс. | умер.+католики | без нал.+ислам');
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const inc = (tax: TaxId, faith: FaithId | null): string => taxIncomePerDay(withPolicy(s, tax, faith)).toFixed(0);
    console.log(
      `  ${STAGES[i][0].padEnd(8)} | ${pad(s.pop, 4)} | ${pad(templeLevel(s), 4)} | ${pad(inc('none', null), 8)} | ` +
        `${pad(inc('moderate', null), 5)} | ${pad(inc('high', null), 4)} | ${pad(inc('moderate', 'catholic'), 14)} | ` +
        `${pad(inc('none', 'islam'), 14)}`,
    );
  }

  // --- Как делить жалованье ---
  const kinds: TroopId[] = ['clubman', 'spearman', 'legionary'];
  const cap = last(stages);
  const schemes: [string, Wage][] = [
    ['по силе 1.1', { head: 0, man: 1.1 }],
    ['по головам 2.2', { head: 2.2, man: 0 }],
    [`голова ${WAGE_HEAD} + сила ${WAGE_MAN}`, WAGE],
    ['то же ×0.7', { head: WAGE_HEAD * 0.7, man: WAGE_MAN * 0.7 }],
    ['то же ×1.5', { head: WAGE_HEAD * 1.5, man: WAGE_MAN * 1.5 }],
  ];
  console.log('\nКак делить жалованье: какую долю от жителей казна держит бойцами одного вида (этап «потолок»):');
  console.log(
    '  способ              | налог     | ' + kinds.map((k) => TROOP_BY_ID[k].name.padStart(9)).join(' | ') +
      ' | копейщик, зол./д',
  );
  for (const [name, w] of schemes) {
    for (const tax of ['moderate', 'high'] as TaxId[]) {
      const s = withPolicy(cap, tax, null);
      const cells = kinds.map((k) => {
        const c = goldCeiling(s, k, w);
        return (Number.isFinite(c) ? (c / s.pop).toFixed(2) : '∞').padStart(9);
      });
      console.log(
        `  ${name.padEnd(19)} | ${(tax === 'high' ? 'высокий' : 'умеренный').padEnd(9)} | ${cells.join(' | ')} | ` +
          wageOf('spearman', w).toFixed(2).padStart(16),
      );
    }
  }

  // --- Потолок по золоту ---
  const taxes: [string, TaxId, FaithId | null][] = [
    ['без налога', 'none', null],
    ['умеренный', 'moderate', null],
    ['высокий', 'high', null],
    ['умер.+католики', 'moderate', 'catholic'],
    ['умер.+ислам', 'moderate', 'islam'],
    ['выс.+ислам', 'high', 'islam'],
  ];
  console.log('\nПотолок по золоту: сколько бойцов одного вида казна держит без убыли (в скобках — доля от жителей):');
  console.log('  этап     | налог и вера     | ' + kinds.map((k) => TROOP_BY_ID[k].name.padStart(13)).join(' | '));
  for (let i = 0; i < stages.length; i++) {
    for (const [name, tax, faith] of taxes) {
      const s = withPolicy(stages[i], tax, faith);
      const cells = kinds.map((k) => {
        const c = goldCeiling(s, k);
        const share = Number.isFinite(c) ? ` (${(c / s.pop).toFixed(2)})` : '';
        return `${n(c)}${share}`.padStart(13);
      });
      console.log(`  ${STAGES[i][0].padEnd(8)} | ${name.padEnd(16)} | ${cells.join(' | ')}`);
    }
  }

  // --- Потолок по еде ---
  console.log('\nПотолок по еде: сколько бойцов прокормит излишек посёлка при расстановке автопилота (в скобках — доля от жителей).');
  console.log('  Еда бойца за день — кандидаты; первый столбец — нынешний SOLDIER_FOOD. «год» — летний излишек в запас на зиму.');
  console.log('  этап     | сезон |' + SOLDIER_FOODS.map((f) => ` еда ${f}`.padEnd(12)).join('|'));
  for (let i = 0; i < stages.length; i++) {
    for (const season of ['summer', 'winter', 'year'] as const) {
      const cells = SOLDIER_FOODS.map((f) => {
        const c = foodCeiling(stages[i], f, season);
        return `${n(c)} (${(c / stages[i].pop).toFixed(1)})`.padStart(11);
      });
      const name = season === 'summer' ? 'лето' : season === 'winter' ? 'зима' : 'год';
      console.log(`  ${STAGES[i][0].padEnd(8)} | ${name.padEnd(5)} |${cells.join(' |')}`);
    }
  }

  // --- Что упирается ---
  const binds: [TroopId, number, Season | 'year'][] = [
    ['spearman', SOLDIER_FOOD, 'winter'],
    ['spearman', SOLDIER_FOOD, 'year'],
    ['clubman', SOLDIER_FOOD, 'winter'],
    ['clubman', SOLDIER_FOOD, 'year'],
    ['legionary', SOLDIER_FOOD, 'winter'],
  ];
  console.log('\nЧто держит армию: меньший из двух потолков (Е — еда, З — золото), еда бойца нынешняя:');
  console.log(
    '  этап     | налог и вера     |' +
      binds.map(([k, , season]) => ` ${TROOP_BY_ID[k].one} ${season === 'year' ? 'год' : 'зима'}`.padEnd(17)).join('|'),
  );
  for (let i = 0; i < stages.length; i++) {
    for (const [name, tax, faith] of taxes) {
      const s = withPolicy(stages[i], tax, faith);
      const cells = binds.map(([k, f, season]) => {
        const g = goldCeiling(s, k);
        const e = foodCeiling(s, f, season);
        return (e < g ? `Е ${n(e)}` : `З ${n(g)}`).padStart(16);
      });
      console.log(`  ${STAGES[i][0].padEnd(8)} | ${name.padEnd(16)} |${cells.join(' |')}`);
    }
  }

  // --- Уход ---
  const mid = stages[2];
  const ceil = goldCeiling(mid, 'spearman');
  const over = Math.round(ceil * 2);
  console.log(
    `\nУход при неуплате (этап «середина», ${mid.pop} жителей, умеренный налог, потолок ${n(ceil)} копейщиков, ` +
      `стоит ${over}, казна пуста; терпение ${GRACE_DAYS} дн. долга, уходит ${DESERT} неоплаченной части в день):`,
  );
  const plain = desert(mid, { spearman: over }, { gold: 0, days: 40, order: 'cheap' });
  const paid = desert(mid, { spearman: over }, {
    gold: 0,
    days: 40,
    order: 'cheap',
    pay: { day: 4, gold: Math.round(wages({ spearman: over }) * 20) },
  });
  console.log('  день | без доплаты: войско, долг | доплата 20 дней жалованья на 4-й день: войско, долг, казна');
  for (const d of [0, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 40]) {
    const a = at(plain, d);
    const b = at(paid, d);
    console.log(
      `  ${pad(d, 4)} | ${pad(Math.round(total(a.army)), 11)} ${pad(Math.round(a.debt), 12)} | ` +
        `${pad(Math.round(total(b.army)), 11)} ${pad(Math.round(b.debt), 6)} ${pad(Math.round(b.gold), 7)}`,
    );
  }

  // --- Кто уходит первым ---
  const mixed: Army = { clubman: 120, spearman: 120, archer: 60, shieldman: 30, legionary: 30 };
  console.log('\nКто уходит первым (этап «середина», умеренный налог, казна пуста, смешанное войско, 60 дней):');
  console.log('  порядок         | было голов | осталось | ушло голов | мощь была | мощь стала | по видам');
  for (const order of ['cheap', 'share'] as const) {
    const end = last(desert(mid, mixed, { gold: 0, days: 60, order }));
    const power = (a: Army): number => armyPower(withArmy(mid, a));
    const left = TROOP_IDS.filter((id) => (mixed[id] ?? 0) > 0)
      .map((id) => `${TROOP_BY_ID[id].one} ${Math.round(end.army[id] ?? 0)}`)
      .join(', ');
    console.log(
      `  ${(order === 'cheap' ? 'дешёвые первыми' : 'поровну долей').padEnd(15)} | ${pad(total(mixed), 10)} | ` +
        `${pad(Math.round(total(end.army)), 8)} | ${pad(Math.round(total(mixed) - total(end.army)), 10)} | ` +
        `${pad(Math.round(power(mixed)), 9)} | ${pad(Math.round(power(end.army)), 10)} | ${left}`,
    );
  }

  // --- Начатые партии ---
  console.log(
    '\nНачатые партии: армия копейщиков, которую партия не потянет. «первый» — через сколько игровых дней уходит ' +
      'первый боец; «час» — что останется за час игры (60 дн.), если игрок ничего не делает.',
  );
  console.log(
    `  этап     | налог      | армия | казна | потолок | сразу: первый, час | отсрочка ${AMNESTY_DAYS} дн.: первый, час |` +
      ' отсрочка и умер. налог в 1-й день: час',
  );
  for (const i of [1, 3]) {
    for (const tax of ['none', 'moderate'] as TaxId[]) {
      for (const share of [1 / 3, 1]) {
        for (const gold of [320, 20000]) {
          const s = withPolicy(stages[i], tax, null);
          const army = { spearman: Math.round(s.pop * share) };
          const now = desert(s, army, { gold, days: 60, order: 'cheap' });
          const later = desert(s, army, { gold, days: 60, order: 'cheap', amnesty: AMNESTY_DAYS });
          const taxed = desert(s, army, {
            gold,
            days: 60,
            order: 'cheap',
            amnesty: AMNESTY_DAYS,
            taxAt: { day: 1, tax: 'moderate' },
          });
          const end = (pts: Point[]): string => pad(Math.round(total(last(pts).army)), 5);
          console.log(
            `  ${STAGES[i][0].padEnd(8)} | ${(tax === 'none' ? 'без налога' : 'умеренный').padEnd(10)} | ` +
              `${pad(army.spearman, 5)} | ${pad(gold, 5)} | ${pad(n(goldCeiling(s, 'spearman')), 7)} | ` +
              `${pad(firstLeave(now), 12)} ${end(now)} | ${pad(firstLeave(later), 19)} ${end(later)} | ${end(taxed)}`,
          );
        }
      }
    }
  }
  console.log(`\n(игровой день — ${DAY_LENGTH} с)`);
}
