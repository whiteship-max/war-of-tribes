import { modalUp, placeTip, useTip } from './tip';

/**
 * Слой подсказки: один на игру. Пока плашка открыта, под ней лежит прозрачный ловец во весь экран —
 * следующее касание где угодно закрывает плашку и до игры не доходит (3.7: «это касание ничего больше не
 * делает»). Касание по самой плашке тоже закрывает её; ссылка внизу сначала закрывает, потом ведёт.
 */
export function TipLayer() {
  const open = useTip((t) => t.open);
  const hide = useTip((t) => t.hide);
  if (!open) return null;
  const place = placeTip(open.at, { w: window.innerWidth, h: window.innerHeight });
  const link = open.link && !modalUp() ? open.link : null;
  const swallow = (e: { preventDefault(): void; stopPropagation(): void }): void => {
    e.preventDefault();
    e.stopPropagation();
    hide();
  };
  return (
    <>
      <div className="nx-tip-catch" onPointerDown={swallow} onClick={swallow} />
      <div
        className={`nx-tip${place.below ? ' below' : ' above'}`}
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
        <b>{open.title}</b>
        {open.body && <p>{open.body}</p>}
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
