/**
 * Поток шанса окна вольного замка (ПН-Э2г, `lib/oddsdesk.ts`): строки пути — секунды ядра боя, и считать их в потоке запросов значило бы
 * держать все адреса игры, пока идёт одно окно. Здесь — отдельный поток того же файла сервера (в образе он один: `server.mjs`), с
 * низким приоритетом (`ODDS_NICE`: на Linux приоритет — у потока, и `os.setPriority` из потока опускает только его). Дела поток берёт по
 * одному, по порядку прихода; срок — между репетициями (`countPaths`).
 *
 * Поток не поднялся или упал — дело отвечает «не посчитан», а не считает в потоке запросов: адреса игры дороже окна бродяги.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { setPriority } from 'node:os';
import { countPaths, type OddsCounter } from '../lib/oddsdesk.js';
import type { FreeNeedRow, FreePathIn } from '../../src/world/freeodds.js';

export const ODDS_ROLE = 'odds';
/** Приоритет потока: самый низкий — ядро отдаётся ему, только когда остальным не нужно. */
export const ODDS_NICE = 19;

interface Job {
  n: number;
  path: FreePathIn;
  calcMs: number;
}
type Reply = { n: number; rows: FreeNeedRow[] | null } | { n: number; error: string };

/** Счёт строк пути потоком файла `file` (тот же файл сервера, `import.meta.url`); `fail` — сказать в журнал, что поток упал. */
export function oddsThread(file: URL, fail: (e: unknown) => void = () => {}): OddsCounter {
  let w: Worker | null = null;
  let n = 0;
  const wait = new Map<number, { ok: (rows: FreeNeedRow[] | null) => void; no: (e: Error) => void }>();
  const drop = (e: Error): void => {
    for (const p of wait.values()) p.no(e);
    wait.clear();
    w = null;
  };
  const start = (): Worker => {
    const v = new Worker(file, { workerData: { role: ODDS_ROLE } });
    v.on('message', (m: Reply) => {
      const p = wait.get(m.n);
      if (!p) return;
      wait.delete(m.n);
      if ('rows' in m) p.ok(m.rows);
      else p.no(new Error(m.error));
    });
    v.on('error', (e) => {
      fail(e);
      drop(e instanceof Error ? e : new Error(String(e)));
    });
    v.on('exit', () => {
      if (w === v) drop(new Error('поток шанса вышел'));
    });
    v.unref();
    return v;
  };
  return (path, calcMs) =>
    new Promise((ok, no) => {
      w ??= start();
      n += 1;
      wait.set(n, { ok, no });
      w.postMessage({ n, path, calcMs } satisfies Job);
    });
}

/** Этот поток — поток шанса: стать им и вернуть `true`. Главный поток — `false`, и ничего не делать. */
export function serveOddsThread(): boolean {
  if (isMainThread || !parentPort || (workerData as { role?: string } | null)?.role !== ODDS_ROLE) return false;
  try {
    setPriority(ODDS_NICE);
  } catch {
    // Опустить приоритет не дали — считаем как есть: окно важнее отказа.
  }
  const port = parentPort;
  port.on('message', (j: Job) => {
    try {
      port.postMessage({ n: j.n, rows: countPaths(j.path, j.calcMs) } satisfies Reply);
    } catch (e) {
      port.postMessage({ n: j.n, error: String(e) } satisfies Reply);
    }
  });
  return true;
}
