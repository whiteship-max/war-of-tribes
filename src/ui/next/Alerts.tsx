import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { Icon } from '@/ui/icons/Icon';
import { useAlertItems, type AlertItem } from '@/ui/alertItems';
import { tipAt } from './tip';
import { ALERT_FRESH_MS, isFresh } from './fresh';
import { cityAudio } from '@/sound/city';

/**
 * Тревоги нового интерфейса (docs/ui_audit.md, 6.0): ряд круглых значков 44 под верхом при любом их числе —
 * сцена не уходит под стопку строк. Красное кольцо — беда по сроку или уже идущая; охра — заметка.
 *
 * Новая тревога первые четыре секунды стоит пилюлей с текстом, и тап по ней ведёт к делу сразу: текст уже
 * прочитан. Потом она сворачивается в значок, и тап открывает подсказку — текст, срок и «К делу ›».
 */
export function Alerts() {
  const all = useAlertItems();
  // Тревоги войны — набеги — стоят значками справа снизу (`WarSigns`, П-7): ряд под верхом их не повторяет.
  const items = all.filter((a) => !a.war);
  const mapOpen = useGame((g) => g.mapOpen);
  const closeMap = useGame((g) => g.closeMap);
  // Дела тревог живут в городе: вести, здания, справки. С карты тревога сначала возвращает в город — иначе
  // держава открылась бы под картой, невидимой (прежняя строка набега на карте так и молчала).
  const act = (a: AlertItem): void => {
    if (!a.go) return;
    if (mapOpen) closeMap();
    a.go();
  };
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
  // Рог — когда встала новая беда по сроку (красное кольцо): набег, мятеж. Те, что были при входе, не трубят — о них
  // игрок узнаёт с экрана, а не с первого касания; заметки (охра) молчат вовсе (docs/audio.md, раздел 7).
  const urgent = useRef<Set<string> | null>(null);
  // Рог слушает весь список, и набеги тоже: их значок стоит в другом столбце, а беда та же.
  useEffect(() => {
    const keys = new Set(all.filter((a) => a.urgent).map((a) => a.key));
    const was = urgent.current;
    urgent.current = keys;
    if (was && [...keys].some((k) => !was.has(k))) cityAudio.cue('alarm');
  }, [all]);
  if (items.length === 0) return null;

  const open = (a: AlertItem, el: Element): void =>
    tipAt(el, {
      title: a.title,
      body: a.body,
      link: a.go ? { label: a.goWord ?? 'К делу', go: () => act(a) } : undefined,
    });

  return (
    <div className={`nx-alerts${mapOpen ? ' on-map' : ''}`}>
      {items.map((a) => {
        const pill = isFresh(a.key, now);
        return (
          <button
            key={a.key}
            className={`nx-alert ${a.urgent ? 'urgent' : 'warn'}${pill ? ' pill' : ''}`}
            onClick={(e) => (pill && a.go ? act(a) : open(a, e.currentTarget))}
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
