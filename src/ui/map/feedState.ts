// Молва края на карте (docs/feed.md): лента, пока карта открыта, и точка новых на кнопке. Живёт отдельно от окна (`Feed.tsx`):
// кнопке лента нужна всегда, а окно едет докачкой по касанию.
import { useCallback, useEffect, useState } from 'react';
import { fetchFeed, FEED_PULL_MS, type FeedItem } from '@/net/feed';

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
