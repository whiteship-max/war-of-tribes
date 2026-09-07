import { useSyncExternalStore } from 'react';
import { isDrawn, onSheet, sheetReady, symbolOf } from './sheet';

interface Props {
  /** Имя файла значка без расширения: `bld-smithy`, `res-wood`. */
  name: string;
  /** Эмодзи, который стоит здесь сейчас. Он же и остаётся, пока значка нет. */
  glyph: string;
  className?: string;
  title?: string;
}

/**
 * Единственное место в игре, где решается, показать нарисованный значок или эмодзи.
 *
 * Значков меньше, чем эмодзи, и так будет ещё две очереди. Правило поэтому одно:
 * **есть картинка — показываем картинку, нет — остаётся эмодзи**. Проверок «а нарисован
 * ли уже вот этот» по компонентам быть не должно: их пришлось бы вычищать по одной,
 * когда набор дорисуют, и одну обязательно забыли бы.
 *
 * Размер не задаётся: значок ровно в строку текста (`1em`), как и эмодзи на его месте.
 * Поэтому подстановка ничего не двигает в вёрстке — и старые правила стиля, которые
 * меряют эти места кеглем (`.ic`, `.cost`, `.nav`), продолжают работать как были.
 *
 * Цвет свой: значок многоцветный, палитра запечена в файл, `currentColor` ему не нужен.
 */
export function Icon({ name, glyph, className, title }: Props) {
  const ready = useSyncExternalStore(onSheet, sheetReady, () => false);
  if (!ready || !isDrawn(name)) {
    return (
      <span className={className} title={title}>
        {glyph}
      </span>
    );
  }
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      width="1em"
      height="1em"
      style={{ verticalAlign: '-0.15em' }}
      role="img"
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <use href={symbolOf(name)} />
    </svg>
  );
}
