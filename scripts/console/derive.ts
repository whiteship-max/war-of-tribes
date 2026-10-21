// `npm run derive -- w | gate` — вывод чисел, которые сами входят в свою выборку (правило 16): W с шагом кости и таблица
// сил у ворот. Шаг вывода — только то, из чего число выводится, теми же функциями, что разделы отчётов (`raid-width.widthOfHired`
// — «Ширина поля» `raid-hiring`; `raid-defense-mix.gateEvens`/`gateValue` — раздел 4б `raid-mix`), без прочих разделов
// отчёта. Драйвер гоняет шаги дочерними процессами (каждый читает записанное заново), с `--write` сам правит записанное
// между шагами и ищет неподвижную точку по правилам 16 и 19. Справка — `--help`, рецепты — docs/handbook/console.md.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { viteNode } from '../lib/fan';
import { ROOT, fail, has, heavy, helpIf, num, parseArgs, rejectUnknown } from './lib';

const C = 'derive';
const HELP = `
npm run derive -- w | gate [--steps N] [--write] [--pause M]
Вывод неподвижной точки (правило 16): шаг считает число на записанном, записанное правится на выведенное, и так, пока
выведенное не совпадёт с записанным.

  w        W и шаг кости — раздел «Ширина поля» raid-hiring: только прогоны «Найма» (лестница, партия с первой секунды,
           уведённые), без «Лазарета», «Сожжённых» и «Морали»; шаг кости — на выведенном W
  gate     таблица сил у ворот — раздел 4б raid-mix: партии мерки и ровный бой (без кривых медианного, окрестности и боя
           без кости — их печатает отчёт)

  --steps N  сколько шагов самое большее (w — 4, gate — 3, как в заданиях владельца); без --write — всегда один шаг
  --write    править записанное между шагами: W и шаг — src/battle/config.ts (FRONT_WIDTH, DICE.step), таблица —
             src/game/data/events.ts (GATE_POWER). Без него — один шаг и печать; записанное не трогается
  --pause M  пауза между шагами, минут (3; бюджет железа: машина остывает между тяжёлыми прогонами)

Правила остановки (правила 16 и 19, как в выводах 19.4, 20.2 и 22.2):
  w     — выведенное = записанному: точка неподвижна. Качание между двумя (a → b → a) — полусумма, округлённая до целого,
          и ещё один шаг проверки. Шаги кончились — последнее выведенное, строкой «не сошлось».
  gate  — строка села, если выведенное в 1 % от записанного; не севшие за все шаги — полусумма записанного и выведенного
          последним шагом.
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
    const { DICE, FRONT_WIDTH } = await import('@/battle');
    // Разделы «Найма» печатают свои таблицы — для вывода они шум: молчат, пока считаются.
    const log = console.log;
    console.log = () => undefined;
    const hired = await hiringSection();
    console.log = log;
    const r = widthOfHired(hired);
    if (!r) fail(C, 'боёв в выборке нет — W не из чего выводить');
    console.log(`  при W ${FRONT_WIDTH}, шаге ${DICE.step}: боёв выборки ${r.fights}, W = ${r.w}, шаг кости на нём ${r.step} (решётка «Лезвия» ${r.size})`);
    console.log(`DERIVE ${JSON.stringify({ was: FRONT_WIDTH, wasStep: DICE.step, w: r.w, step: r.step, fights: r.fights })}`);
  } else if (what === 'gate') {
    const { gateEvens, gateValue } = await import('../raid-defense-mix');
    const { GATE_POWER } = await import('@/game/data/events');
    const { evens } = await gateEvens();
    const table = { wolves: [] as number[], raiders: [] as number[] };
    for (const who of ['wolves', 'raiders'] as const) for (let level = 1; level <= 10; level++) table[who].push(Math.round(gateValue(evens, level, who).value));
    for (const who of ['wolves', 'raiders'] as const) console.log(`  ${who === 'wolves' ? 'волки     ' : 'разбойники'} выведено ${table[who].join(', ')}; записано ${GATE_POWER[who].join(', ')}`);
    console.log(`DERIVE ${JSON.stringify({ was: GATE_POWER, table })}`);
  } else fail(C, 'w или gate');
  process.exit(0);
}

// ---------- Драйвер ----------

const write = has(args, 'write');
const steps = write ? num(C, args, 'steps', what === 'gate' ? 3 : 4, { int: true, min: 1, max: 8 }) : 1;
const pause = num(C, args, 'pause', 3, { min: 0 });
rejectUnknown(C, args);
if (what !== 'w' && what !== 'gate') fail(C, 'что выводить: w или gate');
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

/** Записать таблицу у ворот: строки `wolves: [...]` и `raiders: [...]` в `GATE_POWER`. */
function writeGate(table: Record<'wolves' | 'raiders', number[]>): void {
  let s = readFileSync(EVENTS, 'utf8');
  for (const who of ['wolves', 'raiders'] as const) {
    const re = new RegExp(`(export const GATE_POWER[^=]*= \\{[\\s\\S]*?${who}: \\[)[\\d, ]+(\\])`);
    if (!re.test(s)) fail(C, `не нашёл строку ${who} в GATE_POWER (src/game/data/events.ts) — правка руками`);
    s = s.replace(re, `$1${table[who].join(', ')}$2`);
  }
  writeFileSync(EVENTS, s);
}

/** Шаг кости на ширине `w` — та же строка, что у раздела «Ширина поля» (`raid-width.widthOfHired`). */
async function stepAt(w: number): Promise<number> {
  const { DICE } = await import('@/battle');
  const { armyAt, diceStepFor } = await import('@/battle/bench');
  return Math.ceil(diceStepFor(DICE.hold, 0.1, 12, armyAt(w), w) * 1e4) / 1e4;
}

const t0 = Date.now();
const history: string[] = [];
if (what === 'w') {
  const seen: number[] = [];
  let final: string | null = null;
  for (let k = 1; k <= steps; k++) {
    console.log(`--- шаг ${k} из ${steps} ---`);
    const started = Date.now();
    const r = (await step()) as { was: number; wasStep: number; w: number; step: number; fights: number };
    history.push(`шаг ${k}: при W ${r.was} (шаг ${r.wasStep}) выведено W ${r.w}, шаг ${r.step}, боёв ${r.fights}`);
    seen.push(r.was);
    if (r.w === r.was) {
      final = `W сошёлся: ${r.w} — неподвижная точка (шаг кости ${r.step}${r.step === r.wasStep ? ', как записан' : `; записан ${r.wasStep} — правится на ${r.step}`})`;
      if (write && r.step !== r.wasStep) writeW(r.w, r.step);
      break;
    }
    // Качание: выведенное уже было записанным на прошлом шаге, а записанное сейчас — выведенным тогда (a → b → a).
    const swing = seen.length >= 2 && seen[seen.length - 2] === r.w;
    const next = swing ? Math.round((r.w + r.was) / 2) : r.w;
    if (!write) {
      final = `один шаг: выведено W ${r.w} при записанном ${r.was}; дальше — --write (или правка руками и шаг заново)`;
      break;
    }
    if (swing) history.push(`  качание ${r.was} ↔ ${r.w}: полусумма ${next} (правило 16)`);
    if (k === steps) {
      final = `не сошлось за ${steps} шагов: последнее выведенное W ${r.w} при записанном ${r.was} — решение по правилу 19`;
      break;
    }
    // Шаг кости — функция только W (решётка «Лезвия» размера W): у записанного W он тот, что выводит раздел на этом W.
    const nextStep = next === r.w ? r.step : await stepAt(next);
    writeW(next, nextStep);
    console.log(`  записано: W ${next}, шаг кости ${nextStep} (src/battle/config.ts)`);
    await rest(started);
  }
  console.log('');
  for (const h of history) console.log(h);
  console.log(final ?? '');
} else {
  type Table = Record<'wolves' | 'raiders', number[]>;
  let last: { was: Table; table: Table } | null = null;
  const sat = (a: number, b: number): boolean => Math.abs(a - b) <= 0.01 * Math.abs(b);
  for (let k = 1; k <= steps; k++) {
    console.log(`--- шаг ${k} из ${steps} ---`);
    const started = Date.now();
    const r = (await step()) as { was: Table; table: Table };
    last = r;
    const off = (who: 'wolves' | 'raiders'): string => r.table[who].map((x, i) => ((100 * (x - r.was[who][i])) / r.was[who][i]).toFixed(1)).join(' ');
    history.push(`шаг ${k}: выведенная против записанной, %: волки ${off('wolves')}; разбойники ${off('raiders')}`);
    const settled = (['wolves', 'raiders'] as const).every((who) => r.table[who].every((x, i) => sat(x, r.was[who][i])));
    if (settled) {
      history.push('  все строки в 1 % от записанной — таблица села');
      if (write) writeGate(r.table);
      break;
    }
    if (!write) break;
    if (k === steps) {
      // Не севшие за все шаги — полусумма записанного и выведенного последним шагом (правило 19, как 19.4, 20.2, 22.2).
      const half = (who: 'wolves' | 'raiders'): number[] => r.table[who].map((x, i) => (sat(x, r.was[who][i]) ? x : Math.round((x + r.was[who][i]) / 2)));
      const table: Table = { wolves: half('wolves'), raiders: half('raiders') };
      writeGate(table);
      history.push(`  не севшие строки — полусуммой: волки ${table.wolves.join(', ')}; разбойники ${table.raiders.join(', ')}`);
      break;
    }
    writeGate(r.table);
    console.log('  записано: выведенная таблица (src/game/data/events.ts)');
    await rest(started);
  }
  console.log('');
  for (const h of history) console.log(h);
  if (last && !write) console.log('один шаг; записать и повторить до неподвижной точки — --write');
}
console.log(`время вывода: ${((Date.now() - t0) / 60000).toFixed(1)} мин`);
process.exit(0);
