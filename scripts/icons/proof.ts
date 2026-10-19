// Лист-снимок набора значков ЗН-1 (docs/icons.md): каждый значок на тёмном и светлом, в 48, 20 и 16 px — сразу видно,
// читается ли силуэт и держится ли стиль. Стенд для глаз, не отчёт:
//
//   npx vite-node scripts/icons/proof.ts                    — весь набор в docs/icons/sheet-dark.png и sheet-light.png
//   ONLY=res-,bld- npx vite-node scripts/icons/proof.ts     — только имена с этими началами (в scratchpad, OUT=папка)
//   STATES=1 npx vite-node scripts/icons/proof.ts           — состояния на значках низа: обычный, выбран, погашен, с меткой
//                                                             (docs/icons/states.png; фильтры `icon.css` — тем же видом)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { shapeSvg, GRID } from './kit';
import { ART } from './set';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Фон панели игры и светлый лист. */
const BG = { dark: '#241a12', light: '#f3ead6' } as const;
const TEXT = { dark: '#f3e9d8', light: '#2a1d12' } as const;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function proofSvg(names: string[], theme: 'dark' | 'light', cols = 8): string {
  const cell = { w: 150, h: 104 };
  const rows = Math.ceil(names.length / cols);
  const W = cols * cell.w + 20;
  const H = rows * cell.h + 20;
  let body = '';
  names.forEach((name, i) => {
    const x = 10 + (i % cols) * cell.w;
    const y = 10 + Math.floor(i / cols) * cell.h;
    const shapes = ART[name]().map(shapeSvg).join('');
    const at = (px: number, ox: number, oy: number): string =>
      `<svg x="${x + ox}" y="${y + oy}" width="${px}" height="${px}" viewBox="0 0 ${GRID} ${GRID}">${shapes}</svg>`;
    body += at(48, 4, 6) + at(20, 62, 20) + at(16, 92, 22);
    body += `<text x="${x + 4}" y="${y + 74}" font-family="sans-serif" font-size="11" fill="${TEXT[theme]}">${esc(name)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG[theme]}"/>${body}</svg>`;
}

/** Состояния значка — те же, что `src/ui/icons/icon.css`, фильтрами SVG: выбран — светлее с золотым отсветом, погашен — без цвета. */
function statesSvg(theme: 'dark' | 'light'): string {
  const names = ['bld-town_hall', 'nav-people', 'hud-map', 'hud-army', 'ui-mail', 'res-food', 'troop-archer', 'ui-star'];
  const cols = [
    { label: 'обычный', filter: '' },
    { label: 'выбран', filter: 'url(#on)' },
    { label: 'погашен', filter: 'url(#off)' },
    { label: 'с меткой', filter: '', badge: true },
  ];
  const cell = 120;
  const W = 140 + cols.length * cell;
  const H = 40 + names.length * 52;
  let body = cols.map((c, i) => `<text x="${150 + i * cell}" y="26" font-family="sans-serif" font-size="13" fill="${TEXT[theme]}">${c.label}</text>`).join('');
  names.forEach((name, r) => {
    const y = 40 + r * 52;
    body += `<text x="10" y="${y + 26}" font-family="sans-serif" font-size="11" fill="${TEXT[theme]}">${esc(name)}</text>`;
    const shapes = ART[name]().map(shapeSvg).join('');
    cols.forEach((c, i) => {
      const x = 150 + i * cell;
      body += `<g filter="${c.filter}"><svg x="${x}" y="${y}" width="40" height="40" viewBox="0 0 ${GRID} ${GRID}">${shapes}</svg></g>`;
      if (c.badge) body += `<rect x="${x + 30}" y="${y - 4}" width="22" height="18" rx="9" fill="#d9a441" stroke="#1f1812" stroke-width="2"/><text x="${x + 41}" y="${y + 9}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="12" fill="#1a1410">${r + 1}</text>`;
    });
  });
  const defs = `<defs><filter id="on" x="-30%" y="-30%" width="160%" height="160%"><feComponentTransfer><feFuncR type="linear" slope="1.12"/><feFuncG type="linear" slope="1.12"/><feFuncB type="linear" slope="1.12"/></feComponentTransfer><feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#f0bd52" flood-opacity="0.75"/></filter><filter id="off"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="0.8"/><feFuncG type="linear" slope="0.8"/><feFuncB type="linear" slope="0.8"/><feFuncA type="linear" slope="0.55"/></feComponentTransfer></filter></defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${BG[theme]}"/>${defs}${body}</svg>`;
}

async function main(): Promise<void> {
  if (process.env.STATES) {
    const out = process.env.OUT ?? join(ROOT, 'docs', 'icons');
    const dark = await sharp(Buffer.from(statesSvg('dark'))).png().toBuffer();
    const light = await sharp(Buffer.from(statesSvg('light'))).png().toBuffer();
    const meta = await sharp(dark).metadata();
    const both = await sharp({ create: { width: meta.width! * 2, height: meta.height!, channels: 4, background: '#000' } })
      .composite([{ input: dark, left: 0, top: 0 }, { input: light, left: meta.width!, top: 0 }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(join(out, 'states.png'), both);
    console.log(join(out, 'states.png'));
    return;
  }
  const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
  const names = Object.keys(ART)
    .filter((n) => only.length === 0 || only.some((o) => n.startsWith(o)))
    .sort();
  const out = process.env.OUT ?? join(ROOT, 'docs', 'icons');
  mkdirSync(out, { recursive: true });
  for (const theme of ['dark', 'light'] as const) {
    const svg = proofSvg(names, theme, Number(process.env.COLS ?? 8));
    const file = join(out, `sheet-${theme}.png`);
    writeFileSync(file, await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toBuffer());
    console.log(`${file}: ${names.length} значков`);
  }
}

void main();
