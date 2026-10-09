// Накладная на двумерный арт: какие значки игра ждёт и как зовётся файл каждого.
//
// Список здесь **не пишется руками**: идентификаторы берутся прямо из данных игры —
// зданий, войск, снаряжения, ресурсов, профессий, сезонов, маркеров внимания. Заведут
// новое здание — оно само появится в накладной, и сборка спросит его значок. В этом
// весь смысл файла: имя картинки не может разойтись с игрой молча.
//
// Руками объявлены только те группы, у которых в игре нет своей таблицы: нижняя
// навигация, ячейки строки состояния, ступени морали, время суток, тревоги и общий
// инвентарь. Это словарь интерфейса, а не данные — выводить его неоткуда.
//
// Модуль чистый: ни React, ни DOM. Его читают двое — сборка значков
// (scripts/build-icons.ts) и сам интерфейс, — и второй правды между ними быть не должно.
import { BATTLE_ART } from '@/battle/report';
import { ACHIEVEMENTS } from '@/game/data/quests';
import { DAILY_GAMES } from '@/game/data/daily';
import { MINIGAMES } from '@/game/data/minigames';
import { GEM_PACKS } from '@/game/data/gems';
import { DECREES, RATIONS, TAXES } from '@/game/data/policy';
import { EVENTS } from '@/game/data/events';
import { SOCIAL_LINKS } from '@/game/data/social';
import { TEMPERS } from '@/world/data/diplomacy';
import { LETTER_KINDS } from '@/world/data/letters';
import { DEALS, FIGURES } from '@/world/data/figures';
import { DIPLO_ACTIONS, STANDING_META } from '@/world/data/diplomacy';
import { RELATION_ORDER, STAGES } from '@/world/data/meta';
import { SPY_ACTIONS } from '@/world/data/spy';
import { RESOURCE_IDS } from '@/game/constants';
import { ATTENTION_META } from '@/game/derived';
import { BUILDINGS } from '@/game/data/buildings';
import { DAY_PART_UNTIL } from '@/game/data/seasons';
import { EQUIPMENT_IDS } from '@/game/data/equipment';
import { JOBS } from '@/game/data/jobs';
import { SEASON_META } from '@/game/data/seasons';
import { TROOPS } from '@/game/data/troops';
import type { Season } from '@/game/types';

/** Имя файла значка без расширения: `<группа>-<id>`. */
export type IconName = string;

export interface IconGroup {
  /** Приставка в имени файла. */
  prefix: string;
  /** Идентификаторы, которые обязаны быть нарисованы. */
  ids: readonly string[];
  /** Откуда взят список — для отчёта сборки. */
  source: string;
}

/**
 * Сезон лета и дневное солнце — один значок на оба: так записано в техзадании
 * (1.8), и рисовать второе такое же солнце незачем.
 */
const seasonIds = (Object.keys(SEASON_META) as Season[]).map((s) => (s === 'summer' ? 'sun' : s));

/**
 * Маркер «кузнецы без заказа» берёт значок профессии кузнеца, отдельного файла у него
 * нет (техзадание, 1.7). Поэтому из маркеров внимания в накладную идут три из четырёх.
 */
const attnIds = (Object.keys(ATTENTION_META) as string[]).filter((a) => a !== 'order');

export const ICON_GROUPS: readonly IconGroup[] = [
  // Золото и алмаз — не ресурсы: они не лежат на складе и не хранятся в `resources`.
  // Но значок им нужен там же, где ресурсам, — в цене и в казне.
  { prefix: 'res', ids: [...RESOURCE_IDS, 'gold', 'gem'], source: 'RESOURCE_IDS + золото и алмаз' },
  { prefix: 'bld', ids: BUILDINGS.map((b) => b.id), source: 'BUILDINGS' },
  { prefix: 'gear', ids: EQUIPMENT_IDS, source: 'EQUIPMENT_IDS' },
  // Конь показывается там, где речь про конницу как род, а не про всадника.
  { prefix: 'troop', ids: [...TROOPS.map((t) => t.id), 'horse'], source: 'TROOPS + конь' },
  { prefix: 'job', ids: JOBS.map((j) => j.id), source: 'JOBS' },
  { prefix: 'season', ids: seasonIds, source: 'SEASON_META (лето и день — одно солнце)' },
  { prefix: 'attn', ids: attnIds, source: 'ATTENTION_META без order' },
  // Значки отчёта о бое перечислены там же, где строки отчёта: событие, которому
  // не завели значок, не попадёт ни в отчёт, ни в накладную.
  {
    prefix: 'bat',
    ids: BATTLE_ART.map((n) => n.slice('bat-'.length)),
    source: 'BATTLE_ART в battle/report.ts',
  },
  // Замок — не ступень развития, а вид цели: он рисуется поверх стадии и своим
  // значком (CASTLE_ICON), поэтому в список стадий добавляется отдельно.
  { prefix: 'stage', ids: [...STAGES.map((s) => s.id), 'castle'], source: 'STAGES + замок' },
  { prefix: 'rel', ids: RELATION_ORDER, source: 'RELATION_ORDER' },
  { prefix: 'fig', ids: FIGURES.map((f) => f.id), source: 'FIGURES' },
  // Только поводы. Трёх состояний письма (пришло, прочитано, просрочено), которых
  // просит техзадание, в игре нет: у `Letter` нет поля прочтения, а завести его —
  // правка модели писем и сохранения, а не арта. Разбор — в OBJECTS.md.
  { prefix: 'letter', ids: LETTER_KINDS.map((l) => l.id), source: 'LETTER_KINDS' },
  { prefix: 'decree', ids: DECREES.map((d) => d.id), source: 'DECREES' },
  { prefix: 'ration', ids: RATIONS.map((r) => r.id), source: 'RATIONS' },
  { prefix: 'tax', ids: TAXES.map((x) => x.id), source: 'TAXES' },
  { prefix: 'evt', ids: EVENTS.map((e) => e.id), source: 'EVENTS' },
  { prefix: 'temper', ids: TEMPERS.map((t) => t.id), source: 'TEMPERS' },
  { prefix: 'daily', ids: DAILY_GAMES.map((g) => g.id), source: 'DAILY_GAMES' },
  { prefix: 'mini', ids: MINIGAMES.map((g) => g.id), source: 'MINIGAMES' },
  // Наборы Сокровищницы (docs/gems.md): горсть самоцветов, кожаный кошель с завязкой, окованный сундук.
  { prefix: 'gempack', ids: GEM_PACKS.map((p) => p.id), source: 'GEM_PACKS' },
  // Ловушек в лабиринте нет: `daily/maze.ts` их не расставляет. Значка поэтому
  // тоже нет — рисунок без места мёртвый вес (разбор в OBJECTS.md).
  { prefix: 'maze', ids: ['key', 'door', 'chest'], source: 'клетки лабиринта' },
  { prefix: 'soc', ids: SOCIAL_LINKS.map((l) => l.id), source: 'SOCIAL_LINKS' },
  // Шесть достижений из семи берут уже нарисованное — см. ALIAS ниже.
  { prefix: 'ach', ids: ACHIEVEMENTS.map((a) => a.id), source: 'ACHIEVEMENTS' },
  { prefix: 'state', ids: Object.keys(STANDING_META), source: 'STANDING_META' },
  { prefix: 'deal', ids: DEALS.map((d) => d.id), source: 'DEALS' },
  { prefix: 'dip', ids: DIPLO_ACTIONS.map((a) => a.id), source: 'DIPLO_ACTIONS' },
  { prefix: 'spy', ids: SPY_ACTIONS.map((a) => a.id), source: 'SPY_ACTIONS' },
  // --- дальше словарь интерфейса: своей таблицы в игре у него нет ---
  { prefix: 'nav', ids: ['people', 'quests'], source: 'BottomNav' },
  { prefix: 'hud', ids: ['pop', 'army', 'map', 'order'], source: 'TopBar' },
  { prefix: 'mood', ids: ['good', 'mid', 'bad'], source: 'ступени морали в TopBar' },
  { prefix: 'day', ids: ['morning', 'evening', 'night'], source: 'время суток в TopBar' },
  { prefix: 'alert', ids: ['starving', 'freezing', 'raid'], source: 'AlertBar' },
  {
    prefix: 'ui',
    ids: [
      'warning', 'site', 'time',
      // 'treasury' в накладной нет нарочно: единственное место, где показывалась казна,
      // это строка золота в ратуше — а на той же вкладке стоят три сундука налога.
      // Разбор пары — в assets-src/icons/OBJECTS.md.
      'loot', 'person', 'hammer', 'scroll', 'book', 'pouch', 'crate', 'wagon',
      'ruler', 'eye', 'eye-off', 'pin', 'home', 'banner', 'grave', 'bandage', 'spyglass',
      'bolt', 'target', 'star',
      // Новый интерфейс (docs/ui_audit.md, разделы 8 и 12): закрыть, сведения, вести, закрыто, изучено, правитель,
      // технологии, вера — до него стояли эмодзи ✕ ℹ️ ✉️ 🔒 ✓ 🌳 📚 ⛪.
      'close', 'info', 'mail', 'lock', 'check', 'crown', 'tech', 'faith',
      // Сменить имя и назвать город в профиле — перо; до него стоял ✎, не из Emoji 12.0 (docs/ui_audit.md, 12.8).
      'edit',
      // Другое имя города на выбор — кубик (шаг имени стартового экрана, docs/ui_audit.md, 13).
      'dice',
      // Энергия промыслов — ладонь: силы рук на сутки (docs/minigames.md, 3). Молния занята «мгновенным итогом» боя.
      'energy',
    ],
    source: 'общий инвентарь интерфейса',
  },
  // Очки правителя трёх ветвей — свой значок у каждой: прежде один ◆ на все три (docs/ui_audit.md, 8).
  { prefix: 'pts', ids: ['adm', 'dip', 'mil'], source: 'очки правителя: управление, дипломатия, война' },
];

// ---------- Ссылки: разные места игры, один значок ----------
//
// Техзадание нарочно не заказывает второй рисунок там, где он совпал бы с уже
// заказанным. Ссылки живут здесь, а не в компонентах: иначе «маркер заказа берёт
// кузнеца» пришлось бы помнить наизусть в трёх местах.

const ALIAS: Record<string, IconName> = {
  'season-summer': 'season-sun',
  'day-day': 'season-sun',
  'attn-order': 'job-smith',
  'alert-food': 'res-food',
  'alert-wood': 'res-wood',
  'alert-forge-idle': 'job-smith',
  'nav-townhall': 'bld-town_hall',
  // Достижения: шесть из семи — про то, что уже нарисовано. Второго рисунка
  // тому же событию заводить незачем (техзадание, 1.19). «Взятого замка» среди
  // них больше нет: замков на карте нет, и достижение убрано (data/quests.ts).
  'ach-first_gear': 'job-smith',
  'ach-first_scout': 'fig-scout',
  'ach-first_raid': 'hud-army',
  'ach-first_hunt': 'gear-bow',
  'ach-pop_200': 'bld-houses',
  'ach-survivor': 'day-night',
};

/** Имя файла для пары «группа + идентификатор», с учётом ссылок. */
export function iconName(prefix: string, id: string): IconName {
  const raw = `${prefix}-${id}`;
  return ALIAS[raw] ?? raw;
}

/**
 * Все имена файлов, которые игра готова показать, — вся накладная целиком.
 *
 * Имя пропускается через ссылки: достижение «первая разведка» показывает значок
 * разведчика, и спрашивать под него отдельный файл незачем. Повторы после этого
 * схлопываются — иначе один и тот же файл значился бы в накладной дважды.
 */
export const ICON_MANIFEST: readonly IconName[] = [
  ...new Set(ICON_GROUPS.flatMap((g) => g.ids.map((id) => iconName(g.prefix, id)))),
];

/** К какой группе относится имя файла. `null` — приставка игре незнакома. */
export function groupOf(name: IconName): IconGroup | null {
  const dash = name.indexOf('-');
  if (dash < 0) return null;
  const prefix = name.slice(0, dash);
  return ICON_GROUPS.find((g) => g.prefix === prefix) ?? null;
}

// ---------- Состояние, у которого нет своего идентификатора ----------
//
// Мораль и время суток — числа, а не записи в таблице: значок им выбирает порог.
// Пороги стоят здесь, а не в двух панелях по отдельности, потому что раньше стояли
// именно так — и строка состояния с «Племенем» уже расходились бы, поправь кто-то одну.

/** Ступени морали: значок и эмодзи на его месте. Порядок — сверху вниз. */
export const MOOD_STEPS: readonly { from: number; name: IconName; glyph: string }[] = [
  { from: 70, name: 'mood-good', glyph: '😊' },
  { from: 40, name: 'mood-mid', glyph: '😐' },
  { from: -Infinity, name: 'mood-bad', glyph: '😟' },
];

export const moodOf = (morale: number) => MOOD_STEPS.find((step) => morale >= step.from) ?? MOOD_STEPS[2];

/**
 * Время суток по фазе солнца. Лето и день делят одно солнце — см. ALIAS. Границы — из
 * таблицы игры (`DAY_PART_UNTIL`): по ним же считается риск тайного дела, и ночь в
 * строке состояния обязана быть той же ночью, что прячет лазутчика.
 */
export const DAY_PARTS: readonly { until: number; name: IconName; glyph: string; label: string }[] = [
  { until: DAY_PART_UNTIL.morning, name: 'day-morning', glyph: '🌅', label: 'утро' },
  { until: DAY_PART_UNTIL.day, name: 'season-sun', glyph: '☀️', label: 'день' },
  { until: DAY_PART_UNTIL.evening, name: 'day-evening', glyph: '🌇', label: 'вечер' },
  { until: Infinity, name: 'day-night', glyph: '🌙', label: 'ночь' },
];

export const daypartOf = (solar: number) => DAY_PARTS.find((p) => solar < p.until) ?? DAY_PARTS[3];
