// `npm run march` — режим марша полководца (ДР-2, docs/siege_v2.md, 25): правила режимов и таблица по длинам пути —
// срок, убыль налегке к приходу, истощение лагеря за фазу у обычного и у обоза (при полном и пустом амбаре дома), энергия
// дороги, вывоз добычи по режиму (ДР-5). Все числа — дверями игры (`world/gait`, `world/siegeroll.wasteOf`, `world/energy.roadCost`, `geo.travelTime`):
// своей арифметики у команды нет. Лёгкая: без мира и боёв, замка машины не берёт. Справка — `--help`.
import { GAIT_HAUL, GAIT_LIGHT_WASTE, GAIT_META, GAIT_SPEED, GAITS, TRAIN_SHARE, gaitHaltMs, gaitSpeed, lightShare, type Gait } from '@/world/gait';
import { UNIT_BY_ID } from '@/world/data/units';
import { CAMP_WASTE, CAMP_WASTE_DAYS, CAMP_WASTE_HUNGRY } from '@/world/data/siegeroll';
import { wasteOf } from '@/world/siegeroll';
import { roadCost } from '@/world/energy';
import { ENERGY_PRICE } from '@/world/data/energy';
import { MARCH_MIN_SECONDS, TEST_TRAVEL_SPEED } from '@/world/data/tuning';
import { gameDaysOfMs, realMs, worldDays } from '@/game/pace';
import { helpIf, parseArgs, rejectUnknown, text } from './lib';

const C = 'march';
const HELP = `
npm run march -- [--days "1,3,7,15,30,43.7"]
Режим марша полководца: правила режимов и таблица по длинам пути обычным маршем (игровые дни при ×1) — срок в каждом
режиме, доля отряда, ушедшая налегке к приходу, истощение лагеря за фазу «без перемен» у обычного и у обоза (амбар дома
полный и пустой) и энергия дороги. Дни — без временного ×${TEST_TRAVEL_SPEED} пути: он делит срок сверху.

  --days "d1,d2,…"   длины пути обычным маршем, игровые дни (по умолчанию 1, 3, 7, 15, 30 и дальний сосед ${CAMP_WASTE_DAYS})`;

const args = parseArgs();
helpIf(args, HELP);
const daysText = text(args, 'days');
rejectUnknown(C, args);
const DAYS = (daysText ?? `1,3,7,15,30,${CAMP_WASTE_DAYS}`).split(',').map(Number).filter((d) => Number.isFinite(d) && d > 0);

const pct = (x: number, d = 1): string => `${(x * 100).toFixed(d)} %`;
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const lpad = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

console.log('=== Режим марша: правила (world/gait) ===');
for (const g of GAITS) console.log(`  ${pad(GAIT_META[g].name, 10)} скорость ×${GAIT_SPEED[g]}  ${GAIT_META[g].about}`);
console.log(
  `  истощение налегке: CAMP_WASTE ${CAMP_WASTE} × CAMP_WASTE_HUNGRY ${CAMP_WASTE_HUNGRY} / 4 игр. дн. фазы = ${pct(GAIT_LIGHT_WASTE, 3)} отряда в игр. день`,
);
console.log(
  `  вывоз добычи (ДР-5): доля обоза TRAIN_SHARE = 1 / CAMP_WASTE_HUNGRY = ${TRAIN_SHARE}; налегке 1 − доля = ×${GAIT_HAUL.light}, ` +
    `с обозом 1 + доля × (1 − доля) = ×${GAIT_HAUL.train}; на бойца — ${GAITS.map((g) => `${GAIT_META[g].name.toLowerCase()} ${UNIT_BY_ID.warrior.carry * GAIT_HAUL[g]}`).join(', ')} добра`,
);
const halt = gaitHaltMs();
console.log(
  `  стоянка смены в пути: самый короткий поход ${MARCH_MIN_SECONDS} игр. с = ${gameDaysOfMs(realMs(MARCH_MIN_SECONDS)).toFixed(2)} игр. дн.; ` +
    `с ×${TEST_TRAVEL_SPEED} пути — ${(halt / 60000).toFixed(1)} мин; цена — ${ENERGY_PRICE.gait.price} энергии`,
);

console.log('\n=== По длине пути (дни — обычным маршем при ×1) ===');
console.log(
  `  ${pad('путь', 8)}${GAITS.map((g) => lpad(`${GAIT_META[g].name}, дн.`, 15)).join('')}${lpad('убыль налегке', 15)}` +
    `${lpad('лагерь обычн.', 15)}${lpad('пустой амбар', 14)}${lpad('с обозом', 10)}${lpad('энергия', 10)}`,
);
for (const d of DAYS) {
  const ms = worldDays(d);
  const span = (g: Gait): number => ms / gaitSpeed(g);
  const energy = GAITS.map((g) => roadCost(span(g), gaitSpeed(g)));
  console.log(
    `  ${pad(d.toFixed(1), 8)}${GAITS.map((g) => lpad(gameDaysOfMs(span(g)).toFixed(2), 15)).join('')}` +
      `${lpad(pct(lightShare('light', span('light'))), 15)}` +
      `${lpad(pct(wasteOf('calm', d, false), 2), 15)}${lpad(pct(wasteOf('calm', d, true), 2), 14)}${lpad(pct(wasteOf('calm', d, true, true), 2), 10)}` +
      `${lpad(energy[1].toFixed(1), 10)}`,
  );
  // Та же дорога — та же энергия (М8): расхождение было бы ошибкой двери.
  if (energy.some((e) => Math.abs(e - energy[1]) > 1e-6)) console.log(`    ВНИМАНИЕ: энергия по режимам разная — ${energy.map((e) => e.toFixed(2)).join(' / ')}`);
}
