// Лазарет — раздел `raid:report`.
//
// Раздел заведён до кода лазарета (docs/infirmary.md) тем же порядком, что содержание войска и башня:
// сначала числа, потом решение владельца, потом код. Прежний раздел жил в `sack:report` и мерил мир, в
// котором бой не стоил людей (снимок на 3fffacf); логова с тех пор растут от жителей, оборона считается
// по составу, и игрок платит за войско. Поэтому раздел читает **те же прогоны, что «Найм»**
// (`raid-hiring.ts`, лестница мерки и партия с первой секунды) — гонять их второй раз незачем: каждый
// бой, стоивший бойцов, прогон пишет сам крючками прибора (`Fight`), и от них он не меняется.
//
// Своего прогона у раздела один — полководец, который жжёт ближние логова, пока дома нанимают по
// средствам при высоком налоге: у поведений «Найма» полководец стоит дома, а удар по логову — второй,
// после стены, источник раненых в живой игре. Строка подписана как не поведение «Найма».
//
// Что меряется (вопросы docs/infirmary.md, разделы 1–5):
//  1. сколько бойцов стоит бой — по видам боя, на бой и в час, и что с ними делает нынешнее правило
//     (`applyExpedition`: доля `healShare` возвращается жителями, округление вниз на каждом бою);
//  2. `healShare` по уровням и где он упирается в потолок;
//  3. раненых одного боя и сколько их разом при сроке лечения T — по уровню лазарета;
//  4. срок против промежутка между боями и против восстановления наймом; цена лежания против найма;
//  5. голод: как часто войску не хватает еды и каким поводом дверь содержания называет уход.
//
// Своей арифметики здесь пять мест, и все поверх измеренных боёв: «разом» (раненые каждого боя лежат T
// игровых дней), «не легло сверх ёмкости» (те же сроки при местах на уровень, выведенных из боёв),
// «встали до следующего боя», цена лежания (паёк и жалованье за T дней против добра найма) и «их добро»
// (раненые, вернувшиеся бы бойцами, по цене найма). Раненых в игре нет — это подстановка, а не игра, и так
// и подписано.
import type { TroopId } from '@/game/types';
import { HOME_ID } from '@/world/local/LocalWorld';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import { createInitialState } from '@/game/state';
import { defense, healShare } from '@/game/derived';
import { DAY_LENGTH, INFIRMARY_HEAL_CAP, MAX_BUILDING_LEVEL } from '@/game/constants';
import { DESERT_SHARE } from '@/game/data/upkeep';
import { MIN, START, townAt, unitCost } from './autopilot';
import { NAME, STYLES, live, type Fight, type FightKind, type Hired, type Out } from './raid-hiring';
import { SEEDS, mean, pad, pct, q, sum } from './raid-lair-growth';

const LEVELS = [7, 8, 10];
const HOURS = 4;
const NEW_HOURS = 6;
/** Сроки лечения, игровых дней. */
const TERMS = [1, 2, 3, 5, 10, 20];
/** Со скольких боёв с потерями на уровне из него выводится ёмкость. */
const CAP_FLOOR = 10;

interface Row {
  name: string;
  outs: Out[];
  hours: number;
  /** Уровень посёлка мерки; null — партия с первой секунды, уровень лазарета растёт. */
  level: number | null;
}

const wounded = (f: Fight): number => f.lost * f.heal;
const dayMs = (days: number): number => days * DAY_LENGTH * 1000;
const tri = (xs: number[], f: (x: number) => string = (x) => String(Math.round(x))): string =>
  xs.length ? `${f(q(xs, 0.1))}…${f(q(xs, 0.5))}…${f(q(xs, 0.9))}` : '—';

/** Сколько раненых лежит разом, если каждый бой кладёт `w(f)` на `ms`. Встающие уходят раньше приходящих. */
function peak(fights: Fight[], ms: number, w: (f: Fight) => number): number {
  const ev: [number, number][] = [];
  for (const f of fights) {
    const n = w(f);
    if (n <= 0) continue;
    ev.push([f.at, n], [f.at + ms, -n]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let top = 0;
  for (const [, d] of ev) {
    cur += d;
    top = Math.max(top, cur);
  }
  return top;
}

/**
 * Сколько раненых не легло бы в лазарет ёмкости `cap(уровень)` при сроке `ms`: каждый бой кладёт своих, пока
 * есть места, остальные потеряны; места освобождаются через срок. Бой на уровне без ёмкости (`cap` null)
 * не считается ни в раненых, ни в потерянных.
 */
function overflow(fights: Fight[], ms: number, cap: (level: number) => number | null): { whole: number; lost: number } {
  const beds: [number, number][] = [];
  let whole = 0;
  let lost = 0;
  for (const f of [...fights].sort((a, b) => a.at - b.at)) {
    const c = cap(f.level);
    if (c === null) continue;
    for (let i = beds.length - 1; i >= 0; i--) if (beds[i][0] <= f.at) beds.splice(i, 1);
    const busy = sum(beds.map((b) => b[1]));
    const w = wounded(f);
    const lay = Math.max(0, Math.min(w, c - busy));
    whole += w;
    lost += w - lay;
    if (lay > 0) beds.push([f.at + ms, lay]);
  }
  return { whole, lost };
}

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
  console.log('=== Лазарет: сколько раненых бывает и что с ними можно сделать (docs/infirmary.md) ===');
  console.log('Прогоны — те же, что у «Найма» выше: лестница мерки (4 ч × 5 миров) и партия с первой секунды (6 ч × 3 мира); бои пишет прибор.');
  console.log('Своего прогона одна строка: полководец жжёт ближние логова с половиной войска, дома — «по средствам, высокий налог» (не поведение «Найма»).');

  // 2. healShare по уровням.
  console.log('');
  console.log('Доля потерь, которую лазарет возвращает жителями (healShare), по уровню здания:');
  let prev = -1;
  let flat: number | null = null;
  const shares: string[] = [];
  for (let l = 1; l <= MAX_BUILDING_LEVEL; l++) {
    const g = createInitialState(7);
    for (const b of g.buildings) if (b.type === 'infirmary') b.level = l;
    const s = healShare(g);
    shares.push(`L${l} ${pct(s)}`);
    if (flat === null && Math.abs(s - prev) < 1e-9) flat = l;
    prev = s;
  }
  console.log(`  ${shares.join('  ')}`);
  console.log(`  Потолок INFIRMARY_HEAL_CAP ${pct(INFIRMARY_HEAL_CAP)}: ${flat === null ? 'не достигается' : `с уровня ${flat} уровень ничего не прибавляет`}.`);

  // Строки.
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
    rows.push({ name: 'высокий налог + жжёт логова', outs, hours: HOURS, level });
  }
  for (const style of STYLES) rows.push({ name: NAME[style], outs: h.fresh[style], hours: NEW_HOURS, level: null });
  const where = (r: Row): string => (r.level === null ? 'с нуля' : `ур ${r.level}`);
  const fightsOf = (r: Row): Fight[][] => r.outs.map((o) => o.l.fights);

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
  console.log(`Полководец строки «жжёт логова»: ударов ${strikes}, погиб в ${deaths} прогонах из ${LEVELS.length * SEEDS.length}.`);

  // 1б. Нынешнее правило.
  console.log('');
  console.log('Что с ними делает нынешнее правило (applyExpedition): «раненых» — сумма потерь × healShare в минуту боя; «вернулось» — жителями,');
  console.log('с округлением вниз на каждом бою; «навсегда» — записано погибшими; «прирост» — среднее popGrowth по решениям, в час; «вернулось к приросту» — в час.');
  console.log(' поведение                    где     потеряно  раненых  вернулось  навсегда  вернулось/ч  прирост/ч  вернулось к приросту');
  for (const r of rows) {
    const all = fightsOf(r).flat();
    const runs = r.outs.length * r.hours;
    const lost = sum(all.map((f) => f.lost));
    const back = sum(all.map((f) => f.back));
    const growth = mean(r.outs.flatMap((o) => o.l.growth)) * (3600 / DAY_LENGTH);
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(lost, 8)}  ${pad(Math.round(sum(all.map(wounded))), 7)}  ${pad(back, 9)}  ${pad(lost - back, 8)}  ${pad((back / runs).toFixed(1), 11)}  ${pad(growth.toFixed(1), 9)}  ${pad(growth > 0 ? pct(back / runs / growth) : '—', 20)}`,
    );
  }

  // 3. Раненых одного боя и разом, по уровню лазарета.
  console.log('');
  console.log('Раненых одного боя по уровню лазарета в минуту боя; лестница и партия с нуля вместе. «потеряно в бою» — 10-я…медиана…90-я доля;');
  console.log(`«раненых» — то же × healShare уровня. Уровень без ${CAP_FLOOR} боёв с потерями — «мало боёв», ёмкости из него не выводится.`);
  const HUNT = 'высокий налог + жжёт логова';
  const groups: [string, Fight[]][] = [
    [NAME.meansHigh, rows.filter((r) => r.name === NAME.meansHigh).flatMap((r) => fightsOf(r).flat())],
    [HUNT, rows.filter((r) => r.name === HUNT).flatMap((r) => fightsOf(r).flat())],
  ];
  /**
   * Ёмкость из измеренного — мест на уровень: наибольшая из 90-х долей раненых одного боя, делённых на уровень,
   * по уровням с `CAP_FLOOR` боями у обеих групп. По уровням замеры редки (бои начинаются после защиты новичка),
   * поэтому ёмкость — одно число на уровень, а не таблица.
   */
  let perLevel = 0;
  for (const [name, fights] of groups) {
    console.log(`  ${name}:`);
    console.log('   ур  боёв  потеряно в бою  наибольшее  раненых в бою: 90-я доля  наибольшее');
    for (let l = 1; l <= MAX_BUILDING_LEVEL; l++) {
      const xs = fights.filter((f) => f.level === l);
      if (xs.length === 0) {
        console.log(`   ${pad(l, 2)}  боёв с потерями не было`);
        continue;
      }
      const lost = xs.map((f) => f.lost);
      const w = xs.map(wounded);
      const few = xs.length < CAP_FLOOR ? '  мало боёв' : '';
      if (!few) perLevel = Math.max(perLevel, q(w, 0.9) / l);
      console.log(`   ${pad(l, 2)}  ${pad(xs.length, 4)}  ${pad(tri(lost), 14)}  ${pad(Math.max(...lost), 10)}  ${pad(Math.ceil(q(w, 0.9)), 24)}  ${pad(Math.ceil(Math.max(...w)), 10)}${few}`);
    }
  }
  console.log('');
  console.log('Раненых разом при сроке лечения T (подстановка: раненые каждого боя лежат T игровых дней; ёмкости нет): пик по прогону, медиана…наибольший по прогонам.');
  console.log(' поведение                    где     ' + TERMS.map((t) => `T ${t} дн.`.padStart(12)).join(''));
  for (const r of rows) {
    const cells = TERMS.map((t) => {
      const peaks = fightsOf(r).map((fs) => peak(fs, dayMs(t), wounded));
      return pad(`${Math.round(q(peaks, 0.5))}…${Math.round(Math.max(0, ...peaks))}`, 12);
    });
    console.log(` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${cells.join('')}`);
  }
  console.log('');
  const beds = Math.ceil(perLevel);
  console.log(`Ёмкость из измеренного — наибольшая 90-я доля раненых боя на уровень лазарета: ${perLevel.toFixed(2)}, мест на уровень ${beds} (L1 ${beds}, L5 ${5 * beds}, L10 ${10 * beds}).`);
  console.log('Сколько раненых не легло бы при такой ёмкости (подстановка: места заняты до конца срока, сверх мест — потеряны):');
  console.log(' поведение                    где     ' + TERMS.map((t) => `T ${t} дн.`.padStart(10)).join('') + '  раненых');
  for (const r of rows) {
    const cells = TERMS.map((t) => {
      const o = fightsOf(r).map((fs) => overflow(fs, dayMs(t), (l) => beds * l));
      const whole = sum(o.map((x) => x.whole));
      return pad(whole > 0 ? pct(sum(o.map((x) => x.lost)) / whole) : '—', 10);
    });
    console.log(` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${cells.join('')}  ${pad(Math.round(sum(fightsOf(r).flat().map(wounded))), 7)}`);
  }

  // 4. Срок против промежутка и против найма.
  console.log('');
  console.log('Срок против промежутка: «между боями» — от боя до следующего боя с потерями, 10-я…медиана…90-я, мин мира; «встали к следующему» — доля раненых,');
  console.log(`чей срок T кончился до следующего боя с потерями (игровой день — ${DAY_LENGTH} с); «найм» — восстановление после удержанного боя у стены, раздел «Найм».`);
  console.log(' поведение                    где     между боями, мин  ' + TERMS.map((t) => `T ${t}`.padStart(6)).join('') + '  найм: медиана…90-я, мин  не восстановлено');
  for (const r of rows) {
    const gaps: number[] = [];
    const up = TERMS.map(() => 0);
    let whole = 0;
    for (const fs of fightsOf(r)) {
      fs.forEach((f, i) => {
        const gap = nextGap(fs, i);
        if (gap === null) return;
        if (i === 0 || fs[i - 1].at !== f.at) gaps.push(gap);
        whole += wounded(f);
        TERMS.forEach((t, k) => {
          if (dayMs(t) <= gap) up[k] += wounded(f);
        });
      });
    }
    const restore = r.outs.flatMap((o) => o.l.restore);
    const done = restore.filter((x) => x.done !== null).map((x) => x.done as number);
    const hire = done.length ? `${Math.round(q(done, 0.5) / MIN)}…${Math.round(q(done, 0.9) / MIN)}` : '—';
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(tri(gaps.map((x) => x / MIN)), 16)}  ${up.map((u) => pad(whole > 0 ? pct(u / whole) : '—', 6)).join('')}  ${pad(hire, 23)}  ${pad(`${restore.length - done.length} из ${restore.length}`, 16)}`,
    );
  }

  console.log('');
  console.log('Цена лежания против найма: «добро на павшего» — припас найма и снаряжение по цене ковки (unitCost) по составу павших; «паёк» и «жалованье» —');
  console.log('soldierFoodPerDay и wageOf павших в минуту боя, в игровой день; ячейки T — паёк за T дней к добру на павшего (в скобках — с жалованьем, золото к добру один к одному).');
  console.log('Найм берёт ещё свободного жителя и время казарм и кузницы — в долю не входят.');
  console.log(' поведение                    где     добро на павшего  паёк  жалованье  ' + TERMS.map((t) => `T ${t}`.padStart(12)).join(''));
  for (const r of rows) {
    const all = fightsOf(r).flat();
    const lost = sum(all.map((f) => f.lost));
    if (lost === 0) {
      console.log(` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  павших нет`);
      continue;
    }
    const goods = sum(all.map((f) => sum((Object.entries(f.lostBy) as [TroopId, number][]).map(([id, n]) => n * unitCost(id))))) / lost;
    const eat = sum(all.map((f) => f.eat * f.lost)) / lost;
    const wage = sum(all.map((f) => f.wage * f.lost)) / lost;
    const cells = TERMS.map((t) => pad(`${pct((eat * t) / goods)} (${pct(((eat + wage) * t) / goods)})`, 12));
    console.log(` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(goods.toFixed(1), 16)}  ${pad(eat.toFixed(2), 4)}  ${pad(wage.toFixed(2), 9)}  ${cells.join('')}`);
  }

  console.log('');
  console.log('Сколько добра найма вернул бы лазарет, если бы раненый возвращался бойцом со снаряжением (подстановка): «раненых в час» — на мир;');
  console.log('«их добро» — раненые × добро на павшего их вида, в час; «найм и ковка» — всё, что автопилот потратил на найм и снаряжение, в час; последний столбец — доля.');
  console.log(' поведение                    где     раненых в час  их добро в час  найм и ковка в час  доля');
  for (const r of rows) {
    const runs = r.outs.length * r.hours;
    const all = fightsOf(r).flat();
    const goods = sum(all.map((f) => f.heal * sum((Object.entries(f.lostBy) as [TroopId, number][]).map(([id, n]) => n * unitCost(id))))) / runs;
    const spent = sum(r.outs.map((o) => o.l.spent)) / runs;
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad((sum(all.map(wounded)) / runs).toFixed(1), 13)}  ${pad(Math.round(goods), 14)}  ${pad(Math.round(spent), 18)}  ${pad(spent > 0 ? pct(goods / spent) : '—', 4)}`,
    );
  }

  // 5. Голод.
  console.log('');
  console.log(`Голод и повод ухода: «нехватка еды» — доля решений, где войску не хватало еды (foodShortfall); «названо неуплатой» — из них, где дверь содержания`);
  console.log(`назвала повод неуплатой (unpaid ≥ unfed): тогда уходящие возвращаются жителями. Уход — ${DESERT_SHARE} доли в день. «еда раненых боя» — раненые одного боя × паёк`);
  console.log('к выработке еды посёлка в ту минуту, 90-я доля и наибольшая.');
  console.log(' поведение                    где     нехватка еды  названо неуплатой  еда раненых боя к выработке');
  for (const r of rows) {
    const decisions = sum(r.outs.map((o) => o.l.growth.length));
    const unfed = sum(r.outs.map((o) => o.l.unfed));
    const asPay = sum(r.outs.map((o) => o.l.unfedAsPay));
    const load = fightsOf(r)
      .flat()
      .filter((f) => f.food > 0)
      .map((f) => (wounded(f) * f.eat) / f.food);
    console.log(
      ` ${r.name.padEnd(27)}  ${where(r).padEnd(6)}  ${pad(`${unfed} из ${decisions}`, 12)}  ${pad(unfed ? `${asPay} (${pct(asPay / unfed)})` : '—', 17)}  ${load.length ? `${(q(load, 0.9) * 100).toFixed(1)}%…${(Math.max(...load) * 100).toFixed(1)}%` : '—'}`,
    );
  }
}
