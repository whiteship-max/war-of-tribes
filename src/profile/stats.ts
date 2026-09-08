// Единственная дверь в статистику профиля. Ни один экран и ни один компонент не
// пишет в эти поля напрямую: вызовы стоят там, где событие действительно
// происходит, — в симуляции. Иначе счётчик начинает считать не то, что случилось
// в игре, а то, что открыл игрок, и разъезжается с миром при первом же новом
// экране.
//
// Хранится две вещи и только они:
//   — накопительные итоги на всю партию;
//   — суточные корзины на месяц, и лишь по трём показателям (производство,
//     потери от грабежей, мощь).
// Журнала событий здесь нет нарочно: он растёт без предела, и его никто не читает.
import type { AvatarId } from '@/data/avatars';
import { AVATARS } from '@/data/avatars';
import type { GameState, ResourceId } from '@/game/types';
import { RESOURCE_IDS, emptyResources } from '@/game/constants';
import { dayOf } from '@/game/derived';
import type { ProfileDay, ProfileState } from './types';
import { DEFAULT_AVATAR, cleanName, profileAvatar, profileName, profilePhoto } from './identity';
import { power } from './power';

/** Сколько суточных корзин держим. Старше — выпадает; счёт по возрасту, не по числу. */
export const PROFILE_DAYS = 30;

/** Профиль новой партии: имени нет, лицо по умолчанию, счётчики в нулях. */
export function emptyProfile(): ProfileState {
  return {
    name: null,
    avatarId: null,
    tgName: null,
    tgPhoto: null,
    totals: {
      produced: 0,
      spent: 0,
      raidLoss: emptyResources(),
      raids: 0,
      troopsLost: 0,
      lootResources: 0,
      lootGold: 0,
    },
    days: [],
    card: {
      name: '',
      avatarId: DEFAULT_AVATAR,
      photo: null,
      power: 0,
      battlesWon: 0,
      battlesLost: 0,
      at: 0,
    },
  };
}

/**
 * Корзина текущего игрового дня. Кольцо режется по возрасту: корзина старше
 * месяца выпадает, сколько бы их ни было. По количеству резать нельзя — в
 * бурной партии месяц уложился бы в десяток корзин, а в спокойной растянулся
 * бы на год (та же ошибка, что когда-то была у летописи).
 */
function bucket(s: GameState): ProfileDay {
  const day = dayOf(s.time);
  const days = s.profile.days;
  while (days.length > 0 && day - days[0].day >= PROFILE_DAYS) days.shift();
  const last = days[days.length - 1];
  if (last && last.day === day) return last;
  const fresh: ProfileDay = { day, produced: 0, raidLoss: 0, power: 0 };
  days.push(fresh);
  return fresh;
}

const sumOf = (r: Partial<Record<ResourceId, number>>): number =>
  RESOURCE_IDS.reduce((n, id) => n + Math.max(0, r[id] ?? 0), 0);

// ---------- Что записывается ----------

/** Хозяйство добыло. Зовётся из тика по тому, что действительно легло на склад. */
export function recordProduced(s: GameState, amount: number): void {
  if (!(amount > 0)) return;
  s.profile.totals.produced += amount;
  bucket(s).produced += amount;
}

/** Ресурсы ушли на дело: стройка, ковка, наём. Возвраты сюда не приходят. */
export function recordSpent(s: GameState, cost: Partial<Record<ResourceId, number>>): void {
  const n = sumOf(cost);
  if (n > 0) s.profile.totals.spent += n;
}

/**
 * Чужие унесли добро. Разбивка по ресурсам остаётся: она и отвечает на вопрос
 * «что у меня утекает», ради которого раздел потерь вообще есть.
 */
export function recordRaidLoss(s: GameState, lost: Partial<Record<ResourceId, number>>): void {
  const total = sumOf(lost);
  if (total <= 0) return;
  for (const id of RESOURCE_IDS) {
    const n = Math.max(0, lost[id] ?? 0);
    if (n > 0) s.profile.totals.raidLoss[id] += n;
  }
  s.profile.totals.raids += 1;
  bucket(s).raidLoss += total;
}

/** Бойцы не вернулись — из похода или от своих ворот. */
export function recordTroopsLost(s: GameState, n: number): void {
  if (!(n > 0)) return;
  s.profile.totals.troopsLost += Math.round(n);
}

/** Привезли своё. Золото считается отдельно: оно не ресурс и склад его не держит. */
export function recordLoot(
  s: GameState,
  resources: Partial<Record<ResourceId, number>>,
  gold: number,
): void {
  const n = sumOf(resources);
  if (n > 0) s.profile.totals.lootResources += n;
  if (gold > 0) s.profile.totals.lootGold += gold;
}

/**
 * Итог боя. Счёт битв живёт в `s.stats` — он старше профиля и на нём висят
 * задания, — но правится он отсюда: двух дверей к одному счётчику быть не должно.
 */
export function recordBattle(s: GameState, outcome: 'won' | 'lost'): void {
  if (outcome === 'won') s.stats.battlesWon++;
  else s.stats.battlesLost++;
  refreshCard(s);
}

/**
 * Логово сожжено. Счётчик живёт в `s.stats` — там же, где счёт битв и взятых
 * замков, — но правится отсюда: двух дверей к одному счётчику быть не должно.
 * Пишется он в одном месте, в `applyExpedition`, по отметке из мира, а не по
 * добыче: пустое логово тоже сожжено.
 */
export function recordLairBurned(s: GameState): void {
  s.stats.lairs = (s.stats.lairs ?? 0) + 1;
}

// ---------- Визитка ----------

/**
 * Пересобирает визитку: готовые значения, которые потом увидит чужой игрок на
 * карте мира. Собирать их там будет не из чего — ни зданий, ни армии у него под
 * рукой не окажется, — поэтому они лежат посчитанными. Заодно корзина дня
 * запоминает мощь на этот день.
 */
export function refreshCard(s: GameState): void {
  const p = s.profile;
  const now = power(s);
  p.card = {
    name: profileName(p),
    avatarId: profileAvatar(p).id,
    photo: profilePhoto(p),
    power: now,
    battlesWon: s.stats.battlesWon,
    battlesLost: s.stats.battlesLost,
    at: s.time,
  };
  bucket(s).power = now;
}

/** Корзины по возрастанию дня — то, что показывает панель. */
export const recentDays = (s: GameState): ProfileDay[] => s.profile.days.slice();

// ---------- Имя и лицо ----------
//
// Пишутся здесь, а не в identity.ts, по той же причине, по какой здесь пишется
// статистика: любая правка обязана пересобрать визитку. Оставь запись рядом с
// чтением — и визитка держала бы старое имя до следующего игрового дня, а
// именно её увидят чужие глаза на карте мира.

/** Переименование. Пустое имя — не ошибка, а отказ от своего: вернётся Telegram. */
export function setName(s: GameState, name: string): string | null {
  s.profile.name = cleanName(name);
  refreshCard(s);
  return null;
}

/** Выбор из набора. Он перебивает фото Telegram — на то и выбор. */
export function setAvatar(s: GameState, id: AvatarId): string | null {
  if (!AVATARS.some((a) => a.id === id)) return 'Такого аватара нет.';
  s.profile.avatarId = id;
  refreshCard(s);
  return null;
}

/**
 * Отказ от своего выбора: вернуть фото Telegram. Без этого выбор был бы
 * необратимым — а необратимых развилок в игре ровно одна, и это покровитель.
 */
export function clearAvatar(s: GameState): string | null {
  s.profile.avatarId = null;
  refreshCard(s);
  return null;
}

/**
 * Что отдал Telegram при запуске. Кладёт это оболочка интерфейса, а не
 * симуляция: про Telegram она не знает, а визитке нужны готовые значения.
 */
export function setTelegramIdentity(s: GameState, name: string | null, photo: string | null): void {
  s.profile.tgName = cleanName(name);
  s.profile.tgPhoto = photo && /^https?:\/\//i.test(photo) ? photo : null;
  refreshCard(s);
}
