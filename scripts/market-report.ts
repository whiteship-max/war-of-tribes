// Рынок РН-1 — числами (docs/city_v3.md, «Решения РН-1»).
//
// Цели владельца и как они выводятся:
//  Ц1. Перепродажа — в ноль или в минус всегда: штука, купленная в любой привоз и проданная в любой привоз (тот же или
//      другой) при самой щедрой прибавке к выручке (`BOOST_MAX`: Казначей 3-го уровня с усердием, купечество в полной силе
//      с указом), не приносит больше, чем стоила. Худший случай — самый дешёвый привоз против самого дорогого, значит
//      `SALE_SHARE = 1 / ((1 + PRICE_SWING) · BOOST_MAX)`, вниз до тысячных; отчёт проверяет это перебором привозов месяца.
//  Ц2. Продажа излишка даёт заметное, но не ломающее золото. Без предела выручка от излишка привоза мерочного посёлка
//      (выработка за вычетом расхода, `netPerDay`, за игровые дни привоза) — в разы больше налога (первый прогон РН-1:
//      780…909 %): добро в игре дорого против налога, и продажа разом сломала бы спор за золото. Предел — кошель купцов на
//      привоз: `PURSE[L] = PURSE_SHARE · налог привоза мерочного посёлка уровня L` (`autopilot.townAt`), выводится `--derive`.
//      Привозов восемь в сутки (3 ч, РН-1б): за сутки — восемь кошелей, та же треть суточного налога, что при четырёх.
//      «Заметное» — излишек хотя бы одного игрового дня мерочного посёлка 3, 5 и 8 добирает кошель не меньше чем на
//      `GAIN_LOW`; «не ломающее» — выручка привоза не выше кошеля, то есть трети налога.
//  Сбитие и отход — из устройства, а не подбором: партия во весь запас привоза поднимает цену последней штуки вдвое (прежнее
//  правило дневного прилавка, `PRICE_RAMP = 1`), нажим уходит вдвое за четверть привоза (к новому привозу — 1/16).
//
// Неподвижная точка (правило 16): доля продажи не входит в свою выборку — `BOOST_MAX` и `PRICE_SWING` от неё не зависят, —
// и `--derive` сходится за один круг: пишет, перечитывает и сверяет, что записанное равно выведенному.
//
//   npm run market:report                — цели на записанных числах
//   npm run market:report -- --derive    — вывод `SALE_SHARE` (пишет в src/game/marketrules.ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '@/game/constants';
import { BONDED_GOOD, GOODS, GOOD_BY_ID } from '@/game/data/market';
import { buildingOfType, netPerDay, taxIncomePerDay } from '@/game/derived';
import {
  BOOST_MAX,
  PRESS_HALF,
  PRICE_SWING,
  PURSE,
  PURSE_SHARE,
  SALE_SHARE,
  SHIFT,
  buyUnit,
  depthOf,
  lotOf,
  pressAt,
  priceFactor,
  purseOf,
  sellUnit,
  shiftDays,
  shiftOf,
  shiftStart,
  supplyOf,
} from '@/game/marketrules';
import { townAt } from './autopilot';

const RULES = fileURLToPath(new URL('../src/game/marketrules.ts', import.meta.url));

/** Ц2: излишек одного игрового дня добирает кошель хотя бы на эту долю. */
const GAIN_LOW = 0.5;

const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;
const pad = (v: string | number, n: number): string => String(v).padStart(n);

/** Вывод Ц1: доля продажи — вниз до тысячных. */
const derived = (): number => Math.floor(1000 / ((1 + PRICE_SWING) * BOOST_MAX)) / 1000;

/** Вывод Ц2: кошель купцов по уровням рынка — доля налога привоза мерочного посёлка. */
const derivedPurse = (): number[] =>
  Array.from({ length: MAX_BUILDING_LEVEL + 1 }, (_, l) => (l === 0 ? 0 : Math.round(PURSE_SHARE * taxIncomePerDay(townAt(l)) * shiftDays())));

const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

if (process.argv.includes('--derive')) {
  const share = derived();
  const purse = derivedPurse();
  const src = readFileSync(RULES, 'utf8');
  const next = src
    .replace(/export const SALE_SHARE = [\d.]+;/, `export const SALE_SHARE = ${share};`)
    .replace(/export const PURSE: readonly number\[\] = \[[^\]]*\];/, `export const PURSE: readonly number[] = [${purse.join(', ')}];`);
  if (next !== src) writeFileSync(RULES, next);
  // Круг неподвижной точки: прогнать отчёт новым процессом на записанных числах — его строки «вывод … на записанных числах»
  // говорят, равно ли выведенное записанному.
  const r = spawnSync('npx', ['vite-node', fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  const again = r.stdout.split('\n').filter((l) => l.startsWith('вывод Ц'));
  const back = readFileSync(RULES, 'utf8');
  const gotShare = Number(/export const SALE_SHARE = ([\d.]+);/.exec(back)?.[1]);
  const gotPurse = (/export const PURSE: readonly number\[\] = \[([^\]]*)\];/.exec(back)?.[1] ?? '').split(',').map(Number);
  for (const l of again) console.log(`  ${l}`);
  const ok = gotShare === share && same(gotPurse, purse) && again.length === 2 && again.every((l) => l.includes('равно записанному'));
  console.log(`вывод SALE_SHARE: 1 / ((1 + ${PRICE_SWING}) · ${BOOST_MAX.toFixed(4)}) → ${share}; записано ${gotShare}`);
  console.log(`вывод PURSE: ${purse.join(', ')}; записано ${gotPurse.join(', ')}`);
  console.log(ok ? 'сошлось' : 'НЕ СОШЛОСЬ');
  process.exit(ok ? 0 : 1);
}

console.log('━━ Рынок РН-1 ━━');
console.log(`привоз — ${SHIFT / 3600_000} ч, игровых дней в привозе ${shiftDays()}; доля продажи ${SALE_SHARE}, прибавка до ×${BOOST_MAX.toFixed(4)}, разброс привоза ${pct(PRICE_SWING)}`);
console.log(`вывод Ц1 на записанных числах: ${derived()}${derived() === SALE_SHARE ? ' — равно записанному' : ' — РАСХОДИТСЯ С ЗАПИСАННЫМ (--derive)'}`);
console.log(`вывод Ц2 на записанных числах: кошель ${derivedPurse().join(', ')}${same(derivedPurse(), PURSE) ? ' — равно записанному' : ' — РАСХОДИТСЯ С ЗАПИСАННЫМ (--derive)'}`);

// ---------- Ц1: перепродажа ----------
console.log('\n── Ц1. Перепродажа: худший круг «купить — продать» по привозам месяца (прибавка — потолок) ──');
const W0 = shiftOf(Date.UTC(2026, 9, 1));
const SHIFTS = Array.from({ length: 8 * 30 }, (_, i) => W0 + i);
console.log(`  ${'товар'.padEnd(18)} ${pad('штука', 8)} ${pad('партия', 8)}   худший круг`);
let worst = 0;
for (const def of [...GOODS, BONDED_GOOD]) {
  let unit = 0;
  let lot = 0;
  const d = depthOf(def, 5);
  for (const a of SHIFTS) {
    const buy1 = buyUnit(def, a, d, 0);
    const buyN = lotOf(def, a, d, 0, d);
    for (const b of SHIFTS) {
      // Купленная штука подняла нажим на единицу; нажим не успел отойти — самый щедрый к продаже случай.
      unit = Math.max(unit, sellUnit(def, b, d, 1, BOOST_MAX) / buy1);
      lot = Math.max(lot, lotOf(def, b, d, d, -d, BOOST_MAX).gold / buyN.gold);
    }
  }
  worst = Math.max(worst, unit, lot);
  console.log(`  ${def.name.padEnd(18)} ${pad(unit.toFixed(3), 8)} ${pad(lot.toFixed(3), 8)}`);
}
console.log(`  итог: худший круг ${worst.toFixed(3)} — ${worst <= 1 ? 'не в плюс' : 'В ПЛЮС — ЦЕЛЬ НЕ ДЕРЖИТСЯ'}`);

// ---------- Сбитие ----------
console.log('\n── Сбитие: цена штуки по нажиму (еда, рынок 5, привоз 12:00 UTC, без прибавки) ──');
const food = GOOD_BY_ID.food;
const wDay = W0 + 4;
const dFood = depthOf(food, 5);
console.log(`  глубина ${dFood} шт., основа привоза ×${priceFactor(wDay, food.id).toFixed(3)}`);
for (const k of [-1, -0.5, 0, 0.5, 1]) {
  const q = Math.round(k * dFood);
  console.log(`  нажим ${pad(q, 6)}: купить ${pad(buyUnit(food, wDay, dFood, q), 4)}, продать ${pad(sellUnit(food, wDay, dFood, q, 1), 4)}`);
}

// ---------- Отход ----------
console.log('\n── Отход нажима: доля, что осталась через ── ');
for (const h of [0.25, 0.5, 0.75, 1.5, 2.25, 3]) console.log(`  ${pad(h, 4)} ч: ${pct(pressAt(1, 0, h * 3600_000))}`);
console.log(`  полураспад ${PRESS_HALF / 3600_000} ч`);

// ---------- Привозы суток ----------
console.log('\n── Привозы суток (сетка UTC, каждые 3 часа): запас еды рынка 5, основа, кошель ──');
for (let i = 0; i < 8; i++) {
  const w = W0 + i;
  const at = new Date(shiftStart(w)).toISOString().slice(11, 16);
  console.log(`  с ${at} UTC: запас ${pad(supplyOf(food, 5, w, 0), 5)}, основа ×${priceFactor(w, food.id).toFixed(3)}, кошель ${purseOf(5)}`);
}

// ---------- Ц2: излишек ----------
console.log(`\n── Ц2. Излишек игрового дня в привоз против кошеля купцов (кошель — ${pct(PURSE_SHARE)} налога привоза; за сутки — ${8} кошелей) ──`);
let ok = true;
for (const level of [3, 5, 8]) {
  const s = townAt(level);
  const net = netPerDay(s);
  const market = buildingOfType(s, 'market')?.level ?? 0;
  const purse = purseOf(market);
  let gold = 0;
  let free = 0;
  for (const r of RESOURCE_IDS) {
    const def = GOOD_BY_ID[r];
    const n = Math.floor(Math.max(0, net[r] ?? 0));
    if (!def || n <= 0) continue;
    gold += lotOf(def, wDay, depthOf(def, market), 0, -n, 1).gold;
    free += lotOf(def, wDay, depthOf(def, market), 0, -Math.floor(n * shiftDays()), 1).gold;
  }
  const tax = taxIncomePerDay(s) * shiftDays();
  const share = purse > 0 ? gold / purse : 0;
  ok &&= share >= GAIN_LOW;
  console.log(`  посёлок ${level}: налог привоза ${Math.round(tax)}, кошель ${purse}; излишек дня — ${gold} (${pct(share)} кошеля); излишек привоза без предела — ${free} (${pct(free / tax)} налога)`);
  // Сутки — восемь привозов: суточное золото продажи — восемь кошелей против налога суток (цель — треть, РН-1б).
  const day = (24 * 3600_000) / SHIFT;
  console.log(`    сутки: ${day} кошелей — ${purse * day} против налога суток ${Math.round(tax * day)} (${pct((purse * day) / (tax * day))})`);
}
console.log(`  итог: ${ok ? 'заметно и не ломает' : 'ИЗЛИШЕК ДНЯ НЕ ДОБИРАЕТ КОШЕЛЬ'}`);
