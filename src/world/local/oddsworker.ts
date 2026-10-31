// Дверь мира бродяги к потоку окна вольного замка (ПН-Э2б): один поток на мир, запросы по номеру. Нет потоков (старый браузер) — окно
// без строк шанса, а не с выдуманными: `RoamWorld` говорит, что шанс не посчитан.
import type { FreeNeedIn, FreeNeedRow } from '../freeodds';

export function oddsWorker(): ((input: FreeNeedIn) => Promise<FreeNeedRow[]>) | undefined {
  if (typeof Worker === 'undefined') return undefined;
  let w: Worker | null = null;
  let n = 0;
  const wait = new Map<number, { ok: (rows: FreeNeedRow[]) => void; no: (e: Error) => void }>();
  const start = (): Worker => {
    const v = new Worker(new URL('../freeodds.worker.ts', import.meta.url), { type: 'module' });
    v.onmessage = (e: MessageEvent<{ n: number; rows?: FreeNeedRow[]; error?: string }>): void => {
      const p = wait.get(e.data.n);
      if (!p) return;
      wait.delete(e.data.n);
      if (e.data.rows) p.ok(e.data.rows);
      else p.no(new Error(e.data.error ?? 'окно замка: поток не ответил'));
    };
    v.onerror = (): void => {
      for (const p of wait.values()) p.no(new Error('окно замка: поток упал'));
      wait.clear();
      v.terminate();
      w = null;
    };
    return v;
  };
  return (input) =>
    new Promise<FreeNeedRow[]>((ok, no) => {
      w ??= start();
      n += 1;
      wait.set(n, { ok, no });
      w.postMessage({ n, input });
    });
}
