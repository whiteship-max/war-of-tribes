// Голос текстов нового вида (docs/ui_audit.md, 4.1–4.4): строки экранов этапа 2 без признаков канцелярского и машинного
// текста, без восклицаний и без слов, которые словарь убрал. Проверка грубая и нарочно такая: она ловит прямое слово,
// которое однажды напишут не думая, а не тонкость.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/game/data/buildings';
import { BRANCH_LORE } from '@/game/data/realm';
import { TROOPS } from '@/game/data/troops';
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
  // UI-2 (docs/ui_v2.md, раздел 5): ратуша «Стройка» одной сеткой и лист постройки.
  'next/Hall.tsx',
  'next/hall.ts',
  'next/output.ts',
  // UI-5 (docs/ui_v2.md, 5.4): окно «Жители» — сводка и места работы; невольники — в «Порядке».
  'next/people.ts',
  'panels/PeoplePanel.tsx',
  'parts/Bonded.tsx',
];

/**
 * Строки игрока в исходнике: литералы, шаблоны и текст разметки с кириллицей; комментарии — мимо. Разбор — компилятором
 * TypeScript: прежний щуп регулярным выражением не видел текст разметки рядом с `{…}` («Наше войско идёт {…}»), и
 * такие строки проходили замок молча (docs/voice.md, 12).
 */
export function playerStrings(src: string): string[] {
  const sf = ts.createSourceFile('x.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    let t: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) t = n.text;
    else if (ts.isTemplateExpression(n)) t = n.getText(sf).slice(1, -1);
    else if (ts.isJsxText(n)) t = n.text.replace(/\s+/g, ' ');
    if (t !== null && /[а-яё]/i.test(t)) out.push(t.trim());
    ts.forEachChild(n, visit);
  };
  visit(sf);
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
  // «Казна» — слово «золото» (словарь 4.4); «казнить» — своё слово, вести его знают (docs/voice.md, 11).
  /казн(а|у|е|ой|ы|ач)|войск/i,
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

/**
 * Вычитаны заходом «Голос», чат 2 (docs/voice.md, 10): карта, походы, война, осада, агенты, донесения, вести края, ролик боя,
 * сообщения бота. Пути — от корня проекта.
 */
export const VOICE2 = [
  'netlify/lib/words.ts', 'src/ui/map/feedWords.ts', 'src/ui/map/Feed.tsx', 'src/ui/map/ActionMenu.tsx', 'src/ui/map/WorldMap.tsx',
  'src/ui/next/WarCard.tsx', 'src/ui/next/SpyRival.tsx', 'src/ui/next/ReportNew.tsx', 'src/ui/panels/ReportPanel.tsx',
  'src/ui/panels/SiegePanel.tsx', 'src/ui/panels/CampPanel.tsx', 'src/ui/panels/SortiePanel.tsx', 'src/ui/battle/TwReplay.tsx',
  'src/ui/battle/barrage.ts', 'src/ui/parts/CampStrike.tsx', 'src/ui/parts/TowerEngine.tsx', 'src/ui/parts/AgentCard.tsx',
  'src/ui/parts/AgentPlaces.tsx', 'src/ui/parts/agentLines.ts', 'src/ui/parts/energyWords.ts', 'src/ui/parts/traitLines.ts',
  'src/ui/parts/Watch.tsx', 'src/world/data/gate.ts', 'src/world/siegecraft.ts', 'src/world/garrison.ts', 'src/world/local/LocalWorld.ts',
];

/**
 * Вычитаны заходом «Голос», чат 4 (docs/voice.md, 12): сеть и отказы связи, плашка заморозки, экран «Город не рисуется»,
 * письмо мастерам игры, справочные окна (жители, дружина, порядок, сезон, профиль, задания), вести, задание дня, карточка
 * вида бойцов, летопись Дозора, найма, башни и заданий. Пути — от корня проекта.
 */
export const VOICE4 = [
  'src/net/feed.ts', 'src/net/rating.ts', 'src/net/war.ts', 'src/net/roster.ts', 'src/net/sync.ts', 'src/net/report.ts',
  'src/ui/parts/Frozen.tsx', 'src/ui/parts/Temple.tsx', 'src/ui/parts/daily/Quiz.tsx', 'src/ui/parts/daily/DailyPage.tsx',
  'src/ui/parts/TroopCardView.tsx', 'src/ui/SceneTrouble.tsx', 'src/scenelog.ts', 'src/ui/panels/QuestsPanel.tsx',
  'src/ui/panels/ProfilePanel.tsx', 'src/ui/panels/ArmyPanel.tsx', 'src/ui/panels/OrderPanel.tsx', 'src/ui/panels/SeasonPanel.tsx',
  'src/ui/realm/Mail.tsx', 'src/ui/WinterModal.tsx', 'src/ui/next/Treasury.tsx', 'src/game/sim/survey.ts', 'src/game/sim/daily.ts',
  'src/game/sim/hire.ts', 'src/game/sim/tower.ts', 'src/game/sim/workers.ts', 'src/world/works.ts', 'src/game/data/troops.ts',
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

  it('то же для файлов, вычитанных заходом «Голос», чат 2', () => {
    let seen = 0;
    for (const f of VOICE2) {
      for (const t of playerStrings(readFileSync(join(UI, '..', '..', f), 'utf8'))) {
        seen++;
        for (const bad of BANNED) expect(t, `${f}: «${t}»`).not.toMatch(bad);
        // Служебные слова игры (voice.md, 5): в донесении и сообщении бота их нет.
        expect(t, `${f}: «${t}»`).not.toMatch(/сервер|загруз|\bданн|противник|агент/i);
      }
    }
    expect(seen).toBeGreaterThan(500);
  });

  it('то же для файлов, вычитанных заходом «Голос», чат 4: без служебных слов и без «аккаунта», «отчёта» и «бойцов строя»', () => {
    let seen = 0;
    for (const f of VOICE4) {
      for (const t of playerStrings(readFileSync(join(UI, '..', '..', f), 'utf8'))) {
        seen++;
        for (const bad of BANNED) expect(t, `${f}: «${t}»`).not.toMatch(bad);
        expect(t, `${f}: «${t}»`).not.toMatch(/сервер|\bданн|противник|агент|аккаунт|отч[её]т|бойц\S* строя|WebGL/i);
      }
    }
    expect(seen).toBeGreaterThan(300);
  });

  it('щуп строк видит литерал, шаблон и текст разметки', () => {
    const got = playerStrings(`const a = 'Привет'; const b = \`Срок \${x}\`; const c = <b>Город</b>; // Комментарий`);
    expect(got).toEqual(['Привет', 'Срок ${x}', 'Город']);
    // Текст разметки рядом с выражением — тоже строка игрока; прежний щуп его пропускал.
    expect(playerStrings(`const d = <p>Наше войско идёт {x}. Придёт через {y}.</p>;`)).toEqual(['Наше войско идёт', '. Придёт через']);
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

  it('ветви технологий — тем же правилом двух слоёв', () => {
    for (const [id, { flavor, deed }] of Object.entries(BRANCH_LORE)) {
      expect(flavor.length, id).toBeLessThanOrEqual(70);
      expect(deed.length, id).toBeLessThanOrEqual(110);
      for (const t of [flavor, deed]) {
        expect(t, id).not.toMatch(/\d|[()]/);
        for (const bad of BANNED) expect(t, `${id}: «${t}»`).not.toMatch(bad);
      }
    }
  });

  it('виды бойцов — тем же правилом двух слоёв, вкус не повторяет зачина', () => {
    expect(TROOPS.length).toBeGreaterThan(5);
    const first = new Set<string>();
    for (const d of TROOPS) {
      expect(d.flavor.length, d.id).toBeLessThanOrEqual(70);
      expect(d.description.length, d.id).toBeLessThanOrEqual(110);
      expect(d.flavor.split(/[.?]\s/).length, `${d.id}: одна фраза`).toBe(1);
      for (const t of [d.flavor, d.description]) {
        expect(t, d.id).not.toMatch(/\d|[()]/);
        for (const bad of BANNED) expect(t, `${d.id}: «${t}»`).not.toMatch(bad);
      }
      first.add(d.flavor.split(/[\s,]/)[0].toLowerCase());
    }
    expect(first.size).toBe(TROOPS.length);
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
