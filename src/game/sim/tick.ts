// Главный шаг симуляции. Мутирует состояние на месте.
import type { GameState } from '../types';
import { DAY_LENGTH, MAX_OFFLINE_DAYS, RESOURCE_IDS, STARVATION_DEATH } from '../constants';
import { gameSec, gameSeconds, realSec } from '../pace';
import { CHEATS_ON } from '@/cheats';
import {
  buildRate,
  currentSite,
  foodConsumptionPerDay,
  foodShortfall,
  heatingWoodPerDay,
  moraleBreakdown,
  policyMoralePerDay,
  productionPerDay,
  seasonDayOf,
  seasonIndex,
  seasonMods,
  seasonOf,
  storageCap,
  taxIncomePerDay,
  yearOf,
} from '../derived';
import { COLD_DEATH, SEASON_DAYS, SEASON_META } from '../data/seasons';
import { BUILDING_BY_ID } from '../data/buildings';
import { QUESTS } from '../data/quests';
import { MUTINY_EVENT } from '../data/order';
import { famineToll, growthTick, killPop, logPopDay } from './population';
import { unrestTick } from './mutiny';
import { stabilityTick, stabShock } from './stability';
import { mailArrive, raiseEvent } from './mail';
import { normalizeAssignments } from './workers';
import { forgeTick } from './smithy';
import { surveyTick } from './survey';
import { marketTick, rollShift } from './caravan';
import { recruitTick } from './army';
import { upkeepTick } from './upkeep';
import { councilStep, vacancyEvent } from './council';
import { recruitStep } from './recruit';
import { estatesStep } from './estates';
import { settleHires } from './hire';
import { dynastyStep } from './dynasty';
import { siegeHunger } from './siege';
import { settleWounds } from './infirmary';
import { log, trimLog } from './log';
import { addStock, stockWords, trimStock, type Gains } from './stock';
import { recordProduced, refreshCard } from '@/profile/stats';

export interface TickOptions {
  /** Офлайн-догон: события не запускаются. */
  offline?: boolean;
}

/**
 * Шаг симуляции. Без игрока он ничего не разрешает: донесения, оставленные без ответа, — и мятеж
 * среди них — разрешает почта настоящими часами (`sim/mail.mailStep`).
 */
export function tick(s: GameState, dt: number, opts: TickOptions = {}): void {
  const dayBefore = Math.floor(s.time / DAY_LENGTH);
  const seasonBefore = seasonIndex(s.time);
  s.time += dt;
  const dayAfter = Math.floor(s.time / DAY_LENGTH);

  // Осаду снимает мир своим пульсом. В догоне пульса нет: он идёт до того, как мир
  // вообще открылся, — и здесь, и только здесь, осада снимается по сроку, который мир
  // назвал последним (`SiegeState.until`). Склад в засухе её не снимает (ОС-1): голод
  // решает мир в шаге осады по этой засухе, и снятая осада стёрла бы её вместе с полем.
  if (opts.offline && s.siege && s.time >= s.siege.until && s.siege.dry === undefined) s.siege = null;

  // Мир мог измениться между тиками (сгорела хижина, кончилась стройка) —
  // сначала приводим в порядок, кто где работает, потом считаем по этим данным.
  normalizeAssignments(s);

  // Места агентов: нанятый пришёл — встаёт на место; безымянным — имя, как только
  // мир назвал веру. Возраст не тикает: он выводится из этих же часов при чтении.
  settleHires(s);
  // Дом правителя — тем же порядком и по той же причине: имя, как только известна
  // вера, и вступление наследника, когда правитель дожил до покоя. Очки здесь не
  // считаются вовсе: они функция времени и выводятся при чтении (`sim/points`).
  dynastyStep(s);
  // Раненые, чей срок прошёл, встают в строй. Не тик: отметка в группе и одна сверка с часами.
  settleWounds(s);

  // Сезон читается один раз за тик и дальше передаётся вниз: все множители из одной таблицы.
  const mods = seasonMods(s);

  // 1. Производство и потребление.
  const prod = productionPerDay(s, mods);
  const cap = storageCap(s);
  // Вместимость могла упасть между шагами (склад потерял уровень): излишек сгорает строкой летописи, а не молча
  // срезом выработки (`sim/stock`, решение владельца — склад не выше вместимости).
  trimStock(s, cap);
  // Профиль считает добытое по тому, что действительно легло на склад: полный
  // склад ничего не добавил, и в итогах этого быть не должно. Выработка — фоновое дело: сверх вместимости она
  // срезается без окна, отрицательная (уголь жжёт дрова) убавляет как обычно.
  let gained = 0;
  for (const r of RESOURCE_IDS) {
    if (!prod[r]) continue;
    gained += Math.max(0, addStock(s, r, (prod[r] * dt) / DAY_LENGTH, cap));
  }
  recordProduced(s, gained);
  const eat = (foodConsumptionPerDay(s, mods) * dt) / DAY_LENGTH;
  s.resources.food -= eat;
  // Баланс шага до отреза по нулю: по нему осада судит, оплачен ли прокорм (`sim/siege.siegeHunger`, в конце шага).
  const balance = s.resources.food;
  // Амбар пуст, только если еды на этом шаге не хватило, — а не «почти пуст»: порог
  // тревоги (`derived.foodShortfall`) шагу не судья.
  const empty = s.resources.food < 0;
  if (empty) s.resources.food = 0;
  // Амбар пуст — войско ест последним. Нехватку сначала несёт оно (уходит через
  // дверь содержания, шагом ниже), и жители голодают только тогда, когда нехватка
  // больше того, что ест войско: за армию посёлок больше не платит.
  const hunger = empty ? foodShortfall(s, mods) : { army: 0, town: false };
  if (hunger.town) {
    s.starvation += dt;
    if (s.starvation >= STARVATION_DEATH) {
      s.starvation = STARVATION_DEATH * 0.5;
      killPop(s, famineToll(s), 'голод');
    }
  } else {
    s.starvation = Math.max(0, s.starvation - dt * 2);
  }

  // 1б. Отопление: зимой очаги жгут дрова. Кончились — племя мёрзнет,
  // мораль валится вдвое быстрее (см. moraleTarget и speed ниже), а холод забирает стариков.
  const heat = (heatingWoodPerDay(s, mods) * dt) / DAY_LENGTH;
  if (heat > 0) {
    s.resources.wood -= heat;
    if (s.resources.wood < 0) {
      s.resources.wood = 0;
      s.freezing += dt;
      if (s.freezing >= COLD_DEATH) {
        s.freezing = COLD_DEATH * 0.5;
        killPop(s, famineToll(s), 'холод');
      }
    } else {
      s.freezing = Math.max(0, s.freezing - dt * 2);
    }
  } else {
    s.freezing = Math.max(0, s.freezing - dt * 2);
  }

  // 2. Улучшения: свободные жители и ремесленники работают над первым в очереди.
  const site = currentSite(s);
  if (site) {
    site.work += buildRate(s, mods) * dt;
    if (site.work >= site.workRequired) {
      site.level += 1;
      site.work = 0;
      site.workRequired = 0;
      log(s, `Достроили: ${BUILDING_BY_ID[site.type].name.toLowerCase()}, ур. ${site.level}.`, 'good', undefined, 'build');
    }
  }

  // 3. Кузница и казармы. Кузнец кует снаряжение, казармы превращают свободных
  // жителей в бойцов — обе очереди идут своим чередом, как стройка.
  forgeTick(s, dt);
  recruitTick(s, dt);
  // Изучение округи в Дозоре: не работа, а срок. Одна сверка отметки с часами —
  // поэтому офлайн-догон проходит мимо неё ровно так же, как непрерывная игра.
  surveyTick(s);

  // 3б. Рынок: налог капает в казну, дневной прилавок обновляется со сменой дня,
  // вернувшиеся караваны разгружаются.
  marketTick(s, dt, taxIncomePerDay(s));
  // 3в. Содержание войска: жалованье из казны, долг, терпение и уход — голодом или
  // неуплатой, одной дверью. Долг, терпение и уход зреют по времени — при игроке и без него.
  upkeepTick(s, dt, hunger.army);
  // 3г. Совет Ратуши (РТ-1): книга жалованья, уход неуплатой и конец службы по часам; опустевшее место — весть на стол.
  for (const post of councilStep(s, dt)) raiseEvent(s, vacancyEvent(post));
  // 3г′. Агенты из Ратуши (АГ-1): книга уплаченного жалованья для сервера. Платит ведомость (`sim/upkeep`), уходят неуплатой
  // войско и совет, агенты — нет (решения АГ-1).
  recruitStep(s, dt);
  // 3д. Сословия (РТ-2): указ сословия держится, пока оно верно — дар кончился, соперник получил привилегию, и указ снят.
  estatesStep(s);

  // 4. Мораль плавно стремится к целевой. Пока племя мёрзнет — вдвое быстрее.
  // Разбор морали — один на шаг: из него и цель морали, и причины недовольства стабильности (`sim/stability`).
  const mb = moraleBreakdown(s);
  const target = mb.target;
  const speed = (dt / MORALE_SETTLE) * (s.freezing > 0 ? 2 : 1);
  s.morale += (target - s.morale) * Math.min(1, speed);
  // Указ и рацион двигают мораль не целью, а прямо: ровно столько в игровой день,
  // сколько написано на кнопке в ратуше.
  const drift = (policyMoralePerDay(s) * dt) / DAY_LENGTH;
  if (drift !== 0) s.morale = Math.max(0, Math.min(100, s.morale + drift));

  // 5. Прирост населения. Ни рождений поимённо, ни старения: племя — это число,
  // и растёт оно от свободного жилья, запаса еды и морали (см. sim/population).
  growthTick(s, dt, mods);

  // 6. Итог дня по племени — одной строкой, а не по человеку на строку.
  if (dayAfter > dayBefore) {
    logPopDay(s);
    // Визитка пересобирается раз в игровой день: это тот слепок, который на
    // карте мира увидят чужие, и собирать его им будет не из чего.
    refreshCard(s);
    // Летопись живёт месяц: старое отбрасывается на смене суток, а не на каждой
    // записи — проход по летописи в пределах `LOG_MAX` раз в игровой день ничего не стоит.
    trimLog(s);
  }

  // 6б. Смена сезона и предупреждение о зиме.
  if (seasonIndex(s.time) !== seasonBefore) {
    const season = seasonOf(s.time);
    log(s, `${season === 'summer' ? 'Пришло' : 'Пришла'} ${SEASON_META[season].name.toLowerCase()}. ${SEASON_META[season].hint}`, season === 'winter' ? 'bad' : 'info');
  }
  // Предупреждение поднимается за игровой день до зимы — в последний день осени.
  // Без конкретного расчёта запасов зима читается как несправедливость, а с ним — как задача.
  if (dayAfter > dayBefore && seasonOf(s.time) === 'autumn' && seasonDayOf(s.time) === SEASON_DAYS) {
    const year = yearOf(s.time);
    if (s.winterWarnedYear !== year) {
      s.winterWarnedYear = year;
      s.winterWarning = true;
      log(s, 'Близится зима. Управитель пересчитывает амбары и поленницы.', 'bad');
    }
  }
  // Догон мог проскочить осень насквозь — устаревшее предупреждение снимаем.
  if (s.winterWarning && seasonOf(s.time) !== 'autumn') s.winterWarning = false;

  // 7. Задания.
  for (const q of QUESTS) {
    if (s.completedQuests.includes(q.id)) continue;
    if (!q.check(s)) continue;
    s.completedQuests.push(q.id);
    // Награда ложится сама, без окна: задание закрывает шаг, а не кнопка. Что не поместилось — в строке задания.
    const lost: Gains = {};
    for (const r of RESOURCE_IDS) {
      const n = q.reward[r];
      if (n) lost[r] = n - addStock(s, r, n);
    }
    s.prestige += 2;
    const full = stockWords(lost);
    log(s, `Задание выполнено: ${q.title}.${full ? ` Склад полон: не поместилось ${full}.` : ''}`, 'quest');
  }

  // 7а. Стабильность — после морали и прироста: её полосы читают разбор морали этого шага, мятеж податных и голодных
  // ложится в свою ячейку стола, как мятеж невольников (docs/stability.md).
  const revolt = stabilityTick(s, dt, mb);
  if (revolt) raiseEvent(s, revolt);

  // 7б. Ропот. Порядок считается при чтении; здесь идёт только срок до мятежа — при игроке и в
  // догоне отлучки одинаково. Срок ответа на мятеж ведёт почта (`sim/mail`), а не шаг.
  const unrest = unrestTick(s, dt);

  // 8. Мятеж случаем не выпадает: его поднимает срок ропота, и ложится он в свою ячейку
  // стола — вести посёлка его не держат и им не сгоняются (`sim/mail.raiseEvent`).
  // Сами вести шаг не поднимает: они приходят по сетке настоящих часов, одной на присутствие и
  // отлучку (`sim/mail.mailArrive`), — зреют по времени, а не по присутствию.
  // Поднятый мятеж невольников стоит ступени стабильности — один раз, в ту минуту, когда он лёг на стол.
  if (unrest === 'raise' && raiseEvent(s, MUTINY_EVENT)) stabShock(s, 'mutiny');

  // 9. Голод осады (ОС-1): добыча → прокорм → проверка. Проверка — последней: хлеб, пришедший в этот же шаг (караван,
  // задание), прокорм оплатил, и засухи нет.
  siegeHunger(s, balance);
}

/** Догоняет офлайн-время фиксированным шагом. */
export function catchUp(s: GameState, seconds: number, step = 1): void {
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(step, left);
    tick(s, dt, { offline: true });
    left -= dt;
  }
}

/** За сколько мораль заметно сдвигается к цели, игровых секунд. */
export const MORALE_SETTLE = gameSec(20);
/**
 * Шаг догона офлайна, игровых секунд. Потолок догона задан в игровых днях (`MAX_OFFLINE_DAYS`),
 * поэтому шагов у самой длинной отлучки одно и то же число при любой шкале времени — 1 440, четверть
 * секунды машины (`npm run time:report`, раздел 3), — и укрупнять шаг под длинную отлучку незачем.
 */
export const CATCHUP_STEP = gameSec(2);
/**
 * Дольше этого между двумя шагами живой игры, настоящих секунд, — уже не шаг, а отлучка: таймер
 * страницы стоял (вкладка в фоне, свёрнутое вебвью, уснувший телефон), и игрока при этом не было.
 * То же число, с которого вход в игру считает отлучку догоном (`save.loadGame`).
 */
export const AWAY_AFTER = realSec(5);

/** Сколько игрока не было с `since` по `now` (настоящие мс), **настоящих секунд**. Потолка нет: это правда об отлучке. */
export const awaySeconds = (since: number, now: number): number => Math.max(0, Math.floor((now - since) / 1000));

/**
 * Сколько догонять за отлучку, **игровых секунд**: прошедшее — через дверь времени, потолок — в
 * игровых днях (`MAX_OFFLINE_DAYS`). Одна дверь на догон и на ступени сохранения, которым нужна
 * минута входа после догона.
 */
export const awayGameSeconds = (since: number, now: number): number =>
  Math.min(gameSeconds(awaySeconds(since, now)), MAX_OFFLINE_DAYS * DAY_LENGTH);

/**
 * Отлучка: игрока не было с настоящей минуты `since` по `now`. Догон хозяйства под потолком и
 * вести, пришедшие без игрока (`sim/mail.mailArrive`), — одним правилом для входа в игру и для
 * страницы, которая спала, не закрываясь. Отлучка меряется настоящими секундами, шаг догона —
 * игровыми: перевод один (`game/pace`).
 */
export function absence(s: GameState, since: number, now: number): void {
  if (awaySeconds(since, now) > AWAY_AFTER) catchUp(s, awayGameSeconds(since, now), CATCHUP_STEP);
  mailArrive(s, since, now);
}

/**
 * Шаг живой игры: с прошлого шага прошло `real` настоящих секунд, сейчас `now`.
 *
 * **Время племени — функция часов, а не счёт срабатываний таймера.** Прежде цикл стора прибавлял
 * полсекунды на каждое срабатывание `setInterval`, и страница, у которой браузер придержал или
 * остановил таймеры, молча отставала от мира: автосохранение при этом ставило свежий `lastSaved`,
 * и догона отставшее племя не получало до перезагрузки. Теперь шаг получает прошедшее время:
 * короткий промежуток — обычный шаг при игроке, длинный — отлучка теми же правилами, что при входе.
 */
export function liveStep(s: GameState, real: number, now: number, lived: number = real): void {
  if (!(real > 0)) return;
  // `real` — настоящие секунды устройства: по ним и только по ним решается, шаг это или отлучка
  // (таймер страницы стоял или нет). `lived` — сколько прожила партия; под скоростью проверки оно
  // больше `real` (`game/pace`, «Скорость проверки»), и в отлучку ускорение шаг не переводит: ускоренная
  // партия живёт правилами присутствия, а не догоном.
  if (real <= AWAY_AFTER) {
    const dt = gameSeconds(lived);
    if (CHEATS_ON) present(s, dt);
    else tick(s, dt);
    // Вести приходят по настоящим часам — тем же правилом, что в отлучке: окно этого шага.
    mailArrive(s, now - lived * 1000, now);
    // Привоз рынка — по настоящим часам: уровень закрепляется в минуту начала привоза (РН-1б).
    rollShift(s, now);
    return;
  }
  absence(s, now - lived * 1000, now);
  rollShift(s, now);
}

/**
 * Шаг при игроке длиной `dt` игровых секунд — кусками не длиннее шага догона (`CATCHUP_STEP`). Шаг
 * живой игры обычно — шестидесятая игровой секунды; под скоростью проверки он растёт (на ×120 ровно до
 * шага догона), а задержанный таймер растит его ещё, и шаг симуляции, точный на двух игровых секундах,
 * получил бы двадцать: мораль встала бы в цель одним прыжком, а не шла к ней. Правила при этом —
 * присутствия, а не отлучки: события, осада, почта — как при игроке. Короче шага догона — ровно один `tick`.
 */
export function present(s: GameState, dt: number): void {
  for (let left = dt; left > 0; left -= CATCHUP_STEP) tick(s, Math.min(CATCHUP_STEP, left));
}

