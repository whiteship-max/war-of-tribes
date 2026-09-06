// Боевая симуляция: чистая функция без React, three и состояния игры.
// Сюда же потом придёт сервер — импортировать из `battle/` можно только это.
export * from './types';
export * from './config';
export { simulateBattle } from './sim';
export { quickSetup, quickAttack, presetWeights, QUICK_PRESETS, QUICK_PRESET_IDS, PRESET_WEIGHTS, emptyStack, stackOf, stackTotal, emptySectors, armyTotal, validateSetup, DEFAULT_ORDERS, type QuickPresetId, type QuickPreset, type Intel } from './setup';
export { describeEvent, SECTOR_NAME, PHASE_NAME, SIDE_NAME } from './log';
export * from './names';
export { summarize, ourWord, VERDICT_TITLE, KEYS_MAX, type BattleSummary, type ReportLine } from './report';
// Режиссура ролика: чистая функция от журнала, как и сам бой. Симуляции она не
// зовёт, кубиков не бросает — это держит тест, читающий исходники.
export {
  buildCast,
  frameAt,
  figureCount,
  shotAtTime,
  placedAt,
  sectorSpot,
  laneOf as replayLaneOf,
  rowOf as replayRowOf,
  FIELD,
  FIGURE_CAP,
  MUSTER_FIGURES,
  SKIP,
  type Cast,
  type CastSector,
  type CameraShot,
  type Control,
  type Face,
  type FaceCount,
  type Frame,
  type Keyframe,
  type Mark,
  type SectorFrame,
} from './replay';
