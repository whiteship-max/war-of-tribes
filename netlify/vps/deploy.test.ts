import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../lib/routes/index.js';
import { ENV } from './config.js';

/**
 * Файлы выкладки своего сервера — Dockerfile, docker-compose.yml, deploy/Caddyfile, .dockerignore,
 * .env.example, deploy/update.sh, deploy/coolify.yml, deploy/behind-coolify.yml, deploy/pull-backups.ps1 — проверяются чтением, как замки сервера (`server.test.ts`).
 * Собрать образ здесь нечем (Docker на машине разработки не обязателен), поэтому держатся свойства,
 * ошибка в которых стоила бы дорого и молча: токен в образе, открытый наружу порт приложения,
 * адрес API, который Caddy не провёл бы, переменная, которую сервер не читает.
 */
const ROOT = join(__dirname, '..', '..');
// Пути — каждый своим `join` от корня: так их видит и подсчёт приёмки (`scripts/lib/deps.ts`), и
// эти файлы получают владельца — этот тест, а не «неизвестно что» с полным прогоном отчётов.
const DEPLOY = join(ROOT, 'deploy');
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
const ignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
const netlifyToml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
const caddy = readFileSync(join(DEPLOY, 'Caddyfile'), 'utf8');
const update = readFileSync(join(DEPLOY, 'update.sh'), 'utf8');
const coolify = readFileSync(join(DEPLOY, 'coolify.yml'), 'utf8');
const behind = readFileSync(join(DEPLOY, 'behind-coolify.yml'), 'utf8');
const pull = readFileSync(join(DEPLOY, 'pull-backups.ps1'), 'utf8');

/** Переменные, которые понимает сервер: свои — `config.ENV`, токен и секрет вебхука — `lib/http`, домен — Caddy. */
const KNOWN = new Set<string>([...Object.values(ENV), 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TRIBE_DOMAIN']);

/** Блок сервиса в compose-файле: от `  имя:` до следующего сервиса или раздела. */
const service = (name: string, file = compose): string => {
  const m = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\w[\\w-]*:\\n|^\\S)`, 'm').exec(file);
  if (!m) throw new Error(`нет сервиса ${name}`);
  return m[1];
};

describe('секреты не уезжают в образ и в репозиторий', () => {
  it('.env не попадает в контекст сборки, образец — попадает', () => {
    const lines = ignore.split('\n').map((l) => l.trim());
    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');
    expect(lines).toContain('!.env.example');
    expect(lines).toContain('node_modules');
    expect(lines).toContain('.git');
  });

  it('в образце нет значений секретов — только имена', () => {
    const values = Object.fromEntries(
      example
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => l.split('=', 2) as [string, string]),
    );
    expect(values.TELEGRAM_BOT_TOKEN).toBe('');
    expect(values.TELEGRAM_WEBHOOK_SECRET).toBe('');
    expect(values.NETLIFY_AUTH_TOKEN).toBe('');
    expect(values.TRIBE_DOMAIN).toBe('');
  });

  it('в compose значения только из окружения: ни одного вписанного токена', () => {
    for (const line of compose.split('\n')) {
      const m = /^\s+(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|NETLIFY_AUTH_TOKEN|NETLIFY_SITE_ID):\s*(.*)$/.exec(line);
      if (m) expect(m[2], m[1]).toMatch(/^\$\{\w+(:[-?][^}]*)?\}$/);
    }
  });

  it('Dockerfile не копирует .env и не вписывает токен', () => {
    expect(dockerfile).not.toMatch(/\.env\b(?!\.example)/);
    expect(dockerfile).not.toMatch(/TELEGRAM_BOT_TOKEN/);
  });
});

describe('имена переменных — одни у сервера, compose и образца', () => {
  it('каждое имя образца сервер понимает', () => {
    const names = [...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n) => !KNOWN.has(n))).toEqual([]);
  });

  it('каждая подстановка compose — известное имя', () => {
    const names = [...compose.matchAll(/\$\{(\w+)/g)].map((m) => m[1]);
    expect(names.filter((n) => !KNOWN.has(n))).toEqual([]);
  });

  it('приложению передаются только его переменные; токен — из окружения', () => {
    const env = [...service('app').matchAll(/^ {6}([A-Z_]+):/gm)].map((m) => m[1]);
    expect(env).toContain('TELEGRAM_BOT_TOKEN');
    expect(env).toContain('TELEGRAM_WEBHOOK_SECRET');
    expect(env.filter((n) => n !== 'TELEGRAM_BOT_TOKEN' && n !== 'TELEGRAM_WEBHOOK_SECRET' && !Object.values(ENV).includes(n as never))).toEqual([]);
  });
});

describe('наружу открыт только Caddy', () => {
  it('у приложения нет портов наружу; у Caddy — 80 и 443', () => {
    // Блоки найдены те самые — иначе «портов нет» было бы правдой о пустой строке.
    expect(service('app')).toMatch(/target: app/);
    expect(service('web')).toMatch(/target: web/);
    expect(service('app')).not.toMatch(/^\s+ports:/m);
    const web = service('web');
    expect(web).toMatch(/"80:80"/);
    expect(web).toMatch(/"443:443"/);
  });

  it('данные — в именованном томе, переживающем пересборку', () => {
    expect(service('app')).toMatch(/- tribe-data:\/data/);
    expect(compose).toMatch(/^volumes:\n[\s\S]*^ {2}tribe-data:/m);
  });
});

describe('Caddy проводит ровно адреса API — те же, что у функций Netlify', () => {
  it('список @api совпадает с ROUTES', () => {
    const m = /@api path ([^\n]+)/.exec(caddy);
    expect(m).not.toBeNull();
    expect(m![1].trim().split(/\s+/).sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it('API уходит приложению на его порт; всё прочее — статика с запасным index.html', () => {
    expect(caddy).toMatch(/reverse_proxy app:8080/);
    expect(caddy).toMatch(/try_files \{path\} \/index\.html/);
    expect(caddy).toMatch(/root \* \/srv/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/dist \/srv/);
  });

  it('адрес сайта — из переменной, а не вписан', () => {
    expect(caddy).toMatch(/^\{\$TRIBE_DOMAIN\} \{/m);
  });
});

describe('вариант под Coolify — те же образы, без портов', () => {
  /**
   * Под Coolify 80 и 443 держит его прокси: открытый порт в compose с ним бы подрался. Остальное —
   * то же, что в основном файле: те же цели сборки, тот же набор переменных у приложения.
   */
  it('ни одного порта наружу; Caddy слушает простой HTTP за прокси', () => {
    expect(coolify).not.toMatch(/^\s+ports:/m);
    expect(service('web', coolify)).toMatch(/TRIBE_DOMAIN: ":80"/);
    expect(service('web', coolify)).toMatch(/target: web/);
  });

  it('приложение — та же цель и те же переменные, что в основном compose', () => {
    const vars = (block: string): string[] => [...block.matchAll(/^ {6}([A-Z_]+):/gm)].map((m) => m[1]).sort();
    expect(service('app', coolify)).toMatch(/target: app/);
    expect(vars(service('app', coolify))).toEqual(vars(service('app')));
    expect(vars(service('app')).length).toBeGreaterThan(5);
    expect(service('app', coolify)).toMatch(/- tribe-data:\/data/);
  });
});

describe('игра за прокси Coolify на своём сервере — дополнение к основному compose', () => {
  /**
   * На сервере с Coolify 80 и 443 держит его прокси (Traefik), и порт Caddy из основного compose с ним бы подрался.
   * Дополнение (`COMPOSE_FILE=docker-compose.yml:deploy/behind-coolify.yml` в .env) снимает порты у Caddy и отдаёт
   * его прокси по меткам; приложение, тома и переменные остаются из основного файла.
   */
  it('у Caddy порты сняты, он слушает простой HTTP в сети прокси', () => {
    const web = service('web', behind);
    expect(web).toMatch(/^ {4}ports: !reset \[\]/m);
    expect(web).toMatch(/TRIBE_DOMAIN: ":80"/);
    expect(web).toMatch(/^ {6}- coolify\b/m);
    expect(behind).toMatch(/^ {2}coolify:\s+external: true/m);
  });

  it('прокси ведёт домен игры из TRIBE_DOMAIN на 80-й порт Caddy, сертификат — его', () => {
    const web = service('web', behind);
    expect(web).toMatch(/traefik\.enable=true/);
    expect(web).toMatch(/traefik\.http\.routers\.tribe\.rule=Host\(`\$\{TRIBE_DOMAIN\}`\)/);
    expect(web).toMatch(/traefik\.http\.routers\.tribe\.tls\.certresolver=letsencrypt/);
    expect(web).toMatch(/traefik\.http\.services\.tribe\.loadbalancer\.server\.port=80\b/);
  });

  it('приложение и тома не тронуты: дополнение говорит только о Caddy', () => {
    expect(() => service('app', behind)).toThrow();
    expect(behind).not.toMatch(/^volumes:/m);
  });

  it('копии с сервера забираются из контейнера, имя которого даёт основной compose', () => {
    // Имя контейнера compose — `<name>-<сервис>-1`; разойдись оно с образцом, копии молча перестали бы приходить.
    const project = /^name: (\S+)/m.exec(compose)![1];
    expect(pull).toMatch(new RegExp(`docker cp ${project}-app-1:/data/backups -`));
  });
});

describe('образ собирается теми же командами, что и выкладка', () => {
  it('клиент — `npm run build` (единственная команда релиза), сервер — build.mjs', () => {
    expect(dockerfile).toMatch(/RUN npm ci\b/);
    expect(dockerfile).toMatch(/RUN npm run build && node netlify\/vps\/build\.mjs \/app\/out\/server\.mjs/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/out\/server\.mjs \.\/server\.mjs/);
  });

  it('Node — та же ветка, что у сборки Netlify', () => {
    const netlifyNode = /NODE_VERSION = "(\d+)"/.exec(netlifyToml)![1];
    const images = [...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map((m) => m[1]);
    expect(images.length).toBe(2);
    expect(new Set(images)).toEqual(new Set([netlifyNode]));
  });

  it('приложение работает не от root и проверяет себя по /api/time', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]*\/api\/time/);
  });

  it('обновление: только быстрый git pull, копия базы — до перезапуска', () => {
    expect(update).toMatch(/git pull --ff-only/);
    const backup = update.indexOf('docker compose run --rm app backup');
    expect(backup).toBeGreaterThan(0);
    expect(update.indexOf('docker compose up -d')).toBeGreaterThan(backup);
  });
});
