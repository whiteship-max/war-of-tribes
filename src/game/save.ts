import type { GameState } from './types';
import { DAY_LENGTH, MAX_OFFLINE_SECONDS } from './constants';
import { UPKEEP_TEXT, WAGE_AMNESTY_DAYS } from './data/upkeep';
import { taxIncomePerDay, wagesPerDay } from './derived';
import { emptyArmy } from './data/troops';
import { BUILDINGS } from './data/buildings';
import { emptyEquipment } from './data/equipment';
import { createInitialState, SAVE_VERSION } from './state';
import { catchUp } from './sim/tick';
import { normalizeAssignments } from './sim/workers';
import { log, trimLog } from './sim/log';
import { mergeAgents, nameAgents, mergeLineage } from './sim/agents';
import { AGENT_AGE0, LEVEL_XP } from './data/agents';
import { FIGURE_IDS } from '@/world/data/figures';
import { hashId } from '@/world/diplomacy';
import { cityName } from '../../netlify/lib/contract';
import type { ProfileState } from '@/profile/types';
import { refreshCard } from '@/profile/stats';
import { rescueFromCloud } from '@/telegram/cloud-rescue';
import { serverNow } from '@/net/clock';

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
  return JSON.stringify({ ...s, lastSaved: serverNow() });
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
function migrate(s: GameState, from: number, data: SavedState): void {
  if (from >= SAVE_VERSION) return;
  // 8 → 9: профиля не было вовсе. Статистику задним числом взять неоткуда, и
  // она начинается с нулей; мощь и визитка, наоборот, выводятся из посёлка и
  // дружины, которые в сохранении есть, — поэтому их считаем, а не обнуляем.
  if (from < 9) refreshCard(s);
  // 9 → 10: изучения округи не было вовсе. Ступеней пройдено ноль — задним
  // числом их взять неоткуда, а радиус деревни при этом не меняется: без
  // изучения она видит ровно свой круг обзора, как и раньше.
  if (from < 10) s.survey = { done: 0, startedAt: 0, until: 0 };
  // 10 → 11: кузница работала нарядом, а не заказами. Очередь начинается пустой,
  // и это честно: наряд ничего не оплачивал вперёд, а накопленная работа шла над
  // предметом, которого никто не заказывал. Со склада при этом ничего не ушло.
  if (from < 11) s.forge = [];
  // 11 → 12: покровителя больше нет, у деревни есть вера. Само поле `faith`
  // сюда уже приехало умолчанием — его кладёт слияние поверх новой партии
  // (`deserialize`), и веру задним числом всё равно взять неоткуда: её назовёт
  // мир по клетке замка первым же пульсом. Ступени остаётся два дела: убрать
  // покровителя из состояния, чтобы он не ездил в сохранении мёртвым полем, и
  // сказать игроку, что его выбора больше нет. Молчать нельзя — выбор был
  // необратимым и давал настоящую прибавку.
  if (from < 12) delete (s as { patron?: unknown }).patron;
  // 12 → 13: агенты смертны и стареют, у партии свой сид.
  if (from < 13) mortalAgents(s, data);
  // 13 → 14: войску платят жалованье. Умолчания мало: с `pay.from` = 0 армия,
  // набранная при потолке Статуи, платила бы с первой секунды и разбегалась бы при
  // первом же входе, а игрок о правиле ещё не знал. Отсрочка — с минуты входа,
  // после догона офлайна, как служба приведённых агентов. Налог не трогается.
  if (from < 14) {
    const entry = s.time + offlineSeconds(typeof data.lastSaved === 'number' ? data.lastSaved : serverNow());
    s.pay = { debt: 0, late: 0, gone: {}, from: entry + WAGE_AMNESTY_DAYS * DAY_LENGTH };
  }
  // Строка про грамоту вождя — про восьмёрку, и обязана быть под своим условием:
  // без него сохранение десятой версии узнавало бы о заведении профиля, который
  // у него давно есть.
  if (from < 9) log(s, 'Заведена грамота вождя: имя, лицо и счёт побед. Посёлок и дружина остались при своём.', 'info');
  if (from < 10) log(s, 'В Дозоре завели изучение округи: десять ступеней, и каждая открывает землю за кругом деревни.', 'info');
  if (from < 11) log(s, 'Кузница работает по заказам: наряд снят, закажи, сколько чего надо, — материалы спросят вперёд.', 'info');
  if (from < 12) {
    log(s, 'Покровитель племени отпущен: волк, медведь и орёл ушли в предания вместе со своими прибавками.', 'bad');
    log(s, 'Вместо них у деревни вера — та же, что у всей округи. Загляни в храм: там теперь и устав, и обряд.', 'info');
  }
  if (from < 13) {
    log(
      s,
      `Агенты получили имена и возраст: считаются нанятыми сегодня, опыт при них. Теперь они смертны — гибнут на деле и уходят на покой в шестьдесят; место нанимают заново.`,
      'info',
    );
  }
  if (from < 14) {
    log(s, 'Статуя больше не ограничивает дружину: полководец уводит сколько угодно. Войско держит цена — еда и жалованье.', 'info');
    log(s, UPKEEP_TEXT.amnestyLog(wagesPerDay(s), taxIncomePerDay(s)), 'bad');
  }
}

/**
 * Сколько догонять после записи — одна формула на догон и на ступень, которой нужно знать,
 * где кончится догон: служба приведённых агентов начинается в минуту входа, а не раньше.
 */
export const offlineSeconds = (lastSaved: number): number =>
  Math.min(Math.max(0, Math.floor((serverNow() - lastSaved) / 1000)), MAX_OFFLINE_SECONDS);

/** Пороги опыта до смертных агентов: по ним лежит опыт в сохранении двенадцатой версии. */
const OLD_LEVEL_XP = [0, 20, 60, 130, 240] as const;

/**
 * Опыт по прежним порогам — на новые, так, чтобы уровень не сдвинулся, а путь к
 * следующему остался той же долей шага. Потолок остаётся потолком.
 */
export function rescaleXp(old: number): number {
  const xp = Math.max(0, Number.isFinite(old) ? old : 0);
  const top = OLD_LEVEL_XP.length - 1;
  if (xp >= OLD_LEVEL_XP[top]) return LEVEL_XP[top];
  let level = 0;
  while (level < top - 1 && xp >= OLD_LEVEL_XP[level + 1]) level++;
  const frac = (xp - OLD_LEVEL_XP[level]) / (OLD_LEVEL_XP[level + 1] - OLD_LEVEL_XP[level]);
  return LEVEL_XP[level] + Math.floor(frac * (LEVEL_XP[level + 1] - LEVEL_XP[level]));
}

/**
 * Ступень 12 → 13. Умолчания здесь не хватает: `bornAt` = 0 в партии с большим
 * `s.time` сделал бы всех четверых стариками, и на первом же пульсе они ушли бы на
 * покой. Поэтому служба начинается **сейчас**: агенты считаются нанятыми в минуту
 * входа — после догона офлайна, который загрузка сделает следом, — в `AGENT_AGE0` лет, с
 * тем опытом, что был. Иначе четыре часа догона при нынешнем годе в двадцать минут
 * состарили бы их на двенадцать лет за то время, когда они ещё не старели.
 *
 * Сид партии тоже выводится из неё самой, а не берётся у устройства: одно и то же
 * сохранение, загруженное дважды до первой записи, обязано получить одних и тех же
 * агентов. Имя героя переходит полководцу — это один человек, и игрок знает его по
 * имени.
 */
function mortalAgents(s: GameState, data: SavedState): void {
  const oldHero = (data.hero ?? {}) as { name?: unknown };
  s.seed = hashId(`${String(oldHero.name ?? '')}|${data.lastSaved ?? 0}|${data.time ?? 0}|${data.nextId ?? 0}`) & 0x7fffffff;
  s.rolls = 0;
  s.hires = 0;
  // Опыт — сырой, из сохранения: слияние уже подрезало его под новый потолок, и
  // четвёртый уровень по прежним порогам приехал бы третьим.
  const oldAgents = (data.agents ?? {}) as Partial<Record<string, { xp?: unknown }>>;
  for (const id of FIGURE_IDS) {
    const p = s.agents[id];
    const raw = oldAgents[id]?.xp;
    p.xp = rescaleXp(typeof raw === 'number' ? raw : 0);
    p.person = 0;
    p.bornAt = s.time + offlineSeconds(typeof data.lastSaved === 'number' ? data.lastSaved : serverNow());
    p.age0 = AGENT_AGE0;
    p.vacant = false;
    p.hiring = null;
    p.name = id === 'general' ? cityName(oldHero.name) : null;
  }
  // Остальным трём — имена по вере, если мир её уже называл; нет — назовёт первым пульсом.
  nameAgents(s);
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
      // Содержание войска мержится по полям по той же причине, что рынок и вера:
      // спред `...data` на уровень ниже не спускается. Партия младше четырнадцатой
      // приезжает с умолчанием, а начало платы ей ставит ступень 13 → 14.
      pay: { ...base.pay, ...(data.pay ?? {}), gone: { ...(data.pay?.gone ?? {}) } },
      forge: data.forge ?? [],
      // Назначения — словари счётчиков: их мержить нельзя, иначе исчезнувшее
      // здание оставило бы за собой рабочих. Берём как есть, а порядок наведёт
      // normalizeAssignments ниже.
      workers: { ...(data.workers ?? {}) },
      freeJobs: { ...(data.freeJobs ?? {}) },
      // Невольники на местах — такой же словарь назначений, и по той же причине
      // берутся как есть. Сохранение, записанное до невольников, приезжает без
      // поля — тогда пустой словарь, и порядок наведёт тот же normalizeAssignments.
      bondedWork: { ...(data.bondedWork ?? {}) },
      // Счёт проданного за день появился позже счёта купленного: у старого
      // сохранения его нет, и он начинается пустым, а не undefined.
      market: { day: 0, bought: {}, sold: {}, ...(data.market ?? {}) },
      // Изучение округи мержится по полям по той же причине, что рынок и
      // ежедневка: спред `...data` на уровень ниже не спускается.
      survey: { ...base.survey, ...(data.survey ?? {}) },
      // Орудие башни — тем же приёмом: партия до орудий приезжает башней без орудия.
      engine: { ...base.engine, ...(data.engine ?? {}) },
      // Вера мержится по полям по той же причине, что рынок и изучение округи:
      // спред `...data` на уровень ниже не спускается, и сохранение, записанное
      // до появления нового поля внутри FaithState, привезло бы его как undefined.
      // Отсюда же и приведение старых партий: сохранение без `faith` вовсе
      // приезжает с верой по умолчанию, и миграции об этом заботиться не надо.
      faith: { ...base.faith, ...(data.faith ?? {}) },
      // Ежедневка мержится по полям по той же причине, что и рынок: спред
      // `...data` на уровень ниже не спускается, и сохранение, записанное до
      // появления нового поля внутри DailyState, привезло бы его как undefined.
      daily: { ...base.daily, ...(data.daily ?? {}) },
      caravans: data.caravans ?? [],
      battlePlans: data.battlePlans ?? [],
      stats: { ...base.stats, ...(data.stats ?? {}) },
      profile: mergeProfile(base.profile, data.profile),
      // Агенты — словарь по агентам, как армия по видам: мержится поштучно, а
      // каждое поле читается с проверкой. Партия, записанная до опыта, приезжает
      // агентами первого уровня — ровно сегодняшними, — и версию это не поднимает.
      agents: mergeAgents(data.agents),
      // Родословная — по месту, каждая запись с проверкой и под потолком места.
      // Партия до родословной приезжает с пустой: вспоминать ушедших задним
      // числом не из чего, и версию это не поднимает.
      lineage: mergeLineage(data.lineage),
      // Герой мержится по полям и только теми, что у него остались: имя ушло к
      // полководцу, свой срок «ранен» — к миру (он и есть разбитый полководец).
      hero: {
        kind: data.hero?.kind ?? base.hero.kind,
        marchId: typeof data.hero?.marchId === 'string' ? data.hero.marchId : null,
      },
      seed: typeof data.seed === 'number' && Number.isFinite(data.seed) ? data.seed >>> 0 : base.seed,
      rolls: typeof data.rolls === 'number' && Number.isFinite(data.rolls) ? Math.max(0, Math.floor(data.rolls)) : 0,
      hires: typeof data.hires === 'number' && Number.isFinite(data.hires) ? Math.max(0, Math.floor(data.hires)) : 0,
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
    migrate(s, from, data);
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
 * Запись партии на устройство. Одна на всю игру: и автосохранение, и выход из
 * вкладки, и «положить прямо сейчас» — это она.
 *
 * **Синхронная.** Раньше их было две — быстрая для `beforeunload`, который не
 * ждёт промисов, и медленная с облаком Telegram. Облака больше нет
 * (`telegram/cloud-rescue.ts` объясняет, почему), и второй остаться незачем:
 * два способа записать одно и то же расходятся ровно в тот день, когда формат
 * меняют. Заодно «попытка ежедневки ложится на диск сразу» стало правдой без
 * оговорок — не в следующем микротаске, а в этой же строке.
 *
 * Живёт она здесь, а не у того, кто закрывает вкладку, по одной причине: ключ
 * и формат сохранения должны быть записаны в одном месте. Второй слой, знающий
 * `KEY` и умеющий собрать json сам, обходит любой договор о том, чего в
 * сохранении быть не должно: записать туда можно что угодно, минуя `serialize`.
 * Тест «сейв пишет только save.ts» в sim/gems.test.ts держит это.
 */
export function saveGame(s: GameState): void {
  try {
    localStorage.setItem(KEY, serialize(s));
  } catch {
    /* localStorage может быть недоступен */
  }
}

export interface LoadResult {
  state: GameState;
  offlineSeconds: number;
  fresh: boolean;
  /** Сохранение было, но старого формата: его отбросили и начали новую партию. */
  legacy: boolean;
}

/**
 * Крючки загрузки. Нужны одному — экрану загрузки: подсчёт офлайна занимает
 * заметное время, и он обязан быть отдельной стадией, а не молчаливой паузой.
 * Крючок асинхронный нарочно: оболочка успевает нарисовать кадр с подписью
 * до того, как счёт начнётся и заблокирует поток.
 */
export interface LoadHooks {
  /** Зовётся перед догоном, если догонять есть что. */
  onOffline?: (seconds: number) => Promise<void> | void;
}

export async function loadGame(hooks: LoadHooks = {}): Promise<LoadResult> {
  let json: string | null = null;
  try {
    json = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  // Своей копии нет — значит это тот единственный случай, ради которого
  // осталось чтение облака Telegram: партия могла лежать только там (играли до
  // появления сервера, потом потеряли локальную копию). Подъём разовый —
  // поднятое тут же ложится на диск, и второй раз облако не спросят. Хранилищем
  // облако быть перестало, писать туда больше нечем: см. `cloud-rescue.ts`.
  //
  // Спрашивают его именно здесь, а не «если сервер не ответил»: сеть не имеет
  // права стоять на пути к первому кадру, а синхронизация начинается уже после
  // запуска. Если и на сервере лежит партия, слой синхронизации увидит две
  // живые копии и спросит игрока — молча за него не выберет никто.
  const lifted = json ? null : await rescueFromCloud(KEY);
  const chosen = json ?? lifted;
  const state = chosen ? deserialize(chosen) : null;
  if (!state) {
    // Что-то лежало, но прочитать это нельзя — старый формат. Молча стирать
    // прогресс нельзя: игроку об этом скажет отдельное окно.
    const legacy = Boolean(chosen);
    if (legacy) clearSave();
    return { state: createInitialState(), offlineSeconds: 0, fresh: true, legacy };
  }

  if (lifted && chosen) {
    // Подъём закрепляется на диске сразу и до всякого догона: игрок может
    // закрыть игру в первую же секунду, а второго подъёма не будет — облако
    // спрашивают только при пустом устройстве, и оно только что перестало быть
    // пустым. Строка в летописи — потому что молчаливым подъём быть не должен:
    // партия приехала из места, о котором игрок не просил.
    try {
      localStorage.setItem(KEY, chosen);
    } catch {
      /* localStorage может быть недоступен */
    }
    log(state, 'Партия поднята из облака Telegram: на этом устройстве её не было.');
  }

  const offline = offlineSeconds(state.lastSaved);
  if (offline > 5) {
    await hooks.onOffline?.(offline);
    catchUp(state, offline, 2);
  }
  return { state, offlineSeconds: offline, fresh: false, legacy: false };
}

/**
 * Положить на диск чужое сохранение — то, что приехало с сервера, когда игрок
 * выбрал партию с другого устройства.
 *
 * Живёт здесь по той же причине, по какой здесь живёт `saveGame`: ключ и
 * формат сохранения знает один файл. Строка при этом не принимается на слово —
 * она сперва разбирается: положить на диск то, что игра потом не прочтёт,
 * значит потерять и её, и ту партию, которую она заменила.
 *
 * Возвращает `false`, если строка не разобралась. Тогда ничего не записано.
 */
export function adoptSave(json: string): boolean {
  if (!deserialize(json)) return false;
  try {
    localStorage.setItem(KEY, json);
  } catch {
    return false;
  }
  return true;
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
