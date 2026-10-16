// Свои шрифты на холсте (docs/polish.md, П-1): подписи карты, сроки походов, знаки участи. Те же гарнитуры, что у
// интерфейса (`fonts.css`), — CSS-переменные холст не читает, поэтому имена здесь строкой, а сверяет их с `styles.css`
// тест `fonts.test.ts`.
//
// Холст шрифт не ждёт: пока файл не доехал, строка рисуется подменой, и испечённая подпись так и осталась бы
// системной. Поэтому каждый кэш испечённого текста подписывается на приход шрифта (`onFontsLoaded`) и печёт заново.

/** Основной текст на холсте: сроки, числа, координаты. */
export const CANVAS_SANS = "'Tribe Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** Имена мест и знаки участи — гарнитурой заголовков. */
export const CANVAS_TITLE = "'Tribe Title', Georgia, 'Times New Roman', serif";

/** Звать `drop`, когда доехал любой свой шрифт: испечённый подменой текст устарел. Вне браузера — ничего. */
export function onFontsLoaded(drop: () => void): void {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  fonts?.addEventListener?.('loadingdone', () => drop());
}
