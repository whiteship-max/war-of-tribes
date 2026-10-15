// Молва края на карте (docs/feed.md; до UI-7 — «Вести края»: слово «вести» словарь отдал почте державы — то, что ждёт
// ответа, — а лента ничего не ждёт; Д9, docs/ui_v2.md, 5.6): лента событий региона — кто чей город взял, где осада, где пожар, кто новый
// сосед, кто вышел на первое место. Записи пишет сервер (`/api/feed`); касание записи закрывает окно и наводит камеру
// на место (та же лупа, что у рейтинга и письма — `useWorld.spotlight`).
//
// Карта — потому что всё в ленте про соседей и места на ней. Окно — того же вида, что рейтинг, и кнопка рядом с ним.
// Значок новых — точка на кнопке: запись свежее последней прочитанной на этом устройстве (`SEEN_KEY`).
import { useCallback, useEffect, useState } from 'react';
import { useWorld } from '@/world/store';
import { fetchFeed, FEED_PULL_MS, type FeedItem } from '@/net/feed';
import { Icon } from '@/ui/icons/Icon';
import { agoText, feedWords } from './feedWords';

/** Последняя прочитанная запись на этом устройстве — минута самой свежей при открытии окна. */
const SEEN_KEY = 'tribe.feed.seen.v1';

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeSeen(at: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // Хранилище закрыто — точка новых просто вернётся при следующем входе.
  }
}

/** Есть ли записи свежее прочитанного. Своё — тоже новость: город мог пасть, пока игрока не было. */
export const hasUnseen = (items: readonly FeedItem[], seen: number): boolean => items.some((x) => x.at > seen);

export interface FeedState {
  items: FeedItem[] | null;
  why: string;
  /** Сколько сервер насчитал «сейчас» и когда это было у нас — для «12 мин назад». */
  now: number;
  unseen: boolean;
  markSeen: () => void;
}

/** Лента, пока карта открыта: при входе и раз в `FEED_PULL_MS`. Вне Telegram сервера нет — нет и ленты. */
export function useFeed(on: boolean): FeedState {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [why, setWhy] = useState('');
  const [now, setNow] = useState(0);
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => {
    if (!on) return;
    let live = true;
    const pull = async (): Promise<void> => {
      const got = await fetchFeed();
      if (!live) return;
      if (got.ok) {
        setItems(got.items);
        setNow(got.now);
        setWhy('');
      } else setWhy(got.why);
    };
    void pull();
    const timer = setInterval(() => void pull(), FEED_PULL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [on]);

  const newest = items?.reduce((m, x) => Math.max(m, x.at), 0) ?? 0;
  const markSeen = useCallback(() => {
    if (newest <= seen) return;
    writeSeen(newest);
    setSeen(newest);
  }, [newest, seen]);

  return { items, why, now, unseen: !!items && hasUnseen(items, seen), markSeen };
}

export function Feed({ feed, onClose }: { feed: FeedState; onClose: () => void }) {
  const { items, why, now, markSeen } = feed;
  // Открытое окно — прочитанное: и при открытии, и когда пока оно открыто, пришла новая запись.
  useEffect(() => markSeen(), [markSeen]);

  const show = (x: FeedItem): void => {
    onClose();
    useWorld.setState({ spotlight: { x: x.x, y: x.y } });
  };

  return (
    <div className="wm-rating" role="dialog" aria-label="Молва края">
      <div className="wm-rhead">
        <b>Молва края</b>
        <button className="wm-rbtn" onClick={onClose} aria-label="Закрыть">
          <Icon name="ui-close" glyph="✕" />
        </button>
      </div>
      {why && <div className="nx-stale">{why}</div>}
      {items === null && !why && <div className="wm-rnone">Собираем вести…</div>}
      {items !== null && items.length === 0 && <div className="wm-rnone">В крае тихо.</div>}
      {items?.map((x) => {
        const w = feedWords(x);
        return (
          <button key={x.id} className={`wm-rrow wm-frow${x.mine ? ' mine' : ''}`} onClick={() => show(x)}>
            <span className="wm-fic">
              <Icon name={w.icon.name} glyph={w.icon.glyph} />
            </span>
            <span className="wm-rwho">
              <span className="wm-ftop">
                <b className="one-line">{w.title}</b>
                <i>{agoText(now - x.at)}</i>
              </span>
              <small>{w.line}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
