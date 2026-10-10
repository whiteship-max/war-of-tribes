import { useEffect, useState } from 'react';
import { sceneLog, VERDICT_TEXT, type Note } from '@/scenelog';
import { copyText, tgAbout } from '@/telegram/webapp';
import { useGame } from '@/game/store';
import { Icon } from '@/ui/icons/Icon';
import { sinceMark } from './wait';

/**
 * Что было со сценой — прибор, читаемый с телефона.
 *
 * Заведён по жалобе «свернул аппку, развернул — чёрный экран на месте деревни».
 * Жалоба нестабильная, и без прибора любая правка выглядела бы помогшей.
 * Отладчик к телефону в Телеграме не подключить, поэтому журнал читается прямо
 * в игре: «Задания» → «Служебное» → «Что было со сценой».
 *
 * Прибор ничего не решает и ничего не чинит сам — он только показывает.
 * Единственное действие здесь одно и названо прямо: пересобрать сцену. Оно же
 * стоит на экране-заглушке, когда сцены нет.
 *
 * Приговор берётся у `scenelog.diagnose`, а не считается тут заново: второй
 * правды о том, что со сценой, быть не должно. И если причина не определилась,
 * прибор говорит «не знаю» — угадывать ему нечем.
 */
export function SceneDoctor() {
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  const [copied, setCopied] = useState(false);
  const showToast = useGame((g) => g.showToast);

  // Журнал пополняется помимо React: события браузера и Телеграма приходят
  // мимо стора. Пока раздел раскрыт, перерисовываемся по каждой записи.
  useEffect(() => {
    if (!open) return;
    return sceneLog.subscribe(() => bump((n) => n + 1));
  }, [open]);

  if (!open) {
    return (
      <button className="btn ghost wide" onClick={() => setOpen(true)}>
        <Icon name="ui-eye" glyph="🔎" /> Что было со сценой
      </button>
    );
  }

  const v = sceneLog.vitals();
  const verdict = sceneLog.verdict();
  const notes = sceneLog.list();

  return (
    <div className="doctor">
      <div className={`doctor-verdict v-${verdict}`}>{VERDICT_TEXT[verdict]}</div>
      <div className="doctor-facts">
        <span>Telegram: {tgAbout()}</span>
        {v ? (
          <>
            <span>
              холст {Math.round(v.css.w)}×{Math.round(v.css.h)}, буфер {Math.round(v.buffer.w)}×
              {Math.round(v.buffer.h)}
            </span>
            <span>
              кадров {v.frames}, последний {Math.round(v.now - v.lastFrame)} мс назад
            </span>
            <span>
              луп: {v.blocks.length ? v.blocks.join(', ') : 'идёт'} · контекст:{' '}
              {v.lost ? 'потерян' : 'жив'}
            </span>
          </>
        ) : (
          <span>сцена не подключена — показывать нечего</span>
        )}
      </div>

      <div className="doctor-log">
        {notes.length === 0 && <div className="desc">Журнал пуст.</div>}
        {notes.map((n, i) => (
          <div key={i} className="doctor-line">
            <b>{n.kind}</b>
            <span>{n.note ?? ''}</span>
            <i>{when(n, notes)}</i>
          </div>
        ))}
      </div>

      <div className="doctor-actions">
        <button className="btn ghost" onClick={copy}>
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            if (!sceneLog.revive()) showToast('Сцены нет.');
          }}
        >
          Пересобрать сцену
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)}>
          Свернуть
        </button>
      </div>
    </div>
  );

  async function copy(): Promise<void> {
    const ok = await copyText(sceneLog.report({ Telegram: tgAbout() }));
    setCopied(ok);
    showToast(ok ? 'Запись скопирована.' : 'Не вышло. Перепиши с экрана.');
  }
}

/** Сколько прошло от первой записи: абсолютное время на телефоне ничего не скажет. */
function when(n: Note, all: readonly Note[]): string {
  const t0 = all[0]?.at ?? n.at;
  return sinceMark(n.at - t0);
}
