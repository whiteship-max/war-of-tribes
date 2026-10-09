/**
 * Настройки своего сервера — только из переменных окружения, и только по именам из `ENV`. Значений
 * в репозитории нет ни одного: их вписывает владелец в `.env` на сервере (образец — `.env.example`,
 * пошагово — docs/SERVER.md). Токен бота читается не здесь, а в одном месте на оба дома —
 * `lib/http.botToken` (`server.test.ts`, «токен читают в одном месте»).
 *
 * Разбор не бросает: всё, что не разобралось, возвращается списком строк, и сервер не стартует,
 * назвав причину словами. Запуск с молча подставленным умолчанием вместо опечатки владельца — это
 * сервер, который пишет партии не туда, куда думает владелец.
 */
import { join } from 'node:path';
import { deliverOn } from '../lib/http.js';

/** Имена переменных. Других сервер не читает; `.env.example` и `docker-compose.yml` сверяются с ними тестом. */
export const ENV = {
  /** Порт внутри сети контейнеров; наружу его не открывают. */
  port: 'PORT',
  /** Где лежат данные: `sqlite` (умолчание) или `blobs` — по-прежнему на Netlify. */
  store: 'TRIBE_STORE',
  /** Папка с базой и копиями. В контейнере — том `/data`. */
  dataDir: 'TRIBE_DATA',
  /** Сколько суточных копий хранить. */
  backupKeep: 'BACKUP_KEEP',
  /** Во сколько снимать копию, ЧЧ:ММ по UTC. */
  backupAt: 'BACKUP_AT',
  /** Проход доставки уведомлений раз в минуту: `on` — включить. Умолчание — выключен, как на Netlify. */
  deliver: 'TRIBE_DELIVER',
  /**
   * Темп войны между игроками для проверки (docs/pvp.md): во сколько раз быстрее походы и голод. Читает его
   * общий обработчик войны сам (`http.warPace`) — одинаково на Netlify и здесь. Умолчание — 1, обычная игра.
   */
  warPace: 'TRIBE_WAR_PACE',
  /**
   * Адрес игры для кнопки «Открыть игру» под сообщениями бота (docs/NOTIFY.md, 12.10): `https://домен`. Читает его
   * общий адаптер Telegram сам (`http.appUrl`) — одинаково на Netlify и здесь. Пусто — боевой адрес на Netlify.
   */
  appUrl: 'TRIBE_APP_URL',
  /**
   * Админы бота (docs/admin.md): идентификаторы Telegram через запятую. Читает его общая админка сама
   * (`admin.adminIds`) — одинаково на Netlify и здесь. Пусто — команд админа не слушает никто.
   */
  admins: 'ADMIN_IDS',
  /**
   * Режим появления новых игроков (docs/test_world.md): `sicily` — двенадцать мест на Сицилии и война без защиты слабого.
   * Читает его общий обработчик сам (`http.spawnMode`) — одинаково на Netlify и здесь. Пусто — обычное расселение.
   */
  spawn: 'TRIBE_SPAWN',
  /**
   * Оплата алмазов USDT в сети TON (docs/payments.md). Читает их общий обработчик оплаты сам (`ton.payConfig`) —
   * одинаково на Netlify и здесь. Пусто `TON_WALLET` — оплата выключена. Сеть — `testnet` (умолчание) или `mainnet`.
   */
  tonNetwork: 'TON_NETWORK',
  tonWallet: 'TON_WALLET',
  tonUsdtMaster: 'TON_USDT_MASTER',
  tonUsdtDecimals: 'TON_USDT_DECIMALS',
  tonApiKey: 'TON_API_KEY',
  tonApiUrl: 'TON_API_URL',
  /** Номер сайта Netlify — для `TRIBE_STORE=blobs` и для переноса данных. */
  netlifySite: 'NETLIFY_SITE_ID',
  /** Личный токен Netlify — для `TRIBE_STORE=blobs` и для переноса данных. */
  netlifyToken: 'NETLIFY_AUTH_TOKEN',
} as const;

export interface VpsConfig {
  port: number;
  store: 'sqlite' | 'blobs';
  dataDir: string;
  backupKeep: number;
  /** Минута суток UTC. */
  backupAt: number;
  deliver: boolean;
  netlify: { siteID: string; token: string } | null;
}

export const DEFAULTS = {
  port: 8080,
  dataDir: '/data',
  backupKeep: 14,
  backupAt: 3 * 60 + 30,
} as const;

export function readConfig(env: Record<string, string | undefined>): { config: VpsConfig; problems: string[] } {
  const problems: string[] = [];
  const text = (name: string): string => (env[name] ?? '').trim();

  const int = (name: string, dflt: number, min: number, max: number): number => {
    const raw = text(name);
    if (raw === '') return dflt;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name}: ждали целое от ${min} до ${max}, а там «${raw}»`);
      return dflt;
    }
    return n;
  };

  const storeRaw = text(ENV.store) || 'sqlite';
  if (storeRaw !== 'sqlite' && storeRaw !== 'blobs') problems.push(`${ENV.store}: ждали sqlite или blobs, а там «${storeRaw}»`);
  const store = storeRaw === 'blobs' ? 'blobs' : 'sqlite';

  let backupAt: number = DEFAULTS.backupAt;
  const atRaw = text(ENV.backupAt);
  if (atRaw !== '') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(atRaw);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) problems.push(`${ENV.backupAt}: ждали ЧЧ:ММ, а там «${atRaw}»`);
    else backupAt = Number(m[1]) * 60 + Number(m[2]);
  }

  const deliverRaw = text(ENV.deliver) || 'off';
  if (deliverRaw !== 'on' && deliverRaw !== 'off') problems.push(`${ENV.deliver}: ждали on или off, а там «${deliverRaw}»`);

  const siteID = text(ENV.netlifySite);
  const token = text(ENV.netlifyToken);
  const netlify = siteID && token ? { siteID, token } : null;
  if (store === 'blobs' && !netlify) problems.push(`${ENV.store}=blobs: нужны ${ENV.netlifySite} и ${ENV.netlifyToken}`);

  return {
    config: {
      port: int(ENV.port, DEFAULTS.port, 0, 65535),
      store,
      dataDir: text(ENV.dataDir) || DEFAULTS.dataDir,
      backupKeep: int(ENV.backupKeep, DEFAULTS.backupKeep, 1, 365),
      backupAt,
      deliver: deliverOn({ [ENV.deliver]: deliverRaw }),
      netlify,
    },
    problems,
  };
}

/** Где что лежит в папке данных. */
export const pathsOf = (dir: string) => ({
  db: join(dir, 'tribe.sqlite'),
  backups: join(dir, 'backups'),
  /** Отметка «сервер работает»: её трогает живой сервер, и по ней восстановление отказывается идти под ним. */
  alive: join(dir, 'serve.alive'),
});
