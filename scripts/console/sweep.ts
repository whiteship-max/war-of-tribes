// `npm run sweep -- <что>` — перебор таблицей: доля верха по размеру стаи или набега, по величине гарнизона, по ширине
// фронта. Каждая строка — те же двери, что у `gate`, `raid` и `fight`; «ровный» — первая строка, где доля доходит до
// половины. Справка — `npm run sweep -- --help`, рецепты — docs/handbook/console.md.
import { FRONT_WIDTH } from '@/battle';
import { BATTLE_MAN } from '@/game/battle/kinds';
import { troopPower } from '@/game/battle/price';
import { defense } from '@/game/derived';
import { TROOP_IDS } from '@/game/data/troops';
import { gatePower } from '@/game/data/events';
import type { TroopId } from '@/game/types';
import type { GateFoe } from '@/world/types';
import { menOfPower } from '@/world/garrison';
import { defenceKinds } from '@/world/fights';
import { resolveField } from '@/world/battle';
import { fail, has, heavy, helpIf, num, parseArgs, parseSide, pct, pipsOf, placeOf, rejectUnknown, spread, text, troopsWords, wilson, type Args } from './lib';
import { bench, gatePoint, wallPoint, type GatePoint } from './world';
import { townOf } from './town';

const C = 'sweep';
const HELP = `
npm run sweep -- <что> [ключи]
Перебор таблицей: строка — значение перебора, доля верха пришедших (нападающего) с границей на 95 %, потери. «Ровный» —
первая строка, где доля доходит до половины.

  wolves | raiders   --level L [--army …] [--from --to --step] — стая из N волков / разбойники мощью P у ворот посёлка;
                     по умолчанию от ¼ до 3 таблиц игры для этого посёлка шагом ¼
  garrison           --level L (--wolves N | --raiders P | --power P) [--from --to --step] — войско посёлка ×k (тот же
                     состав, мерка autopilot.townAt): какой гарнизон держит стаю, разбойников или набег у стены;
                     по умолчанию k от 0.25 до 3 шагом 0.25
  power              --level L [--army …] [--from --to --step] — набег логова у стены по мощи (по умолчанию от 250 до
                     5000 шагом 250)
  width              --a … --d … [--from --to --step] [--place --river --pips-a --pips-d] — бой в поле по ширине фронта
                     W (по умолчанию от 40 до 160 шагом 5; W игры = ${FRONT_WIDTH})
Общие: --runs N (40) — боёв на строку, --seed S (1), --world S (7).

Примеры:
  npm run sweep -- wolves --level 5
  npm run sweep -- garrison --level 5 --wolves 450
  npm run sweep -- power --level 8 --from 500 --to 4000 --step 500 --runs 80
  npm run sweep -- width --a spearman:200,archer:100 --d legionary:120 --from 60 --to 130 --step 10`;

const args: Args = parseArgs();
helpIf(args, HELP);
const what = args.free[0];
if (!what) fail(C, 'что перебирать: wolves, raiders, garrison, power, width');
const runs = num(C, args, 'runs', 40, { int: true, min: 1, max: 100000 });
const seed = num(C, args, 'seed', 1, { int: true });
const worldSeed = num(C, args, 'world', 7, { int: true });

function range(def: [number, number, number]): number[] {
  const from = num(C, args, 'from', def[0]);
  const to = num(C, args, 'to', def[1]);
  const step = num(C, args, 'step', def[2], { min: Number.EPSILON });
  if (to < from) fail(C, '--to меньше --from');
  const out: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i++) out.push(Math.round((from + i * step) * 1e6) / 1e6);
  if (out.length > 400) fail(C, `строк ${out.length} — больше 400; шаг побольше`);
  return out;
}

/** Строка перебора и «ровный» — где доля впервые доходит до половины. */
function table(head: string, label: string, rows: { v: number; label: string; p: GatePoint }[], even = true): void {
  console.log(head);
  console.log(` ${label.padEnd(26)} верх пришедших (95 %)           потери пришедших %   потери обороны %`);
  for (const r of rows) {
    const [lo, hi] = wilson(r.p.won, r.p.runs);
    console.log(` ${r.label.padEnd(26)} ${pct(r.p.won / r.p.runs).padStart(7)} (${pct(lo)}…${pct(hi)})`.padEnd(62) + `${spread(r.p.attackerLoss).padEnd(20)} ${spread(r.p.defenderLoss)}`);
  }
  if (!even) return;
  const first = rows.find((r) => r.p.won * 2 >= r.p.runs);
  console.log(first ? `Ровный: ${first.label} — первая строка, где пришедшие берут верх хотя бы в половине боёв.` : 'Ровного нет: пришедшие ни в одной строке не берут верх в половине боёв.');
}

const level = (): number => num(C, args, 'level', 5, { int: true, min: 1, max: 10 });
const army = (): Partial<Record<TroopId, number>> | undefined => {
  const t = text(args, 'army');
  return t ? parseSide(C, t, worldSeed, 'войско посёлка').troops : undefined;
};

if (what === 'wolves' || what === 'raiders') {
  const L = level();
  const a = army();
  const foe: GateFoe = what;
  const values = has(args, 'from') || has(args, 'to') || has(args, 'step') ? range([0, 0, 1]) : null;
  rejectUnknown(C, args);
  await heavy(`перебор у ворот, ${foe}`);
  const b = await bench(L, worldSeed, a, { raids: false });
  const t = gatePower(b.g, foe);
  const powers = values ? values.map((v) => (foe === 'wolves' ? v * BATTLE_MAN : v)) : Array.from({ length: 12 }, (_, i) => (t * (i + 1)) / 4);
  const rows = powers.map((p) => ({
    v: p,
    label: foe === 'wolves' ? `${menOfPower(p)} волков` : `мощь ${Math.round(p)} (${menOfPower(p)})`,
    p: gatePoint(b, foe, p, seed, runs),
  }));
  table(
    `=== Перебор у ворот: ${foe === 'wolves' ? 'волки' : 'разбойники'}, посёлок ${L}-го уровня (войско ${troopsWords(b.g.army)}, оборона ${Math.round(defense(b.g))}); таблица игры — ${Math.round(t)} (${menOfPower(t)}); ${runs} боёв на строку ===`,
    foe === 'wolves' ? 'стая' : 'разбойники',
    rows,
  );
} else if (what === 'garrison') {
  const L = level();
  const wolves = has(args, 'wolves') ? num(C, args, 'wolves', 0, { min: 1 }) : null;
  const raiders = has(args, 'raiders') ? num(C, args, 'raiders', 0, { min: 1 }) : null;
  const power = has(args, 'power') ? num(C, args, 'power', 0, { min: 2 }) : null;
  if ([wolves, raiders, power].filter((x) => x !== null).length !== 1) fail(C, 'garrison: одно из --wolves N, --raiders P или --power P (набег у стены)');
  const ks = range([0.25, 3, 0.25]);
  const base = army();
  rejectUnknown(C, args);
  await heavy('перебор гарнизона');
  const mix = base ?? townOf(L).army;
  const rows: { v: number; label: string; p: GatePoint }[] = [];
  for (const k of ks) {
    const scaled = Object.fromEntries(TROOP_IDS.map((id) => [id, Math.round((mix[id] ?? 0) * k)])) as Partial<Record<TroopId, number>>;
    const b = await bench(L, worldSeed, scaled, { raids: false });
    const p = wolves !== null ? gatePoint(b, 'wolves', wolves * BATTLE_MAN, seed, runs) : raiders !== null ? gatePoint(b, 'raiders', raiders, seed, runs) : wallPoint(b, power as number, seed, runs);
    rows.push({ v: k, label: `×${k} — мощь ${Math.round(troopPower(b.g.army))}`, p });
  }
  const foe = wolves !== null ? `${wolves} волков у ворот` : raiders !== null ? `разбойники мощью ${raiders} у ворот` : `набег мощью ${power} у стены`;
  table(`=== Какой гарнизон держит: ${foe}, посёлок ${L}-го уровня, войско ×k (состав ${troopsWords(mix)}); ${runs} боёв на строку ===`, 'гарнизон', rows, false);
  const holds = rows.find((r) => r.p.won * 2 < r.p.runs);
  console.log(holds ? `Держит с ${holds.label}: первая строка, где пришедшие берут верх реже половины боёв.` : 'Не держит ни один гарнизон перебора.');
} else if (what === 'power') {
  const L = level();
  const a = army();
  const powers = range([250, 5000, 250]);
  rejectUnknown(C, args);
  await heavy('перебор набега у стены');
  const b = await bench(L, worldSeed, a, { raids: false });
  const rows = powers.map((p) => ({ v: p, label: `мощь ${p} (${menOfPower(p)})`, p: wallPoint(b, p, seed, runs) }));
  table(`=== Набег у стены по мощи: посёлок ${L}-го уровня (войско ${troopsWords(b.g.army)}, оборона ${Math.round(defense(b.g))}); ${runs} боёв на строку ===`, 'набег', rows);
} else if (what === 'width') {
  const aText = text(args, 'a');
  const dText = text(args, 'd');
  if (!aText || !dText) fail(C, 'width: нужны --a и --d');
  const ground = placeOf(C, text(args, 'place'), has(args, 'river'));
  const pipsA = pipsOf(C, text(args, 'pips-a'), 'pips-a');
  const pipsD = pipsOf(C, text(args, 'pips-d'), 'pips-d');
  const widths = range([40, 160, 5]);
  rejectUnknown(C, args);
  await heavy('перебор ширины фронта');
  const rows = widths.map((width) => {
    const p: GatePoint = { won: 0, runs, attackerLoss: [], defenderLoss: [] };
    for (let s = seed; s < seed + runs; s++) {
      const a = parseSide(C, aText, s, 'нападающий');
      const d = parseSide(C, dText, s, 'оборона');
      const f = resolveField({
        seed: s,
        attacker: { kinds: a.kinds, ...(pipsA ? { pips: pipsA } : {}) },
        defender: { kinds: defenceKinds(d.kinds, 0, 0), ...(pipsD ? { pips: pipsD } : {}) },
        ...(ground ? { ground } : {}),
        width,
      });
      if (f.won) p.won++;
      p.attackerLoss.push(f.attackerLoss * 100);
      p.defenderLoss.push(f.defenderLoss * 100);
    }
    return { v: width, label: `W ${width}${width === FRONT_WIDTH ? ' (игра)' : ''}`, p };
  });
  table(`=== Бой в поле по ширине фронта: ${aText} против ${dText}; ${runs} боёв на строку ===`, 'ширина', rows);
} else fail(C, `«${what}» — не знаю; wolves, raiders, garrison, power, width`);
process.exit(0);
