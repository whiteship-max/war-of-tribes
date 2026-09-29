/**
 * Настоящий Chrome под замер — общая часть отчётов, которым нужна живая страница.
 *
 * Заведено, когда таких отчётов стало два (`scene-report`, `tap-report`): тонкий
 * клиент CDP переписывать во второй раз незачем, а две копии одного клиента
 * разошлись бы ровно так же, как расходились две копии разбора жеста.
 *
 * Здесь только транспорт: как найти браузер, как поднять его без окна и как
 * говорить с вкладкой. Что именно мерить — дело самого отчёта.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPORT_FPS, UNCAPPED, holdMachine } from './budget';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Адрес игры для отчёта: щуп (`?probe=1`, `src/debug.ts`) и потолок кадров отчёта (`?fpscap=`, `budget.REPORT_FPS` —
 * бюджет железа; игра его только опускает, `render/loop.capFrom`). Отчёт, которому нужна частота самой игры, берёт
 * адрес без потолка и говорит почему — так делает `map`, он меряет цену кадра.
 */
export const reportPage = (port: number, query = ''): string => `http://127.0.0.1:${port}/?probe=1&fpscap=${REPORT_FPS}${query}`;

/** Где лежит Chrome. Не нашёлся — путь задаётся переменной CHROME. */
export function chromePath(): string {
  if (process.env.CHROME) return process.env.CHROME;
  const guesses = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = guesses.find((p) => p && existsSync(p));
  if (!found) throw new Error('не нашёл Chrome — укажи путь в CHROME=');
  return found;
}

/**
 * Поднимает браузер со своим профилем и ждёт, пока откроется отладочный порт.
 * `HEAD=1` показывает окно — иногда надо посмотреть глазами, что там творится.
 */
export async function launchChrome(port: number, args: string[] = []): Promise<ChildProcess> {
  // Бюджет железа (CLAUDE.md): стендовый браузер — только с потолком кадров и только один. Чужой рядом — ждём, пока
  // он кончится, а не падаем: отказ посреди приёмки стоил бы ей отчёта (так `scene` и `revive` отказались рядом с
  // чужим рендером 29.09.2026). Дождались — берём замок машины: браузер — тяжёлая работа; под приёмкой замок свой.
  const uncapped = args.filter((a) => UNCAPPED.includes(a));
  if (uncapped.length) throw new Error(`флаги ${uncapped.join(' ')} снимают потолок кадров — запрещено правилом бюджета железа`);
  await holdMachine('Стендовый браузер', { runs: false, inReport: true });
  const profile = join(process.env.TEMP ?? '/tmp', `tribe-chrome-${port}-${Date.now()}`);
  const chrome = spawn(
    chromePath(),
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      ...(process.env.HEAD === '1' ? [] : ['--headless=new']),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      ...args,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      return chrome;
    } catch {
      await sleep(250);
    }
  }
  chrome.kill();
  throw new Error('Chrome не открыл отладочный порт');
}

/** Тонкий клиент CDP: одного соединения с вкладкой хватает на весь замер. */
export class Tab {
  private id = 0;
  private waiting = new Map<number, { ok: (v: unknown) => void; bad: (e: Error) => void }>();

  private constructor(
    private ws: WebSocket,
    /** Идентификатор вкладки — по нему её и закрывают. */
    readonly target: string,
  ) {
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(String(e.data)) as {
        id?: number;
        method?: string;
        params?: { exceptionDetails?: { text: string; exception?: { description?: string } } };
        result?: unknown;
        error?: { message: string };
      };
      // Упавшее в странице обязано быть видно: молча падающая сцена выглядит как
      // «переход не кончился», и причину пришлось бы искать вслепую.
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        console.error('  в странице:', d?.exception?.description ?? d?.text);
      }
      if (msg.id === undefined) return;
      const slot = this.waiting.get(msg.id);
      if (!slot) return;
      this.waiting.delete(msg.id);
      if (msg.error) slot.bad(new Error(msg.error.message));
      else slot.ok(msg.result);
    });
  }

  /** Открывает новую вкладку на адресе и соединяется с ней. */
  static async open(port: number, url: string): Promise<Tab> {
    const created = (await (
      await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    ).json()) as { webSocketDebuggerUrl: string; id: string };
    const ws = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('не открылось соединение с вкладкой')), { once: true });
    });
    const tab = new Tab(ws, created.id);
    await tab.send('Runtime.enable');
    await tab.send('Page.enable');
    return tab;
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((ok, bad) => {
      this.waiting.set(id, { ok: ok as (v: unknown) => void, bad });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Выполняет выражение на странице и отдаёт разобранный JSON. */
  async eval<T>(expression: string): Promise<T> {
    const r = await this.send<{
      result: { value?: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return JSON.parse(r.result.value ?? 'null') as T;
  }

  /**
   * Сколько объектов этого класса ещё живо. Единственный честный ответ на вопрос
   * «утекает ли»: куча растёт и от кэшей, а вот вторая живая диорама — это уже
   * утечка и ничто другое. Так и нашлась та, что жила в игре всё время.
   */
  async alive(expression: string): Promise<number> {
    const proto = await this.send<{ result: { objectId?: string } }>('Runtime.evaluate', {
      expression: `${expression}.constructor.prototype`,
    });
    if (!proto.result.objectId) return -1;
    const found = await this.send<{ objects: { objectId: string } }>('Runtime.queryObjects', {
      prototypeObjectId: proto.result.objectId,
    });
    const n = await this.send<{ result: { value?: number } }>('Runtime.callFunctionOn', {
      objectId: found.objects.objectId,
      functionDeclaration: 'function () { return this.length; }',
      returnByValue: true,
    });
    return n.result.value ?? -1;
  }

  close(): void {
    this.ws.close();
  }
}
