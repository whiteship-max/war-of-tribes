// `npm run derive -- w | gate` — вывод чисел, которые сами входят в свою выборку (правило 16): W с шагом кости и таблица
// сил у ворот. Шаг вывода — только то, из чего число выводится, теми же функциями, что разделы отчётов (`raid-width.widthOfHired`
// — «Ширина поля» `raid-hiring`; `raid-defense-mix.gateEvens`/`gateValue` — раздел 4б `raid-mix`), без прочих разделов
// отчёта. Драйвер гоняет шаги дочерними процессами (каждый читает записанное заново), с `--write` сам правит записанное
// между шагами и ищет неподвижную точку по правилам 16 и 19. Справка — `--help`, рецепты — docs/handbook/console.md.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { viteNode } from '../lib/fan';
import { FOES, GATE_SETTLE, NOT_SETTLED_EXIT, WALL_SETTLE, W_SWING, facesMove, gateMove, gateSettled, wMove, withBurn, withFaces, type Faces, type Foe, type Table } from './fixpoint';
import { ROOT, fail, has, heavy, helpIf, num, parseArgs, rejectUnknown } from './lib';

const C = 'derive';
const HELP = `
npm run derive -- w | gate [--steps N] [--write] [--pause M]
npm run derive -- burn [--write]
npm run derive -- step [--from A] [--to B]
Вывод неподвижной точки (правило 16): шаг считает число на записанном, записанное правится на выведенное, и так, пока
выведенное не совпадёт с записанным.

  w        W и шаг кости — раздел «Ширина поля» raid-hiring: только прогоны «Найма» (лестница, партия с первой секунды,
           уведённые), без «Лазарета», «Сожжённых» и «Морали»; шаг кости — на выведенном W, на окне ширин W − 2 … W + 2
           (bench.stepHold, ПБ-1); стена и лестницы — раздел «сила стены» siege:report (siege-wall.wallFacesOf), тем же
           кругом: точка села, когда W неподвижен и грани в четверти грани от записанных
  burn     окно после сожжения BURN_IMMUNE — раздел «окна защиты» sack:report: наибольшая отстройка после сожжения по этапам
           лестницы поражения, вверх до суток игрока (ПБ-1); шаг один — окно в свою выборку не входит; правило проверяется на
           известной точке (окно после грабежа — SIEGE_IMMUNE владельца), не дало её — стоп, код 3
  step     кривая шага кости по W отрезка (--from, --to; по умолчанию W конфига ± 5): монотонно ли и где скачки (задача 22.7);
           ничего не пишет
  gate     таблица сил у ворот — раздел 4б raid-mix: партии мерки и ровный бой (без кривых медианного, окрестности и боя
           без кости — их печатает отчёт)

  --steps N  сколько шагов самое большее (w — 4, gate — 3, как в заданиях владельца); без --write — всегда один шаг
  --write    править записанное между шагами: W и шаг — src/battle/config.ts (FRONT_WIDTH, DICE.step), стена и лестницы —
             src/world/data/wall.ts (WALL_FACES, LADDER_FACES), таблица —
             src/game/data/events.ts (GATE_POWER). Без него — один шаг и печать; записанное не трогается
  --pause M  пауза между шагами, минут (3; бюджет железа: машина остывает между тяжёлыми прогонами)

Правила остановки (правила 16 и 19; решение владельца 26.10.2026 — scripts/console/fixpoint.ts):
  w     — выведенное = записанному: точка неподвижна. Повернуло назад и не дальше 2 от записанного — качание: полусумма,
          округлённая до целого, строкой «ФЛАГ», и конец. Шаги кончились, а точка не села — «НЕ СОШЛОСЬ»: записанное
          оставлено, код выхода 3 — стоп и доклад.
  gate  — строка села, если выведенное в 1 % от записанного; повернувшая назад — полусуммой; все не севшие повернули —
          «ФЛАГ» и конец; к последнему шагу какие-то идут в одну сторону — «НЕ СОШЛОСЬ», записанное оставлено, код 3.
Каждый шаг — тяжёлая работа под замком машины и в бюджете ядер (веер отчётов). Число в документ — из вывода приёмки.

Примеры:
  npm run derive -- w                  один шаг: W и шаг кости на записанном
  npm run derive -- w --write          до четырёх шагов, записанное правится само
  npm run derive -- gate --write --steps 3`;

const args = parseArgs();
helpIf(args, HELP);
const what = args.free[0];
const child = has(args, 'child');

// ---------- Шаг вывода (дочерний процесс) ----------

if (child) {
  rejectUnknown(C, args);
  if (what === 'w') {
    const { hiringSection } = await import('../raid-hiring');
    const { widthOfHired } = await import('../raid-width');
    const { spiritOfHired, spiritSection } = await import('../raid-spirit');
    const { DICE, FRONT_WIDTH } = await import('@/battle');
    // Разделы «Найма» печатают свои таблицы — для вывода они шум: молчат, пока считаются.
    const log = console.log;
    console.log = () => undefined;
    const hired = await hiringSection();
    console.log = log;
    const r = widthOfHired(hired);
    if (!r) fail(C, 'боёв в выборке нет — W не из чего выводить');
    console.log(`  при W ${FRONT_WIDTH}, шаге ${DICE.step}: боёв выборки ${r.fights}, W = ${r.w}, шаг кости на нём ${r.step} (решётка «Лезвия» ${r.size})`);
    // Дух нашей стороны в тех же боях (ДР-1): цель весов причин — мораль обычного города около нейтрали (раздел «Дух дружины»).
    const sp = spiritOfHired(hired);
    if (sp) console.log(`  дух нашей стороны в боях выборки: мораль — медиана ${sp.morale.toFixed(1)} (10-я…90-я ${sp.low.toFixed(1)}…${sp.high.toFixed(1)}), дисциплина — медиана ${sp.discipline.toFixed(1)}; потолок — мораль ${sp.moraleCeil.toFixed(1)}, дисциплина ${sp.disciplineCeil.toFixed(1)}`);
    spiritSection(hired);
    // Стена и лестницы — пара с W (ПБ-1, п. 3): раздел «сила стены» `siege:report` той же функцией, на записанном W.
    const { phaseSieges, wallFacesOf } = await import('../siege-wall');
    const { WALL_FACES, LADDER_FACES } = await import('@/world/data/wall');
    const sieges = await phaseSieges();
    const faces = wallFacesOf(sieges);
    console.log(`  стена (раздел «сила стены» siege:report, ${sieges.length} осад): оборона ${faces.wall} грани (записано ${WALL_FACES}), лестницы ${faces.ladder} (записано ${LADDER_FACES})`);
    console.log(`DERIVE ${JSON.stringify({ was: FRONT_WIDTH, wasStep: DICE.step, w: r.w, step: r.step, fights: r.fights, wasFaces: { wall: WALL_FACES, ladder: LADDER_FACES }, faces })}`);
  } else if (what === 'gate') {
    const { gateEvens, gateValue } = await import('../raid-defense-mix');
    const { GATE_POWER } = await import('@/game/data/events');
    const { evens } = await gateEvens();
    const table = { wolves: [] as number[], raiders: [] as number[] };
    for (const who of ['wolves', 'raiders'] as const) for (let level = 1; level <= 10; level++) table[who].push(Math.round(gateValue(evens, level, who).value));
    for (const who of ['wolves', 'raiders'] as const) console.log(`  ${who === 'wolves' ? 'волки     ' : 'разбойники'} выведено ${table[who].join(', ')}; записано ${GATE_POWER[who].join(', ')}`);
    console.log(`DERIVE ${JSON.stringify({ was: GATE_POWER, table })}`);
  } else if (what === 'burn') {
    // Окно после сожжения (ПБ-1, п. 6): раздел «окна защиты» `sack:report` — лестница поражения и правило окна той же функцией.
    const { defeatLadder, protectWindows } = await import('../sack-ladder');
    const { BURN_IMMUNE, SIEGE_IMMUNE } = await import('@/world/data/tuning');
    const w = protectWindows(await defeatLadder());
    const day = 24 * 3600_000;
    console.log(`  наибольшая отстройка: после грабежа ${w.plunder.hours.toFixed(1)} ч, после сожжения ${w.burn.hours.toFixed(1)} ч; правило даёт ${w.plunder.days} и ${w.burn.days} сут`);
    console.log(`DERIVE ${JSON.stringify({ was: Math.round(BURN_IMMUNE / day), days: w.burn.days, hours: w.burn.hours, plunderDays: w.plunder.days, siegeDays: Math.round(SIEGE_IMMUNE / day) })}`);
  } else fail(C, 'w, gate или burn');
  process.exit(0);
}

// ---------- Кривая шага кости (ПБ-1, п. 2) ----------

if (what === 'step') {
  // Проверка задачи 22.7: шаг кости на окне вывода (`bench.stepHold`) — по каждому W отрезка; монотонно ли и где скачки. Ничего не
  // пишет: шаг — функция одного W, записывает его вывод `w`.
  const { DICE, FRONT_WIDTH } = await import('@/battle');
  const { diceStepFor } = await import('@/battle/bench');
  const from = num(C, args, 'from', FRONT_WIDTH - 5, { int: true, min: 20, max: 400 });
  const to = num(C, args, 'to', FRONT_WIDTH + 5, { int: true, min: from, max: 400 });
  rejectUnknown(C, args);
  await heavy(`кривая шага кости, W ${from}…${to}`);
  const t0 = Date.now();
  const rows: { w: number; step: number }[] = [];
  for (let w = from; w <= to; w++) {
    const step = Math.ceil(diceStepFor(DICE.hold, 0.1, 12, w) * 1e4) / 1e4;
    rows.push({ w, step });
    console.log(`  W ${w}: шаг кости ${step}`);
  }
  const jumps = rows.slice(1).map((r, i) => (r.step - rows[i].step) / rows[i].step);
  const up = jumps.every((j) => j >= 0);
  const down = jumps.every((j) => j <= 0);
  const worst = jumps.reduce((m, j) => (Math.abs(j) > Math.abs(m) ? j : m), 0);
  console.log(`соседние W: наибольший скачок ${(100 * worst).toFixed(2)} %; монотонно: ${up || down ? 'да' : 'нет'}; в конфиге W ${FRONT_WIDTH}, шаг ${DICE.step}`);
  console.log(`время: ${((Date.now() - t0) / 60000).toFixed(1)} мин`);
  process.exit(0);
}

// ---------- Драйвер ----------

const write = has(args, 'write');
const steps = write && what !== 'burn' ? num(C, args, 'steps', what === 'gate' ? 3 : 4, { int: true, min: 1, max: 8 }) : 1;
const pause = num(C, args, 'pause', 3, { min: 0 });
rejectUnknown(C, args);
if (what !== 'w' && what !== 'gate' && what !== 'burn') fail(C, 'что выводить: w, gate, burn или step');
// Замок машины — на весь вывод: шаги — потомки, и между шагами машину никто не займёт (machinelock: потомки не ждут).
await heavy(`вывод ${what}`);

/** Пауза между шагами: машина остывает (бюджет железа); только после шага дольше десяти минут. */
async function rest(started: number): Promise<void> {
  if (pause <= 0 || Date.now() - started < 10 * 60_000) return;
  console.log(`  пауза ${pause} мин перед следующим шагом — машина остывает (бюджет железа)`);
  await new Promise((r) => setTimeout(r, pause * 60_000));
}

/** Шаг вывода дочерним процессом: его вывод идёт на экран, итог — строкой `DERIVE {…}`. */
function step(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const kid = spawn(process.execPath, [viteNode(), path.join(ROOT, 'scripts', 'console', 'derive.ts'), '--', what, '--child'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    kid.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      out += text;
      process.stdout.write(text.split('\n').filter((l) => !l.startsWith('DERIVE ')).join('\n'));
    });
    kid.on('exit', (code) => {
      const line = out.split('\n').find((l) => l.startsWith('DERIVE '));
      if (code !== 0 || !line) reject(new Error(`шаг вывода вышел с кодом ${code}`));
      else resolve(JSON.parse(line.slice('DERIVE '.length)));
    });
  });
}

const CONFIG = path.join(ROOT, 'src', 'battle', 'config.ts');
const EVENTS = path.join(ROOT, 'src', 'game', 'data', 'events.ts');

/** Записать W и шаг кости в конфиг боя: одна строка `FRONT_WIDTH = N;` и поле `step:` у `DICE`. */
function writeW(w: number, stepValue: number): void {
  let s = readFileSync(CONFIG, 'utf8');
  const a = s.replace(/export const FRONT_WIDTH = \d+(\.\d+)?;/, `export const FRONT_WIDTH = ${w};`);
  const b = a.replace(/(export const DICE = \{[^}]*step: )[\d.]+/, `$1${stepValue}`);
  if (a === s || b === a) fail(C, 'не нашёл FRONT_WIDTH или DICE.step в src/battle/config.ts — их вид изменился, правка руками');
  s = b;
  writeFileSync(CONFIG, s);
}

const WALL_FILE = path.join(ROOT, 'src', 'world', 'data', 'wall.ts');

/** Записать грани стены и лестниц (ПБ-1, п. 3): строки `WALL_FACES` и `LADDER_FACES` в `src/world/data/wall.ts`. */
function writeWall(faces: Faces): void {
  const out = withFaces(readFileSync(WALL_FILE, 'utf8'), faces);
  if (out === null) fail(C, 'не нашёл WALL_FACES или LADDER_FACES в src/world/data/wall.ts — их вид изменился, правка руками');
  writeFileSync(WALL_FILE, out);
}

/** Записать таблицу у ворот: строки `wolves: [...]` и `raiders: [...]` в `GATE_POWER`. */
function writeGate(table: Table): void {
  let s = readFileSync(EVENTS, 'utf8');
  for (const who of FOES) {
    const re = new RegExp(`(export const GATE_POWER[^=]*= \\{[\\s\\S]*?${who}: \\[)[\\d, ]+(\\])`);
    if (!re.test(s)) fail(C, `не нашёл строку ${who} в GATE_POWER (src/game/data/events.ts) — правка руками`);
    s = s.replace(re, `$1${table[who].join(', ')}$2`);
  }
  writeFileSync(EVENTS, s);
}

/** Шаг кости на ширине `w` — та же строка, что у раздела «Ширина поля» (`raid-width.widthOfHired`). */
async function stepAt(w: number): Promise<number> {
  const { DICE } = await import('@/battle');
  const { diceStepFor } = await import('@/battle/bench');
  return Math.ceil(diceStepFor(DICE.hold, 0.1, 12, w) * 1e4) / 1e4;
}

const TUNING = path.join(ROOT, 'src', 'world', 'data', 'tuning.ts');

const t0 = Date.now();
const history: string[] = [];
/** Код выхода: «не сошлось» — `NOT_SETTLED_EXIT`, стоп и доклад (решение владельца 26.10.2026, `fixpoint.ts`). */
let code = 0;
if (what === 'burn') {
  // Не неподвижная точка: окно в свою выборку не входит (лестница меряет отстройку, а не окно) — шаг один.
  const r = (await step()) as { was: number; days: number; hours: number; plunderDays: number; siegeDays: number };
  if (r.plunderDays !== r.siegeDays) {
    history.push(`ПРАВИЛО НЕ ДАЁТ известной точки: окно после грабежа ${r.plunderDays} сут, владелец назначил ${r.siegeDays} — записанное оставлено, стоп и доклад (код ${NOT_SETTLED_EXIT})`);
    code = NOT_SETTLED_EXIT;
  } else if (r.days === r.was) history.push(`BURN_IMMUNE сходится: ${r.days} сут (отстройка после сожжения ${r.hours.toFixed(1)} ч)`);
  else if (!write) history.push(`выведено ${r.days} сут при записанных ${r.was} (отстройка ${r.hours.toFixed(1)} ч); записать — --write`);
  else {
    const out = withBurn(readFileSync(TUNING, 'utf8'), r.days);
    if (out === null) fail(C, 'не нашёл BURN_IMMUNE в src/world/data/tuning.ts — его вид изменился, правка руками');
    writeFileSync(TUNING, out);
    history.push(`записано: BURN_IMMUNE ${r.days} сут (было ${r.was}; отстройка после сожжения ${r.hours.toFixed(1)} ч) — src/world/data/tuning.ts`);
  }
  console.log('');
  for (const h of history) console.log(h);
} else if (what === 'w') {
  const seen: number[] = [];
  const seenFaces: Faces[] = [];
  let final: string | null = null;
  for (let k = 1; k <= steps; k++) {
    console.log(`--- шаг ${k} из ${steps} ---`);
    const started = Date.now();
    const r = (await step()) as { was: number; wasStep: number; w: number; step: number; fights: number; wasFaces: Faces; faces: Faces };
    const facesText = `стена ${r.faces.wall} (записано ${r.wasFaces.wall}), лестницы ${r.faces.ladder} (записано ${r.wasFaces.ladder})`;
    history.push(`шаг ${k}: при W ${r.was} (шаг ${r.wasStep}) выведено W ${r.w}, шаг ${r.step}, боёв ${r.fights}; ${facesText}`);
    seen.push(r.was);
    seenFaces.push(r.wasFaces);
    const fm = facesMove(seenFaces, r.faces, k === steps);
    if (!write && (r.w !== r.was || fm.kind !== 'settled')) {
      final = `один шаг: выведено W ${r.w} при записанном ${r.was}, ${facesText}; дальше — --write (или правка руками и шаг заново)`;
      break;
    }
    const move = wMove(seen, r.w, k === steps);
    if (move.kind === 'fixed' && fm.kind === 'settled') {
      final = `W сошёлся: ${r.w} — неподвижная точка (шаг кости ${r.step}${r.step === r.wasStep ? ', как записан' : `; записан ${r.wasStep} — правится на ${r.step}`}); грани стены сели в ${WALL_SETTLE}: ${facesText}`;
      if (write && r.step !== r.wasStep) writeW(r.w, r.step);
      if (write) writeWall(r.faces);
      break;
    }
    if (move.kind === 'stuck' || fm.kind === 'stuck') {
      const why = [move.kind === 'stuck' ? `W ${r.w} при записанном ${r.was}` : '', fm.kind === 'stuck' ? `в одну сторону идут: ${fm.faces.join(', ')}` : ''].filter(Boolean).join('; ');
      final = `НЕ СОШЛОСЬ за ${steps} шагов: ${why}; записанное оставлено — стоп и доклад (код ${NOT_SETTLED_EXIT})`;
      code = NOT_SETTLED_EXIT;
      break;
    }
    // Шаг кости — функция только W (окно ширин вокруг W, `bench.stepHold`): у записанного W он тот, что выводит раздел на этом W.
    const nextW = move.kind === 'fixed' ? r.w : move.next;
    const nextStep = nextW === r.w ? r.step : await stepAt(nextW);
    const nextFaces = fm.kind === 'settled' ? r.faces : fm.next;
    writeW(nextW, nextStep);
    writeWall(nextFaces);
    console.log(`  записано: W ${nextW}, шаг кости ${nextStep} (src/battle/config.ts); стена ${nextFaces.wall}, лестницы ${nextFaces.ladder} (src/world/data/wall.ts)`);
    if (move.kind === 'swing') {
      final = `ФЛАГ (правило 19): W качается ${r.was} ↔ ${r.w} в пределах ±${W_SWING} — записана полусумма ${nextW}, шаг кости ${nextStep}; стена ${nextFaces.wall}, лестницы ${nextFaces.ladder}${fm.kind === 'settled' ? '' : ' (грани на полусумме W не проверены)'}`;
      break;
    }
    if (fm.kind === 'swing' && move.kind === 'fixed') {
      final = `ФЛАГ (правило 19): W ${r.w} неподвижен, грани качаются (${fm.faces.join(', ')}) — записаны полусуммой: стена ${nextFaces.wall}, лестницы ${nextFaces.ladder}`;
      break;
    }
    await rest(started);
  }
  console.log('');
  for (const h of history) console.log(h);
  console.log(final ?? '');
} else {
  const seen: Table[] = [];
  let last: { was: Table; table: Table } | null = null;
  for (let k = 1; k <= steps; k++) {
    console.log(`--- шаг ${k} из ${steps} ---`);
    const started = Date.now();
    const r = (await step()) as { was: Table; table: Table };
    last = r;
    seen.push(r.was);
    const off = (who: Foe): string => r.table[who].map((x, i) => ((100 * (x - r.was[who][i])) / r.was[who][i]).toFixed(1)).join(' ');
    history.push(`шаг ${k}: выведенная против записанной, %: волки ${off('wolves')}; разбойники ${off('raiders')}`);
    if (!write) {
      if (gateSettled(r.was, r.table)) history.push(`  все строки в ${GATE_SETTLE * 100} % от записанной — таблица села`);
      break;
    }
    const move = gateMove(seen, r.table, k === steps);
    if (move.kind === 'settled') {
      history.push(`  все строки в ${GATE_SETTLE * 100} % от записанной — таблица села`);
      writeGate(r.table);
      break;
    }
    if (move.kind === 'stuck') {
      history.push(`  НЕ СОШЛОСЬ за ${steps} шагов: в одну сторону идут ${move.rows.join(', ')}; записанное оставлено — стоп и доклад (код ${NOT_SETTLED_EXIT})`);
      code = NOT_SETTLED_EXIT;
      break;
    }
    writeGate(move.table);
    if (move.kind === 'swing') {
      history.push(`  ФЛАГ (правило 19): качаются ${move.rows.join(', ')} — полусуммой; записано: волки ${move.table.wolves.join(', ')}; разбойники ${move.table.raiders.join(', ')}`);
      break;
    }
    console.log('  записано: выведенная таблица, повернувшие назад строки — полусуммой (src/game/data/events.ts)');
    await rest(started);
  }
  console.log('');
  for (const h of history) console.log(h);
  if (last && !write) console.log('один шаг; записать и повторить до неподвижной точки — --write');
}
console.log(`время вывода: ${((Date.now() - t0) / 60000).toFixed(1)} мин`);
process.exit(code);
