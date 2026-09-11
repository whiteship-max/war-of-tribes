/**
 * Значки предыстории: полосы и вещи — рисунком, а не эмодзи.
 *
 * ПОЧЕМУ НЕ ЭМОДЗИ. У половины вещей режима своего эмодзи нет или оно рисуется
 * пустым квадратом: полено (🪵) — Emoji 13.0, топор (🪓) — 12.0, у шкуры эмодзи
 * нет вовсе. Окно, где у одних вещей картинка, у других квадрат, а у третьих слово,
 * читается сломанным. Поэтому значки одного рисунка на всё: одноцветные, цвет
 * берут у текста (`currentColor`) — значит полоса и строка красят их сами.
 *
 * Весят они строками разметки, а не картинками: ни одного файла, ни одной загрузки,
 * и едут чанком режима. Эмодзи остались там, где рисуются везде, — в строке о небе.
 */
import type { ReactNode } from 'react';

const Svg = ({ children, evenodd = false }: { children: ReactNode; evenodd?: boolean }) => (
  <svg
    className="pro-ico"
    viewBox="0 0 24 24"
    fill="currentColor"
    fillRule={evenodd ? 'evenodd' : undefined}
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

/** Здоровье. */
export const IconHeart = () => (
  <Svg>
    <path d="M12 20.6C12 20.6 3.2 15.2 3.2 9.4c0-2.9 2.2-5.1 4.8-5.1 1.7 0 3.2.9 4 2.3.8-1.4 2.3-2.3 4-2.3 2.6 0 4.8 2.2 4.8 5.1 0 5.8-8.8 11.2-8.8 11.2z" />
  </Svg>
);

/** Тепло: снежинка — то, что его отнимает. */
export const IconFrost = () => (
  <Svg>
    <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.8v18.4M4 7.4l16 9.2M4 16.6l16-9.2" />
      <path d="M9.4 3.9 12 6.5l2.6-2.6M9.4 20.1 12 17.5l2.6 2.6M18.5 18.7l-.9-3.4 3.4-.9M5.5 5.3l.9 3.4-3.4.9M21 9.7l-3.4-1 .9-3.4M3 14.3l3.4 1-.9 3.4" />
    </g>
  </Svg>
);

/** Сытость и жареное мясо: окорок на кости. */
export const IconMeat = () => (
  <Svg>
    <ellipse cx="15" cy="9" rx="6.2" ry="5" transform="rotate(-45 15 9)" />
    <path d="M10.6 12l1.4 1.4-5.6 5.6L5 17.6z" />
    <circle cx="6.3" cy="19.7" r="1.6" />
    <circle cx="4.3" cy="17.7" r="1.6" />
  </Svg>
);

/** Сырое мясо: кусок с костью. */
export const IconRaw = () => (
  <Svg evenodd>
    <path d="M6.5 6.2c2.6-2.6 7.7-3.3 11-1 3.6 2.5 4.2 7.6 1.6 11.2-2.6 3.6-8 5.3-12 3.4-3.7-1.8-4.9-6.6-3.2-10.2.5-1.3 1.4-2.5 2.6-3.4zM11 9.6a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0z" />
  </Svg>
);

/** Топор. */
export const IconAxe = () => (
  <Svg>
    <path d="M3 19.6l1.4 1.4 13-13-1.4-1.4z" />
    <path d="M13.2 11.2 16.6 7.8C16 5 13.8 3 10.8 2.6c1 2 .4 4.4-1.2 5.8 1.4.4 2.8 1.4 3.6 2.8z" />
  </Svg>
);

/** Лук. */
export const IconBow = () => (
  <Svg>
    <g fill="none" stroke="currentColor" strokeLinecap="round">
      <path d="M5 3.5c8.5 1.7 13.8 7 15.5 15.5" strokeWidth={2.4} />
      <path d="M5 3.5 20.5 19" strokeWidth={1.1} />
    </g>
  </Svg>
);

/** Стрелы. */
export const IconArrows = () => (
  <Svg>
    <path d="M5 19 17.2 6.8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    <path d="M13.8 5.4 20 4l-1.4 6.2z" />
    <path d="M5 19l-.4-4 1.9 1.9zM5 19l4 .4-1.9-1.9z" />
  </Svg>
);

/** Дрова: два полена торцом. */
export const IconLogs = () => (
  <Svg>
    <rect x="2.5" y="12.5" width="19" height="6.5" rx="3.25" />
    <rect x="5" y="5.5" width="14" height="6.5" rx="3.25" />
    <g fill="none" stroke="#000" strokeOpacity={0.38} strokeWidth={1.2}>
      <circle cx="18.2" cy="15.75" r="1.6" />
      <circle cx="15.8" cy="8.75" r="1.6" />
    </g>
  </Svg>
);

/** Шкура. */
export const IconHide = () => (
  <Svg>
    <path d="M12 2.8c1.2 1.3 2.7 1.7 4.3 1.2.2 1.6-.4 2.9-1.4 3.8 1.3 1 2.9 1.2 4.6.8-.2 2-1.5 3.2-3.2 3.7 1 1.5 1.3 3.3.9 5.3-1.6-.6-3.1-.5-4.2.4-.1 1.7-.4 3-1 4.2-.6-1.2-.9-2.5-1-4.2-1.1-.9-2.6-1-4.2-.4-.4-2-.1-3.8.9-5.3-1.7-.5-3-1.7-3.2-3.7 1.7.4 3.3.2 4.6-.8-1-.9-1.6-2.2-1.4-3.8 1.6.5 3.1.1 4.3-1.2z" />
  </Svg>
);

/** Одежда из шкуры. */
export const IconCoat = () => (
  <Svg>
    <path d="M8.3 3h2c.4 1.2 1 1.9 1.7 1.9s1.3-.7 1.7-1.9h2l5 3.4-2.2 3.9-1.8-1V21H7.3V9.3l-1.8 1-2.2-3.9z" />
  </Svg>
);

/** Вещи: заплечный мешок. */
export const IconPack = () => (
  <Svg evenodd>
    <path d="M8.5 7v-.8a3.5 3.5 0 0 1 7 0V7h2.4c.8 0 1.5.6 1.6 1.4l1 11c.1.9-.6 1.6-1.5 1.6H5c-.9 0-1.6-.7-1.5-1.6l1-11C4.6 7.6 5.3 7 6.1 7zm2 0h3v-.8a1.5 1.5 0 0 0-3 0z" />
  </Svg>
);
