// `npm run fight` — бой двух сторон ядром, той же дверью, что набег и штурм у мира и сервера (`world/fights.wallFight`):
// стороны, место, стена, отметки, сид и повторы → исход, потери, ход боя по фазам, доля побед с разбросом.
// Справка — `npm run fight -- --help`, рецепты — docs/handbook/console.md.
import { FRONT_WIDTH, SPIRIT, type BattleResult, type Side, type Spirit } from '@/battle';
import { PHASE_NAME, REASON_NAME, describeEvent } from '@/battle/log';
import { summarize } from '@/battle/report';
import { defenceKinds, wallFight } from '@/world/fights';
import { resolveField, type FieldInput, type FieldOutcome } from '@/world/battle';
import { openingWords, wallFront } from '@/world/wall';
import type { BattleRecord } from '@/world/types';
import { troopsOfKinds } from '@/game/battle/faces';
import {
  LIGHT_BATTLES,
  SIDE_HELP,
  assaultOf,
  fail,
  has,
  heavy,
  helpIf,
  kindsWords,
  num,
  parseArgs,
  parseSide,
  pipsOf,
  placeOf,
  rejectUnknown,
  replayHint,
  saveRecord,
  shareWords,
  sideLines,
  spread,
  text,
  type SideSpec,
} from './lib';
import { townSide } from './town';
import { AXIS_AIM, SPIRIT_AIM, SPIRIT_CHECKS, SPIRIT_MIX, deriveSpirit, strengthOf } from './spirit';
import { BEST_GENERAL, deriveFlank, flankChecks } from './flank';
import { TACTICS_TOP } from '@/game/commandrules';
import { SCARS, SCAR_SIZE, type ScarId } from '@/game/scarrules';
import { deriveScar, deriveScars, deriveScarsFan, horseShareOfMix, scarChecks } from './scars';

const C = 'fight';
const HELP = `
npm run fight -- --a <сторона> --d <сторона> [ключи]
Бой двух сторон ядром, дверью боя у стены мира и сервера (world/fights.wallFight). Нападающий — --a, обороняющийся — --d.

  --a, --d "вид:число,…"   стороны (ниже); у обороны вместо --d можно --town L — гарнизон, ополчение и стрелки башни
                           посёлка мерки уровня L (тот же, что у отчётов: autopilot.townAt)
  --militia N --tower N    ополчение обороны и сколько из него стрелков башни (к --d; у --town — свои)
  --wall СПОСОБ            бой у стены: none (поле, по умолчанию), scaling (с ходу), ladders, ram, tower, breach:N,
                           через «+»: ladders+ram, breach:2+tower
  --place МЕСТО --river    земля и переправа — штраф кости нападающему: plain steppe desert forest hills mountains
  --pips-a, --pips-d       отметки полководца: "fire:2,shock:1,melee:0,maneuver:3"
  --rest-a, --rest-d       мораль между боями, доля полной 0..1 (1 — свежие)
  --resolve-a, --resolve-d стойкость (обряд), 0 по умолчанию
  --spirit-a, --spirit-d   дух войска ДР-1 «мораль,дисциплина», шкалы 0..100 (70 — нейтраль, без ключа — без духа)
  --derive-spirit          вывод точек духа (SPIRIT в src/battle/config.ts) и сила по углам шкал; сторона — --a (по
                           умолчанию мерка spearman:200,archer:80,legionary:60), сидов — --runs (200);
                           --check — только сила по углам при записанных, без вывода
  --derive-flank           вывод вершины тактики командиров флангов (TACTICS_TOP в src/game/commandrules.ts, ДР-3) и сила
                           командира каждого рода и уровня; сторона — --a (по умолчанию та же мерка), сидов — --runs (200);
                           --check — только сила при записанной вершине
  --derive-scars           вывод величин черт армии (SCAR_SIZE в src/game/scarrules.ts, ДР-4): добрая в своём бою — как
                           шкала духа на верху, дурная — её зеркало; сидов — --runs (100); --check — только сила при записанных;
                           --scar ИМЯ[,ИМЯ…] — только названные (ghosts, woodfear…): несколько — веером, по процессу
                           на черту (бюджет ядер); проверка — тоже только их
  --width W                ширина фронта полосы, бойцов строя (по умолчанию W игры = ${FRONT_WIDTH})
  --seed S                 сид первого боя (1); --runs N — боёв подряд на сидах S, S+1, … (1)
  --log                    журнал боя целиком (каждое событие); без него — фазы и ключевые события
  --watch                  открыть ролик этого боя (первого сида) в браузере
${SIDE_HELP}

Примеры:
  npm run fight -- --a spearman:120,archer:60 --d "kind:infantry:150" --runs 40
  npm run fight -- --a raiders:900 --town 5 --wall scaling --runs 100
  npm run fight -- --a legionary:80 --d lair:600 --place forest --river --log`;

const args = parseArgs();
helpIf(args, HELP);
const seed = num(C, args, 'seed', 1, { int: true });
const runs = num(C, args, 'runs', 1, { int: true, min: 1, max: 100000 });
if (has(args, 'derive-spirit')) await deriveSpiritCommand();
if (has(args, 'derive-flank')) await deriveFlankCommand();
if (has(args, 'derive-scars')) await deriveScarsCommand();
const aText = text(args, 'a') ?? text(args, 'attacker');
if (!aText) fail(C, 'нет нападающего: --a "spearman:100"');
const townLevel = has(args, 'town') ? num(C, args, 'town', 1, { int: true, min: 1, max: 10 }) : null;
const dText = text(args, 'd') ?? text(args, 'defender');
if (!dText && townLevel === null) fail(C, 'нет обороны: --d "spearman:100" или --town 5');
const wallSpec = text(args, 'wall', 'none') as string;
const assault = assaultOf(C, wallSpec);
const width = num(C, args, 'width', FRONT_WIDTH, { min: 1 });
const ground = placeOf(C, text(args, 'place'), has(args, 'river'));
const pipsA = pipsOf(C, text(args, 'pips-a'), 'pips-a');
const pipsD = pipsOf(C, text(args, 'pips-d'), 'pips-d');
const restA = num(C, args, 'rest-a', 1, { min: 0, max: 1 });
const restD = num(C, args, 'rest-d', 1, { min: 0, max: 1 });
const resolveA = num(C, args, 'resolve-a', 0);
const resolveD = num(C, args, 'resolve-d', 0);
/** Дух стороны из ключа «мораль,дисциплина»; нет ключа — без духа. */
function spiritOf(key: string): Spirit | undefined {
  const v = text(args, key);
  if (v === undefined) return undefined;
  const [m, d] = v.split(',').map((x) => Number(x.trim()));
  if (!Number.isFinite(m) || !Number.isFinite(d) || m < 0 || d < 0 || m > SPIRIT.top || d > SPIRIT.top) fail(C, `--${key}: «мораль,дисциплина», 0..${SPIRIT.top}`);
  return { morale: m, discipline: d };
}
const spiritA = spiritOf('spirit-a');
const spiritD = spiritOf('spirit-d');
const log = has(args, 'log');
const watch = has(args, 'watch');
const town = townLevel !== null ? await townSide(townLevel, seed) : null;
const militia = num(C, args, 'militia', town?.militia ?? 0, { int: true, min: 0 });
const archers = num(C, args, 'tower', town?.archers ?? 0, { int: true, min: 0 });
rejectUnknown(C, args);
if (runs > LIGHT_BATTLES) await heavy(`бой, ${runs} сидов`);

const sideAt = (s: number): { a: SideSpec; d: SideSpec } => ({
  a: parseSide(C, aText, s, 'нападающий'),
  d: town && !dText ? town.side : parseSide(C, dText as string, s, 'оборона'),
});

const front = assault ? wallFront(assault, width) : null;

/** Бой одного сида: стена — дверью `wallFight`; поле при своей ширине — тем же составом обороны, что у неё (`defenceKinds`). */
function battle(s: number): { a: SideSpec; d: SideSpec; field: FieldOutcome; input: FieldInput } {
  const { a, d } = sideAt(s);
  const attacker = { kinds: a.kinds, resolve: resolveA, ...(pipsA ? { pips: pipsA } : {}), rest: restA, ...(spiritA ? { spirit: spiritA } : {}) };
  const defender = { kinds: d.kinds, militia, archers, resolve: resolveD, ...(pipsD ? { pips: pipsD } : {}), rest: restD, ...(spiritD ? { spirit: spiritD } : {}) };
  if (front || width === FRONT_WIDTH) {
    const { input, field } = wallFight({ seed: s, attacker, defender, ...(ground ? { ground } : {}), front });
    return { a, d, field, input };
  }
  const input: FieldInput = {
    seed: s,
    attacker,
    defender: {
      kinds: defenceKinds(d.kinds, militia, archers),
      resolve: resolveD,
      ...(pipsD ? { pips: pipsD } : {}),
      rest: restD,
      ...(spiritD ? { spirit: spiritD } : {}),
    },
    ...(ground ? { ground } : {}),
    width,
  };
  return { a, d, field: resolveField(input), input };
}

const first = battle(seed);
console.log(`=== Бой: сид ${seed}${runs > 1 ? `…${seed + runs - 1} (${runs} боёв)` : ''}, ширина фронта ${front ? `${Math.round(front.width)} из ${width}` : width} ===`);
for (const line of sideLines('нападающий', first.a)) console.log(line);
for (const line of sideLines(town && !dText ? `оборона — посёлок мерки ${townLevel}-го уровня` : 'оборона', first.d, militia > 0 ? `; ополчение ${militia}, из него стрелков башни ${Math.min(militia, archers)}` : '')) console.log(line);
if (front) for (const o of front.openings) console.log(`  стена — ${openingWords(o, width)}`);
if (ground) console.log(`  место: земля −${ground.land ?? 0} граней${ground.crossing ? `, переправа −${ground.crossing}` : ''} нападающему`);
if (pipsA || pipsD) console.log(`  отметки: нападающий ${JSON.stringify(pipsA ?? {})}, оборона ${JSON.stringify(pipsD ?? {})}`);

const r = first.field.result;
if (!r) {
  console.log(first.field.won ? 'Боя нет: обороны нет — нападающий взял верх даром.' : 'Боя нет: нападающих нет.');
  process.exit(0);
}

const SIDE_WORD: Record<Side, string> = { attacker: 'нападающий', defender: 'оборона' };
function oneBattle(res: BattleResult): void {
  const win = res.winner === 'draw' ? 'ничья' : `верх взял ${SIDE_WORD[res.winner]}`;
  console.log('');
  console.log(`Исход: ${win} — ${REASON_NAME[res.reason]}${res.pyrrhic ? ', пиррова победа' : ''}; ${res.ticks} тиков.`);
  for (const side of ['attacker', 'defender'] as const) {
    const s = res.sides[side];
    console.log(
      `  ${SIDE_WORD[side].padEnd(11)} было ${Math.round(s.total.initial)}, пало ${Math.round(s.total.losses)} (${Math.round((100 * s.total.losses) / Math.max(1, s.total.initial))} %), мораль в конце ${Math.round(s.morale)}; по родам пало: ${kindsWords(s.losses)}`,
    );
  }
  console.log('');
  console.log('Ход боя по фазам (тики, павшие нападающего / обороны, мораль в конце фазы):');
  for (const p of res.phases) {
    const mor = p.morale ? `, мораль ${p.morale.attacker} / ${p.morale.defender}` : '';
    console.log(`  ${`${PHASE_NAME[p.phase]}${p.round ? ` (круг ${p.round})` : ''}`.padEnd(26)} ${String(p.from).padStart(3)}–${String(p.to).padEnd(3)} пало ${Math.round(p.losses.attacker)} / ${Math.round(p.losses.defender)}${mor}`);
  }
  if (log) {
    console.log('');
    console.log('Журнал боя:');
    for (const e of res.log) console.log(`  [${String(e.tick).padStart(3)}] ${describeEvent(e)}`);
  } else {
    const sum = summarize(res, 'attacker');
    if (sum.keys.length > 0) {
      console.log('');
      console.log('Ключевые события (глазами нападающего; весь журнал — --log):');
      for (const k of sum.keys) console.log(`  [${String(k.tick).padStart(3)}] ${k.text}`);
    }
  }
}

if (runs === 1) oneBattle(r);
else {
  const outs = [first.field];
  for (let i = 1; i < runs; i++) outs.push(battle(seed + i).field);
  const won = outs.filter((f) => f.won).length;
  const draws = outs.filter((f) => f.result?.winner === 'draw').length;
  console.log('');
  console.log(`Нападающий взял верх: ${shareWords(won, runs)}; ничьих ${draws}.`);
  console.log(`Потери нападающего, доля вышедших, 10-я…медиана…90-я: ${spread(outs.map((f) => f.attackerLoss * 100))} %`);
  console.log(`Потери обороны: ${spread(outs.map((f) => f.defenderLoss * 100))} %`);
  console.log(`Длина боя, тиков: ${spread(outs.map((f) => f.result?.ticks ?? 0))}`);
  console.log('');
  console.log(`Первый бой (сид ${seed}) подробно:`);
  oneBattle(r);
}

// Запись для ролика: виды племени — как вышли; рода ядра без вида — видами без вещей (как чужой отряд в игре).
const troopsFor = (s: SideSpec, side: Side): BattleRecord['troops'][Side] => {
  const own = { ...s.troops };
  const fromKinds = troopsOfKinds(r.sides[side].initial);
  const counted = Object.values(own).reduce((n, x) => n + (x ?? 0), 0);
  return counted > 0 ? own : fromKinds;
};
const rec: BattleRecord = {
  us: 'attacker',
  result: r,
  troops: { attacker: troopsFor(first.a, 'attacker'), defender: troopsFor(first.d, 'defender') },
  ...(militia > 0 ? { militia: { attacker: { men: 0, archers: 0 }, defender: { men: militia, archers: Math.min(militia, archers) } } } : {}),
  ...(first.a.beasts ? { beasts: 'attacker' as const } : first.d.beasts ? { beasts: 'defender' as const } : {}),
  ...(front ? { site: 'wall' as const, openings: front.openings } : {}),
} as BattleRecord;
const file = saveRecord(C, { kind: 'battle', title: `Бой: ${aText} против ${dText ?? `посёлка ${townLevel}-го уровня`}`, rec });
console.log('');
replayHint(file);
if (watch) await (await import('./open')).openReplay(file);

/**
 * `--derive-spirit` (ДР-1, Д4): точки `SPIRIT` по ориентиру владельца и сила по углам шкал при записанных. Сторона — `--a` (виды
 * племени), сидов — `--runs`. Больше `LIGHT_BATTLES` сидов — под замком машины.
 */
async function deriveSpiritCommand(): Promise<never> {
  const seeds = num(C, args, 'runs', 200, { int: true, min: 20, max: 2000 });
  const spec = text(args, 'a');
  const check = has(args, 'check');
  rejectUnknown(C, args);
  const troops = spec ? parseSide(C, spec, 1, 'мерка').troops : SPIRIT_MIX;
  await heavy(`вывод духа, ${seeds} сидов на точку`);
  console.log(`=== Дух войска (ДР-1): мерка ${JSON.stringify(troops)}, ${seeds} сидов на точку ===`);
  console.log(`Ориентир: обе на дне — ×${SPIRIT_AIM.low}, обе на верху — ×${SPIRIT_AIM.high}; каждая шкала на краю — ×${AXIS_AIM.low.toFixed(4)} / ×${AXIS_AIM.high.toFixed(4)}.`);
  if (!check) {
    const d = deriveSpirit(troops, seeds);
    console.log(`Выведено: мораль low ${d.morale.low}, high ${d.morale.high}; дисциплина low ${d.discipline.low}, high ${d.discipline.high}`);
  }
  console.log(`Записано: мораль low ${SPIRIT.morale.low}, high ${SPIRIT.morale.high}; дисциплина low ${SPIRIT.discipline.low}, high ${SPIRIT.discipline.high}`);
  console.log('Сила при записанных (во сколько раз армия с духом стоит ровной без него):');
  for (const c of SPIRIT_CHECKS) console.log(`  ${c.name.padEnd(28)} ×${strengthOf(troops, c.spirit, seeds).toFixed(3)}`);
  process.exit(0);
}

/**
 * `--derive-flank` (ДР-3, К4): вершина тактики командиров флангов — наибольшая, при которой двое лучших тактиков на обоих флангах
 * не сильнее лучшего полководца, — и сила командира каждого рода и уровня при записанной. Сторона — `--a` (виды племени), сидов —
 * `--runs`. Больше `LIGHT_BATTLES` сидов — под замком машины.
 */
async function deriveFlankCommand(): Promise<never> {
  const seeds = num(C, args, 'runs', 200, { int: true, min: 20, max: 2000 });
  const spec = text(args, 'a');
  const check = has(args, 'check');
  rejectUnknown(C, args);
  const troops = spec ? parseSide(C, spec, 1, 'мерка').troops : SPIRIT_MIX;
  await heavy(`вывод командиров флангов, ${seeds} сидов на точку`);
  console.log(`=== Командиры флангов (ДР-3): мерка ${JSON.stringify(troops)}, ${seeds} сидов на точку ===`);
  if (!check) {
    const d = deriveFlank(troops, seeds);
    console.log(`Лучший полководец ${JSON.stringify(BEST_GENERAL)}: ×${d.general.toFixed(3)}`);
    for (const b of d.both) console.log(`  двое с тактикой ${b.t} на обоих флангах: ×${b.strength.toFixed(3)}${b.strength > d.general ? ' — сильнее полководца' : ''}`);
    console.log(`Выведено: TACTICS_TOP = ${d.top}`);
  }
  console.log(`Записано: TACTICS_TOP = ${TACTICS_TOP}`);
  console.log('Сила при записанной (во сколько раз армия с командиром стоит той же без него):');
  for (const c of flankChecks(troops, seeds)) console.log(`  ${c.name.padEnd(30)} тактика ${String(c.tactics).padStart(2)}  ×${c.strength.toFixed(3)}`);
  process.exit(0);
}

/**
 * `--derive-scars` (ДР-4, Ш5): величины черт армии — сила черты в её бою равна ориентиру (шкала духа ДР-1 на верху или на дне) —
 * и сила каждой при записанных. Сидов — `--runs`. Больше `LIGHT_BATTLES` сидов — под замком машины.
 */
async function deriveScarsCommand(): Promise<never> {
  const seeds = num(C, args, 'runs', 100, { int: true, min: 20, max: 2000 });
  const check = has(args, 'check');
  const only = text(args, 'scar');
  const ids = only ? (only.split(',').map((x) => x.trim()) as ScarId[]) : undefined;
  for (const id of ids ?? []) if (!SCARS.some((x) => x.id === id)) fail(C, `--scar: черты «${id}» нет — ${SCARS.map((x) => x.id).join(', ')}`);
  rejectUnknown(C, args);
  await heavy(`вывод черт армии, ${seeds} сидов на точку`);
  console.log(`=== Черты армии (ДР-4): ${seeds} сидов на точку; конных в мерке против конницы — ${(100 * horseShareOfMix()).toFixed(1)} % ===`);
  if (!check) {
    // Несколько названных — веером, по процессу на черту (бюджет ядер); одна — в этом процессе; без `--scar` — все подряд.
    const got = !ids ? deriveScars(seeds) : ids.length === 1 ? [deriveScar(ids[0], seeds, new Map())] : await deriveScarsFan(ids, seeds);
    for (const d of got) {
      const name = SCARS.find((x) => x.id === d.id)!.name;
      console.log(`  ${name.padEnd(18)} ориентир ×${d.aim.toFixed(3)}  величина ${d.size.toFixed(2)}  сила ×${d.strength.toFixed(3)}${d.capped ? '  — упёрлась в потолок' : ''}`);
    }
  }
  console.log(`Записано: ${JSON.stringify(SCAR_SIZE)}`);
  console.log('Сила при записанных (во сколько раз армия с чертой стоит той же без неё в её бою):');
  for (const c of scarChecks(seeds, ids)) console.log(`  ${SCARS.find((x) => x.id === c.id)!.name.padEnd(18)} ×${c.strength.toFixed(3)}  (ориентир ×${c.aim.toFixed(3)})`);
  process.exit(0);
}
