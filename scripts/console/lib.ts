// Общая часть консольных команд (docs/handbook/console.md): доводы, стороны боя, вывод, разброс доли, запись для ролика.
//
// Команды — инструмент проверки для владельца и сессий, а не отчёты приёмки: своих чисел игры здесь нет, бой и мир идут
// теми же дверями, что в игре (`world/fights.wallFight`, `LocalWorld.wallField`, `gateField`, приказы мира). Разбор
// доводов — свой, без пакетов: одинаково в PowerShell, Git Bash и Linux, имена видов — и латиницей, и по-русски.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIT_KINDS, emptyStack, type GroundPenalty, type Pips, type Stack, type UnitKind } from '@/battle';
import { KIND_META } from '@/battle/names';
import { TROOPS } from '@/game/data/troops';
import type { TroopId } from '@/game/types';
import { kindsOf } from '@/game/battle/price';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { garrisonOf, raidingParty } from '@/world/garrison';
import { GROUND_CROSSING, GROUND_LAND } from '@/world/place';
import { WALL_BREACHES } from '@/world/data/wall';
import type { Assault } from '@/world/wall';
import { holdMachine } from '../lib/budget';

/** Корень репозитория: записи для ролика лежат в нём (`snaps/` в .gitignore), чтобы dev-сервер их отдал. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- Доводы ----------

export interface Args {
  /** Доводы без ключа, по порядку. */
  free: string[];
  /** `--ключ значение`, `--ключ=значение`; флаг без значения — `true`. */
  keys: Map<string, string | true>;
  /** Ключи, которые команда спросила: прочие — опечатка, и о ней говорится. */
  asked: Set<string>;
}

/** Ключи, у которых значения не бывает: следующий довод после них — свободный. */
const FLAGS = new Set(['help', 'log', 'watch', 'quiet', 'json', 'no-open', 'no-shield', 'bare', 'all', 'live', 'river', 'strike', 'joint', 'camp', 'repair', 'ration', 'gun', 'derive-spirit', 'derive-flank', 'derive-scars', 'check']);

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): Args {
  const free: string[] = [];
  const keys = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2 && /[a-zа-я]/i.test(a[1]))) {
      const body = a.replace(/^--?/, '');
      const eq = body.indexOf('=');
      if (eq >= 0) keys.set(body.slice(0, eq).toLowerCase(), body.slice(eq + 1));
      else {
        const key = body.toLowerCase() === 'h' ? 'help' : body.toLowerCase();
        const next = argv[i + 1];
        if (!FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
          keys.set(key, next);
          i++;
        } else keys.set(key, true);
      }
    } else free.push(a);
  }
  return { free, keys, asked: new Set(['help']) };
}

/** Ошибка довода: строка по-русски, подсказка и выход с кодом 2 — без стека, его владелец не читает. */
export function fail(command: string, message: string): never {
  console.error(`ошибка: ${message}`);
  console.error(`справка: npm run ${command} -- --help`);
  process.exit(2);
}

/** Справка команды: печатается по `--help` (и `-h`), выход с кодом 0. */
export function helpIf(args: Args, text: string): void {
  if (!args.keys.has('help')) return;
  console.log(text.trim());
  process.exit(0);
}

export function has(args: Args, key: string): boolean {
  args.asked.add(key);
  return args.keys.has(key);
}

export function text(args: Args, key: string, def?: string): string | undefined {
  args.asked.add(key);
  const v = args.keys.get(key);
  return v === undefined || v === true ? def : v;
}

/** Число довода: нет — `def`; не число или вне `[min, max]` — ошибка словами. */
export function num(command: string, args: Args, key: string, def: number, o: { min?: number; max?: number; int?: boolean } = {}): number {
  args.asked.add(key);
  const v = args.keys.get(key);
  if (v === undefined) return def;
  const n = Number(String(v).replace(',', '.'));
  if (v === true || !Number.isFinite(n)) fail(command, `--${key} ждёт число, а пришло «${v === true ? '' : v}»`);
  if (o.int && !Number.isInteger(n)) fail(command, `--${key} ждёт целое число, а пришло ${n}`);
  if (o.min !== undefined && n < o.min) fail(command, `--${key} не меньше ${o.min}, а пришло ${n}`);
  if (o.max !== undefined && n > o.max) fail(command, `--${key} не больше ${o.max}, а пришло ${n}`);
  return n;
}

/** Ключи, которых команда не знает: опечатка в имени ключа молча меняла бы бой — о ней говорится до счёта. */
export function rejectUnknown(command: string, args: Args): void {
  const extra = [...args.keys.keys()].filter((k) => !args.asked.has(k));
  if (extra.length > 0) fail(command, `не знаю ключ${extra.length > 1 ? 'и' : ''} ${extra.map((k) => `--${k}`).join(', ')}`);
}

// ---------- Стороны боя ----------

/** Сторона, как её описала строка довода: люди племени по видам и рода ядра, сложенные в строй. */
export interface SideSpec {
  /** Бойцы племени по видам (головы) — их видит ролик; рода ядра из строки сюда переведены видами без вещей. */
  troops: TroopStack;
  /** Строй ядра — бойцы строя по родам: то, что идёт в бой. */
  kinds: Stack;
  /** Звери (волки): у них нет вещей и снаряжения ролика. */
  beasts: boolean;
  /** Строка, как её прочли, — для шапки вывода. */
  read: string;
}

const lower = (s: string): string => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Имена видов племени: id латиницей и имя по-русски (полное и без последней буквы — «копейщик» и «копейщики»). */
function troopByName(name: string): TroopId | null {
  const n = lower(name);
  for (const t of TROOPS) {
    const ru = lower(t.name);
    if (t.id === n || ru === n || ru.replace(/[иы]$/, '') === n.replace(/[иы]$/, '')) return t.id;
  }
  return null;
}

/** Рода ядра: id латиницей (`spear`, `infantry`, `archer`, `cavalry`, `heavy`) и имя по-русски. */
const KIND_ALIAS: Record<string, UnitKind> = {
  копья: 'spear',
  копье: 'spear',
  пехота: 'infantry',
  стрелки: 'archer',
  'лёгкая конница': 'cavalry',
  'легкая конница': 'cavalry',
  конница: 'cavalry',
  'тяжёлая конница': 'heavy',
  'тяжелая конница': 'heavy',
};
function kindByName(name: string): UnitKind | null {
  const n = lower(name);
  for (const k of UNIT_KINDS) if (k === n || lower(KIND_META[k].name) === n) return k;
  return KIND_ALIAS[n] ?? null;
}

const WOLVES = ['wolves', 'wolf', 'волки', 'волк', 'стая'];
const RAIDERS = ['raiders', 'разбойники', 'набег'];
const LAIR = ['lair', 'логово', 'гарнизон логова'];

/** Справка о сторонах: одна на все команды. */
export const SIDE_HELP = `
Сторона — список «имя:число» через запятую, без пробелов вокруг двоеточия (или в кавычках):
  виды племени, головы:  clubman spearman archer axeman swordsman shieldman rider knight legionary
                         (или по-русски: дубинщики, копейщики, лучники, топорники, мечники, щитоносцы,
                          всадники, латные всадники, латники)
  рода ядра, бойцы строя: spear infantry archer cavalry heavy (копья, пехота, лучники, лёгкая конница,
                          тяжёлая конница) — с префиксом kind:, например kind:spear:120
  волки:N                — стая из N волков (лёгкая конница без вещей, как у события у ворот)
  raiders:P / разбойники:P — отряд набега мощью P, состав — по укладу из сида (как у мира)
  lair:P / логово:P      — гарнизон логова мощью P, уклад — из сида
  Мощь — мера мира: дубинщик весит 2 (price.troopPower).`;

/**
 * Строка стороны → строй и виды. `seed` — для укладов набега и логова: они выпадают по сиду и имени, как в мире.
 * Ошибка — словами, с тем, что не узналось.
 */
export function parseSide(command: string, spec: string, seed: number, who: string): SideSpec {
  const troops: TroopStack = {};
  const kinds = emptyStack();
  let beasts = false;
  let any = false;
  for (const raw of spec.split(/[,;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const at = part.lastIndexOf(':');
    if (at <= 0) fail(command, `${who}: «${part}» — нужно «имя:число», например spearman:100`);
    const name = part.slice(0, at);
    const n = Number(part.slice(at + 1).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) fail(command, `${who}: «${part}» — после двоеточия число не меньше нуля`);
    if (n === 0) continue;
    any = true;
    const lname = lower(name);
    if (lname.startsWith('kind:') || lname.startsWith('род:')) {
      const k = kindByName(lname.slice(lname.indexOf(':') + 1));
      if (!k) fail(command, `${who}: род «${name}» не знаю — spear, infantry, archer, cavalry, heavy`);
      kinds[k] += Math.round(n);
      continue;
    }
    if (WOLVES.includes(lname)) {
      beasts = true;
      kinds.cavalry += Math.round(n);
      continue;
    }
    if (RAIDERS.includes(lname) || LAIR.includes(lname)) {
      const g = RAIDERS.includes(lname) ? raidingParty(seed, 'console', n) : garrisonOf(seed, 'console', n);
      for (const k of UNIT_KINDS) kinds[k] += g.kinds[k];
      continue;
    }
    const t = troopByName(name);
    const k = t ? null : kindByName(name);
    if (t) troops[t] = (troops[t] ?? 0) + Math.round(n);
    else if (k) kinds[k] += Math.round(n);
    else fail(command, `${who}: «${name}» — не вид племени, не род ядра и не волки/разбойники/логово (справка: --help)`);
  }
  if (!any) fail(command, `${who}: пустая сторона — «${spec}»`);
  const tk = kindsOf(troops);
  for (const k of UNIT_KINDS) kinds[k] += tk[k];
  return { troops, kinds, beasts, read: spec };
}

/** Строй словами: «копья 40 · пехота 120». */
export const kindsWords = (s: Stack): string =>
  UNIT_KINDS.filter((k) => Math.round(s[k]) > 0)
    .map((k) => `${KIND_META[k].name.toLowerCase()} ${Math.round(s[k])}`)
    .join(' · ') || 'никого';

/** Виды племени словами: «Копейщики 40 · Лучники 20». */
export function troopsWords(t: TroopStack): string {
  const out = TROOPS.filter((d) => (t[d.id] ?? 0) > 0).map((d) => `${d.name} ${t[d.id]}`);
  return out.length ? out.join(' · ') : '—';
}

export const menOf = (s: Stack): number => UNIT_KINDS.reduce((n, k) => n + s[k], 0);

// ---------- Место, стена, отметки ----------

const PLACES: Record<string, keyof typeof GROUND_LAND> = {
  поле: 'plain',
  равнина: 'plain',
  степь: 'steppe',
  пустыня: 'desert',
  лес: 'forest',
  холмы: 'hills',
  горы: 'mountains',
};

/** Место боя: земля (`GROUND_LAND`) и переправа — штраф кости нападающему, как `world/place.groundAt`. */
export function placeOf(command: string, name: string | undefined, river: boolean): GroundPenalty | undefined {
  if (!name && !river) return undefined;
  let land = 0;
  if (name) {
    const n = lower(name);
    const id = (Object.keys(GROUND_LAND) as (keyof typeof GROUND_LAND)[]).find((t) => t === n) ?? PLACES[n];
    if (!id) fail(command, `--place: «${name}» не знаю — plain steppe desert forest hills mountains (поле степь пустыня лес холмы горы)`);
    land = GROUND_LAND[id];
  }
  return { ...(land > 0 ? { land } : {}), ...(river ? { crossing: GROUND_CROSSING } : {}) };
}

/** Способ штурма: `scaling` (с ходу, лестницы на себе), `ladders`, `ram`, `tower`, `breach:N` — через «+». */
export function assaultOf(command: string, spec: string): Assault | null {
  const n = lower(spec);
  if (n === 'none' || n === 'нет' || n === 'поле' || n === 'field') return null;
  const a: Assault = {};
  for (const part of n.split('+')) {
    const p = part.trim();
    if (p === 'scaling' || p === 'сходу' || p === 'с ходу') continue;
    else if (p === 'ladders' || p === 'лестницы') a.ladders = true;
    else if (p === 'ram' || p === 'таран') a.ram = true;
    else if (p === 'tower' || p === 'башня') a.tower = true;
    else if (/^(breach|пролом|проломы)(:\d+)?$/.test(p)) {
      const k = p.includes(':') ? Number(p.split(':')[1]) : 1;
      if (k > WALL_BREACHES) fail(command, `--wall: проломов не больше ${WALL_BREACHES}`);
      a.breaches = k;
    } else fail(command, `--wall: «${part}» не знаю — none, scaling, ladders, ram, tower, breach:N (через «+»)`);
  }
  return a;
}

/** Отметки полководца: «fire:2,shock:1,melee:0,maneuver:3». */
export function pipsOf(command: string, spec: string | undefined, key: string): Pips | undefined {
  if (!spec) return undefined;
  const out: Pips = {};
  for (const part of spec.split(',')) {
    const [k, v] = part.split(':').map((x) => x.trim());
    const n = Number(v);
    if (!['fire', 'shock', 'melee', 'maneuver', 'siege'].includes(k) || !Number.isFinite(n)) fail(command, `--${key}: «${part}» — fire, shock, melee, maneuver, siege с числом`);
    out[k as keyof Pips] = n;
  }
  return out;
}

// ---------- Разброс доли ----------

/** Граница доверия доли Уилсона на 95 %: честная и при 0 и при n побед из n. */
export function wilson(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

export const pct = (x: number): string => `${(x * 100).toFixed(x === 0 || x === 1 ? 0 : 1)} %`;

/** «12 из 40 — 30.0 % (17.9…45.6 % на 95 %)». */
export function shareWords(k: number, n: number): string {
  const [lo, hi] = wilson(k, n);
  return `${k} из ${n} — ${pct(k / n)} (${pct(lo)}…${pct(hi)} на 95 %)`;
}

/** 10-я…медиана…90-я доля ряда. */
export function spread(xs: number[], digits = 0): string {
  if (xs.length === 0) return '—';
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  const f = (x: number): string => x.toFixed(digits);
  return s.length === 1 ? f(s[0]) : `${f(q(0.1))}…${f(q(0.5))}…${f(q(0.9))}`;
}

// ---------- Запись для ролика и замок ----------

/** Что лежит в записи консоли: бой — ролик ГФ-1, осада — ролик ГФ-2 (`src/render/console-stand.ts`). */
export type ConsoleRecord = { kind: 'battle'; title: string; rec: unknown } | { kind: 'siege'; title: string; rec: unknown; report: unknown };

/**
 * Записать бой или осаду для ролика: `snaps/console/<команда>-<время>.json` и копию `snaps/console/last.json`. Путь —
 * от корня репозитория, тот, что ждёт `npm run replay`.
 */
export function saveRecord(command: string, record: ConsoleRecord): string {
  const dir = path.join(ROOT, 'snaps', 'console');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `${command}-${stamp}.json`;
  const json = JSON.stringify(record);
  writeFileSync(path.join(dir, name), json);
  writeFileSync(path.join(dir, 'last.json'), json);
  return `snaps/console/${name}`;
}

/** Подсказка про ролик под выводом. */
export function replayHint(file: string): void {
  console.log(`ролик: npm run replay -- ${file}   (последний — npm run replay)`);
}

/**
 * Тяжёлая работа консоли: дождаться свободной машины и взять замок `~/.heavy-job.lock` (бюджет железа, CLAUDE.md).
 * Снимается сам, когда процесс выходит.
 */
export async function heavy(what: string): Promise<void> {
  await holdMachine(`консоль: ${what}`);
}

/** Сколько боёв консоль считает лёгкой работой — без замка машины (доли секунды на обычной машине). */
export const LIGHT_BATTLES = 200;

/** Виды и строй стороны — две строки шапки. */
export function sideLines(label: string, s: SideSpec, extra = ''): string[] {
  const out = [`${label}: ${s.read}`];
  if (troopTotal(s.troops) > 0) out.push(`  виды: ${troopsWords(s.troops)}`);
  out.push(`  в строю: ${kindsWords(s.kinds)} — ${Math.round(menOf(s.kinds))} бойцов строя${extra}`);
  return out;
}
