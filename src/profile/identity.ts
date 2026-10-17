// Кто игрок: имя и герб. У имени три источника, и порядок между ними жёсткий —
// свой выбор, потом Telegram, потом умолчание. Переопределение живёт в
// сохранении и приоритетнее данных Telegram: игрок, назвавшийся сам, не должен
// переименовываться обратно при следующем запуске.
//
// Здесь только чтение. Пишут имя и герб там же, где пишут всё остальное про
// профиль, — в stats.ts: любая правка обязана пересобрать визитку, а знать про
// визитку этому модулю незачем (и нельзя: вышел бы круг импортов).
import { armsOr, type Arms } from '@/heraldry/arms';
import type { ProfileState } from './types';
import { DEFAULT_CITY, cityName, cityOr } from '../../netlify/lib/contract';

export { DEFAULT_CITY, cityName };

/** Как игрок зовётся, пока не назвался сам и пока Telegram молчит. */
export const DEFAULT_NAME = 'Правитель';

/** Длиннее имя не влезает ни в кружок, ни в визитку. */
export const NAME_MAX = 24;

/** Приводит введённое имя к тому, что можно хранить. Пусто — значит имени нет. */
export const cleanName = (v: string | null | undefined): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t.slice(0, NAME_MAX) : null;
};

/**
 * Имя своего города для показа: названное игроком или «Безымянный город». Поле читается
 * только здесь и только через очистку договора (`cityOr`) — сохранение могло прийти с
 * сервера от другой сборки, и доверять лежащей в нём строке нельзя.
 */
export const profileCity = (p: Pick<ProfileState, 'city'>): string => cityOr(p.city);

/** Имя игрока: своё → из Telegram → «Правитель». */
export const profileName = (p: ProfileState): string => cleanName(p.name) ?? cleanName(p.tgName) ?? DEFAULT_NAME;

/**
 * Герб державы: выбранный в конструкторе или прежний герб-башня (`DEFAULT_ARMS`). Поле читается только здесь и только через
 * проверку набора (`armsOr`) — сохранение могло прийти с сервера от другой сборки, и доверять строке в нём нельзя.
 */
export const profileArms = (p: Pick<ProfileState, 'arms'>): Arms => armsOr(p.arms);
