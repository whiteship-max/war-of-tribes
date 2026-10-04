import { sceneLog, VERDICT_TEXT, type Verdict } from '@/scenelog';
import { copyText, tgAbout } from '@/telegram/webapp';

/**
 * Экран на месте пропавшей диорамы.
 *
 * Правило простое: **молча чёрного прямоугольника быть не должно.** Игрок,
 * увидевший вместо деревни черноту, обязан прочитать, что случилось, и нажать
 * одну кнопку. Иначе единственный выход — закрыть и открыть мини-аппку заново,
 * а это и есть та жалоба, из-за которой всё затевалось.
 *
 * Появляется он редко и по делу: только когда сцену не удалось поднять самой —
 * контекст не вернулся, пересборка не помогла, кадры не пошли. Пока сцена
 * чинится сама, показывать тут нечего, и экран не показывается.
 *
 * Слова берутся у прибора (`scenelog`), а не пишутся здесь: приговор один на
 * игру, и вторая его формулировка разошлась бы с первой при первой же правке.
 * Если причина не определилась, здесь так и написано — «не знаю».
 */
export function SceneTrouble({ verdict, onRetry }: { verdict: Verdict; onRetry: () => void }) {
  return (
    <div className="trouble">
      <div className="trouble-box">
        <div className="trouble-title">Город не рисуется</div>
        <div className="trouble-why">{VERDICT_TEXT[verdict]}</div>
        <button className="btn wide" onClick={onRetry}>
          Восстановить
        </button>
        <div className="trouble-hint">Если не помогло, скопируй отчёт.</div>
        <button className="btn ghost wide" onClick={() => void copy()}>
          Скопировать отчёт
        </button>
      </div>
    </div>
  );

  // Импорт статический нарочно: `await import(...)` теряет пользовательский
  // жест, а без жеста буфер обмена не откроется — та же ловушка, что у звука.
  async function copy(): Promise<void> {
    await copyText(sceneLog.report({ Telegram: tgAbout() }));
  }
}
