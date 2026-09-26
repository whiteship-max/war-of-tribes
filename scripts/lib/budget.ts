/**
 * Бюджет железа: сколько машины владельца может занять один прогон.
 *
 * ПРАВИЛО ВЛАДЕЛЬЦА, ОБЯЗАТЕЛЬНОЕ ДЛЯ ВСЕХ СЕССИЙ (CLAUDE.md, «Бюджет железа»). Машина владельца —
 * не сервер: дважды подряд, 25 и 26.09.2026, она уходила в защиту и выключалась кнопкой прямо на
 * работе, и оба раза — на браузере, гнавшем видеокарту. Правило держит этот модуль, а не память:
 * тесты (`vite.config.ts`), веер отчётов (`fan.ts`) и приёмка (`reports.ts`) берут ядра отсюда,
 * стендовый браузер (`chrome.ts`) не поднимется без потолка кадров и рядом с чужим.
 *
 *   ядра      не больше двух третей (`budgetCores`), и это потолок, а не цель;
 *   браузер   только с потолком кадров, не дольше двух минут подряд (`BROWSER_MAX_MS`), по одному;
 *   чужое     перед прогоном — ни чужого стендового браузера, ни чужого прогона отчётов и тестов.
 */
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';

/** Какая доля ядер машины может уйти на один прогон: две трети (решение владельца). */
export const CORE_SHARE = 2 / 3;

/** Сколько ядер — работников тестов, процессов веера, жетонов приёмки — берёт прогон: две трети, вниз, не меньше одного. */
export function budgetCores(cores = availableParallelism()): number {
  return Math.max(1, Math.floor(cores * CORE_SHARE));
}

/** Флаги Chrome, снимающие потолок кадров. Запрещены: с ними стенд гнал видеокарту на полную. */
export const UNCAPPED: readonly string[] = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

/** Сколько самое большее идёт один прогон браузерного стенда подряд. Дальше — пауза и новый заход. */
export const BROWSER_MAX_MS = 2 * 60_000;

interface Proc {
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
 * Чужие тяжёлые прогоны на машине: стендовый браузер (Chrome с отладочным портом — обычный браузер
 * владельца его не открывает) и прогоны отчётов, тестов и стендов (node с `vite-node` или `vitest`).
 * Свой процесс и вся цепочка его предков (`npm run …` и оболочки) не в счёт.
 */
export function foreignRuns(options: { browsers?: boolean; runs?: boolean } = {}): string[] {
  const { browsers = true, runs = true } = options;
  const all = processes();
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const mine = new Set<number>();
  for (let pid: number | undefined = process.pid; pid && !mine.has(pid); pid = byPid.get(pid)?.ppid) mine.add(pid);
  const found: string[] = [];
  for (const p of all) {
    if (mine.has(p.pid)) continue;
    if (browsers && /chrome/i.test(p.name) && p.cmd.includes('--remote-debugging-port') && !p.cmd.includes('--type=')) {
      found.push(`стендовый браузер ${p.pid}`);
    } else if (runs && /^node(\.exe)?$/i.test(p.name) && /vite-node|vitest/.test(p.cmd)) {
      found.push(`прогон ${p.pid}: ${p.cmd.slice(0, 120)}`);
    }
  }
  return found;
}

/** Отказ словами, если машина занята чужим: одна строка на то, что нашлось, и что делать. */
export function refuseIfBusy(what: string, options?: { browsers?: boolean; runs?: boolean }): void {
  const busy = foreignRuns(options);
  if (busy.length === 0) return;
  console.error(`\n${what} не запущен — правило бюджета железа (CLAUDE.md): прогоны только по одному, а на машине уже идёт:`);
  for (const b of busy) console.error(`  ${b}`);
  console.error('Дождись, пока он кончится, или сними его, если он висит от прерванного прогона.');
  process.exit(2);
}
