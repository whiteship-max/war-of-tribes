import { Icon } from '@/ui/icons/Icon';
import { useCityBusy } from './Hints';
import { TIP_W, TIP_W_WIDE, modalUp, placeTip, tipRoom, useTip, type Rect, type TipContent, type TipMaker, type TipRow } from './tip';

/**
 * Слой подсказки: один на игру. Пока плашка числа открыта, под ней лежит прозрачный ловец во весь экран —
 * следующее касание где угодно закрывает плашку и до игры не доходит (3.7: «это касание ничего больше не
 * делает»). Касание по самой плашке тоже закрывает её; ссылка внизу сначала закрывает, потом ведёт.
 *
 * У каждой плашки — свой крестик в правом верхнем углу, касание 44 (Г-5, отзыв тестера): на телефоне не догадывались, что
 * плашку убирает касание мимо, и жали крестик окна под ней. Крестик плашки закрывает только её — касание до окна под ней
 * не доходит.
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
  const place = placeTip(tip.at, view, tip.makers?.length ? TIP_W_WIDE : TIP_W);
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
        <b className="nx-tip-title">{tip.title}</b>
        {tip.lore && <p className="nx-tip-lore">{tip.lore}</p>}
        {tip.body && <p>{tip.body}</p>}
        {((tip.rows && tip.rows.length > 0) || tip.more) && (
          <div className="nx-tip-rows">
            {tip.rows?.map((r, i) => (
              <TipLine key={i} row={r} go={modal ? undefined : r.go} hide={hide} />
            ))}
            {tip.rows && tip.rows.length > 0 && tip.sum && <TipLine row={tip.sum} sum hide={hide} />}
            {tip.more && (
              <>
                <b className="nx-tip-sub">{tip.more.title}</b>
                {tip.more.rows.map((r, i) => (
                  <TipLine key={`m${i}`} row={r} go={modal ? undefined : r.go} hide={hide} />
                ))}
                {tip.more.sum && <TipLine row={tip.more.sum} sum hide={hide} />}
              </>
            )}
          </div>
        )}
        {/* Главные кнопки — постройки, которые делают число; под окном с вопросом их нет, как и двери окна. */}
        {tip.makers && tip.makers.length > 0 && !modal && (
          <div className={`nx-tip-makers${tip.makers.length === 1 ? ' one' : ''}`}>
            {tip.makers.map((m) => (
              <TipMakerButton key={m.label} maker={m} hide={hide} />
            ))}
          </div>
        )}
        <button
          type="button"
          className="nx-tip-x"
          aria-label="Закрыть подсказку"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            hide();
          }}
        >
          <Icon name="ui-close" glyph="✕" />
        </button>
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

/**
 * Главная кнопка подсказки — постройка, которая делает число: значок и имя, 44. Постройки нет в городе — та же кнопка
 * с подписью «построить» ведёт в «Стройку» ратуши. Сначала закрывает подсказку, потом ведёт — как дверь окна.
 */
function TipMakerButton({ maker, hide }: { maker: TipMaker; hide: () => void }) {
  return (
    <button
      className={`nx-tip-maker${maker.build ? ' build' : ''}`}
      aria-label={maker.build ? `Построить: ${maker.label}` : maker.label}
      onClick={(e) => {
        e.stopPropagation();
        hide();
        maker.go();
      }}
    >
      <Icon name={maker.icon.name} glyph={maker.icon.glyph} />
      <span>
        {maker.label}
        {maker.build && <small>построить</small>}
      </span>
    </button>
  );
}
