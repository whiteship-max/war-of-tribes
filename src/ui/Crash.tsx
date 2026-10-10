import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useGame } from '@/game/store';

/**
 * Сбой интерфейса — словами и кнопкой, а не пустым экраном (docs/bughunt.md, «Пустой экран после сбоя окна»).
 *
 * Без ловушки исключение при рисовании любого окна снимает в React 18 всё дерево разом: город, строка, кнопки и даже
 * «Сообщить об ошибке» пропадают, а партия под этим живёт дальше (шаг и автосохранение — в сторе, не в дереве). Игрок
 * видит пустоту и закрывает игру. Чаще всего так выглядит не ошибка кода, а выкладка посреди игры: куски окон, которые
 * едут по нажатию (`lazy` в `App`), лежат под именами с хешем, новая сборка их убирает, и сервер на старое имя отдаёт
 * страницу вместо скрипта — первый же герб державы после выкладки гасил экран.
 *
 * Ловушка стоит над всем приложением (`main.tsx`) и отдельно над каждым окном, что едет по нажатию (`App`): сбой окна
 * закрывает только окно, город остаётся.
 */

/** Не доехал кусок сборки: после выкладки старого имени больше нет — лечит только перезапуск. */
export function chunkLost(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Unable to preload|module script/i.test(
    text,
  );
}

/** Слова экрана сбоя: заголовок и объяснение. Чистая функция — её держит тест. */
export function crashWords(error: unknown): { title: string; why: string } {
  if (chunkLost(error))
    return {
      title: 'Игра обновилась',
      why: 'Вышла новая версия, и это окно осталось от прежней. Перезапусти игру — город и запасы на месте.',
    };
  return {
    title: 'Окно не открылось',
    why: 'Здесь сломалось что-то в самой игре. Город и запасы на месте: перезапусти игру, а если повторится — отправь запись мастерам.',
  };
}

/** Строка записи для мастеров: имя и текст ошибки и начало стека — без данных игрока. */
export function crashNote(error: unknown, where: string): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const stack = (e.stack ?? '').split('\n').slice(0, 6).join('\n');
  return `Сбой окна «${where}»: ${e.name}: ${e.message}\n${stack}`.slice(0, 1500);
}

/** Перезапуск с записью партии на диск: шаг идёт и без окна, и последние секунды не должны пропасть. */
export function restartGame(): void {
  try {
    useGame.getState().save();
  } catch {
    /* записать не вышло — перезапуск всё равно поднимет последнее автосохранение */
  }
  location.reload();
}

interface CrashProps {
  children: ReactNode;
  /** Где стоит ловушка — для записи мастерам. */
  where: string;
  /** Закрыть окно, в котором случился сбой. Нет — ловушка над всей игрой, закрывать нечего. */
  onClose?: () => void;
  /** Сбой рисуется на месте окна внутри шторки, а не поверх всего экрана. */
  inline?: boolean;
}

interface CrashState {
  error: unknown;
  sent: 'idle' | 'sending' | 'sent' | 'failed';
}

export class Crash extends Component<CrashProps, CrashState> {
  state: CrashState = { error: null, sent: 'idle' };

  static getDerivedStateFromError(error: unknown): Partial<CrashState> {
    return { error: error ?? new Error('неизвестный сбой') };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[сбой окна ${this.props.where}]`, error, info.componentStack);
  }

  /**
   * Закрыть окно. Сбой не сбрасывается: окно уезжает и разбирается вместе с ловушкой, а сброшенная ловушка успела бы
   * нарисовать сломанное окно ещё раз, пока оно уезжает.
   */
  private close = (): void => {
    this.props.onClose?.();
  };

  private send = async (): Promise<void> => {
    if (this.state.sent === 'sending' || this.state.sent === 'sent') return;
    this.setState({ sent: 'sending' });
    try {
      // Своим куском, как окно «Сообщить об ошибке»: экран сбоя в первой загрузке не тянет за собой отправку.
      const { reportOf, sendReport } = await import('@/net/report');
      const res = await sendReport(reportOf(crashNote(this.state.error, this.props.where), `сбой: ${this.props.where}`, useGame.getState().s));
      this.setState({ sent: res.ok ? 'sent' : 'failed' });
    } catch {
      this.setState({ sent: 'failed' });
    }
  };

  render(): ReactNode {
    const { error, sent } = this.state;
    if (error === null) return this.props.children;
    const { title, why } = crashWords(error);
    const lost = chunkLost(error);
    return (
      <div className={this.props.inline ? 'crash crash-inline' : 'crash'} role="alert">
        <div className="trouble-box">
          <div className="trouble-title">{title}</div>
          <div className="trouble-why">{why}</div>
          <button className="btn wide" onClick={restartGame}>
            Перезапустить игру
          </button>
          {!lost && (
            <button className="btn ghost wide" disabled={sent === 'sending' || sent === 'sent'} onClick={() => void this.send()}>
              {sent === 'sent' ? 'Запись ушла' : sent === 'sending' ? 'Отправляю…' : 'Отправить запись мастерам'}
            </button>
          )}
          {sent === 'failed' && <div className="trouble-hint">Запись не ушла. Перезапусти игру и напиши через 🐞.</div>}
          {this.props.onClose && (
            <button className="btn ghost wide" onClick={this.close}>
              Закрыть окно
            </button>
          )}
        </div>
      </div>
    );
  }
}
