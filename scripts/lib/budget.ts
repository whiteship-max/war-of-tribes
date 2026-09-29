/**
 * Бюджет железа: сколько машины владельца может занять один прогон.
 *
 * ПРАВИЛО ВЛАДЕЛЬЦА, ОБЯЗАТЕЛЬНОЕ ДЛЯ ВСЕХ СЕССИЙ (CLAUDE.md, «Бюджет железа»). Машина владельца —
 * не сервер: 25 и 26.09.2026 она уходила в защиту и выключалась кнопкой, оба раза — пока в панели
 * предпросмотра крутились размноженные руками циклы кадра сцены; 29.09.2026 — в третий раз, от
 * перегрева: полная приёмка держала 8 ядер из 12 около получаса, а рядом в другой сессии шёл рендер
 * видео. Правило держит этот модуль, а не память: тесты (`vite.config.ts`), веер отчётов (`fan.ts`),
 * жетоны (`slots.ts`) и приёмка (`reports.ts`) берут ядра отсюда, стендовый браузер (`chrome.ts`) не
 * поднимется без потолка кадров и рядом с чужим.
 *
 *   ядра      не больше половины (`budgetCores`, на машине владельца 6 из 12), и это потолок, а не
 *             цель; под приёмкой жетон держит всякий, кто считает (`slots.ts`), — и главный процесс
 *             отчёта с веером, пока считает сам (`fan.ts`);
 *   страница  отчёта рисует с потолком `REPORT_FPS` и плотностью `REPORT_DPR`, если отчёту не нужно
 *             больше; кому нужно и почему — у самих чисел;
 *   стенд     сцены, который сессия гоняет сама: с потолком кадров, не дольше двух минут подряд
 *             (`BROWSER_MAX_MS`), по одному заходу;
 *   приёмка   штатные отчёты идут столько, сколько идут, но строго по очереди, в бюджете ядер, с
 *             паузой между тяжёлыми (`HEAVY_PAUSE_MS`) и только на свободной машине (`waitUntilFree`);
 *   чужое     перед прогоном — ни чужого браузера для замеров, ни рендера и ffmpeg, ни сборки, ни
 *             прогона отчётов и тестов (`foreignRuns`), и чужая загрузка машины ниже `FREE_LOAD`.
 *
 * Всё здесь — бюджет железа, а не игровые числа: вывод отчётов от них зависеть не должен, и сверяет это приёмка.
 */
import { spawnSync } from 'node:child_process';
import { availableParallelism, cpus } from 'node:os';
import { measure } from './measured';

/**
 * Какая доля ядер машины может уйти на один прогон: половина (решение владельца, 29.09.2026; прежде —
 * две трети, 8 из 12, и под ними машина перегрелась, пока рядом шёл чужой рендер). Вторая половина —
 * самой машине и тому, что владелец делает на ней в это время.
 */
export const CORE_SHARE = 1 / 2;

/** Сколько ядер — работников тестов, процессов веера, жетонов приёмки — берёт прогон: половина, вниз, не меньше одного. */
export function budgetCores(cores = availableParallelism()): number {
  return Math.max(1, Math.floor(cores * CORE_SHARE));
}

/** Флаги Chrome, снимающие потолок кадров. Запрещены: с ними стенд гнал видеокарту на полную. */
export const UNCAPPED: readonly string[] = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

/**
 * Потолок кадров страницы отчёта: тридцать, вдвое ниже игры (`render/loop.FPS_CAP`). Страница опускает
 * его адресом `?fpscap=` (`render/loop.capFrom`), поднять выше игры нельзя ничем. Отчётам, которые не
 * меряют сам кадр, частота не нужна: `tap` судит палец часами обработчиков, `scene` — отметки запуска
 * и входа на карту, `revive` — идут ли кадры вообще. **Нужно больше одному — `map`:** он меряет цену
 * кадра карты на потолке игры — «длинный» кадр там дольше 25 мс, а бюджет кадра — 16.7 мс при
 * шестидесяти; при тридцати длинным был бы каждый кадр, и замер мерил бы потолок, а не карту.
 */
export const REPORT_FPS = 30;

/**
 * Плотность пикселей страницы отчёта: единица — заливка вчетверо меньше, чем при двойке. Нужно
 * больше троим, и у каждого плотность — предмет замера, а не украшение:
 *   `revive` — раздел «чужой размер» проверяет, что буфер пересчитан под плотность экрана (@2 и @3
 *              против потолка игры 2), и размер буфера стоит в выводе;
 *   `map`    — телефонный кадр 375×812 @2: цена кадра и память кэша земли — на плотности телефона;
 *   `tap`    — след пальца на экране телефона 375×812 @2 (строка шапки вывода); холст при этом не
 *              рисуется вовсе — WebGL подделан, — и плотность стоит одну разметку интерфейса.
 * `scene` берёт единицу (окно без масштаба).
 */
export const REPORT_DPR = 1;

/**
 * Сколько самое большее идёт один прогон **стенда сцены** подряд — того, что сессия гоняет сама,
 * чтобы посмотреть или замерить картинку (`prologue:stand`). Дальше — пауза и новый заход. Штатных
 * отчётов приёмки этот потолок не касается: они идут столько, сколько идут (`HEAVY_PAUSE_MS`).
 */
export const BROWSER_MAX_MS = 2 * 60_000;

/**
 * Пауза между тяжёлыми отчётами приёмки — браузерными: они идут строго по одному, после счётных,
 * и между ними машина остывает. Паузу держит сама приёмка (`reports.ts`), в том числе на базе во
 * втором worktree; в выводе отчётов её нет, и сверку с базой она не трогает.
 */
export const HEAVY_PAUSE_MS = 30_000;

/** Выдержать паузу между тяжёлыми прогонами, сказав об этом строкой. */
export async function coolDown(why: string): Promise<void> {
  console.log(`  пауза ${HEAVY_PAUSE_MS / 1000} с перед ${why} — бюджет железа`);
  await new Promise((r) => setTimeout(r, HEAVY_PAUSE_MS));
}

/**
 * Чужая загрузка, при которой машина ещё свободна: четверть. Порог выбран, а не измерен: прогон берёт
 * половину (`CORE_SHARE`), и вместе с чужой четвертью машина занята не больше чем на три четверти;
 * больше — прогон ждёт. Сколько занимает рабочий стол владельца без прогонов — не измерено.
 */
export const FREE_LOAD = 1 / 4;

/** Как часто занятую машину спрашивают снова и как часто об ожидании говорят строкой. */
const FREE_POLL_MS = 30_000;
const FREE_SAY_MS = 5 * 60_000;
/** Сколько мерить загрузку машины. */
const LOAD_SAMPLE_MS = 5_000;

export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  cmd: string;
}

const TAB = '\t';

/** Все процессы машины: номер, родитель, имя и строка команды. Не удалось спросить — пусто. */
function processes(): Proc[] {
  const win = process.platform === 'win32';
  const r = win
    ? spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.CommandLine)" }',
        ],
        { encoding: 'utf8', windowsHide: true },
      )
    : spawnSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return [];
  const out: Proc[] = [];
  for (const raw of r.stdout.split('\n')) {
    const line = raw.replace('\r', '');
    if (win) {
      const [pid, ppid, name, ...cmd] = line.split(TAB);
      if (!pid || Number.isNaN(Number(pid))) continue;
      out.push({ pid: Number(pid), ppid: Number(ppid), name: name ?? '', cmd: cmd.join(TAB) });
    } else {
      const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), name: m[3], cmd: m[4] });
    }
  }
  return out;
}

/**
 * Свои процессы: цепочка предков (`npm run …` и оболочки) и все потомки — отчёты, которые гонит
 * приёмка, их веер и их браузер. Чужими считаются только остальные.
 */
function family(all: Proc[]): Set<number> {
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const mine = new Set<number>();
  for (let pid: number | undefined = process.pid; pid && !mine.has(pid); pid = byPid.get(pid)?.ppid) mine.add(pid);
  const kids = new Map<number, number[]>();
  for (const p of all) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid]);
  const stack = [process.pid];
  while (stack.length > 0) {
    for (const k of kids.get(stack.pop()!) ?? []) {
      if (mine.has(k) || k === 0) continue;
      mine.add(k);
      stack.push(k);
    }
  }
  return mine;
}

/**
 * Что в чужом процессе — тяжёлая работа, рядом с которой прогон не начинается. Признаки — по имени и
 * строке команды: так видно и то, что не нагружает машину прямо сейчас, но вот-вот начнёт.
 */
export function heavyWork(p: Proc): string | null {
  const node = /^node(\.exe)?$/i.test(p.name);
  if (/chrome/i.test(p.name) && !p.cmd.includes('--type=') && /--remote-debugging-(port|pipe)|--headless/.test(p.cmd)) {
    // Главный процесс Chrome для замеров или рендера: обычный браузер владельца без окна и без отладочного порта не открывают.
    return `стендовый браузер ${p.pid}`;
  }
  if (/^ffmpeg(\.exe)?$/i.test(p.name)) return `ffmpeg ${p.pid} — рендер видео`;
  if (node && /vite-node|vitest/.test(p.cmd)) return `прогон ${p.pid}: ${p.cmd.slice(0, 120)}`;
  if (node && /(^|[\s"'\\/])render[\w.-]*\.(m?js|cjs|ts)\b/i.test(p.cmd)) return `рендер ${p.pid}: ${p.cmd.slice(0, 120)}`;
  if (node && /vite(\.js)?["']?\s+build\b|[\\/]build\.mjs\b|[\\/]tsc(\.js)?["']?(\s|$)|typescript[\\/]bin[\\/]tsc/.test(p.cmd)) {
    return `сборка ${p.pid}: ${p.cmd.slice(0, 120)}`;
  }
  return null;
}

/**
 * Чужие тяжёлые прогоны на машине: браузер для замеров или рендера, ffmpeg, рендер, сборка, прогоны
 * отчётов, тестов и стендов. Свои — предки и потомки этого процесса — не в счёт.
 */
export function foreignRuns(options: { browsers?: boolean; runs?: boolean } = {}): string[] {
  const { browsers = true, runs = true } = options;
  const all = processes();
  const mine = family(all);
  const found: string[] = [];
  for (const p of all) {
    if (mine.has(p.pid)) continue;
    const what = heavyWork(p);
    if (!what) continue;
    if (what.startsWith('стендовый браузер') ? browsers : runs) found.push(what);
  }
  return found;
}

/**
 * Загрузка машины за `ms`: доля всех ядер, занятая не простоем. Своих прогонов в этот миг быть не
 * должно — спрашивают её перед стартом, когда свой процесс ждёт.
 */
export async function machineLoad(ms = LOAD_SAMPLE_MS): Promise<number> {
  const sum = (): { idle: number; all: number } =>
    cpus().reduce(
      (a, c) => ({ idle: a.idle + c.times.idle, all: a.all + c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle }),
      { idle: 0, all: 0 },
    );
  const a = sum();
  await new Promise((r) => setTimeout(r, ms));
  const b = sum();
  const all = b.all - a.all;
  return all > 0 ? 1 - (b.idle - a.idle) / all : 0;
}

/** Отказ словами, если машина занята чужим: одна строка на то, что нашлось, и что делать. Для стенда, который сессия гоняет сама. */
export function refuseIfBusy(what: string, options?: { browsers?: boolean; runs?: boolean }): void {
  const busy = foreignRuns(options);
  if (busy.length === 0) return;
  console.error(`\n${what} не запущен — правило бюджета железа (CLAUDE.md): прогоны только по одному, а на машине уже идёт:`);
  for (const b of busy) console.error(`  ${b}`);
  console.error('Дождись, пока он кончится, или сними его, если он висит от прерванного прогона.');
  process.exit(2);
}

/**
 * Что сказать об ожидании: что ждёт, чем занята машина и — только если держит чужой процесс — что висящий от
 * прерванного прогона снимают руками. Держит одна загрузка машины (`load`) — снимать нечего, и совета нет: прежде он
 * печатался и тогда (docs/battle_eu4.md, 14.35).
 */
export function busyWords(what: string, runs: readonly string[], load: string | null): string[] {
  const lines = [`${what} ждёт — бюджет железа (CLAUDE.md): прогоны только на свободной машине, а на ней идёт:`];
  for (const b of runs) lines.push(`  ${b}`);
  if (load) lines.push(`  ${load}`);
  if (runs.length > 0) lines.push('  Висит от прерванного прогона — сними его руками.');
  return lines;
}

/**
 * Ждать, пока машина освободится, — для приёмки и её отчётов: занятая машина значит «подождать», а не
 * «упасть» (решение владельца, 29.09.2026). Свободна — когда нет чужой тяжёлой работы (`foreignRuns`) и,
 * если спросили, чужая загрузка ниже `FREE_LOAD`. Об ожидании говорит строкой сразу и раз в пять минут
 * (`busyWords`); висящий процесс от прерванного прогона снимают руками.
 *
 * Внутри отчёта (`inReport`) об ожидании говорят замером: это состояние машины, а не свойство кода, и в
 * сверку с базой оно не идёт — строка из одних замеров пропускается (`measured.ts`); иначе ожидание было
 * бы сдвигом вывода.
 */
export async function waitUntilFree(
  what: string,
  options: { browsers?: boolean; runs?: boolean; load?: boolean; inReport?: boolean } = {},
): Promise<void> {
  const say = (line: string): void => console.log(options.inReport ? `  ${measure(line.trim())}` : line);
  let said = -Infinity;
  const started = Date.now();
  for (;;) {
    const runs = foreignRuns(options);
    let load: string | null = null;
    if (runs.length === 0 && options.load) {
      const share = await machineLoad();
      if (share >= FREE_LOAD) load = `машина занята на ${Math.round(share * 100)} % (свободна — ниже ${Math.round(FREE_LOAD * 100)} %)`;
    }
    if (runs.length === 0 && load === null) {
      if (said > -Infinity) say(`  машина свободна через ${Math.round((Date.now() - started) / 1000)} с — ${what}`);
      return;
    }
    if (Date.now() - said >= FREE_SAY_MS) {
      said = Date.now();
      for (const line of busyWords(what, runs, load)) say(line);
    }
    await new Promise((r) => setTimeout(r, FREE_POLL_MS));
  }
}
