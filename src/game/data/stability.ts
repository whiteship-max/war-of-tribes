// Стабильность державы: имена и слова, которыми о ней говорит симуляция, — ступени, группы, строки летописи и вести
// мятежа (docs/stability.md). Слова экрана раздела — в его куске (`ui/realm/stabWords.ts`): в первую загрузку они не едут.
//
// Модуль чистый: только слова и числа из аргументов. Считает `sim/stability`.
import type { RevoltGroup, StabGroup } from '../types';
import type { IconName } from '@/ui/icons/alias';

/** Имя значка набора (docs/icons.md) — с проверкой `tsc`. */
const ico = (name: IconName): IconName => name;

/** Ступени словами мира, от −3 до +3. */
export const STAB_NAMES: Record<string, string> = {
  '-3': 'Смута',
  '-2': 'Раздор',
  '-1': 'Шатко',
  '0': 'Мир',
  '1': 'Лад',
  '2': 'Достаток',
  '3': 'Благоденствие',
};

/** Имя ступени. */
export const stabName = (level: number): string => STAB_NAMES[String(Math.round(level))] ?? STAB_NAMES['0'];

/** «+1», «0», «−2» — знак минуса типографский, как у прочих чисел игры. */
export const stabSigned = (level: number): string => (level > 0 ? `+${level}` : level < 0 ? `−${-level}` : '0');

/** Группы недовольных: имя полосы и значок. */
export const GROUP_META: Record<StabGroup, { name: string; icon: IconName }> = {
  folk: { name: 'Податные', icon: ico('nav-people') },
  hungry: { name: 'Голодные', icon: ico('ui-bowl') },
  bonded: { name: 'Невольники', icon: ico('ui-chain') },
  army: { name: 'Войско', icon: ico('hud-army') },
};

/** Вести мятежа в общей таблице событий (`data/events`): своя ячейка стола, как у мятежа невольников (`sim/mail`). */
export const REVOLT_EVENT: Record<RevoltGroup, string> = { folk: 'revolt_folk', hungry: 'revolt_hungry' };
/** Условия мятежников, когда подавить не вышло. */
export const TERMS_EVENT = 'revolt_terms';
/** Все вести стабильности — по ним почта даёт им свою ячейку, а приход вестей ждёт, пока мятеж не решён. */
export const STAB_EVENTS: readonly string[] = [REVOLT_EVENT.folk, REVOLT_EVENT.hungry, TERMS_EVENT];

/** Строки летописи стабильности (род `stab`): смена ступени, мятеж и его исход. */
export const STAB_LOG = {
  up: (name: string, why: string): string => `Стабильность: ${name}. ${why}`,
  down: (name: string, why: string): string => `Стабильность: ${name}. ${why}`,
  why: {
    calm: 'Тихие дни сделали своё.',
    drift: 'Недовольство взяло своё.',
    bought: 'Правитель укрепил державу.',
    revolt: 'Город поднялся.',
    mutiny: 'Невольники поднялись.',
    army: 'Войско перестало ждать жалованья.',
    fallen: 'Город пал.',
    terms: 'Мятежники не разошлись.',
  },
  rose: (group: string, rebels: number): string => `Мятеж: ${group.toLowerCase()} встали, ${rebels} не выходят на работу.`,
  calmed: 'Мятежники разошлись по домам и вернулись к работе.',
};

/** Вести мятежа: заголовок, кто пишет, текст и подписи ответов. Числа — аргументами. */
export const REVOLT_TEXT = {
  title: { folk: 'Мятеж податных', hungry: 'Хлебный бунт' } as Record<RevoltGroup, string>,
  from: 'Старший стражи',
  text: {
    folk: (rebels: number): string =>
      `Податные бросили работу и собрались у ратуши. Их ${rebels}: требуют облегчить подати и грозят воротами.`,
    hungry: (rebels: number): string =>
      `Голодные вышли на площадь. Их ${rebels}: требуют хлеба, амбарам грозит разгром.`,
  } as Record<RevoltGroup, (rebels: number) => string>,
  waits: 'Без ответа стража выйдет сама',
  suppress: 'Подавить силой',
  suppressHint: (rebels: number): string => `Бой у ворот с ${rebels} мятежниками; отбились — недовольство спадёт вдвое`,
  concede: { folk: 'Уступить податным', hungry: 'Раздать хлеб и золото' } as Record<RevoltGroup, string>,
  wait: 'Переждать',
  waitHint: (days: string): string => `Мятежники стоят ещё ${days}, потом расходятся; недовольство — вдвое`,
  suppressed: 'Стража вышла к воротам. Чем кончилось, скажет донесение.',
  conceded: 'Уступили. Люди разошлись и вернулись к работе.',
  waited: 'Ждут, пока мятеж выдохнется. Работа стоит.',
  held: 'Мятеж подавлен у ворот. Люди вернулись к работе, но смотрят исподлобья.',
  termsTitle: 'Условия мятежников',
  termsText: 'Стража не удержала ворота. Мятежники заняли площадь и ставят условия.',
  termsConcede: 'Принять условия',
  termsRefuse: 'Не уступать',
  termsRefuseHint: (days: string): string => `Упадок ещё ${days} и стабильность ступенью ниже`,
  refused: 'Условий не приняли. Мятежники держат площадь, работа стоит.',
};

/** Что даст уступка податным — словами, по тому, что у города сейчас. */
export const concedeWords = {
  tax: (from: string, to: string): string => `Налог: ${from.toLowerCase()} → ${to.toLowerCase()}; недовольство в ноль`,
  decree: (to: string): string => `Указ: ${to.toLowerCase()}; недовольство в ноль`,
  nothing: 'Обещания; недовольство в ноль',
  pay: 'Недовольство в ноль',
};
