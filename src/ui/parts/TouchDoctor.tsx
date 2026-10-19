import { useEffect, useState } from 'react';
import { gestLog, type Touch } from '@/gestlog';
import { TAP_MOVE, TAP_MS, TAP_SLIP, TAP_TARGET } from '@/gestures';
import { BUILDINGS } from '@/game/data/buildings';
import { copyText, tgAbout } from '@/telegram/webapp';
import { useGame } from '@/game/store';
import { Icon } from '@/ui/icons/Icon';
import { sinceMark } from './wait';

/**
 * Что было под пальцем — прибор, читаемый с телефона.
 *
 * Заведён по жалобе «тап по зданию срабатывает иногда, непредсказуемо». Она из
 * тех, которые нельзя разобрать ни глазами, ни стендом: отладчик к телефону в
 * Телеграме не подключить, а синтетическое событие на стенде отличается от
 * живого пальца ровно тем, из-за чего тап и терялся. Значит, спрашивать надо
 * само устройство — «Задания» → «Служебное» → «Что было под пальцем».
 *
 * Прибор ничего не чинит и ничего не решает: он показывает, что видел. Причину
 * он не называет — не понял, что было, так и пишет. Сломанный прибор хуже
 * отсутствующего: назвав причину наугад, он увёл бы следующую починку в сторону.
 *
 * Журнал общий у деревни и у карты нарочно. Жалоба звучала как «на карте
 * работает, а в деревне нет», и сравнить их можно только в одном списке.
 */
export function TouchDoctor() {
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  const [copied, setCopied] = useState(false);
  const showToast = useGame((g) => g.showToast);

  // Журнал пополняется мимо React: касания приходят на холст, а не в стор.
  useEffect(() => {
    if (!open) return;
    return gestLog.subscribe(() => bump((n) => n + 1));
  }, [open]);

  if (!open) {
    return (
      <button className="btn ghost wide" onClick={() => setOpen(true)}>
        <Icon name="ui-eye" /> Что было под пальцем
      </button>
    );
  }

  const touches = gestLog.list();

  return (
    <div className="doctor doctor-touch">
      {gestLog.summary().map((s, i) => (
        <div className="doctor-verdict" key={i}>
          {s}
        </div>
      ))}
      <div className="doctor-facts">
        <span>Telegram: {tgAbout()}</span>
        <span>
          пороги: камера с {TAP_MOVE} px, тап живёт до {TAP_SLIP} px и {TAP_MS} мс, цель {TAP_TARGET} px
        </span>
        <span>«картинка» — на сколько уехал вид за время касания</span>
      </div>

      <div className="doctor-log">
        {touches.length === 0 && (
          <div className="desc">Пусто. Потрогай город и карту, потом вернись сюда.</div>
        )}
        {touches.map((t, i) => (
          <div key={i} className="doctor-line">
            <b>{t.end}</b>
            <span>{facts(t)}</span>
            <i>{when(t, touches)}</i>
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
            gestLog.clear();
            setCopied(false);
          }}
        >
          Очистить
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)}>
          Свернуть
        </button>
      </div>
    </div>
  );

  async function copy(): Promise<void> {
    const ok = await copyText(gestLog.report({ Telegram: tgAbout() }));
    setCopied(ok);
    showToast(ok ? 'Журнал скопирован.' : 'Не вышло. Перепиши с экрана.');
  }
}

/** Название постройки; неизвестное имя показывается как есть, а не прячется. */
function nameOf(hit: string): string {
  return BUILDINGS.find((b) => b.id === hit)?.name ?? hit;
}

/** Одна строка фактов о касании. Ни одного вывода — только измеренное. */
function facts(t: Touch): string {
  const parts = [
    t.where,
    `${t.fingers} пал.`,
    `${Math.round(t.ms)} мс`,
    `сход ${Math.round(t.far)}`,
    `путь ${Math.round(t.path)}`,
    `картинка ${t.drift === null ? 'не знаю' : Math.round(t.drift)}`,
  ];
  if (t.hit) parts.push(`→ ${t.where === 'деревня' ? nameOf(t.hit) : t.hit}`);
  return parts.join(' · ');
}

/** Сколько прошло от первой записи: абсолютное время на телефоне ничего не скажет. */
function when(t: Touch, all: readonly Touch[]): string {
  const t0 = all[0]?.at ?? t.at;
  return sinceMark(t.at - t0);
}
