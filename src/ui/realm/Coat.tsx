// Герб державы — вход в меню управления, слева сверху, как в Europa Universalis IV.
//
// Встал на место круглого лица вождя: карточки профиля в шапке больше нет, её
// содержимое (имя, город, лицо, мощь, счёт битв, синхронизация и настройки)
// переехало в меню державы, за шестерёнку.
//
// Рисунок — герб державы, который игрок собрал в профиле (`parts/ArmsMaker`, docs/polish.md, П-2); не собирал — прежний:
// золотое поле, чёрная башня (`heraldry/arms.DEFAULT_ARMS`). Тот же герб стоит на знамёнах города, на карте и в роликах.
import { useGame } from '@/game/store';
import { profileArms } from '@/profile/identity';
import { ArmsArt } from '@/ui/parts/Arms';
import { Icon } from '@/ui/icons/Icon';
import { useWorld } from '@/world/store';
import { coatView, useRealm } from './open';
import { mailKeys, unreadCount, useSeen, rivalKeys } from './unread';

/** Герб державы высотой `size`. Отдельно от кнопки: тот же рисунок стоит и в шапке меню. */
export function CoatArt({ size }: { size: number }) {
  const arms = useGame((g) => g.s.profile.arms);
  return <ArmsArt arms={profileArms({ arms })} size={size / 1.2} />;
}

/**
 * `quiet` — новый интерфейс: счётчик вестей там стоит на «Вестях» внизу, куда и ведёт (docs/ui_audit.md,
 * 3.9: нажатие по кнопке со счётчиком ведёт к тому, что он считает), а герб открывает державу.
 */
export function CoatButton({ quiet = false }: { quiet?: boolean } = {}) {
  const open = useRealm((r) => r.open);
  const show = useRealm((r) => r.show);
  // Счётчик почты: сколько ждущего ответа ещё не открывали. Нажатие ведёт туда
  // же, куда всегда, — в последний открытый раздел: счётчик зовёт, а не уводит,
  // и то же число стоит на вкладке «Решения».
  const inbox = useGame((g) => g.s.inbox);
  const letters = useWorld((w) => w.letters);
  const rivals = useWorld((w) => w.rivals);
  const seen = useSeen((u) => u.seen);
  const unread = unreadCount(
    mailKeys(
      inbox,
      letters.map((l) => l.id),
      rivalKeys(rivals, true),
    ),
    seen,
  );
  return (
    <button
      className={`coat-btn${open ? ' active' : ''}`}
      data-tut="coat"
      onClick={() => show(coatView(useGame.getState().s, quiet, useRealm.getState().view))}
      aria-label={unread > 0 && !quiet ? `Держава, новых вестей: ${unread}` : 'Держава'}
    >
      <CoatArt size={36} />
      {unread > 0 && !quiet && <span className="coat-badge">{unread}</span>}
    </button>
  );
}

/**
 * Вход в профиль игрока — значок справа под строкой запасов, зеркально плашке алмазов слева (ЗН-3, docs/ui_v2.md, 5.10;
 * слово владельца). На нём фигурка человека, а не герб (ЗН-4, 5.11): герб — держава, слева сверху, и второй герб справа был
 * её дублем. Касание открывает окно «Профиль» — только профиль, без вкладок державы. Цель касания — 44 (действие, 2.5),
 * видимая плашка — 32, как у алмазов: лишние 12 px цели уходят вниз, в город, а не вверх, в ячейки запасов.
 */
export function ProfileBadge() {
  const show = useRealm((r) => r.show);
  return (
    <button className="nx-me" onClick={() => show('settings')} aria-label="Профиль">
      <span className="nx-me-face">
        <Icon name="ui-person" />
      </span>
    </button>
  );
}
