import { useState, type FormEvent } from 'react';
import { CHEATS_ON, CHEAT_MARK, CHEAT_MARK_GLADE, cheatsOf, type CheatWhere } from '@/cheats';
import { tgInitData } from '@/telegram/webapp';

/**
 * Кнопка кодов: одна разметка на деревню и на поляну.
 *
 * ОДИН КОМПОНЕНТ НА ДВА МЕСТА ПОКАЗА — тем же правилом, каким живут настройки
 * (`parts/Settings.tsx`) и цена (`parts/Cost.tsx`): две панели с одними строками
 * расходятся ровно тогда, когда правят одну из них. Отличается у режимов только
 * место на экране (класс) и то, что код делает с состоянием, — а состояние сюда
 * не приходит вовсе: наружу торчит одна функция `onApply`.
 *
 * ПОЭТОМУ ЖЕ ОН НИЧЕГО НЕ ЗНАЕТ НИ ПРО `useGame`, НИ ПРО СЦЕНУ. Предыстория
 * берёт его как есть, и связи с партией от этого не заводится: он про поле ввода
 * и кнопку, а не про игру. Едет он при этом в общем чанке — его импортирует и
 * `App`, — то есть чанк режима от него не растёт.
 *
 * КНОПКА НЕ СКРЫВАЕТСЯ И НЕ ПРИТВОРЯЕТСЯ. Код виден в бандле любому, и делать
 * вид, что его надо «найти», незачем: панель прямо говорит, что это инструмент
 * проверки, и перечисляет все коды режима. Прячут их не здесь, а одним
 * `CHEATS_ON` в `src/cheats.ts` — тогда этого компонента нет в разметке вовсе.
 */
export function CheatPanel({
  where,
  marked,
  onApply,
}: {
  where: CheatWhere;
  /** Партия (или поляна) уже помечена: строка стоит в самой панели. */
  marked: boolean;
  /** Применить набранное. Возвращает строку ответа — её и показываем. */
  onApply: (code: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [said, setSaid] = useState('');
  if (!CHEATS_ON) return null;
  // В Telegram коды `offTelegram` не показываются — та же проверка, что у узнавания (`game/store.cheat`).
  const list = cheatsOf(where, tgInitData() !== null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    // Клавиатуру убираем до ответа: на iOS она закрывает ровно ту строку, ради
    // которой код и набирали.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setSaid(onApply(draft));
    setDraft('');
  };

  return (
    <div className={`cheat cheat-${where}`}>
      {open && (
        <form className="cheat-card" onSubmit={submit}>
          <b>Коды</b>
          <span className="cheat-note">
            Инструмент проверки, а не секрет: код лежит в бандле и виден любому.
          </span>
          <input
            type="text"
            value={draft}
            placeholder="код"
            maxLength={24}
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn wide">
            Применить
          </button>
          {said !== '' && <span className="cheat-said">{said}</span>}
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <b>{c.code}</b>
                <span>{c.what}</span>
              </li>
            ))}
          </ul>
          {/* Метка партии — здесь же, а не только в летописи: панель открывают
              как раз затем, чтобы понять, трогали ли эту партию кодами. */}
          {marked && <span className="cheat-mark">{where === 'village' ? CHEAT_MARK : CHEAT_MARK_GLADE}</span>}
        </form>
      )}
      <button
        className={`cheat-btn${open ? ' open' : ''}${marked ? ' marked' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label="Коды"
        aria-expanded={open}
      >
        {open ? '✕' : '⌘'}
      </button>
    </div>
  );
}
