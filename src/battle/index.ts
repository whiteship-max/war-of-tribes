// Боевая симуляция: чистая функция без React, three и состояния игры.
// Сюда же потом придёт сервер — импортировать из `battle/` можно только это.
export * from './types';
export * from './config';
export { simulateBattle, startMorale, phaseLuck, pipOf } from './sim';
export { quickSetup, quickAttack, presetWeights, QUICK_PRESETS, QUICK_PRESET_IDS, PRESET_WEIGHTS, emptyStack, stackOf, stackTotal, emptySectors, armyTotal, validateSetup, DEFAULT_ORDERS, type QuickPresetId, type QuickPreset, type Intel } from './setup';
export { describeEvent, pipPhases, SECTOR_NAME, PHASE_NAME, SIDE_NAME } from './log';
export * from './names';
export { summarize, ourWord, VERDICT_TITLE, KEYS_MAX, type BattleSummary, type ReportLine } from './report';
// Режиссуры ролика (`./replay`) в этой двери нет нарочно: ролик едет своим куском
// по «Смотреть бой», а модуль, названный здесь, сборщик кладёт в первую загрузку
// вместе с ядром. Её зовут прямо — `@/battle/replay`. Она по-прежнему чистая
// функция от журнала: симуляции не зовёт и кубиков не бросает (тест по исходникам).
