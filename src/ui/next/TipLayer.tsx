import { Icon } from '@/ui/icons/Icon';
import { useCityBusy } from './Hints';
import { modalUp, placeTip, tipRoom, useTip, type Rect, type TipContent, type TipRow } from './tip';

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
          // Разбор строками бывает выше фразы: строки прокручиваются, а плашка не выходит за экран (`tipRoom`). Высота
          // — не у самой плашки: обрезка её содержимого срезала бы и стрелку к элементу.
          ['--room' as string]: `${tipRoom(place, view)}px`,
          ['--arrow' as string]: `${place.arrow}px`,
        }}
        onClick={hide}
      >
        <b>{tip.title}</b>
        {tip.lore && <p className="nx-tip-lore">{tip.lore}</p>}
        {tip.body && <p>{tip.body}</p>}
        {tip.rows && tip.rows.length > 0 && (
          <div className="nx-tip-rows">
            {tip.rows.map((r, i) => (
              <TipLine key={i} row={r} go={modal ? undefined : r.go} hide={hide} />
            ))}
            {tip.sum && <TipLine row={tip.sum} sum hide={hide} />}
          </div>
        )}
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

/**
 * Строка разбора в подсказке: значок, имя, число. С дверью к источнику — кнопка 44 со стрелкой: сначала закрывает
 * подсказку, потом ведёт (как ссылка внизу). Пока поверх стоит окно, ждущее ответа, двери нет — как и у ссылки.
 */
function TipLine({ row, go, sum = false, hide }: { row: TipRow; go?: () => void; sum?: boolean; hide: () => void }) {
  const cls = `nx-tip-row${sum ? ' sum' : ''}${row.tone ? ` ${row.tone}` : ''}`;
  const inner = (
    <>
      {row.icon && <Icon name={row.icon.name} glyph={row.icon.glyph} />}
      <span>{row.label}</span>
      <b>{row.value}</b>
    </>
  );
  if (!go) return <div className={cls}>{inner}</div>;
  return (
    <button
      className={`${cls} go`}
      onClick={(e) => {
        e.stopPropagation();
        hide();
        go();
      }}
    >
      {inner}
      <i aria-hidden="true">›</i>
    </button>
  );
}
