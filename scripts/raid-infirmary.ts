// Лазарет — раздел отчёта `raid-hiring:report` (прежде — раздел `raid:report`).
//
// Лазарет сделан по решениям владельца (docs/infirmary.md, раздел 9): раненый встаёт в строй тем же
// бойцом, мест — 11 бойцов строя на уровень, лежат два игровых дня, раненые полководца лежат при нём до возвращения
// дружины, рассеянные не ранены (`src/game/sim/infirmary.ts`). Раздел меряет, **что он сделал в игре**:
// сколько павших ранено, сколько легло, скольким не хватило мест, сколько встало в строй и сколько добра
// найма это сберегло. Числа до кода — снимок того же раздела на коммите 2fc77c9.
//
// Прогоны — те же, что у «Найма» (`raid-hiring.ts`, лестница мерки и партия с первой секунды): каждый бой,
// стоивший бойцов, и лазарет на каждом решении прогон пишет сам крючками прибора (`Fight`, `HireLedger`),
// и от них он не меняется. Своего прогона у раздела один — полководец, который жжёт ближние логова, пока
// дома нанимают по средствам при высоком налоге: у поведений «Найма» полководец стоит дома, а раненые в
// поле — вторая половина правила. Строка подписана как не поведение «Найма».
//
// Своей арифметики здесь две строки, и обе поверх измеренного: «встали к следующему бою» (легли в бою,
// срок `WOUND_DAYS` против промежутка до следующего боя с потерями) и «их добро» (вставшие в строй по цене
// найма павших того же боя).
import type { TroopId } from '@/game/types';
import { HOME_ID } from '@/world/local/LocalWorld';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import { createInitialState } from '@/game/state';
import { defense, healShare, infirmaryBeds } from '@/game/derived';
import { DAY_LENGTH, INFIRMARY_HEAL_CAP, MAX_BUILDING_LEVEL, WOUND_DAYS } from '@/game/constants';
import { DESERT_SHARE } from '@/game/data/upkeep';
import { MIN, START, townAt, unitCost } from './autopilot';
import { NAME, STYLES, live, type Fight, type FightKind, type Out } from './raid-live';
import type { Hired } from './raid-hiring';
import { SEEDS, pad, pct, q, sum } from './raid-common';

const LEVELS = [7, 8, 10];
const HOURS = 4;
const NEW_HOURS = 6;
const HUNT = 'высокий налог + жжёт логова';

interface Row {
  name: string;
  outs: Out[];
  hours: number;
  /** Уровень посёлка мерки; null — партия с первой секунды, уровень лазарета растёт. */
  level: number | null;
}

const tri = (xs: number[], f: (x: number) => string = (x) => String(Math.round(x))): string =>
  xs.length ? `${f(q(xs, 0.1))}…${f(q(xs, 0.5))}…${f(q(xs, 0.9))}` : '—';

/** Промежуток от боя до следующего боя с потерями того же прогона; null — следующего не было. */
function nextGap(fights: Fight[], i: number): number | null {
  const at = fights[i].at;
  const next = fights.find((f) => f.at > at);
  return next ? next.at - at : null;
}

const byKind = (fights: Fight[]): string => {
  const m = new Map<FightKind, { n: number; lost: number }>();
  for (const f of fights) {
    const x = m.get(f.kind) ?? { n: 0, lost: 0 };
    x.n++;
    x.lost += f.lost;
    m.set(f.kind, x);
  }
  return [...m.entries()]
    .sort((a, b) => b[1].lost - a[1].lost)
    .map(([k, v]) => `${k} ${v.n} (${v.lost})`)
    .join(', ');
};

/** Добро найма одного павшего этого боя — среднее по составу павших. */
const goodsPerLost = (f: Fight): number =>
  f.lost > 0 ? sum((Object.entries(f.lostBy) as [TroopId, number][]).map(([id, n]) => n * unitCost(id))) / f.lost : 0;

/** Полководец жжёт ближние логова с половиной войска; дома нанимают по средствам при высоком налоге. */
async function hunt(level: number, seed: number): Promise<{ out: Out; strikes: number; died: number }> {
  let target: string | null = null;
  let mustered = false;
  let went = 0;
  let strikes = 0;
  let died = 0;
  const g = townAt(level);
  const out = await live({
    g,
    seed,
    style: 'meansHigh',
    hours: HOURS,
    ripe: true,
    ref: defense(townAt(level)),
    strikeWent: () => went,
    after: async ({ g: x, world, now }) => {
      const figs = await world.figures();
      const gen = figs.find((f) => f.id === 'general');
      if (!gen) return;
      if (gen.gone) {
        if (gen.gone === 'died' && died === 0) died = 1;
        return;
      }
      if (gen.downUntil > START + now || gen.arriveAt > START + now || gen.readyAt > START + now || gen.besieging) return;
      const home = (await world.info()).home;
      if (!mustered) {
        if (!gen.atHome) {
          await world.moveFigure('general', home);
          return;
        }
        // Половина всего войска — так же, как берёт полководец раздела «Уведённые люди».
        const half: TroopStack = {};
        for (const id of TROOP_IDS) if ((x.army[id] ?? 0) > 1) half[id] = Math.floor((x.army[id] ?? 0) / 2);
        if (troopTotal(half) > 0 && (await world.setGarrison(half)) === null) mustered = true;
        return;
      }
      if (troopTotal(gen.troops) <= 0) {
        mustered = false;
        target = null;
        return;
      }
      if (target && gen.atId === target) {
        went = troopTotal(gen.troops);
        const res = await world.attack({ setup: null });
        if (res.error === null) strikes++;
        target = null;
        mustered = false;
        return;
      }
      target = null;
      const chunk = await world.region({ x: home.x - 26, y: home.y - 26, w: 53, h: 53 });
      const list = chunk.settlements.filter((s) => !s.mine && !s.ruin && s.id !== HOME_ID);
      list.sort((a, b) => Math.hypot(a.x - gen.at.x, a.y - gen.at.y) - Math.hypot(b.x - gen.at.x, b.y - gen.at.y));
      const next = list[0];
      if (next && (await world.moveFigure('general', { x: next.x, y: next.y })) === null) target = next.id;
    },
  });
  return { out, strikes, died };
}

export async function infirmarySection(h: Hired): Promise<void> {
  console.log('');
  console.log('=== Лазарет: что он делает с ранеными (docs/infirmary.md) ===');
  console.log('Прогоны — те же, что у «Найма» выше: лестница мерки (4 ч × 5 миров) и партия с первой секунды (6 ч × 3 мира); бои и лазарет пишет прибор.');
  console.log(`Своего прогона одна строка — «${HUNT}»: полководец жжёт ближние логова с половиной войска, дома — «по средствам, высокий налог» (не поведение «Найма»).`);

  console.log('');
  console.log(`Доля павших, которых лазарет кладёт ранеными (healShare), и мест (infirmaryBeds), по уровню; лежат ${WOUND_DAYS} игровых дня:`);
  const byLevel: string[] = [];
  let flat: number | null = null;
  let prev = -1;
  for (let l = 1; l <= MAX_BUILDING_LEVEL; l++) {
    const g = createInitialState(7);
    for (const b of g.buildings) if (b.type === 'infirmary') b.level = l;
    const s = healShare(g);
    byLevel.push(`L${l} ${pct(s)} / ${infirmaryBeds(g)}`);
    if (flat === null && Math.abs(s - prev) < 1e-9) flat = l;
    prev = s;
  }
  console.log(`  ${byLevel.join('  ')}`);
  console.log(`  Потолок INFIRMARY_HEAL_CAP ${pct(INFIRMARY_HEAL_CAP)}: ${flat === null ? 'доля растёт до десятого уровня' : `с уровня ${flat} доля не растёт`}.`);

  const rows: Row[] = [];
  for (const level of LEVELS) for (const style of STYLES) rows.push({ name: NAME[style], outs: h.ladder[`${style}:${level}`], hours: HOURS, level });
  let strikes = 0;
  let deaths = 0;
  for (const level of LEVELS) {
    const outs: Out[] = [];
    for (const seed of SEEDS) {
      const r = await hunt(level, seed);
      outs.push(r.out);
      strikes += r.strikes;
      deaths += r.died;
    }
    rows.push({ name: HUNT, outs, hours: HOURS, level });
  }
  for (const style of STYLES) rows.push({ name: NAME[style], outs: h.fresh[style], hours: NEW_HOURS, level: null });
  const where = (r: Row): string => (r.level === null ? 'с нуля' : `ур ${r.level}`);
  const fightsOf = (r: Row): Fight[][] => r.outs.map((o) => o.l.fights);
  const total = (r: Row, f: (o: Out) => number): number => sum(r.outs.map(f));

  // 1. Сколько стоит бой.
  console.log('');
  console.log('Бои, стоившие бойцов. «в час» — на мир; «на бой» — потеряно в одном бою, 10-я…медиана…90-я доля; «от вышедших» — у стены и вылазки');
  console.log('(у стены вышли все, кто был дома); «по видам» — боёв (потеряно).');
  console.log(' поведение                    где     боёв  в час  потеряно  в час  на бой      наибольший  от вышедших   по видам');
  for (const r of rows) {
    const all = fightsOf(r).flat();
    const runs = r.outs.length * r.hours;
    const lost = all.map((f) => f.lost);
    const share = all.filter((f) => f.went >= 10).map((f) => f.lost / f.went);
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(all.length, 4)}  ${pad((all.length / runs).toFixed(1), 5)}  ${pad(sum(lost), 8)}  ${pad(Math.round(sum(lost) / runs), 5)}  ${pad(tri(lost), 10)}  ${pad(lost.length ? Math.max(...lost) : 0, 10)}  ${pad(tri(share, pct), 11)}   ${byKind(all) || '—'}`,
    );
  }
  console.log(`Полководец строки «${HUNT}»: ударов ${strikes}, погиб в ${deaths} прогонах из ${LEVELS.length * SEEDS.length}.`);

  // 2. Раненые.
  console.log('');
  console.log('Раненые в игре: «ранено» — легли в бою, при полководце и не хватило мест в бою; «при полководце» — ждали дружину, «по возвращении» —');
  console.log('из них легли / не хватило мест, когда дружина вернулась; «не хватило мест» — всего; «встали» — вернулись в строй; «ушли голодом» — из лазарета;');
  console.log('«в строй из павших» — вставшие к потерянным; «навсегда» — потеряно минус вставшие.');
  console.log(' поведение                    где     потеряно  ранено  легли в бою  при полководце  по возвращении  не хватило мест  встали  ушли голодом  в строй из павших  навсегда  встали/ч');
  for (const r of rows) {
    const all = fightsOf(r).flat();
    const runs = r.outs.length * r.hours;
    const lost = sum(all.map((f) => f.lost));
    const laid = sum(all.map((f) => f.laid));
    const carried = sum(all.map((f) => f.carried));
    const noBedBattle = sum(all.map((f) => f.noBed));
    const risen = total(r, (o) => o.l.risen);
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(lost, 8)}  ${pad(laid + carried + noBedBattle, 6)}  ${pad(laid, 11)}  ${pad(carried, 14)}  ${pad(`${total(r, (o) => o.l.broughtLaid)} / ${total(r, (o) => o.l.broughtLost)}`, 14)}  ${pad(noBedBattle + total(r, (o) => o.l.broughtLost), 15)}  ${pad(risen, 6)}  ${pad(total(r, (o) => o.l.starvedWounded), 12)}  ${pad(lost > 0 ? pct(risen / lost) : '—', 17)}  ${pad(lost - risen, 8)}  ${pad((risen / runs).toFixed(1), 8)}`,
    );
  }

  // 3. Места.
  console.log('');
  console.log('Места по решениям игрока: «пик занятых» — по прогону, медиана…наибольший; «полный» — доля решений, на которых мест не оставалось;');
  console.log('«раненых в бою» — ранено в одном бою (легли, при полководце, не хватило мест), 90-я доля и наибольшее, в головах; «строя» — то же');
  console.log('в бойцах строя: место в лазарете — боец строя (derived.bedsTaken), и мест и пик — тоже в них.');
  console.log(' поведение                    где     мест    пик занятых  полный  раненых в бою: 90-я доля  наибольшее  строя: 90-я доля  наибольшее');
  for (const r of rows) {
    const peaks = r.outs.map((o) => o.l.bedsPeak);
    const decisions = total(r, (o) => o.l.growth.length);
    const w = fightsOf(r)
      .flat()
      .map((f) => f.laid + f.carried + f.noBed);
    const men = fightsOf(r)
      .flat()
      .map((f) => f.woundMen);
    const beds = r.level === null ? 'растёт' : String(infirmaryBeds(townAt(r.level)));
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(beds, 6)}  ${pad(`${Math.round(q(peaks, 0.5))}…${Math.round(Math.max(0, ...peaks))}`, 11)}  ${pad(pct(total(r, (o) => o.l.bedsFull) / Math.max(1, decisions)), 6)}  ${pad(w.length ? Math.round(q(w, 0.9)) : '—', 24)}  ${pad(w.length ? Math.max(...w) : '—', 10)}  ${pad(men.length ? Math.round(q(men, 0.9)) : '—', 16)}  ${pad(men.length ? Math.round(Math.max(...men)) : '—', 10)}`,
    );
  }

  // 3а. Ёмкость выводом (docs/infirmary.md, раздел 3): 90-я доля раненых одного боя, делённая на уровень лазарета,
  // у игрока по умолчанию и у полководца, жгущего логова, на тех уровнях, где боёв с потерями не меньше десяти;
  // наибольшее, вверх до целого. Условие: сверх мест теряется 0–5 % раненых — обещание «сверх мест — не выжили»
  // иногда сбывается, а не всегда и не никогда. Единица — боец строя (решение владельца 9).
  const RULE_ROWS = [NAME.meansHigh, HUNT];
  const MIN_FIGHTS = 10;
  console.log('');
  console.log(`Ёмкость выводом: 90-я доля раненых одного боя в бойцах строя, делённая на уровень лазарета, — строки «${NAME.meansHigh}» и «${HUNT}»,`);
  console.log(`уровни, где боёв с потерями не меньше ${MIN_FIGHTS}; наибольшее, вверх до целого. «сверх мест» — не хватило мест (в бою и по возвращении) к ранено, в головах.`);
  let need = 0;
  for (const r of rows) {
    if (r.level === null || !RULE_ROWS.includes(r.name)) continue;
    const all = fightsOf(r).flat();
    const wounded = sum(all.map((f) => f.laid + f.carried + f.noBed));
    const lostBeds = sum(all.map((f) => f.noBed)) + total(r, (o) => o.l.broughtLost);
    const p90 = all.length ? q(all.map((f) => f.woundMen), 0.9) : 0;
    const counts = all.length >= MIN_FIGHTS;
    if (counts) need = Math.max(need, p90 / r.level);
    console.log(
      `  ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  боёв ${pad(all.length, 4)}  90-я доля ${pad(p90.toFixed(1), 6)}  на уровень ${pad((p90 / r.level).toFixed(2), 5)}${counts ? '' : ' (не в счёт)'}  сверх мест ${pad(wounded > 0 ? pct(lostBeds / wounded) : '—', 4)} (${lostBeds} из ${wounded})`,
    );
  }
  console.log(`  выводом: ${need.toFixed(2)} на уровень → ${Math.ceil(need - 1e-9)} мест на уровень; в игре — ${infirmaryBeds(townAt(1))} на первом, ${infirmaryBeds(townAt(MAX_BUILDING_LEVEL))} на десятом.`);

  // 4. Срок против промежутка и против найма.
  console.log('');
  console.log('Срок против промежутка: «между боями» — от боя до следующего боя с потерями, 10-я…медиана…90-я, мин мира; «встали к следующему» — доля легших в бою,');
  console.log(`чей срок (${WOUND_DAYS} игровых дня, ${(WOUND_DAYS * DAY_LENGTH) / 60} мин мира) кончился до следующего боя с потерями; «найм» — восстановление после удержанного боя у стены, раздел «Найм».`);
  console.log(' поведение                    где     между боями, мин  встали к следующему  найм: медиана…90-я, мин  не восстановлено');
  for (const r of rows) {
    const gaps: number[] = [];
    let up = 0;
    let whole = 0;
    for (const fs of fightsOf(r)) {
      fs.forEach((f, i) => {
        const gap = nextGap(fs, i);
        if (gap === null) return;
        if (i === 0 || fs[i - 1].at !== f.at) gaps.push(gap);
        whole += f.laid;
        if (WOUND_DAYS * DAY_LENGTH * 1000 <= gap) up += f.laid;
      });
    }
    const restore = r.outs.flatMap((o) => o.l.restore);
    const done = restore.filter((x) => x.done !== null).map((x) => x.done as number);
    const hire = done.length ? `${Math.round(q(done, 0.5) / MIN)}…${Math.round(q(done, 0.9) / MIN)}` : '—';
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(tri(gaps.map((x) => x / MIN)), 16)}  ${pad(whole > 0 ? pct(up / whole) : '—', 19)}  ${pad(hire, 23)}  ${pad(`${restore.length - done.length} из ${restore.length}`, 16)}`,
    );
  }

  // 5. Что это сберегло.
  console.log('');
  console.log('Что сберёг лазарет: «их добро» — вставшие в строй по добру найма павших (припас найма и снаряжение по цене ковки, unitCost), в час на мир;');
  console.log(`«паёк лазарета» — ранено и легло или ждало × паёк бойца × ${WOUND_DAYS} дня, в час; «найм и ковка» — всё, что автопилот потратил на найм и снаряжение, в час.`);
  console.log(' поведение                    где     встали в час  их добро в час  паёк лазарета в час  найм и ковка в час  их добро к найму');
  for (const r of rows) {
    const runs = r.outs.length * r.hours;
    const all = fightsOf(r).flat();
    const laid = sum(all.map((f) => f.laid + f.carried));
    const risen = total(r, (o) => o.l.risen);
    // Цена вставшего — средняя цена павших тех боёв, где раненые легли, взвешенная легшими.
    const perLaid = laid > 0 ? sum(all.map((f) => (f.laid + f.carried) * goodsPerLost(f))) / laid : 0;
    const goods = (risen * perLaid) / runs;
    const ration = sum(all.map((f) => (f.laid + f.carried) * f.eat * WOUND_DAYS)) / runs;
    const spent = total(r, (o) => o.l.spent) / runs;
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad((risen / runs).toFixed(1), 12)}  ${pad(Math.round(goods), 14)}  ${pad(Math.round(ration), 19)}  ${pad(Math.round(spent), 18)}  ${pad(spent > 0 ? pct(goods / spent) : '—', 16)}`,
    );
  }

  // 6. Голод.
  console.log('');
  console.log('Голод: «нехватка еды» — решений, где войску не хватало еды (foodShortfall, делитель — все, кто ест солдатский паёк); «тревога: неуплата» — из них,');
  console.log('где строка тревоги назвала больший повод неуплатой (строка одна на оба повода, `derived.upkeepInfo.why`). Дальше — судьба ушедших по строкам');
  console.log(`летописи, которые пишет сама дверь: «ушло голодом» и «ушло неуплатой» из строя, «голодный жителем» обязан быть нулём — поводы делят уходящих,`);
  console.log(`и жителем возвращается только неуплата. «ушли из лазарета» и «ушли с учений» — всегда голодом (доля ухода ${DESERT_SHARE} в день).`);
  console.log(' поведение                    где     нехватка еды  тревога: неуплата  ушло голодом  ушло неуплатой  голодный жителем  ушли из лазарета  ушли с учений');
  for (const r of rows) {
    const decisions = total(r, (o) => o.l.growth.length);
    const unfed = total(r, (o) => o.l.unfed);
    const asPay = total(r, (o) => o.l.unfedAsPay);
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(`${unfed} из ${decisions}`, 12)}  ${pad(unfed ? `${asPay} (${pct(asPay / unfed)})` : '—', 17)}  ${pad(total(r, (o) => o.l.starvedLine), 12)}  ${pad(total(r, (o) => o.l.paidLine), 14)}  ${pad(total(r, (o) => o.l.starvedHome), 16)}  ${pad(total(r, (o) => o.l.starvedWounded), 16)}  ${pad(total(r, (o) => o.l.starvedDrafts), 13)}`,
    );
  }
}
