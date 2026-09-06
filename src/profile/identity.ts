// Кто игрок: имя и лицо. Три источника, и порядок между ними жёсткий —
// свой выбор, потом Telegram, потом умолчание. Переопределение живёт в
// сохранении и приоритетнее данных Telegram: игрок, назвавшийся сам, не должен
// переименовываться обратно при следующем запуске.
import type { Avatar, AvatarId } from '@/data/avatars';
import { AVATARS } from '@/data/avatars';
import type { GameState } from '@/game/types';
import type { ProfileState } from './types';

/** Кем игрок выходит, пока не выбрал сам и пока Telegram молчит. */
export const DEFAULT_AVATAR: AvatarId = '01_swordsman';
export const DEFAULT_NAME = 'Вождь';

/** Длиннее имя не влезает ни в кружок, ни в визитку. */
export const NAME_MAX = 24;

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t.slice(0, NAME_MAX) : null;
};

/** Вид из набора по идентификатору. Набор непустой, поэтому что-то вернётся всегда. */
export const avatarById = (id: AvatarId | null): Avatar =>
  AVATARS.find((a) => a.id === (id ?? DEFAULT_AVATAR)) ?? AVATARS[0];

/** Имя игрока: своё → из Telegram → «Вождь». */
export const profileName = (p: ProfileState): string => clean(p.name) ?? clean(p.tgName) ?? DEFAULT_NAME;

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

// ---------- Действия игрока ----------

/** Переименование. Пустое имя — не ошибка, а отказ от своего: вернётся Telegram. */
export function setName(s: GameState, name: string): string | null {
  s.profile.name = clean(name);
  return null;
}

/** Выбор из набора. Он перебивает фото Telegram — на то и выбор. */
export function setAvatar(s: GameState, id: AvatarId): string | null {
  if (!AVATARS.some((a) => a.id === id)) return 'Такого аватара нет.';
  s.profile.avatarId = id;
  return null;
}

/**
 * Что отдал Telegram при запуске. Кладёт это интерфейс, а не симуляция: про
 * Telegram она не знает, а визитке нужны готовые значения, а не вызов на лету.
 */
export function setTelegramIdentity(s: GameState, name: string | null, photo: string | null): void {
  s.profile.tgName = clean(name);
  s.profile.tgPhoto = photo && /^https?:\/\//i.test(photo) ? photo : null;
}
