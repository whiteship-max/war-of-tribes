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
import { copyText, inTelegram, openTelegram, shareLink, tgUserId } from '@/telegram/webapp';
import { Icon } from '@/ui/icons/Icon';

/**
 * Социальные ссылки и приглашение.
 *
 * Ни за подписку, ни за приглашённого друга ничего не начисляется, и это не
 * забывчивость: проверить подписку без сервера физически нечем — это вызов
 * getChatMember от имени бота. Награда, выданная за нажатие кнопки, досталась бы
 * и тем, кто ничего не подписал. Поэтому кнопка открывает ссылку, а про награду
 * сказано прямо. Изображать выдачу нельзя, обходных путей заводить тоже.
 */
export function Social() {
  return (
    <>
      <h3>Племя в сети</h3>
      <div className="note">
        Награды за подписку пока нет: проверить её может только сервер, а сервера у игры нет.
        Появится он — появится и награда.
      </div>
      {SOCIAL_LINKS.map((link) => (
        <SocialRow key={link.id} link={link} />
      ))}
      <Invite />
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
      {link.url ? (
        // Ссылка t.me открывается внутри клиента: openLink увёл бы игрока во
        // внешний браузер, откуда в мини-аппку он уже не вернётся.
        <button className="btn ghost" onClick={() => openTelegram(link.url as string)}>
          Открыть
        </button>
      ) : (
        <button className="btn ghost" disabled>
          Скоро
        </button>
      )}
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
    else if (how === 'none') showToast('Поделиться не вышло — скопируй ссылку вручную.');
  };

  return (
    <>
      <h3>Позвать своих</h3>
      <div className="note">
        За приглашённого друга дают алмазы. Начислить их клиент не может и не должен — это
        сделает сервер, когда появится: иначе алмазы выписывал бы себе кто угодно.
      </div>
      {!link && (
        <div className="note bad">
          {inTelegram()
            ? 'Личной ссылки пока нет: мини-аппке нужно короткое имя в @BotFather.'
            : 'Игра открыта не из Telegram, поэтому личной ссылки нет — ниже обычный адрес игры.'}
        </div>
      )}
      {link && BOT_IS_PLACEHOLDER && (
        <div className="note bad">
          Ссылка собрана на временное имя бота и пока никуда не ведёт: мини-аппку ещё не завели
          в @BotFather. Поделиться ею можно, но друг по ней не придёт.
        </div>
      )}
      {/* Ссылка видна текстом: скопировать её в буфер выходит не везде — для
          этого нужен защищённый контекст, а вебвью бывает и без него. */}
      <div className="invite-link" onClick={() => void copy()}>
        {url}
      </div>
      <button className="btn wide" onClick={() => void share()}>
        Поделиться ссылкой
      </button>
      <button className="btn ghost wide" onClick={() => void copy()}>
        {copied ? 'Скопировано' : 'Скопировать'}
      </button>
    </>
  );

  async function copy(): Promise<void> {
    const ok = await copyText(url);
    setCopied(ok);
    showToast(ok ? 'Ссылка скопирована.' : 'Скопировать не вышло — выдели ссылку вручную.');
  }
}
