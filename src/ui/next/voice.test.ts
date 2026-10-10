// Голос текстов нового вида (docs/ui_audit.md, 4.1–4.4): строки экранов этапа 2 без признаков канцелярского и машинного
// текста, без восклицаний и без слов, которые словарь убрал. Проверка грубая и нарочно такая: она ловит прямое слово,
// которое однажды напишут не думая, а не тонкость.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/game/data/buildings';
import { createInitialState } from '@/game/state';
import { buildingFacts, buildingTip } from './buildingTips';

const UI = join(__dirname, '..');

/** Файлы экранов этапа 2 — новый вид целиком своими строками. */
export const STAGE2 = [
  'next/CityNaming.tsx',
  'next/cityNames.ts',
  'realm/RealmTabs.tsx',
  'next/WorldNew.tsx',
  'next/MarchesNew.tsx',
  // Вычитаны заходом «Добивка» (docs/ui_audit.md, 18): верх, низ, тревоги, окно постройки, промыслы, держава.
  'next/Hud.tsx',
  'next/hudTips.ts',
  'next/buildingTips.ts',
  'next/BuildingNew.tsx',
  'next/Nav.tsx',
  'next/Alerts.tsx',
  'next/Trades.tsx',
  'realm/RealmNew.tsx',
  'alertItems.ts',
];

/** Строки игрока в исходнике: литералы и текст разметки с кириллицей; комментарии — мимо. */
export function playerStrings(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of code.matchAll(/'([^'\n]*)'|`([^`]*)`|>([^<>{}\n]+)</g)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (/[а-яё]/i.test(t)) out.push(t);
  }
  return out;
}

/** 4.3: слова и обороты, которых нет нигде; 4.4: слова, которые словарь заменил. */
export const BANNED = [
  /Вы можете|Ты можешь/,
  /^(Можно|Нужно)\b/,
  /Обратите внимание|Стоит отметить|^Важно|^Учти/,
  /позволя|даёт возможность/,
  /\bданн(ый|ая|ое|ые)\b|является|осуществ|в рамках|с целью|для того чтобы|таким образом|в свою очередь|при этом|а также|следует|необходимо/,
  /!/,
  /посёл|деревн|\bвождь\b|рацион/i,
  /казн|войск/i,
];

/**
 * Вычитаны заходом «Голос», чат 1 (docs/voice.md): интерфейс вне этапа 2 — Сокровищница, найм и кузница, держава,
 * окна построек, окна поверх города, данные построек, указов, заданий, войска. Пути — от `src`.
 */
export const VOICE1 = [
  'ui/next/Treasury.tsx', 'ui/next/TreasuryBuy.tsx', 'ui/next/Rush.tsx', 'ui/next/RecruitNew.tsx', 'ui/next/SmithyNew.tsx',
  'ui/next/Hints.tsx', 'ui/realm/RealmTabs.tsx', 'ui/realm/Tech.tsx', 'ui/realm/Ruler.tsx', 'ui/parts/Settings.tsx',
  'ui/parts/BugReport.tsx', 'ui/parts/TownHall.tsx', 'ui/parts/TownBuild.tsx', 'ui/parts/Barracks.tsx', 'ui/parts/Muster.tsx',
  'ui/parts/Market.tsx', 'ui/parts/Masters.tsx', 'ui/parts/Tavern.tsx', 'ui/parts/Walls.tsx', 'ui/parts/Statue.tsx',
  'ui/parts/Provisions.tsx', 'ui/parts/policyWords.ts', 'ui/panels/BuildingPanel.tsx', 'ui/panels/PeoplePanel.tsx',
  'ui/panels/PopPanel.tsx', 'ui/panels/MoralePanel.tsx', 'ui/OfflineModal.tsx', 'ui/WinterModal.tsx', 'ui/map/Rating.tsx',
  'game/data/hints.ts', 'game/data/tutorial.ts', 'game/data/policy.ts', 'game/data/quests.ts', 'game/data/troops.ts',
  'game/data/equipment.ts', 'game/data/buildings.ts', 'game/data/jobs.ts', 'game/data/yards.ts',
];

describe('голос текстов этапа 2', () => {
  it('ни канцелярита, ни восклицаний, ни слов, которые словарь убрал', () => {
    let seen = 0;
    for (const f of STAGE2) {
      for (const t of playerStrings(readFileSync(join(UI, f), 'utf8'))) {
        seen++;
        for (const bad of BANNED) expect(t, `${f}: «${t}»`).not.toMatch(bad);
      }
    }
    // Область: строки нашлись — проверка не пустая.
    expect(seen).toBeGreaterThan(30);
  });

  it('то же для файлов, вычитанных заходом «Голос»', () => {
    let seen = 0;
    for (const f of VOICE1) {
      for (const t of playerStrings(readFileSync(join(UI, '..', f), 'utf8'))) {
        seen++;
        for (const bad of BANNED) expect(t, `${f}: «${t}»`).not.toMatch(bad);
      }
    }
    expect(seen).toBeGreaterThan(300);
  });

  it('щуп строк видит литерал, шаблон и текст разметки', () => {
    const got = playerStrings(`const a = 'Привет'; const b = \`Срок \${x}\`; <b>Город</b> // Комментарий`);
    expect(got).toEqual(['Привет', 'Срок ${x}', 'Город']);
  });
});

// Два слоя описаний (docs/voice.md, 3 и 4): вкус — одна фраза без чисел, дело — без вписанных чисел (правило 18),
// длины по голосу; зачины не повторяются, подсказка окна несёт оба слоя и показание числами игры.
describe('описания построек: вкус и дело', () => {
  it('вкус — одна короткая фраза, дело — короткое, обе без цифр и без запретных слов', () => {
    expect(BUILDINGS.length).toBeGreaterThan(20);
    for (const d of BUILDINGS) {
      expect(d.flavor.length, d.id).toBeLessThanOrEqual(70);
      expect(d.description.length, d.id).toBeLessThanOrEqual(110);
      expect(d.flavor.split(/[.?]\s/).length, `${d.id}: одна фраза`).toBe(1);
      for (const t of [d.flavor, d.description]) {
        expect(t, d.id).not.toMatch(/\d/);
        expect(t, d.id).not.toMatch(/[()]/);
        for (const bad of BANNED) expect(t, `${d.id}: «${t}»`).not.toMatch(bad);
      }
    }
  });

  it('зачины не повторяются: вкус — ни разу, дело — не больше двух раз одним словом', () => {
    const first = (t: string) => t.split(/[\s,]/)[0].toLowerCase();
    const flavor = BUILDINGS.map((d) => first(d.flavor));
    expect(new Set(flavor).size).toBe(flavor.length);
    const deed = new Map<string, number>();
    for (const d of BUILDINGS) deed.set(first(d.description), (deed.get(first(d.description)) ?? 0) + 1);
    for (const [w, n] of deed) expect(n, w).toBeLessThanOrEqual(2);
  });

  it('подсказка окна постройки — вкус, дело и показание числами игры', () => {
    const s = createInitialState();
    for (const b of s.buildings) {
      const tip = buildingTip(s, b);
      const def = BUILDINGS.find((d) => d.id === b.type)!;
      expect(tip.lore).toBe(def.flavor);
      expect(tip.body!.startsWith(def.description), b.type).toBe(true);
      const now = buildingFacts(s, b);
      if (now) expect(tip.body!.toLowerCase(), b.type).toContain(now.toLowerCase());
      else expect(tip.body).toBe(def.description);
    }
  });
});
