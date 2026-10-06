import { useState } from 'react';
import {
  BOT_IS_PLACEHOLDER,
  INVITE_TEXT,
  SITE_URL,
  SOCIAL_LINKS,
  inviteLink,
  type SocialLink,
} from '@/game/data/social';
import { useGame } from '@/game/store';
import { copyText, openTelegram, shareLink, tgUserId } from '@/telegram/webapp';
import { Icon } from '@/ui/icons/Icon';

/**
 * Социальные ссылки и приглашение.
 *
 * Ни за подписку, ни за приглашённого друга ничего не начисляется, и это не
 * забывчивость: проверить подписку без сервера физически нечем — это вызов
 * getChatMember от имени бота. Награда, выданная за нажатие кнопки, досталась бы
 * и тем, кто ничего не подписал. Поэтому кнопка открывает ссылку, а награды экран
 * не обещает ни словом. Изображать выдачу нельзя, обходных путей заводить тоже.
 */
export function Social() {
  return (
    <>
      <h3>Мы в сети</h3>
      {/* Ссылки, которой нет, нет и в списке: невыпущенное не показывается (docs/ui_audit.md, 14.1, 3). */}
      {SOCIAL_LINKS.filter((link) => link.url).map((link) => (
        <SocialRow key={link.id} link={link} />
      ))}
      {/*
        Приглашения нет, пока имя бота — заглушка: ссылка собиралась на временное имя и
        вела в никуда, а игрок, отправив её другу, не узнал бы, почему тот не пришёл.
        Впишут настоящие имена из @BotFather (`data/social.ts`) — блок вернётся сам.
      */}
      {!BOT_IS_PLACEHOLDER && <Invite />}
    </>
  );
}

function SocialRow({ link }: { link: SocialLink }) {
  return (
    <div className="social-row">
      <span className="ico">
        <Icon name={`soc-${link.id}`} glyph={link.icon} />
      </span>
      <div className="body">
        <div className="title">{link.name}</div>
        <div className="desc">{link.note}</div>
      </div>
      {/* Ссылка t.me открывается внутри клиента: openLink увёл бы игрока во
          внешний браузер, откуда в мини-аппку он уже не вернётся. */}
      <button className="btn ghost" onClick={() => openTelegram(link.url as string)}>
        Открыть
      </button>
    </div>
  );
}

/**
 * Приглашение. Три состояния, и все три нужны: ссылка есть; игрока не опознали
 * (игра открыта не из Telegram — идентификатора нет, а сочинять его нельзя:
 * выдуманный код пропадёт с очисткой данных и может совпасть с чужим).
 */
function Invite() {
  const showToast = useGame((g) => g.showToast);
  const [copied, setCopied] = useState(false);
  const id = tgUserId();
  const link = inviteLink(id);
  const url = link ?? SITE_URL;

  const share = async (): Promise<void> => {
    const how = await shareLink(url, INVITE_TEXT);
    if (how === 'clipboard') showToast('Ссылка скопирована.');
    else if (how === 'none') showToast('Не вышло. Скопируй ссылку сам.');
  };

  return (
    <>
      <h3>Позвать своих</h3>
      {!link && <div className="note bad">Личной ссылки нет. Ниже обычный адрес игры.</div>}
      {/* Ссылка видна текстом: скопировать её в буфер выходит не везде — для
          этого нужен защищённый контекст, а вебвью бывает и без него. */}
      <div className="invite-link" onClick={() => void copy()}>
        {url}
      </div>
      <button className="btn wide" onClick={() => void share()}>
        Поделиться
      </button>
      <button className="btn ghost wide" onClick={() => void copy()}>
        {copied ? 'Скопировано' : 'Скопировать'}
      </button>
    </>
  );

  async function copy(): Promise<void> {
    const ok = await copyText(url);
    setCopied(ok);
    showToast(ok ? 'Ссылка скопирована.' : 'Не вышло. Выдели ссылку сам.');
  }
}
