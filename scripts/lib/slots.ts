/**
 * Жетоны на ядра: сколько дочерних процессов веера (`fan.ts`) работает разом у всех отчётов вместе.
 *
 * Приёмка гонит счётные отчёты параллельно (`scripts/reports.ts`), и у тяжёлых из них свой веер.
 * Дай каждому веер во все ядра — процессов станет втрое больше, чем ядер, и в каждом по треть
 * гигабайта. Поэтому ядра делит один счётчик: приёмка держит сервер жетонов, веер берёт жетон на
 * каждый дочерний процесс и отдаёт его, когда процесс вышел. Очередь одна и по порядку прихода:
 * отчёт, закончивший свой веер, отдаёт ядра тому, кто ещё считает, — и хвост самого тяжёлого
 * отчёта идёт на всех ядрах, а не на своей доле.
 *
 * Жетон держит всякий, кто считает: счётный отчёт без веера (его берёт приёмка), дочерний процесс веера и главный
 * процесс отчёта с веером, пока считает сам, — на время веера он свой жетон отдаёт (`fan.ts`). Прежде главные процессы
 * веера шли мимо жетонов, а свои разделы считают сами: отчётов с веером пять, и сверх бюджета могло считать до пяти
 * процессов (бюджет железа, 29.09.2026).
 *
 * Жетон — открытое соединение: закрылось — жетон вернулся, даже если процесс упал. Без приёмки
 * (`TRIBE_SLOTS` не задан) жетонов нет, и веер берёт столько процессов, сколько велит `TRIBE_FAN`.
 */
import net from 'node:net';

export const SLOTS = 'TRIBE_SLOTS';

export interface Slot {
  release(): void;
}

/** Сервер жетонов на `n` ядер. Адрес — в `env` для дочерних процессов. */
export async function serveSlots(n: number): Promise<{ env: Record<string, string>; close(): Promise<void>; busy(): number }> {
  let free = n;
  // Занятость: интеграл выданных жетонов по времени — сколько ядер в среднем было занято.
  const started = performance.now();
  let area = 0;
  let last = started;
  const tick = (): void => {
    const now = performance.now();
    area += (n - free) * (now - last);
    last = now;
  };
  const queue: net.Socket[] = [];
  const held = new Set<net.Socket>();
  const grant = (): void => {
    while (free > 0 && queue.length > 0) {
      const s = queue.shift()!;
      if (s.destroyed) continue;
      tick();
      free--;
      held.add(s);
      s.write('1\n');
    }
  };
  const server = net.createServer((s) => {
    queue.push(s);
    s.on('error', () => undefined);
    s.on('close', () => {
      if (held.delete(s)) {
        tick();
        free++;
      } else {
        const i = queue.indexOf(s);
        if (i >= 0) queue.splice(i, 1);
      }
      grant();
    });
    grant();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    env: { [SLOTS]: `127.0.0.1:${port}` },
    busy: () => {
      tick();
      return area / Math.max(1, last - started);
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of [...held, ...queue]) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Взять жетон; без сервера жетонов — `null` сразу: ограничивает только `TRIBE_FAN`. */
export function takeSlot(env: NodeJS.ProcessEnv = process.env): Promise<Slot | null> {
  const at = env[SLOTS];
  if (!at) return Promise.resolve(null);
  const [host, port] = at.split(':');
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(port), host);
    s.once('error', reject);
    s.once('data', () => {
      s.removeListener('error', reject);
      s.on('error', () => undefined);
      // Выданный жетон процесс не держит живым: главный процесс отчёта с веером держит свой до конца (`fan.ts`), и
      // открытое соединение не дало бы ему выйти. Пока жетона ждут, соединение держит процесс — иначе он вышел бы, не
      // дождавшись.
      s.unref();
      resolve({ release: () => s.destroy() });
    });
  });
}
