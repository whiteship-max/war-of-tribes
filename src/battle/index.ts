// Боевая симуляция: чистая функция без React, three и состояния игры.
// Сюда же потом придёт сервер — импортировать из `battle/` можно только это.
export * from './types';
export * from './config';
export { simulateBattle } from './sim';
export { quickSetup, quickAttack, presetWeights, QUICK_PRESETS, QUICK_PRESET_IDS, PRESET_WEIGHTS, emptyStack, stackOf, stackTotal, emptySectors, armyTotal, validateSetup, DEFAULT_ORDERS, type QuickPresetId, type QuickPreset, type Intel } from './setup';
export { describeEvent, SECTOR_NAME, PHASE_NAME, SIDE_NAME } from './log';
