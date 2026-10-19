// Один значок крупно — для правки рисунка: `NAMES=a,b npx vite-node scripts/icons/one.ts` → OUT/one.png (стенд, не отчёт).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { shapeSvg, GRID } from './kit';
import { ART } from './set';

const names = (process.env.NAMES ?? '').split(',').filter(Boolean);
const px = 160;
const body = names
  .map((n, i) => `<svg x="${i * (px + 10)}" y="0" width="${px}" height="${px}" viewBox="0 0 ${GRID} ${GRID}">${ART[n]().map(shapeSvg).join('')}</svg>`)
  .join('');
const W = names.length * (px + 10);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${px}"><rect width="${W}" height="${px}" fill="#241a12"/>${body}</svg>`;
void sharp(Buffer.from(svg))
  .png()
  .toBuffer()
  .then((b) => writeFileSync(join(process.env.OUT ?? '.', 'one.png'), b));
