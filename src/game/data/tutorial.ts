// Проводка первых шагов. Только данные: что сказать, что подсветить и по какому
// факту шаг считается пройденным. Рисует это ui/TutorialOverlay.
//
// Посёлок стоит с первой секунды, поэтому вести за руку надо не к стройке, а к
// тому, вокруг чего игра: кузница → снаряжение → ратуша → казармы → карта → разведка.
import type { BuildingTypeId, GameState } from '../types';
import { sessionSec } from '../pace';
import { armySize, buildingById, buildingOfType, workerCount } from '../derived';
import { gearOpen } from '../sim/tech';

/** Что подсвечивается «дыркой» в затемнении. */
export type TutorialTarget =
  /** Ничего: строка на весь экран. Без `done` — дальше по тапу в любом месте. */
  | { kind: 'none' }
  /** Здание в сцене — позиция считается проекцией из 3D, так что живёт при повороте камеры. */
  | { kind: 'building'; type: BuildingTypeId }
  /** Элемент интерфейса по data-атрибуту. */
  | { kind: 'dom'; sel: string };

/** Что сейчас открыто в интерфейсе: обучение засчитывает шаги и по этому тоже. */
export interface TutorialUi {
  /** id здания, чья панель открыта. */
  building: number | null;
  /** Открытый раздел нижней навигации. */
  tab: string | null;
  /** Открыта карта мира. */
  mapOpen: boolean;
  /** Открыта карточка клетки карты. */
  worldTile: boolean;
}

export interface TutorialStep {
  id: string;
  /** Одна короткая строка, до ~60 знаков. Функция — когда текст зависит от состояния. */
  text: string | ((s: GameState) => string);
  target: TutorialTarget;
  /**
   * Шаг закрыт. Проверяется по факту, а не по порядку: игрок, нанявший бойца
   * раньше просьбы, не застревает — шаг проматывается. Шаг без `done` — строка,
   * которую закрывают тапом в любом месте.
   */
  done?: (s: GameState, ui: TutorialUi) => boolean;
}

/**
 * Сколько обучение придерживает случайные события — пять **настоящих** минут на часах племени:
 * обучение идёт в первом заходе, и игрок проходит его своими минутами (`game/pace.sessionSec`).
 * Ограничение по времени, а не по флагу: брошенное на середине обучение не должно навсегда выключить
 * события — модалка мешает только пока подсветка на экране.
 */
export const TUTORIAL_EVENT_MUTE = sessionSec(5 * 60);

/** Открыта ли панель здания такого типа. */
const opened = (s: GameState, ui: TutorialUi, type: BuildingTypeId): boolean => {
  const b = ui.building !== null ? buildingById(s, ui.building) : null;
  return b !== null && b.type === type;
};

/** Сколько кузнецов стоит у горна. */
const smiths = (s: GameState): number => {
  const smithy = buildingOfType(s, 'smithy');
  return smithy ? workerCount(s, smithy.id) : 0;
};

/** Есть ли на складе хоть один предмет снаряжения. */
const anyGear = (s: GameState): boolean => Object.values(s.equipment ?? {}).some((n) => n > 0);

/** Бойцы уже есть или учатся. */
const anyTroops = (s: GameState): boolean => armySize(s) > 0 || (s.recruits ?? []).length > 0;

/** Разведка ушла: число ушедших выводится из походов мира на каждом пульсе. */
const scouting = (s: GameState): boolean => s.scoutsAway > 0;

/**
 * Шаги сценария, разложенные по местам экрана: кузница и её слот, заказ копий,
 * ратуша и казармы в её списке построек, кнопка карты, соседнее поселение и разведка.
 * Каждый шаг заканчивается действием игрока в настоящем интерфейсе: обучающих
 * макетов и кнопки «Далее» здесь нет.
 */
export const TUTORIAL: TutorialStep[] = [
  {
    id: 'intro',
    text: 'От костра на поляне — до каменных стен. Соседи не дремлют.',
    target: { kind: 'none' },
  },
  {
    id: 'smithy',
    text: 'Нажми кузницу.',
    target: { kind: 'building', type: 'smithy' },
    done: (s, ui) => opened(s, ui, 'smithy') || smiths(s) > 0 || anyGear(s),
  },
  {
    id: 'smith',
    text: 'Поставь кузнеца к горну.',
    target: { kind: 'dom', sel: '[data-tut="slot-add"]' },
    done: (s) => smiths(s) > 0 || anyGear(s),
  },
  {
    // Копьё — вторая ступень военной ветви, и на первом уровне кузница не куёт ничего
    // вовсе. Шаг про это стоит здесь нарочно: гейт — главный двигатель игры, и прятать
    // его от новичка хуже, чем объяснить в первую минуту (решение владельца 7,
    // docs/dynasty.md, раздел 6.1). Начальный котёл очков хватает ровно на эту ступень,
    // так что ждать игроку не приходится ни секунды.
    id: 'tech',
    text: 'Изучи копьё.',
    target: { kind: 'dom', sel: '[data-tut="coat"]' },
    done: (s) => gearOpen(s, 'spear') || anyGear(s),
  },
  {
    id: 'forge',
    text: 'Закажи копья.',
    target: { kind: 'dom', sel: '[data-tut="forge-spear"]' },
    done: (s) => s.forge.length > 0 || anyGear(s),
  },
  {
    // «Здания» низа (РТ-1): сетка всех построек, в ней — казармы. Имя шага прежнее: шаг партии — номер, а не имя.
    id: 'open_town',
    text: 'Открой «Здания».',
    target: { kind: 'dom', sel: '[data-tut="nav-buildings"]' },
    done: (s, ui) => ui.tab === 'buildings' || opened(s, ui, 'barracks') || anyTroops(s),
  },
  {
    id: 'open_barracks',
    text: 'Открой казармы. Там нанимают бойцов.',
    target: { kind: 'dom', sel: '[data-tut="list-barracks"]' },
    done: (s, ui) => opened(s, ui, 'barracks') || anyTroops(s),
  },
  {
    id: 'recruit',
    // Пока копьё куётся, кнопка найма не нажимается: строка объясняет ожидание.
    text: (s) =>
      (s.equipment.spear ?? 0) > 0
        ? 'Найми копейщика.'
        : s.forge.some((o) => o.item === 'spear')
          ? 'Копьё куётся. Потом найми копейщика.'
          : 'Копья нет. Закажи его или найми, кого можешь.',
    target: { kind: 'dom', sel: '[data-tut="recruit-spearman"]' },
    done: (s) => anyTroops(s),
  },
  {
    id: 'map',
    text: 'Открой карту. Там соседи.',
    target: { kind: 'dom', sel: '[data-tut="nav-map"]' },
    done: (s, ui) => ui.mapOpen || scouting(s),
  },
  {
    id: 'pick',
    text: 'Нажми соседний город.',
    target: { kind: 'none' },
    done: (s, ui) => ui.worldTile || scouting(s),
  },
  {
    id: 'scout',
    text: 'Отправь разведку.',
    target: { kind: 'dom', sel: '[data-tut="scout"]' },
    done: (s) => scouting(s),
  },
  {
    id: 'outro',
    text: 'Разведка принесёт сведения. Тогда решишь, куда вести поход.',
    target: { kind: 'none' },
  },
];

export const tutorialActive = (s: GameState): boolean => !s.tutorialDone && s.tutorialStep < TUTORIAL.length;

export const currentStep = (s: GameState): TutorialStep | null =>
  tutorialActive(s) ? TUTORIAL[s.tutorialStep] : null;

export const stepText = (step: TutorialStep, s: GameState): string =>
  typeof step.text === 'function' ? step.text(s) : step.text;

export function finishTutorial(s: GameState): void {
  s.tutorialStep = TUTORIAL.length;
  s.tutorialDone = true;
}

/** Отладка: пройти обучение заново с первого шага. */
export function restartTutorial(s: GameState): void {
  s.tutorialStep = 0;
  s.tutorialDone = false;
}

/**
 * Проматывает все шаги, которые уже выполнены. Вызывается на каждый тик и после
 * каждого действия игрока. Возвращает true, если состояние изменилось.
 */
export function advanceTutorial(s: GameState, ui: TutorialUi): boolean {
  if (!tutorialActive(s)) return false;
  const before = s.tutorialStep;
  while (s.tutorialStep < TUTORIAL.length) {
    const step = TUTORIAL[s.tutorialStep];
    // Шаг без условия ждёт тапа — дальше не проматываем.
    if (!step.done || !step.done(s, ui)) break;
    s.tutorialStep++;
  }
  if (s.tutorialStep >= TUTORIAL.length) finishTutorial(s);
  return s.tutorialStep !== before;
}

/** Тап по строке шага, который ничего не требует. Шаг с условием тапом не закрыть. */
export function tapTutorial(s: GameState, ui: TutorialUi): boolean {
  const step = currentStep(s);
  if (!step || step.done) return false;
  s.tutorialStep++;
  advanceTutorial(s, ui);
  if (s.tutorialStep >= TUTORIAL.length) finishTutorial(s);
  return true;
}
