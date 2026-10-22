// Ссылки набора ЗН-1 (docs/icons.md): разные места игры — один рисунок. Набор рисует предмет один раз, а имён у него
// столько, сколько мест его спрашивают: профессия лесоруба и лесопилка — одна пила, грамота мира и указ об управлении —
// одна грамота. Ссылки живут здесь, а не в компонентах: иначе «лесоруб — это пила» пришлось бы помнить в трёх местах.
//
// Модуль чистый — ни React, ни DOM, ни данных игры: его читают сборка значков (`scripts/build-icons.ts`), интерфейс и —
// одним типом — данные игры (`IconName`).
import type { DrawnIcon } from './generated';

export const ALIAS = {
  // Профессия — там, где она работает: строка «Рабочие» и окно постройки показывают один знак.
  'job-idle': 'ui-hammer',
  'job-gatherer': 'bld-gathering',
  'job-hunter': 'bld-hunter_hut',
  'job-woodcutter': 'bld-sawmill',
  'job-stonecutter': 'bld-quarry',
  'job-miner': 'bld-mine',
  'job-farmer': 'bld-farm',
  'job-herder': 'bld-pen',
  'job-crafter': 'bld-workshop',
  'job-smith': 'bld-smithy',
  'job-priest': 'ui-candle',
  'attn-order': 'bld-smithy',
  // Лето и дневное солнце — одно солнце.
  'season-summer': 'season-sun',
  'day-day': 'season-sun',
  'stage-village': 'bld-houses',
  'hud-pop': 'nav-people',
  'nav-quests': 'ui-scroll',
  'nav-townhall': 'bld-town_hall',
  'alert-starving': 'ui-bowl',
  'alert-freezing': 'season-winter',
  'alert-food': 'res-food',
  'alert-wood': 'res-wood',
  'alert-forge-idle': 'bld-smithy',
  'ui-ruler': 'ui-crown',
  'ui-faith': 'bld-church',
  'ui-music': 'ui-lute',
  'ui-up': 'attn-upgrade',
  'ui-treasury': 'bld-cache',
  // Отчёт о бое.
  'bat-morale': 'ui-whiteflag',
  'bat-annihilated': 'ui-skull',
  'bat-outfought': 'ui-scales',
  'bat-dice': 'ui-dice',
  // Грамоты и сделки.
  'letter-pact': 'ui-handshake',
  'letter-tribute': 'ui-pouch',
  'letter-alliance': 'deal-alliance',
  'letter-ransom': 'ui-chain',
  'letter-raid': 'alert-raid',
  'letter-siege': 'alert-siege',
  'deal-truce': 'ui-whiteflag',
  'deal-trade': 'ui-scales',
  'deal-tribute': 'ui-pouch',
  'dip-pact': 'ui-charter',
  'dip-peace': 'ui-dove',
  'dip-war': 'hud-army',
  'state-neutral': 'rel-neutral',
  'state-pact': 'ui-charter',
  'state-war': 'hud-army',
  'spy-probe': 'ui-eye',
  'temper-proud': 'ui-feather',
  'temper-greedy': 'res-gold',
  'temper-fierce': 'ui-wolf',
  'temper-wary': 'ui-eye',
  'temper-steady': 'res-stone',
  // Указы, паёк, налог.
  'decree-none': 'ui-handshake',
  'decree-order': 'ui-scales',
  'decree-freedom': 'ui-lute',
  'ration-lean': 'ui-bowl',
  'ration-normal': 'ui-stew',
  'ration-rich': 'ui-cauldron',
  'tax-none': 'ui-dove',
  'tax-moderate': 'ui-jug',
  'tax-high': 'ui-pouch',
  // Очки правителя.
  'pts-adm': 'ui-charter',
  'pts-dip': 'ui-dove',
  'pts-mil': 'hud-army',
  // Вести.
  'evt-refugees': 'nav-people',
  'evt-wanderers': 'bld-workshop',
  'evt-wolves': 'ui-wolf',
  'evt-berries': 'ui-berries',
  'evt-storm': 'ui-storm',
  'evt-trade': 'ui-wagon',
  'evt-sickness': 'ui-rat',
  'evt-mercenaries': 'gear-shield',
  'evt-free_company': 'ui-banner',
  'evt-festival': 'ui-bunting',
  'evt-rome_letter': 'ui-charter',
  'evt-rome_relief': 'ui-dove',
  'evt-heresy_split': 'ui-flame',
  'evt-mutiny': 'spy-revolt',
  'evt-revolt_folk': 'ui-pitchfork',
  'evt-revolt_hungry': 'ui-loaf',
  'evt-revolt_terms': 'ui-charter',
  'evt-relic_offer': 'ui-beads',
  'evt-good_hunt': 'ui-deer',
  'evt-fire': 'ui-flame',
  'evt-harvest_feast': 'bld-farm',
  'evt-fair': 'bld-market',
  'evt-spring_flood': 'ui-wave',
  'evt-silt': 'season-spring',
  'evt-hard_winter': 'season-winter',
  'evt-pilgrims': 'ui-prayer',
  'evt-pilgrims_gift': 'dip-gift',
  'evt-noble_dispute': 'ui-scales',
  'evt-feud': 'ui-dagger',
  'evt-deserters': 'ui-whiteflag',
  'evt-deserters_flee': 'day-night',
  'evt-mine_find': 'ui-pick',
  'evt-mine_collapse': 'ui-burst',
  'evt-merchant_loan': 'ui-satchel',
  'evt-merchant_due': 'ui-charter',
  // Ежедневка, промыслы, лавка, лабиринт.
  'daily-archery': 'ui-target',
  'mini-berries': 'ui-berries',
  'mini-herd': 'ui-sheep',
  'mini-hunt': 'ui-deer',
  'mini-fish': 'ui-fish',
  'gempack-chest': 'bld-cache',
  'maze-key': 'hud-order',
  'maze-chest': 'bld-cache',
  'soc-group': 'nav-people',
  // Достижения — про то, что уже нарисовано.
  'ach-first_gear': 'bld-smithy',
  'ach-first_scout': 'fig-scout',
  'ach-first_raid': 'hud-army',
  'ach-first_win': 'ui-trophy',
  'ach-first_hunt': 'gear-bow',
  'ach-survivor': 'day-night',
  'ach-pop_200': 'bld-houses',
} as const satisfies Record<string, DrawnIcon>;

/** Имя значка: нарисованное или ссылка на нарисованное. Опечатку ловит `tsc`. */
export type IconName = DrawnIcon | keyof typeof ALIAS;

/** Нарисованный значок под именем: ссылка раскрывается, своё имя — как есть. */
export const drawnOf = (name: string): string => (ALIAS as Record<string, string>)[name] ?? name;

/**
 * Значки первого экрана — едут в первую загрузку строкой кода, остальные — листом после первого кадра. Первый экран — это
 * верх (запасы, золото, жители, порядок, дружина, энергия, мораль, сезон и время суток), низ (ратуша, жители, карта или
 * город, дружина, вести), тревоги под верхом и войны справа, значки над крышами, кнопка подписей и заставка «Поверни
 * телефон» (`orientation.ts`).
 */
export const FIRST_SCREEN: readonly IconName[] = [
  'res-wood', 'res-stone', 'res-food', 'res-hides', 'res-charcoal', 'res-copper', 'res-iron', 'res-gold', 'res-gem',
  'nav-people', 'hud-army', 'hud-order', 'hud-map', 'ui-energy', 'bld-town_hall', 'ui-home', 'ui-mail', 'ui-scroll',
  'mood-good', 'mood-mid', 'mood-bad',
  'season-spring', 'season-sun', 'season-autumn', 'season-winter', 'day-morning', 'day-evening', 'day-night',
  'alert-raid', 'alert-siege', 'stage-camp', 'ui-bowl', 'attn-idle', 'bld-smithy', 'ui-phone',
];
