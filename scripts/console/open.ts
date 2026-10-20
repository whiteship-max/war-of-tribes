// Ролик записи консоли в браузере (docs/handbook/console.md, «Ролик»): dev-сервер vite этого репозитория и стенд
// `?replay=file` (`src/render/console-stand.ts`) — тот же ролик боя (ГФ-1) и осады (ГФ-2), что в игре, на записи из файла.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib';

/** Порт сервера ролика: свой, чтобы не спорить с `npm run dev` (5173); занят — vite берёт следующий. */
export const REPLAY_PORT = 5199;

/** Открыть адрес в браузере по умолчанию: Windows, macOS, Linux. Не вышло — адрес остаётся в выводе. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', () => console.log(`браузер не открылся сам — открой адрес выше руками`));
    child.unref();
  } catch {
    console.log('браузер не открылся сам — открой адрес выше руками');
  }
}

/**
 * Поднять dev-сервер и открыть ролик записи `file` (путь от корня репозитория, `snaps/console/…json`). Сервер живёт, пока
 * идёт команда (Ctrl+C — выход); `open: false` — только адрес.
 */
export async function openReplay(file: string, o: { open?: boolean; quality?: string } = {}): Promise<void> {
  const rel = file.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!existsSync(path.join(ROOT, rel))) {
    console.error(`ошибка: записи ${rel} нет — её кладут консольные команды (npm run fight, raid, siege …)`);
    process.exit(2);
  }
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, clearScreen: false, logLevel: 'warn', server: { port: REPLAY_PORT, host: '127.0.0.1' } });
  await server.listen();
  const base = (server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${REPLAY_PORT}/`).replace(/\/$/, '');
  const url = `${base}/?replay=file&file=/${rel}${o.quality ? `&quality=${o.quality}` : ''}`;
  console.log(`ролик: ${url}`);
  console.log('сервер ролика идёт, пока открыта эта команда; выход — Ctrl+C');
  if (o.open !== false) openBrowser(url);
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      void server.close().then(() => resolve());
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
