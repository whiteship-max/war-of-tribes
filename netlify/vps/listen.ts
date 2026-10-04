/**
 * Приём HTTP своего сервера: запрос `node:http` → `Request` → общий обработчик (`lib/routes/`) →
 * `Response` → ответ. Своего смысла здесь нет и заводить его нельзя: всё, что сервер решает,
 * решают обработчики, одни на Netlify и здесь. Фреймворк не взят нарочно — обработчики уже
 * говорят на стандартных `Request` и `Response`, и вся прослойка — эти полсотни строк, а не
 * зависимость, которая поменяла бы сборку игры для Netlify.
 *
 * Перед сервером стоит Caddy (`deploy/Caddyfile`): он отдаёт статику, держит HTTPS и проводит сюда
 * ровно четыре адреса. Наружу порт этого процесса не открыт (`docker-compose.yml`).
 *
 * Журнала запросов нет, как и на Netlify (`server.test.ts`, «никто ничего не пишет в журнал»):
 * ни заголовка, ни тела, ни ключа. Сбой обработчика наружу — 500 простым текстом, как у упавшей
 * функции Netlify; внутрь — только адрес, на котором упало (`onError`).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MAX_BODY_BYTES, type Route } from '../lib/http.js';
import type { Stores } from '../lib/kv.js';

export interface ListenOpts {
  routes: Readonly<Record<string, Route>>;
  stores: Stores;
  /** Обработчик бросил исключение. Получает только адрес — без запроса. */
  onError?: (path: string) => void;
  clock?: () => number;
}

/**
 * Адрес клиента. Caddy пишет его в `X-Forwarded-For`, заменяя присланное клиентом (доверенных
 * прокси у него не задано), — значит правое значение и есть настоящий адрес. Нужен он ровно одному
 * ситу частоты у часов (`routes/time.ts`); без заголовка — адрес сокета.
 */
export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const line = Array.isArray(fwd) ? fwd[fwd.length - 1] : fwd;
  const last = line?.split(',').pop()?.trim();
  return last || req.socket.remoteAddress || null;
}

/**
 * Тело запроса с потолком. Сверх `MAX_BODY_BYTES + 1` байт не копится ничего: остаток читается и
 * выбрасывается, а лишнего байта хватает, чтобы `readBody` обработчика ответил 413, — тот же отказ,
 * что на Netlify, а не обрезанное тело, которое разобралось бы как испорченное.
 */
function readCapped(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cap = MAX_BODY_BYTES + 1;
    req.on('data', (chunk: Buffer) => {
      if (size >= cap) return;
      const take = chunk.subarray(0, cap - size);
      chunks.push(take);
      size += take.length;
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const BASE = 'http://tribe.local';

/** Обработчик `node:http`: найти адрес, собрать `Request`, отдать `Response`. */
export function handleWith(opts: ListenOpts): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const clock = opts.clock ?? Date.now;
  return async (req, res) => {
    // Адрес для `onError` — только известный, из таблицы: строка запроса в журнал не попадает.
    let known: string | null = null;
    try {
      const url = new URL(req.url ?? '/', BASE);
      const route = Object.hasOwn(opts.routes, url.pathname) ? opts.routes[url.pathname] : undefined;
      if (route) known = url.pathname;
      if (!route) {
        send(res, 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, '{"error":"not-found"}');
        return;
      }
      const method = req.method ?? 'GET';
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
      }
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readCapped(req);
      const request = new Request(url, { method, headers, body });
      const response = await route(request, { stores: opts.stores, now: clock(), ip: clientIp(req) });
      const out: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        out[k] = v;
      });
      send(res, response.status, out, Buffer.from(await response.arrayBuffer()));
    } catch {
      opts.onError?.(known ?? '?');
      if (!res.headersSent) send(res, 500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Internal Error');
      else res.end();
    }
  };
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body: string | Buffer): void {
  res.writeHead(status, { ...headers, 'content-length': String(Buffer.byteLength(body)) });
  res.end(body);
}

/**
 * Поднять сервер. Простой соединения держится дольше, чем у Caddy перед ним: иначе Node закрыл
 * бы соединение, которое Caddy как раз берёт для следующего запроса, и игрок получил бы 502.
 */
export function listen(opts: ListenOpts, port: number, host = '0.0.0.0'): Promise<Server> {
  const handle = handleWith(opts);
  const server = createServer((req, res) => void handle(req, res));
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
