import type { GameState } from './types';
import { MAX_OFFLINE_SECONDS } from './constants';
import { emptyArmy } from './data/troops';
import { BUILDINGS } from './data/buildings';
import { emptyEquipment } from './data/equipment';
import { createInitialState, SAVE_VERSION } from './state';
import { catchUp } from './sim/tick';
import { normalizeAssignments } from './sim/workers';
import { log, trimLog } from './sim/log';
import type { ProfileState } from '@/profile/types';
import { refreshCard } from '@/profile/stats';
import { cloudGet, cloudSet } from '@/telegram/webapp';

const KEY = 'tribe.save.v1';

/**
 * С какой версии сохранение ещё можно привести. Всё, что старше, отбрасывается
 * по-прежнему и по прежней причине: в шестой версии население было списком
 * поимённых жителей, в седьмой посёлок был перестроен целиком — приводить там
 * нечего. Восьмёрка от девятки отличается только тем, чего в ней не было, и
 * это считается из самого состояния.
 */
export const MIN_SAVE_VERSION = 8;

export function serialize(s: GameState): string {
  return JSON.stringify({ ...s, lastSaved: Date.now() });
}

type SavedState = Partial<GameState> & { version?: number };

/**
 * Профиль мержится по полям, как рынок и статистика: спред `...data` на уровень
 * ниже не спускается, и сохранение, записанное до появления нового счётчика,
 * привезло бы его как undefined.
 */
const mergeProfile = (base: ProfileState, saved?: Partial<ProfileState>): ProfileState => ({
  ...base,
  ...(saved ?? {}),
  totals: {
    ...base.totals,
    ...(saved?.totals ?? {}),
    raidLoss: { ...base.totals.raidLoss, ...(saved?.totals?.raidLoss ?? {}) },
  },
  days: saved?.days ?? [],
  card: { ...base.card, ...(saved?.card ?? {}) },
});

/**
 * Приведение сохранений младших версий. Ступень получает состояние, уже слитое
 * поверх новой партии, и доделывает то, чего слияние знать не может: считает
 * величину из самого состояния вместо того, чтобы оставить умолчание.
 *
 * Прогресс не пропадает молча — о приведении сказано в летописи.
 */
function migrate(s: GameState, from: number): void {
  if (from >= SAVE_VERSION) return;
  // 8 → 9: профиля не было вовсе. Статистику задним числом взять неоткуда, и
  // она начинается с нулей; мощь и визитка, наоборот, выводятся из посёлка и
  // дружины, которые в сохранении есть, — поэтому их считаем, а не обнуляем.
  if (from < 9) refreshCard(s);
  log(s, 'Заведена грамота вождя: имя, лицо и счёт побед. Посёлок и дружина остались при своём.', 'info');
}

/**
 * Читает сохранение. Формат текущий — читается как есть; формат не старше
 * `MIN_SAVE_VERSION` — приводится к текущему (`migrate`); всё, что старше,
 * отбрасывается: в шестой версии население было списком поимённых жителей, в
 * седьмой посёлок был перестроен целиком, и приводить там нечего — возвращаем
 * null, а loadGame говорит игроку, что партия началась заново.
 */
export function deserialize(json: string): GameState | null {
  try {
    const data = JSON.parse(json) as SavedState;
    if (!data || typeof data.pop !== 'number') return null;
    const from = typeof data.version === 'number' ? data.version : 0;
    // Сохранение из будущего читать нечем: полей, которых мы не знаем, не бывает
    // только у младших версий.
    if (from < MIN_SAVE_VERSION || from > SAVE_VERSION) return null;
    const base = createInitialState();
    // Простое слияние: новые поля из createInitialState, остальное из сохранения.
    const s = {
      ...base,
      ...data,
      version: SAVE_VERSION,
      resources: { ...base.resources, ...(data.resources ?? {}) },
      // Снаряжение и армия — такие же словари счётчиков: новый вид бойца или
      // предмета не должен приезжать из сохранения как undefined.
      equipment: { ...emptyEquipment(), ...(data.equipment ?? {}) },
      army: { ...emptyArmy(), ...(data.army ?? {}) },
      recruits: data.recruits ?? [],
      // Назначения — словари счётчиков: их мержить нельзя, иначе исчезнувшее
      // здание оставило бы за собой рабочих. Берём как есть, а порядок наведёт
      // normalizeAssignments ниже.
      workers: { ...(data.workers ?? {}) },
      freeJobs: { ...(data.freeJobs ?? {}) },
      market: { day: 0, bought: {}, ...(data.market ?? {}) },
      // Ежедневка мержится по полям по той же причине, что и рынок: спред
      // `...data` на уровень ниже не спускается, и сохранение, записанное до
      // появления нового поля внутри DailyState, привезло бы его как undefined.
      daily: { ...base.daily, ...(data.daily ?? {}) },
      caravans: data.caravans ?? [],
      battlePlans: data.battlePlans ?? [],
      stats: { ...base.stats, ...(data.stats ?? {}) },
      profile: mergeProfile(base.profile, data.profile),
    } as GameState;
    // Здание, добавленное в BUILDINGS после того, как сохранение записали,
    // должно появиться в посёлке само — так же, как оно появляется в новой партии
    // (CLAUDE.md, «Правила»). Иначе игрок с сохранением остался бы без него
    // навсегда: `buildings` берётся из сохранения как есть, мержить его нельзя —
    // мерж вернул бы и здания, которых в игре больше нет.
    for (const def of BUILDINGS) {
      if (s.buildings.some((b) => b.type === def.id)) continue;
      s.buildings.push({ id: s.nextId++, type: def.id, level: 1, work: 0, workRequired: 0 });
    }
    normalizeAssignments(s);
    migrate(s, from);
    // Летопись старого сохранения могла копиться по прежнему правилу «последние
    // 80 записей» и растянуться на полгода игрового времени. Приводим её к тому
    // же месяцу, что и у новой партии, прямо на загрузке.
    trimLog(s);
    return s;
  } catch {
    return null;
  }
}

/**
 * Синхронная запись на выход из игры. `beforeunload` не ждёт промисов, поэтому
 * облака здесь нет — только localStorage.
 *
 * Живёт она здесь, а не у того, кто закрывает вкладку, по одной причине: ключ
 * и формат сохранения должны быть записаны в одном месте. Второй слой, знающий
 * `KEY` и умеющий собрать json сам, расходится с этим молча — и расходится он
 * ровно в тот день, когда формат меняют. Он же обходит любой договор о том,
 * чего в сохранении быть не должно: записать туда можно что угодно, минуя
 * `serialize`. Тест «сейв пишет только save.ts» в sim/gems.test.ts держит это.
 */
export function saveLocalNow(s: GameState): void {
  try {
    localStorage.setItem(KEY, serialize(s));
  } catch {
    /* localStorage может быть недоступен */
  }
}

export async function saveGame(s: GameState): Promise<void> {
  const json = serialize(s);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* localStorage может быть недоступен */
  }
  await cloudSet(KEY, json);
}

export interface LoadResult {
  state: GameState;
  offlineSeconds: number;
  fresh: boolean;
  /** Сохранение было, но старого формата: его отбросили и начали новую партию. */
  legacy: boolean;
}

export async function loadGame(): Promise<LoadResult> {
  let json: string | null = null;
  try {
    json = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  const cloud = await cloudGet(KEY);
  // Берём более свежее сохранение.
  const pickNewer = (a: string | null, b: string | null): string | null => {
    if (!a) return b;
    if (!b) return a;
    const ta = deserialize(a)?.lastSaved ?? 0;
    const tb = deserialize(b)?.lastSaved ?? 0;
    return tb > ta ? b : a;
  };
  const chosen = pickNewer(json, cloud);
  const state = chosen ? deserialize(chosen) : null;
  if (!state) {
    // Что-то лежало, но прочитать это нельзя — старый формат. Молча стирать
    // прогресс нельзя: игроку об этом скажет отдельное окно.
    const legacy = Boolean(json || cloud);
    if (legacy) clearSave();
    return { state: createInitialState(), offlineSeconds: 0, fresh: true, legacy };
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - state.lastSaved) / 1000));
  const offline = Math.min(elapsed, MAX_OFFLINE_SECONDS);
  if (offline > 5) catchUp(state, offline, 2);
  return { state, offlineSeconds: offline, fresh: false, legacy: false };
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
