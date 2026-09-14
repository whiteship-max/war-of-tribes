// Кто игрок: имя и лицо. Три источника, и порядок между ними жёсткий —
// свой выбор, потом Telegram, потом умолчание. Переопределение живёт в
// сохранении и приоритетнее данных Telegram: игрок, назвавшийся сам, не должен
// переименовываться обратно при следующем запуске.
//
// Здесь только чтение. Пишут имя и лицо там же, где пишут всё остальное про
// профиль, — в stats.ts: любая правка обязана пересобрать визитку, а знать про
// визитку этому модулю незачем (и нельзя: вышел бы круг импортов).
import type { Avatar, AvatarId } from '@/data/avatars';
import { AVATARS } from '@/data/avatars';
import type { ProfileState } from './types';
import { DEFAULT_CITY, cityName, cityOr } from '../../netlify/lib/contract';

export { DEFAULT_CITY, cityName };

/** Кем игрок выходит, пока не выбрал сам и пока Telegram молчит. */
export const DEFAULT_AVATAR: AvatarId = '01_swordsman';
export const DEFAULT_NAME = 'Вождь';

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

/** Вид из набора по идентификатору. Набор непустой, поэтому что-то вернётся всегда. */
export const avatarById = (id: AvatarId | null): Avatar =>
  AVATARS.find((a) => a.id === (id ?? DEFAULT_AVATAR)) ?? AVATARS[0];

/** Имя игрока: своё → из Telegram → «Вождь». */
export const profileName = (p: ProfileState): string => cleanName(p.name) ?? cleanName(p.tgName) ?? DEFAULT_NAME;

/**
 * Аватар из набора. Он есть всегда — даже когда показывается фото Telegram:
 * фото ложится поверх, а на карточке и в визитке нужен вид из набора.
 */
export const profileAvatar = (p: ProfileState): Avatar => avatarById(p.avatarId);

/**
 * Фото Telegram — только пока игрок не выбрал своё. Выбрал — фото уходит:
 * иначе выбор из набора не имел бы видимого следствия.
 */
export const profilePhoto = (p: ProfileState): string | null => (p.avatarId ? null : p.tgPhoto);

/** Что рисовать в маленьком кружке. */
export const faceSrc = (p: ProfileState): string => profilePhoto(p) ?? profileAvatar(p).face;

/** Что рисовать крупно. У фото Telegram карточки нет — тогда карточка из набора. */
export const cardSrc = (p: ProfileState): string => profileAvatar(p).card;
