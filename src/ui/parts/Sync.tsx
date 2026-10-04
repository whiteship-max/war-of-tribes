// Синхронизация глазами игрока.
//
// Два кусочка, и оба про одно правило: **неудача синхронизации не имеет права
// быть незаметной, и не имеет права мешать играть.** Поэтому здесь нет ни
// модалки на потерю связи, ни блокировки, ни бесконечного колёсика — строка
// состояния в профиле и возврат отвергнутой партии в служебном разделе.
//
// Слова берутся у самого слоя синхронизации (`why`): вторая копия объяснений в
// разметке разошлась бы с первой ровно тогда, когда поведение поменяют.
import { useSync } from '@/net/sync';

const at = (ms: number | null): string =>
  ms ? new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';

/** Строка «где лежит мой прогресс». Живёт в профиле: это про учётную запись. */
export function SyncStatus() {
  const state = useSync((g) => g.state);
  const why = useSync((g) => g.why);
  const lastOk = useSync((g) => g.lastOk);

  const text =
    state === 'ok'
      ? `Сохранено в ${at(lastOk)}. Партия откроется в этом Telegram на любом устройстве.`
      : state === 'busy'
        ? 'Сохраняем…'
        : why;

  return (
    <div className={`sync-line ${state}`}>
      <i />
      <span>{text}</span>
    </div>
  );
}

/**
 * Отвергнутая партия. Показывается только когда она есть, и это единственное
 * место, где её можно вернуть.
 *
 * Ради неё расхождение и разбирается без вопросов: партии, выросшие врозь,
 * сводятся в пользу серверной молча — но проигравшая копия остаётся здесь
 * целиком, и вернуть её можно одной кнопкой. Уберёшь кнопку — «молча» станет
 * «навсегда», и правило «прогресс не пропадает» перестанет быть правдой.
 */
export function SpareSave() {
  const spare = useSync((g) => g.spare);
  const restore = useSync((g) => g.restoreSpare);
  const forget = useSync((g) => g.forgetSpare);
  if (!spare) return null;
  return (
    <div className="spare">
      <b>Отложенная партия</b>
      <small>
        День {spare.card.day}, жителей {spare.card.pop}, мощь {spare.card.power}. Отложена{' '}
        {new Date(spare.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.
      </small>
      <div className="row">
        <button
          className="btn ghost"
          onClick={() => {
            if (confirm('Вернуть отложенную партию? Нынешняя заменится, игра перезапустится.')) restore();
          }}
        >
          Вернуть
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            if (confirm('Забыть отложенную партию? Вернуть её будет нельзя.')) forget();
          }}
        >
          Забыть
        </button>
      </div>
    </div>
  );
}
