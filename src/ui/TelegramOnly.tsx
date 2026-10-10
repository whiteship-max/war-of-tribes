import { BOT_URL } from '@/game/data/social';
import { StartArt } from './StartScreen';

/**
 * Адрес игры открыт просто в браузере — играть можно только в Telegram (`telegram/gate.ts`).
 *
 * Тот же кадр, что у экрана загрузки и стартового, и одна кнопка. Ссылка — обычная: вне Telegram скрипту клиента
 * открывать её некуда, а t.me сам предложит приложение или Telegram Web.
 */
export function TelegramOnly() {
  return (
    <div className="start">
      <StartArt />
      <div className="start-body">
        <h1 className="tg-only-title">Kings &amp; Vassals играют в Telegram</h1>
        <p className="start-note">В браузере игра не открывается: город, дружина и сохранение живут в Telegram.</p>
        <a className="start-go" href={BOT_URL}>
          Открыть в Telegram
        </a>
      </div>
    </div>
  );
}
