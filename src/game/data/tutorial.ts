// Проводка первых шагов. Только данные: что сказать, что подсветить и по какому
// факту шаг считается пройденным. Рисует это ui/TutorialOverlay.
import type { BuildingTypeId, GameState } from '../types';
import { DAY_LENGTH } from '../constants';
import { buildingById, countAll, countBuilt, workerCount } from '../derived';
import { SEASONS, SEASON_DAYS } from './seasons';

/** Что подсвечивается «дыркой» в затемнении. */
export type TutorialTarget =
  /** Ничего: строка на весь экран, дальше по тапу в любом месте. */
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
}

export interface TutorialStep {
  id: string;
  /** Одна короткая строка, до ~60 знаков. Функция — когда текст зависит от состояния. */
  text: string | ((s: GameState) => string);
  target: TutorialTarget;
  /**
   * Шаг закрыт. Проверяется по факту, а не по порядку: игрок, построивший лесопилку
   * раньше просьбы, не застревает — шаг проматывается. Шаг без `done` — строка,
   * которую закрывают тапом в любом месте.
   */
  done?: (s: GameState, ui: TutorialUi) => boolean;
}

/** День, на который приходит первая зима: она замыкает первый год. */
export const FIRST_WINTER_DAY = SEASONS.indexOf('winter') * SEASON_DAYS + 1;

/**
 * Сколько игрового времени обучение придерживает случайные события. Ограничение по
 * времени, а не по флагу: брошенное на середине обучение не должно навсегда выключить
 * события — модалка мешает только пока подсветка на экране.
 */
export const TUTORIAL_EVENT_MUTE = 5 * DAY_LENGTH;

/** Открыта ли панель здания такого типа. */
const opened = (s: GameState, ui: TutorialUi, type: BuildingTypeId): boolean => {
  const b = ui.building !== null ? buildingById(s, ui.building) : null;
  return b !== null && b.type === type;
};

/** Сколько народу уже рубит лес на лесопилке. */
const sawmillWorkers = (s: GameState): number =>
  s.buildings.reduce((n, b) => (b.type === 'sawmill' ? n + workerCount(s, b.id) : n), 0);

/**
 * Шесть шагов сценария, разложенных по местам экрана: «построй лесопилку» — это раздел
 * «Здания» внизу и карточка в его списке, а «отправь рубить лес» — сначала само здание,
 * потом слот в его панели. Каждый шаг заканчивается действием игрока в настоящем интерфейсе:
 * обучающих макетов и кнопки «Далее» здесь нет.
 */
export const TUTORIAL: TutorialStep[] = [
  {
    id: 'intro',
    text: 'Пять человек и костёр. Больше у племени ничего нет.',
    target: { kind: 'none' },
  },
  {
    id: 'campfire',
    text: 'Тапни костёр — у каждого здания своя панель.',
    target: { kind: 'building', type: 'campfire' },
    // Главное правило — «данные живут в зданиях», поэтому годится любая открытая панель.
    done: (_s, ui) => ui.building !== null,
  },
  {
    id: 'open_build',
    text: 'Открой «Здания» внизу — там весь посёлок и стройка.',
    target: { kind: 'dom', sel: '[data-tut="nav-build"]' },
    done: (s, ui) => ui.tab === 'build' || countAll(s, 'sawmill') > 0,
  },
  {
    id: 'build_sawmill',
    text: 'Построй лесопилку: на месте лесоруб вдвое сильнее.',
    target: { kind: 'dom', sel: '[data-tut="build-sawmill"]' },
    done: (s) => countAll(s, 'sawmill') > 0,
  },
  {
    id: 'open_sawmill',
    text: 'Тапни лесопилку — у неё тоже своя панель.',
    target: { kind: 'building', type: 'sawmill' },
    done: (s, ui) => opened(s, ui, 'sawmill') || sawmillWorkers(s) > 0,
  },
  {
    id: 'assign',
    // Пока идёт стройка, слота ещё нет: строка объясняет ожидание, а не молчит.
    text: (s) =>
      countBuilt(s, 'sawmill') > 0 ? 'Поставь человека рубить лес.' : 'Лесопилка строится. Скоро появится место.',
    target: { kind: 'dom', sel: '[data-tut="slot-add"]' },
    done: (s) => sawmillWorkers(s) > 0,
  },
  {
    id: 'storage',
    text: 'Все запасы племени — на складе. Тапни его.',
    target: { kind: 'building', type: 'storage' },
    done: (s, ui) => opened(s, ui, 'storage'),
  },
  {
    id: 'winter',
    text: `Зима придёт на ${FIRST_WINTER_DAY}-й день. К ней готовятся заранее.`,
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
