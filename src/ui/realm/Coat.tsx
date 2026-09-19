// Герб державы — вход в меню управления, слева сверху, как в Europa Universalis IV.
//
// Встал на место круглого лица вождя: карточки профиля в шапке больше нет, её
// содержимое (имя, город, лицо, мощь, счёт битв, синхронизация и настройки)
// переехало в меню державы, за шестерёнку.
//
// Рисунок свой и простой: щит, поле цвета нашей стороны, чёрная башня. Цвет не
// заведён заново — это знамя наших отрядов на карте (`PARTY_OWN`): игрок уже
// знает его как «своё». Никаких настоящих гербов и чужих эмблем.
import { PARTY_OWN } from '@/ui/map/palette';
import { useRealm } from './open';

const P = PARTY_OWN;

/** Щит с башней. Отдельно от кнопки: тот же рисунок стоит и в шапке меню. */
export function CoatArt({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path
        d="M6 5 H34 V19 C34 28 27 33 20 36 C13 33 6 28 6 19 Z"
        fill={P.cloth}
        stroke={P.clothDark}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* Башня: три зубца, тело и дверь просветом поля. */}
      <path
        d="M13 11 H16 V13.5 H18.5 V11 H21.5 V13.5 H24 V11 H27 V17 H25.5 V28 H14.5 V17 H13 Z"
        fill={P.line}
      />
      <path d="M18 28 V23.5 C18 22 22 22 22 23.5 V28 Z" fill={P.cloth} />
    </svg>
  );
}

export function CoatButton() {
  const open = useRealm((r) => r.open);
  const show = useRealm((r) => r.show);
  return (
    <button
      className={`coat-btn${open ? ' active' : ''}`}
      onClick={() => show()}
      title="Держава: правительство, стройка, вера, армия и настройки"
      aria-label="Держава"
    >
      <CoatArt size={36} />
    </button>
  );
}
