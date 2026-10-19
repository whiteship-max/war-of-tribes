// Окно «Поделиться» (docs/feed.md, раздел 3): карточка в стиле игры и два пути — сообщением в чат (`t.me/share/url`,
// ссылка ведёт в бота и открывает игру, с меткой пригласившего) и историей Telegram (`shareToStory`, Bot API 7.8:
// картинка вида из `public/assets/share`, подпись — текст карточки). Старый клиент историй не умеет — кнопки нет.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/ui/icons/Icon';
import { useGame } from '@/game/store';
import { STORY_TEXT_MAX, canStory, shareLink, shareStory, tgUserId } from '@/telegram/webapp';
import { BOT_IS_PLACEHOLDER, SITE_URL, inviteLink } from '@/game/data/social';
import type { ShareCard } from './shareCard';
import type { IconName } from '@/ui/icons/alias';

const ICON: Record<ShareCard['kind'], IconName> = {
  battle: 'ui-banner',
  city: 'ui-banner',
  rating: 'ui-trophy',
};

/**
 * Куда ведёт ссылка: приглашение с меткой игрока (`startapp=r…`, сервер запишет, кто кого привёл), а пока имена бота и
 * мини-аппки в `data/social.ts` — заглушки, — боевой адрес игры: ссылка на временное имя вела бы в никуда.
 */
export const shareUrl = (): string => (BOT_IS_PLACEHOLDER ? null : inviteLink(tgUserId())) ?? SITE_URL;

/** Картинка истории — адресом: Telegram забирает её сам. */
export const storyImage = (kind: ShareCard['kind']): string => new URL(`/assets/share/${kind}.jpg`, window.location.origin).href;

export function ShareSheet({ card, onClose }: { card: ShareCard; onClose: () => void }) {
  const showToast = useGame((g) => g.showToast);
  const [story] = useState(canStory);
  const url = shareUrl();

  const toChat = async (): Promise<void> => {
    const how = await shareLink(url, card.text);
    if (how === 'clipboard') showToast('Ссылка скопирована');
    if (how !== 'none') onClose();
  };
  const toStory = (): void => {
    // Ссылка — в подпись, если влезает: виджет-ссылку Telegram показывает только у Premium.
    const text = `${card.text} ${url}`.length <= STORY_TEXT_MAX ? `${card.text} ${url}` : card.text;
    if (shareStory(storyImage(card.kind), text, url)) onClose();
    else showToast('История не открылась');
  };

  // Поверх всего — порталом: шторка донесения сдвигается `transform`, и `position: fixed` внутри неё встал бы в шторке.
  return createPortal(
    <div className="nx-share-back" onClick={onClose}>
      <div className="nx-share" role="dialog" aria-label="Поделиться" onClick={(e) => e.stopPropagation()}>
        <div className={`nx-scard ${card.kind}`}>
          <div className="nx-screst">
            <Icon name={ICON[card.kind]} />
            <span>TRIBE</span>
          </div>
          <b className="nx-shead">{card.head}</b>
          <span className="nx-stitle one-line">{card.title}</span>
          <div className="nx-srows">
            {card.rows.map((r) => (
              <div key={r.label}>
                <small>{r.label}</small>
                <b>{r.value}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="nx-sbtns">
          <button className="btn" onClick={() => void toChat()}>
            В чат
          </button>
          {story && (
            <button className="btn" onClick={toStory}>
              В историю
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
