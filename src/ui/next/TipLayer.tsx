import { Icon } from '@/ui/icons/Icon';
import { useCityBusy } from './Hints';
import { modalUp, placeTip, useTip, type Rect, type TipContent } from './tip';

/**
 * Слой подсказки: один на игру. Пока плашка числа открыта, под ней лежит прозрачный ловец во весь экран —
 * следующее касание где угодно закрывает плашку и до игры не доходит (3.7: «это касание ничего больше не
 * делает»). Касание по самой плашке тоже закрывает её; ссылка внизу сначала закрывает, потом ведёт.
 *
 * Подсказка новичку (`TipContent.free`) ловца не кладёт: касание мимо плашки доходит до города, как без неё, — тап по
 * постройке открывает постройку. Закрывает её касание по ней самой или крестик; пока город занят (`useCityBusy`), она
 * спрятана и ждёт возвращения.
 */
export function TipLayer() {
  const open = useTip((t) => t.open);
  const hide = useTip((t) => t.hide);
  const busy = useCityBusy();
  if (!open) return null;
  return <TipView tip={open} view={{ w: window.innerWidth, h: window.innerHeight }} busy={busy} modal={modalUp()} hide={hide} />;
}

interface ViewProps {
  tip: TipContent & { at: Rect };
  view: { w: number; h: number };
  /** Город занят — подсказка новичку прячется (подсказка числа стоит: её открыли касанием только что). */
  busy: boolean;
  /** Поверх стоит окно, ждущее ответа: ссылки нет (`modalUp`). */
  modal: boolean;
  hide: () => void;
}

/** Разметка слоя без хранилищ и окна — её сверяет тест (`next.test.ts`). */
export function TipView({ tip, view, busy, modal, hide }: ViewProps) {
  if (tip.free && busy) return null;
  const place = placeTip(tip.at, view);
  const link = tip.link && !modal ? tip.link : null;
  const swallow = (e: { preventDefault(): void; stopPropagation(): void }): void => {
    e.preventDefault();
    e.stopPropagation();
    hide();
  };
  return (
    <>
      {!tip.free && <div className="nx-tip-catch" onPointerDown={swallow} onClick={swallow} />}
      <div
        className={`nx-tip${place.below ? ' below' : ' above'}${tip.free ? ' free' : ''}`}
        role="tooltip"
        style={{
          left: place.left,
          width: place.width,
          top: place.top ?? undefined,
          bottom: place.bottom ?? undefined,
          ['--arrow' as string]: `${place.arrow}px`,
        }}
        onClick={hide}
      >
        <b>{tip.title}</b>
        {tip.body && <p>{tip.body}</p>}
        {tip.free && (
          <button
            className="nx-tip-x"
            aria-label="Закрыть"
            onClick={(e) => {
              e.stopPropagation();
              hide();
            }}
          >
            <Icon name="ui-close" glyph="✕" />
          </button>
        )}
        {link && (
          <button
            className="nx-tip-go"
            onClick={(e) => {
              e.stopPropagation();
              hide();
              link.go();
            }}
          >
            {link.label}
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
    </>
  );
}
