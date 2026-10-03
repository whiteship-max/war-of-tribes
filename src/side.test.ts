// Цвет стороны — одна дверь (`side.ts`; решение владельца 03.10.2026): игрок — золото, враг — красный, везде — в обоих
// роликах боя, на карте и в отчёте о бое. Держит это не память: тест сверяет каждого читателя с дверью и читает исходники,
// чтобы шестнадцатеричная запись цвета стороны не завелась мимо неё второй правдой.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TROOP_IDS } from '@/game/data/troops';
import { RELATION_META } from '@/world/data/meta';
import { STANDING_META } from '@/world/data/diplomacy';
import { FELL_MARK, PARTY_FOE, PARTY_OWN } from '@/ui/map/palette';
import { CLOTH_OF } from '@/render/battle/troops';
import { SIDE_CLOTH } from '@/render/tw/crowd';
import { Figure } from '@/render/figures';
import { PALETTE } from '@/render/palette';
import { dressSoldier, gearTier } from '@/render/units';
import { SIDE_COLOR, SIDE_PAINT, SIDE_VARS, shade, sideColor, sidePaint, sideShade } from './side';

/** Тон цвета в градусах (0..360) — по нему «золото» и «красный» проверяются словами решения, а не числом. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('цвет стороны: дверь', () => {
  it('игрок — золото, враг — красный; тень и краска — тот же цвет, темнее', () => {
    // Золото — тон между оранжевым и жёлтым, красный — у нуля: так решение записано словами.
    expect(hue(SIDE_COLOR.ours)).toBeGreaterThan(30);
    expect(hue(SIDE_COLOR.ours)).toBeLessThan(50);
    expect(hue(SIDE_COLOR.foe) < 15 || hue(SIDE_COLOR.foe) > 345).toBe(true);
    expect(sideColor(true)).toBe(SIDE_COLOR.ours);
    expect(sideColor(false)).toBe(SIDE_COLOR.foe);
    for (const ours of [true, false]) {
      const paint = `#${sidePaint(ours).toString(16).padStart(6, '0')}`;
      expect(paint).toBe(shade(sideColor(ours), SIDE_PAINT));
      // Тон краски и тени — тот же, что у двери, до градуса: темнее, но не другой цвет.
      expect(Math.abs(hue(paint) - hue(sideColor(ours)))).toBeLessThan(1.5);
      expect(Math.abs(hue(sideShade(ours)) - hue(sideColor(ours)))).toBeLessThan(1.5);
    }
    expect(SIDE_VARS).toEqual({ '--side-ours': SIDE_COLOR.ours, '--side-foe': SIDE_COLOR.foe });
  });
});

describe('цвет стороны: читатели', () => {
  it('карта: свои и враги, отряды, знак участи, война — цвет двери', () => {
    expect(RELATION_META.self.color).toBe(SIDE_COLOR.ours);
    expect(RELATION_META.enemy.color).toBe(SIDE_COLOR.foe);
    expect(PARTY_OWN.cloth).toBe(SIDE_COLOR.ours);
    expect(PARTY_OWN.clothDark).toBe(sideShade(true));
    expect(PARTY_FOE.cloth).toBe(SIDE_COLOR.foe);
    expect(PARTY_FOE.clothDark).toBe(sideShade(false));
    expect(FELL_MARK.stripe).toBe(SIDE_COLOR.foe);
    expect(STANDING_META.war.color).toBe(SIDE_COLOR.foe);
  });

  it('оба ролика боя: наши — краска золота, чужие — краска красного', () => {
    expect(CLOTH_OF(true)).toBe(sidePaint(true));
    expect(CLOTH_OF(false)).toBe(sidePaint(false));
    expect(SIDE_CLOTH.ours).toBe(sidePaint(true));
    expect(SIDE_CLOTH.theirs).toBe(sidePaint(false));
  });

  it('боец несёт только свой цвет стороны: щит, рубаха и гребень латника — одним цветом', () => {
    const foreign = new Set([sidePaint(false), PALETTE.paintRed, PALETTE.paintBlue]);
    let crests = 0;
    for (const troop of TROOP_IDS) {
      const f = new Figure();
      dressSoldier(f, troop);
      for (const s of f.slots) expect(foreign.has(s.color.getHex()), `${troop}: ${s.part} ${s.color.getHexString()}`).toBe(false);
      // Свой боец по умолчанию — в своём цвете: рубаха — краска стороны.
      expect(f.slots.some((s) => s.color.getHex() === sidePaint(true)), troop).toBe(true);
      if (gearTier(troop) >= 3) {
        // Гребень — плавник на шлеме: деталь головы цвета стороны.
        expect(f.slots.some((s) => s.joint === 'head' && s.part === 'plate' && s.color.getHex() === sidePaint(true)), `${troop}: гребень`).toBe(true);
        crests++;
      }
    }
    // Область правила не пуста: латники с гребнем есть.
    expect(crests).toBeGreaterThan(0);
  });
});

/** Все исходники игры (`.ts`, `.tsx`, `.css`) — путь от `src/` и текст. */
function sources(): { path: string; text: string }[] {
  const root = join(__dirname);
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|css)$/.test(name) && !/\.test\.ts$/.test(name)) out.push({ path: relative(root, p).split(sep).join('/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out;
}

/**
 * Где записи цвета стороны законны вне двери: акцент интерфейса совпадает с золотом стороны числом, но сторону не значит —
 * кольцо выбора здания и обвод значка над ним (`render/Scene.ts`), акцент кнопок и плохое число (`--accent`, `--bad` в
 * `ui/styles.css`). Новое место сюда не дописывается: цвет стороны берут из двери.
 */
const NOT_SIDE: Record<string, number> = { 'render/Scene.ts': 2, 'ui/styles.css': 2 };

describe('цвет стороны: второй правды нет', () => {
  it('шестнадцатеричная запись золота и красного стороны — только в двери', () => {
    const hex = (c: string): string => c.slice(1).toLowerCase();
    const pattern = new RegExp(`(#|0x)(${hex(SIDE_COLOR.ours)}|${hex(SIDE_COLOR.foe)})\\b`, 'gi');
    const found: Record<string, number> = {};
    for (const s of sources()) {
      if (s.path === 'side.ts') continue;
      const n = s.text.match(pattern)?.length ?? 0;
      if (n > 0) found[s.path] = n;
    }
    expect(found).toEqual(NOT_SIDE);
  });

  it('прежний синий стороны в бою не живёт: ни ролики, ни их полоса не берут краску палитры за сторону', () => {
    const battle = sources().filter((s) => /^(render\/battle|render\/tw|ui\/battle)\//.test(s.path) || s.path === 'render/units.ts');
    // Область правила не пуста: оба ролика и одевание бойца на месте.
    expect(battle.length).toBeGreaterThan(20);
    for (const s of battle) expect(/paint(Blue|Red)/.test(s.text), s.path).toBe(false);
  });
});
