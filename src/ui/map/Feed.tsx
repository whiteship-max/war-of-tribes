// Молва края на карте (docs/feed.md; до UI-7 — «Вести края»: слово «вести» словарь отдал почте державы — то, что ждёт
// ответа, — а лента ничего не ждёт; Д9, docs/ui_v2.md, 5.6): лента событий региона — кто чей город взял, где осада, где пожар, кто новый
// сосед, кто вышел на первое место. Записи пишет сервер (`/api/feed`); касание записи закрывает окно и наводит камеру
// на место (та же лупа, что у рейтинга и письма — `useWorld.spotlight`).
//
// Карта — потому что всё в ленте про соседей и места на ней. Окно — того же вида, что рейтинг, и кнопка рядом с ним.
// Значок новых — точка на кнопке: запись свежее последней прочитанной на этом устройстве (`SEEN_KEY`).
//
// Окно едет докачкой по кнопке (`WorldMap`, РТ-1 — в зачёт первой загрузки); лента и точка новых — `feedState.ts`, они нужны
// кнопке и без окна.
import { useEffect } from 'react';
import { useWorld } from '@/world/store';
import type { FeedItem } from '@/net/feed';
import type { FeedState } from './feedState';
import { Icon } from '@/ui/icons/Icon';
import { agoText, feedWords } from './feedWords';
import { Table, type Col } from '@/ui/kit/Table';

/** Столбцы молвы (UI-7, docs/ui_v2.md, 5.6): что случилось и когда; строка записи — касанием, место — дверью «›». */
const FEED_COLS: readonly Col[] = [
  { key: 'what', title: 'Что' },
  { key: 'ago', title: 'Когда', align: 'right', w: '88px' },
];

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
          <Icon name="ui-close" />
        </button>
      </div>
      {why && <div className="nx-stale">{why}</div>}
      {items === null && !why && <div className="wm-rnone">Собираем вести…</div>}
      {items !== null && items.length === 0 && <div className="wm-rnone">В крае тихо.</div>}
      {items !== null && items.length > 0 && (
        <Table
          label="Молва края"
          cols={FEED_COLS}
          rows={items.map((x) => {
            const w = feedWords(x);
            return {
              key: x.id,
              on: Boolean(x.mine),
              tip: () => ({ title: w.title, body: w.line }),
              go: () => show(x),
              goLabel: `${w.title}: на карте`,
              cells: {
                what: (
                  <span className="kit-name">
                    <Icon name={w.icon} />
                    <span className="one-line">{w.title}</span>
                  </span>
                ),
                ago: <span className="muted">{agoText(now - x.at)}</span>,
              },
            };
          })}
        />
      )}
    </div>
  );
}
