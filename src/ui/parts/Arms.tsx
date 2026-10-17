// Герб SVG: держава в шапке, профиль и конструктор, карточка соседа, рейтинг (docs/polish.md, П-2).
//
// Слои — `heraldry/art.armsLayers`, те же, что у холста (`heraldry/paint.ts`): рисунок герба один на интерфейс, город,
// карту и ролики.
import './arms.css';
import { useId } from 'react';
import type { Arms } from '@/heraldry/arms';
import { INK, RIM, SHIELD_PATH, armsLayers } from '@/heraldry/art';

/** Ширина `size`, высота — 1.2 ширины (щит 100 × 120 с полями под обвод). */
export function ArmsArt({ arms, size, label }: { arms: Arms; size: number; label?: string }) {
  // Номер для обрезки и блика: у `useId` двоеточия, а в `url(#…)` они ломают ссылку.
  const id = `arms${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const shield = SHIELD_PATH[arms.shield];
  return (
    <svg
      width={size}
      height={size * 1.2}
      viewBox="-2 -2 104 124"
      className="arms-art"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <clipPath id={`${id}c`}>
          <path d={shield} />
        </clipPath>
        <radialGradient id={`${id}g`} gradientUnits="userSpaceOnUse" cx="30" cy="26" r="114">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        {armsLayers(arms).map((l, i) => (
          <path
            key={i}
            d={l.d}
            transform={l.m ? `matrix(${l.m.join(' ')})` : undefined}
            fill={l.fill ?? 'none'}
            fillRule="evenodd"
            stroke={l.stroke}
            strokeWidth={l.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <rect x="0" y="0" width="100" height="120" fill={`url(#${id}g)`} />
      </g>
      <path d={shield} fill="none" stroke={INK} strokeWidth={RIM} strokeLinejoin="round" />
    </svg>
  );
}
