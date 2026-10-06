// Окно «Сообщить об ошибке» (docs/admin.md). Игрок пишет только текст; версия игры, устройство и размер экрана,
// открытый экран, что было со сценой и последние строки летописи прикладываются сами (`net/report.reportOf`) — и
// окно говорит об этом прямо, чтобы игрок знал, что уходит кроме его слов. Снимка экрана пока нет: появится по желанию
// игрока, место под него оставлено в договоре.
//
// Едет своим куском (`lazy` в `App`): открыто ли окно, знает крошечный `bugOpen.ts`, на который смотрят кнопки.
import { useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import { useRealm } from '@/ui/realm/open';
import { REPORT_LIMITS } from '../../../netlify/lib/contract';
import { reportOf, sendReport } from '@/net/report';
import { useBugReport } from './bugOpen';

/** Что открыто сейчас — словами: город, карта, меню державы с разделом, панель здания. */
function viewNow(): string {
  const g = useGame.getState();
  const r = useRealm.getState();
  if (r.open) return `меню державы: ${r.view}`;
  if (g.mapOpen) return 'карта';
  if (g.sheet !== null) return `панель: ${JSON.stringify(g.sheet).slice(0, 80)}`;
  return 'город';
}

export function BugReport() {
  const hide = useBugReport((b) => b.hide);
  // Экран — тот, с которого окно открыли: снимается один раз, при открытии.
  const view = useMemo(viewNow, []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await sendReport(reportOf(text.trim(), view, useGame.getState().s ?? null));
    setBusy(false);
    if (res.ok) setDone(res.id);
    else setError(res.why);
  };

  return (
    <div className="modal-backdrop over-all" onClick={hide}>
      <div className="modal bug-report" onClick={(e) => e.stopPropagation()}>
        <div className="m-ico">🐞</div>
        <h2>Сообщить об ошибке</h2>
        {done ? (
          <>
            <p>Отправлено, номер {done}. Спасибо — посмотрим.</p>
            <div className="options">
              <button className="btn" onClick={hide}>
                Закрыть
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Что случилось? Опиши, что делал и что пошло не так.</p>
            <textarea
              className="bug-text"
              value={text}
              maxLength={REPORT_LIMITS.text}
              rows={6}
              autoFocus
              placeholder="Например: свернул игру, вернулся — вместо города чёрный экран."
              onChange={(e) => setText(e.target.value)}
            />
            <small className="muted bug-count">
              {text.length}/{REPORT_LIMITS.text}
            </small>
            <small className="muted bug-note">
              Вместе с текстом уйдут версия игры, устройство и размер экрана, открытый экран, что было со сценой и последние
              события партии. Больше ничего.
            </small>
            {error && <p className="bug-error">{error}</p>}
            <div className="options">
              <button className="btn" disabled={!text.trim() || busy} onClick={() => void send()}>
                {busy ? 'Отправляю…' : 'Отправить'}
              </button>
              <button className="btn ghost" onClick={hide}>
                Закрыть
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
