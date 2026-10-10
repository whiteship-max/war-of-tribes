// Играть можно только в Telegram (решение владельца, 11.10.2026).
//
// Признак Telegram — подписанная строка запуска (`initData`): её дают мобильный Telegram, Telegram Desktop и Telegram
// Web (web.telegram.org открывает игру во фрейме и кладёт строку в адрес — её разбирает скрипт telegram-web-app.js).
// Нет её — адрес открыт просто в браузере: вместо игры экран «играют в Telegram» со ссылкой на бота
// (`ui/TelegramOnly.tsx`), и игра не встаёт вовсе — ни стора, ни сохранения (`main.tsx`).
//
// Второй признак — та же строка в самом адресе (`#tgWebAppData=`): скрипт Telegram грузится с telegram.org, и если он
// не доехал, игрок в Telegram всё равно играет — как играл и до заслона, только без серверного сохранения.
//
// Стендам и отчётам заслон не мешает: они открывают игру на своей машине (`127.0.0.1`, `localhost`) и с флагом замера
// `?probe=1` (`src/debug.ts`), а стенды графики и ролика (`?showcase=`, `?replay=`) встают раньше заслона. Своя машина —
// это и dev-сервер, открытый с телефона по адресу домашней сети (`vite --host`).

/** Откуда открыта страница — всё, что нужно заслону. */
export interface Launch {
  /** `location.hostname`. */
  host: string;
  /** `location.hash`. */
  hash: string;
  /** Подписанная строка запуска (`tgInitData`); вне Telegram — `null`. */
  initData: string | null;
  /** Флаг замера `?probe=1` (`debug.probe`). */
  probe: boolean;
}

/** Своя машина: петля, имена `.localhost` и `.test`. */
const LOCAL = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$|\.(localhost|test)$/i;

/** Домашняя сеть — dev-сервер с телефона. Боевой сервер стоит на публичном адресе и сюда не попадает. */
const HOME_NET = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;

/** Адрес — своя машина или домашняя сеть, а не выкладка. */
export const localHost = (host: string): boolean => LOCAL.test(host) || HOME_NET.test(host);

/** Запущено ли из Telegram: подпись от скрипта Telegram или та же строка в адресе. */
export const fromTelegram = (l: Pick<Launch, 'hash' | 'initData'>): boolean =>
  Boolean(l.initData) || /[#&]tgWebAppData=/.test(l.hash);

/** Вместо игры — экран «играют в Telegram». */
export const telegramOnly = (l: Launch): boolean => !fromTelegram(l) && !l.probe && !localHost(l.host);
