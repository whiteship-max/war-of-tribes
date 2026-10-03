import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { Icon } from '@/ui/icons/Icon';
import { useAlertItems, type AlertItem } from '@/ui/alertItems';
import { tipAt } from './tip';

/** Сколько новая тревога стоит пилюлей с текстом, прежде чем свернуться в значок (3.7). */
export const ALERT_FRESH_MS = 4000;

/**
 * Когда тревога появилась впервые за этот заход. Память интерфейса, не партии: перезапуск показывает
 * висящие тревоги пилюлями ещё раз — игрок их в этом заходе не видел.
 */
const firstSeen = new Map<string, number>();

/** Свежая ли тревога: пилюля с текстом, а не значок. Чистая — её сверяет тест на границе срока. */
export function isFresh(key: string, now: number, seen: Map<string, number> = firstSeen): boolean {
  let at = seen.get(key);
  if (at === undefined) {
    at = now;
    seen.set(key, at);
  }
  return now - at < ALERT_FRESH_MS;
}

/**
 * Тревоги нового интерфейса (docs/ui_audit.md, 6.0): ряд круглых значков 44 под верхом при любом их числе —
 * сцена не уходит под стопку строк. Красное кольцо — беда по сроку или уже идущая; охра — заметка.
 *
 * Новая тревога первые четыре секунды стоит пилюлей с текстом, и тап по ней ведёт к делу сразу: текст уже
 * прочитан. Потом она сворачивается в значок, и тап открывает подсказку — текст, срок и «К делу ›».
 */
export function Alerts() {
  const items = useAlertItems();
  const mapOpen = useGame((g) => g.mapOpen);
  const [now, setNow] = useState(() => performance.now());
  const fresh = items.filter((a) => isFresh(a.key, now));
  const anyFresh = fresh.length > 0;
  // Пока есть свежие, ряд переспрашивает время, чтобы пилюля свернулась сама. Время — монотонное время
  // страницы: это анимация интерфейса, а не «сейчас» партии или игрока (`net/clock`).
  useEffect(() => {
    if (!anyFresh) return;
    const t = setTimeout(() => setNow(performance.now()), ALERT_FRESH_MS);
    return () => clearTimeout(t);
  }, [anyFresh, now]);
  if (items.length === 0) return null;

  const open = (a: AlertItem, el: Element): void =>
    tipAt(el, {
      title: a.title,
      body: a.body,
      link: a.go ? { label: a.goWord ?? 'К делу', go: a.go } : undefined,
    });

  return (
    <div className={`nx-alerts${mapOpen ? ' on-map' : ''}`}>
      {items.map((a) => {
        const pill = isFresh(a.key, now);
        return (
          <button
            key={a.key}
            className={`nx-alert ${a.urgent ? 'urgent' : 'warn'}${pill ? ' pill' : ''}`}
            onClick={(e) => (pill && a.go ? a.go() : open(a, e.currentTarget))}
            aria-label={a.title}
          >
            <span className="nx-ring">{a.icon ? <Icon name={a.icon} glyph={a.glyph} /> : a.glyph}</span>
            {pill && <span className="nx-pill-txt">{a.title}</span>}
            {a.timer && <span className="nx-timer">{a.timer}</span>}
          </button>
        );
      })}
    </div>
  );
}
