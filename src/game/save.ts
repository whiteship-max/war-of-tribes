import type { ActiveEvent, GameState, LogEntry } from './types';
import { bonesToCharcoal } from './charcoal';
import type { PartyFold } from './yardmerge';
import { DAY_LENGTH } from './constants';
import { UPKEEP_TEXT, WAGE_AMNESTY_DAYS } from './data/upkeep';
import { PACE_TEXT } from './data/pace';
import { daysSpan } from './span';
import { taxIncomePerDay, wagesPerDay } from './derived';
import { emptyArmy } from './data/troops';
import { BUILDINGS } from './data/buildings';
import { emptyEquipment } from './data/equipment';
import { createInitialState, SAVE_VERSION } from './state';
import { AWAY_AFTER, absence, awayGameSeconds, awaySeconds } from './sim/tick';
import { normalizeAssignments } from './sim/workers';
import { log, trimLog } from './sim/log';
import { trimStock } from './sim/stock';
import { gearOff, mergeAgents, nameAgents, mergeLineage } from './sim/agents';
import { mergeCouncil } from './sim/council';
import { mergeRecruit } from './sim/recruit';
import { mergeCommand } from './sim/command';
import { mergeMarket } from './sim/caravan';
import { mergeEstates } from './sim/estates';
import { mergeWage } from './sim/upkeep';
import { mergeSpirit } from './sim/spirit';
import { mergeScars } from './sim/scars';
import { dynastyStep, mergeRealm, newHouse, skillLine } from './sim/dynasty';
import { adminNotice, creditTech, fateNotice, gateOf, levelName, techLevel } from './sim/tech';
import { BRANCH_OF, WAR_FATES } from './data/realm';
import { AGENT_AGE0, LEVEL_XP, RETIRE_AGE } from './data/agents';
import { FIGURE_IDS } from '@/world/data/figures';
import { hashId } from '@/world/diplomacy';
import { cityName } from '../../netlify/lib/contract';
import type { ProfileState } from '@/profile/types';
import { refreshCard } from '@/profile/stats';
import { rescueFromCloud } from '@/telegram/cloud-rescue';
import { enterLead, leadAt, partyNow } from '@/net/clock';
import { CHEATS_ON } from '@/cheats';
import { roamOn } from './roamflag';
import { mergeRoam } from './sim/roam';
import { loadRulerTraits } from './rulernow';

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
  // Партия, которую ускоряли, везёт опережение своих часов живым: отметки мира и `lastSaved` лежат в
  // часах партии, и без опережения следующий вход прочёл бы их будущим (`game/pace`, «Скорость
  // проверки»). Партия, которую не ускоряли, поля не получает вовсе — оно же метка.
  return JSON.stringify(
    CHEATS_ON && s.lead !== undefined ? { ...s, lastSaved: partyNow(), lead: leadAt() } : { ...s, lastSaved: partyNow() },
  );
}

/**
 * Сохранение как оно лежит на диске. Поля, которые партия больше не хранит, описаны здесь, а не в
 * `GameState`: ступени их читают, а партия после чтения их не несёт (`deserialize` убирает).
 * `hero` — герой с именем и родом до поставки 1 боя (имя ушло к полководцу ступенью 12 → 13, род и
 * поход — с прибавкой героя, docs/battle_eu4.md, 14.19.6); `battlePlans` — схемы похода с планом,
 * приказами и раскладкой удара, ушедшие вместе с ними (14.5); `defenseFormation` — расстановка обороны
 * по секторам, ушедшая с поставкой 2: у частокола строй раскладывает правило, как любой бой (14.27).
 * Версия от этого не растёт: читать поле некому, и ступени ему не нужно.
 */
type SavedState = Partial<GameState> & {
  version?: number;
  hero?: { name?: unknown };
  battlePlans?: unknown;
  defenseFormation?: unknown;
};

/** Поля, которые партия больше не хранит: старое сохранение привозит их спредом, и они убираются. */
const DROPPED = ['hero', 'battlePlans', 'defenseFormation'] as const;

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
 * Прогресс не пропадает молча — о приведении сказано игроку. Сказано, а не
 * записано: ступень говорит (`tell`), а в летопись это ложится после догона
 * отлучки, при входе (`enter`). Писать в летопись отсюда нельзя — строка встала
 * бы на минуту записи, и после суток отлучки её срезал бы возраст летописи.
 */
function migrate(s: GameState, from: number, data: SavedState, fold: PartyFold | null = null): void {
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
    const entry = s.time + awayGameSeconds(typeof data.lastSaved === 'number' ? data.lastSaved : partyNow(), partyNow());
    s.pay = { debt: 0, late: 0, gone: {}, from: entry + WAGE_AMNESTY_DAYS * DAY_LENGTH };
  }
  // Строка про грамоту вождя — про восьмёрку, и обязана быть под своим условием:
  // без него сохранение десятой версии узнавало бы о заведении профиля, который
  // у него давно есть.
  if (from < 9) tell(s, 'У правителя теперь есть имя, лицо и счёт побед. Город и дружина остались прежними.', 'info');
  if (from < 10) tell(s, 'Дозор теперь разведывает округу. Каждый уровень открывает землю дальше от города.', 'info');
  if (from < 11) tell(s, 'Кузница теперь куёт по заказам. Закажи, сколько надо, запасы спишут вперёд.', 'info');
  if (from < 12) {
    tell(s, 'Покровитель города отпущен. Волк, медведь и орёл ушли в предания вместе с прибавками.', 'bad');
    tell(s, 'Вместо них у города вера земли вокруг. Устав и обряд теперь в храме.', 'info');
  }
  if (from < 13) {
    tell(
      s,
      `Люди на местах получили имена и возраст. Считаются нанятыми сегодня, опыт при них. Теперь они гибнут на деле и уходят на покой в ${RETIRE_AGE}, место нанимают заново.`,
      'info',
    );
  }
  // 14 → 15: событие ждало в одном поле, теперь их стол. Ждавшее событие
  // переезжает на стол целиком — со сроком, если он был поставлен.
  if (from < 15) {
    const old = (s as { activeEvent?: ActiveEvent | null }).activeEvent;
    s.inbox = old ? [old] : [];
    delete (s as { activeEvent?: unknown }).activeEvent;
  }
  if (from < 14) {
    tell(s, 'Статуя больше не ограничивает отряд, полководец уводит сколько угодно. Дружину держит цена: еда и жалованье.', 'info');
    tell(s, UPKEEP_TEXT.amnestyLog(wagesPerDay(s), taxIncomePerDay(s)), 'bad');
  }
  if (from < 15) {
    tell(s, 'Вести теперь ждут ответа по несколько сразу, у каждой свой срок.', 'info');
  }
  // 15 → 16: время пошло медленнее. Состояние не трогается — в партии лежат игровые секунды, и
  // шкала у двери времени их смысла не меняет; выросли только настоящие сроки. Об этом и говорится.
  if (from < 16) {
    s.paceNotice = true;
    tell(s, PACE_TEXT.log(daysSpan(1)), 'info');
  }
  // 16 → 17: у державы появился правитель. Умолчания мало по той же причине, что у
  // смертных агентов: дом новой партии считает, что правление началось в нулевую
  // секунду, — а у сыгранной партии `s.time` огромен, и первый же пульс отправил бы
  // правителя на покой, не показав игроку ни одного дня правления. Поэтому правление
  // начинается **в минуту входа**, после догона офлайна, ровно как служба приведённых
  // агентов; очки идут оттуда же, и вернувшийся не находит полный котёл задаром.
  if (from < 17) {
    const entry = s.time + awayGameSeconds(typeof data.lastSaved === 'number' ? data.lastSaved : partyNow(), partyNow());
    s.realm = newHouse(s.seed, entry);
    // Имена — по вере деревни, если мир её уже называл; не называл — назовёт первым пульсом.
    dynastyStep(s);
    const who = s.realm.ruler.name ?? 'правитель';
    tell(
      s,
      `Во главе державы встал ${who}: ${skillLine(s.realm.ruler.skills)}. Каждый навык даёт очки своего вида, копятся они сами.`,
      'info',
    );
    tell(s, 'Очки и родословная — в державе.', 'info');
  }
  // 17 → 18: у державы появились технологии, и первый гейт — дипломатическая ветвь.
  // Умолчания мало: у начатой партии `tech.diplo` лежит первым уровнем (его положила
  // ступень 16 → 17), а место лазутчика у неё есть — оставь как есть, и гейт **отнял бы**
  // уже имеющееся. Поэтому пройденная ступень засчитывается, и доказательством служит
  // сама запись: до этой ступени место лазутчика было у каждой партии, включая ту, у
  // которой он как раз погиб и не нанят заново (`sim/tech.creditTech`, довод `hadAll`).
  if (from < 18) {
    const given = creditTech(s, true);
    if (given.length > 0) {
      tell(s, `Место лазутчика засчитано изученным: ${gateOf('spy').level} уровень ${BRANCH_OF.diplo}. Что у города уже есть, технологии не отнимают.`, 'info');
    }
    tell(s, 'В державе открылись технологии. Очки правителя тратятся на их уровни.', 'info');
  }
  // 18 → 19: построена военная ветвь. Умолчания мало ровно по той же причине, что у
  // дипломатической: `tech.war` лежит первым уровнем, а снаряжение и войско у начатой
  // партии есть, — оставь как есть, и гейт **отнял бы** уже кованое. Засчитывается
  // пройденная ступень, и доказательством служит **самая дорогая вещь на складе и в
  // дружине** (решение владельца): лестница монотонна, всё, что ниже, подразумевается.
  //
  // `hadAll` здесь не при чём и не передаётся: место агента до гейта было у каждой партии,
  // и отнять его значило бы отнять человека, — а доспех, которого партия ни разу не
  // сковала, у неё не отнимают, потому что его у неё нет.
  if (from < 19) {
    const given = creditTech(s);
    const level = techLevel(s, 'war');
    if (given.includes('war')) {
      tell(s, `Засчитан ${level} уровень ${BRANCH_OF.war}, по самой дорогой вещи в городе. Ковать и нанимать можно всё, что ковали и нанимали.`, 'info');
    } else {
      tell(s, `Технологии ${BRANCH_OF.war} начинаются с первого уровня, кованого в городе нет. Следующий уровень открывает ${levelName('war', 2).toLowerCase()}.`, 'info');
    }
    tell(s, `Кузница и казармы теперь спрашивают технологии ${BRANCH_OF.war}. Вещь куют и бойцов нанимают с того уровня, где они открыты.`, 'info');
  }
  // 19 → 20: участь «увести людей» стала покупной ступенью военной ветви, и кредита ей нет —
  // засчитываются вещи, а участь не вещь (решение владельца, docs/dynasty.md, раздел 11.2).
  // Формат тот же. Строку об этом сочиняет не эта ступень, а вход (`afterEntry`): строка
  // говорит, хватает ли очков, а очки — функция времени, и их правда — на минуту входа, а не
  // на минуту записи.
  //
  // 20 → 21: построена административная ветвь — наёмные мастера на местах Мастерской
  // (docs/admin_branch.md, раздел 4.1). Новое поле (`masters`) приезжает умолчанием — нулём, — и
  // засчитывать нечего: мастеров не было ни у кого, ветвь открывает новое, а не запирает старое.
  // Версию подняли, чтобы партия узнала об этом строкой; сочиняет её вход (`afterEntry`): она
  // называет очки, а их правда — на минуту входа.
  //
  // 21 → 22: алмазы переехали на сервер (решение владельца 09.10.2026, docs/gems.md). Поля `gems` в
  // партии больше нет: баланс и журнал ведёт сервер, и при первом входе в эпоху мира он кладёт
  // стартовые сам. Число с устройства не переносится — иначе оно стало бы вторым начислением.
  if (from < 22) {
    delete (s as { gems?: unknown }).gems;
    tell(s, 'Алмазы теперь хранятся в Сокровищнице. Каждая трата записана в её книге.', 'info');
  }
  //
  // 22 → 23: кости стали углём (решение владельца 10.10.2026, docs/economy.md). Припас переименован везде, где лежал, ещё
  // до слияния с новой партией (`deserialize` → `bonesToCharcoal`): иначе склад приехал бы с костями сбоку и стартовым
  // углём. Здесь — только строка игроку.
  if (from < 23) tell(s, 'Кости на складе пошли в уголь, один к одному. Уголь жгут лесорубы, и без него горн холоден.', 'info');
  // 23 → 24: ресурсные дворы объединены (ЗД-1). Постройки, стройка, рабочие и невольники сведены ещё до слияния
  // (`deserialize` → `yardmerge.foldParty`); здесь — возврат цены стройки, которую не на что перенести, дверью склада
  // (`sim/pay.refund`, разовое дело описи), и строка игроку.
  if (from < 24 && fold && door) door.settleParty(s, fold, (text, kind) => tell(s, text, kind));
}

/**
 * Ступень 23 → 24 (`game/yardstep.ts`, правило — `game/yardmerge.ts`) — своей докачкой: она нужна только партии младше 24-й, а
 * первая загрузка не должна расти ради тех, у кого старой партии нет. Подгружает её `loadFold` — вход (`loadGame`) и взятие
 * серверной партии (`net/sync`) зовут его до чтения, если запись старше; без неё старая запись не читается (`deserialize` →
 * null) и ничего не затирается.
 */
type FoldDoor = typeof import('./yardstep');
let door: FoldDoor | null = null;

/** Подгрузить ступень 23 → 24. Повторный вызов — та же. */
export async function loadFold(): Promise<void> {
  door ??= await import('./yardstep');
}

/** Версия записи без разбора всей строки: поле `version` пишет `serialize` первым. */
const versionOf = (json: string): number => Number(/"version":\s*(\d+)/.exec(json)?.[1] ?? SAVE_VERSION);

/** Готовность прочесть запись: партии младше 24-й нужна дверь перехода, партии с делами правителя — правила черт; подгрузить их до чтения. */
export async function readyToRead(json: string): Promise<void> {
  if (versionOf(json) < 24) await loadFold();
  // Черты правителя (ПН-2): в записи есть счёт дел или минимальное жалованье — правила черт подгружаются до чтения (`rulernow`).
  if (/"deeds":\{|"mode":"min"/.test(json)) await loadRulerTraits();
}

/**
 * Что ступени сохранения сказали игроку, — до входа в партию. Живёт рядом с состоянием, как
 * `readFrom`, а не в нём: в сохранение не едет, и ложится в летопись одним разом, после догона
 * отлучки (`enter`).
 */
const told = new WeakMap<GameState, { text: string; kind: LogEntry['kind'] }[]>();

/**
 * Сказать игроку о приведении партии. Строка ляжет в летопись при входе, **после догона отлучки**
 * (`enter`), и встанет на минуту входа: летопись режется по возрасту (`LOG_MAX_DAYS`, тридцать
 * игровых дней), а догон идёт до `MAX_OFFLINE_DAYS` (сорока восьми), и строка, записанная на
 * минуту записи, после суток отлучки ушла бы вместе со старыми — игрок не узнал бы, что изменилось.
 */
function tell(s: GameState, text: string, kind: LogEntry['kind'] = 'info'): void {
  const lines = told.get(s) ?? [];
  lines.push({ text, kind });
  told.set(s, lines);
}

/**
 * Из какой версии прочитано это состояние. Живёт рядом с состоянием, а не в нём: в сохранение
 * оно не едет, и нужно ровно одному — ступеням, которые говорят с игроком после догона отлучки.
 */
const readFrom = new WeakMap<GameState, number>();

/**
 * После догона отлучки — всё, что сказали ступени сохранения (`tell`), и то, что можно сказать
 * только на минуту входа. **Это единственное место, где `save.ts` пишет в летопись**, и держит это
 * тест по исходнику (`game/entrylog.test.ts`): строка о приведении партии, записанная раньше
 * догона, после суток отлучки уходила из летописи по возрасту.
 *
 * 19 → 20: участь стала покупной, и пропажа не должна быть молчаливой. Что сказать, решает дверь
 * гейта (`sim/tech.fateNotice`) — теми же числами, что стоят на кнопке «Изучить».
 *
 * 20 → 21: построена административная ветвь (`sim/tech.adminNotice`) — тем же приёмом.
 */
function afterEntry(s: GameState): void {
  const from = readFrom.get(s) ?? SAVE_VERSION;
  if (from < 20) {
    for (const fate of WAR_FATES) {
      const line = fateNotice(s, fate);
      if (line) tell(s, line);
    }
  }
  if (from < 21) tell(s, adminNotice(s));
  for (const { text, kind } of told.get(s) ?? []) log(s, text, kind);
  told.delete(s);
  readFrom.delete(s);
}

/**
 * Вход в прочитанную партию — одна дверь на загрузку (`loadGame`) и на тех, кто читает партию
 * сам: догон отлучки (`sim/tick.absence`), потом всё, что сказали ступени сохранения (`afterEntry`).
 * К старой партии другого пути нет: и серверная запись, и возвращённая копия ложатся на диск и
 * приходят сюда перезапуском. `now` — настоящее время входа.
 */
export function enter(s: GameState, now: number = partyNow()): void {
  // Отлучка — одна дверь на вход в игру и на страницу, спавшую не закрываясь (`sim/tick.absence`):
  // догон хозяйства под потолком, потом вести, пришедшие без игрока, — выводом из времени, а не
  // доигрыванием тиков. Вести после догона: кость партии и веса событий берутся у посёлка, каким
  // он стал к входу.
  absence(s, s.lastSaved, now);
  afterEntry(s);
}

/**
 * Сколько игрока не было после записи, **настоящих секунд**, — для окна «С возвращением». Сколько из
 * этого догоняется и где кончится догон, считает одна дверь — `sim/tick.awayGameSeconds`: служба
 * приведённых агентов начинается в минуту входа, а не раньше.
 */
export const offlineSeconds = (lastSaved: number): number => awaySeconds(lastSaved, partyNow());

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
 * тем опытом, что был. Иначе догон офлайна (до `MAX_OFFLINE_DAYS`) при нынешнем
 * `AGENT_YEAR` состарил бы их на годы за то время, когда они ещё не старели.
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
    p.bornAt = s.time + awayGameSeconds(typeof data.lastSaved === 'number' ? data.lastSaved : partyNow(), partyNow());
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
    // 22 → 23: кости — уголь. До слияния: ключ склада, рынка и трофея должен прийти уже новым (ступень — в `migrate`).
    if (from < 23) bonesToCharcoal(data);
    // 23 → 24: дворы объединены (ЗД-1). До слияния: трёх построек больше нет, и назначения ложатся по делам — иначе
    // слияние привезло бы постройки, которых в игре нет, и рабочих по номерам (ступень — в `migrate`).
    // Двери нет — запись не читается, и ничего не затирается: её подгружает тот, кто читает (`readyToRead`).
    if (from < 24 && !door) return null;
    const fold = from < 24 && door ? door.foldParty(data as Record<string, unknown>) : null;
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
      pay: {
        ...base.pay,
        ...(data.pay ?? {}),
        gone: { ...(data.pay?.gone ?? {}) },
        hurt: { ...(data.pay?.hurt ?? {}) },
        drafts: { ...(data.pay?.drafts ?? {}) },
        // Жалованье дружине и счёт уплаченного (ДР-1) — с проверкой: партия до ДР-1 приезжает с полным, давно.
        wage: undefined,
        paid: undefined,
        ...mergeWage(data.pay),
      },
      // Память боёв дружины (ДР-1) — только целой записью; партия до ДР-1 приезжает без неё.
      spirit: mergeSpirit(data.spirit),
      // Журнал боёв армии (ДР-4): только читаемые метки; нет — черт нет (партия до ДР-4).
      scars: mergeScars(data.scars),
      // Раненых до лазарета с местами и сроком не было: старая партия приезжает с пустым лазаретом.
      wounded: data.wounded ?? [],
      // Вставших раненых отряда полководца до раскладки не считали: старая партия начинает счёт с нуля.
      risen: { ...(data.risen ?? {}) },
      // Вызовов к воротам до поставки 3 боя не было: старая партия приезжает без них.
      gate: data.gate ?? [],
      // Очереди стройки до СТ-1 не было: порядок был порядком построек. Старая партия приезжает пустым списком, и
      // `derived.buildQueue` ставит её стройки тем же порядком — начатая первой. Чужое (не число) отбрасывается.
      buildQueue: Array.isArray(data.buildQueue) ? data.buildQueue.filter((id): id is number => Number.isInteger(id)) : [],
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
      // Рынок — одной дверью чтения (`sim/market.mergeMarket`): запись до РН-1 (счёт дня `day`) приезжает пустым привозом,
      // нажим и сделки — только целыми записями.
      market: mergeMarket(data.market),
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
      stats: { ...base.stats, ...(data.stats ?? {}) },
      profile: mergeProfile(base.profile, data.profile),
      // Агенты — словарь по агентам, как армия по видам: мержится поштучно, а
      // каждое поле читается с проверкой. Партия, записанная до опыта, приезжает
      // агентами первого уровня — ровно сегодняшними, — и версию это не поднимает.
      agents: mergeAgents(data.agents),
      // Дом правителя — по полям, как профиль и вера: спред `...data` на уровень ниже
      // не спускается. Партия до дома приезжает с домом новой партии, а время
      // вступления ей ставит ступень 16 → 17.
      realm: mergeRealm(base.realm, data.realm),
      // Родословная — по месту, каждая запись с проверкой и под потолком места.
      // Партия до родословной приезжает с пустой: вспоминать ушедших задним
      // числом не из чего, и версию это не поднимает.
      lineage: mergeLineage(data.lineage),
      // Совет Ратуши (РТ-1) — по полям с проверкой; партия до совета приезжает без него, и версия не растёт.
      council: mergeCouncil(data.council),
      recruit: mergeRecruit(data.recruit),
      command: mergeCommand(data.command),
      estates: mergeEstates(data.estates),
      seed: typeof data.seed === 'number' && Number.isFinite(data.seed) ? data.seed >>> 0 : base.seed,
      rolls: typeof data.rolls === 'number' && Number.isFinite(data.rolls) ? Math.max(0, Math.floor(data.rolls)) : 0,
      hires: typeof data.hires === 'number' && Number.isFinite(data.hires) ? Math.max(0, Math.floor(data.hires)) : 0,
    } as GameState;
    // Кто не дома, прежде лежал числом (`warriorsAway`), теперь — по видам (`away`).
    // Состав из числа не восстановить, и не нужно: мир кладёт его первым же пульсом, а
    // до него всё войско дома. Старое поле никто не читает — оно не должно и ездить.
    delete (s as { warriorsAway?: unknown }).warriorsAway;
    for (const key of DROPPED) delete (s as unknown as Record<string, unknown>)[key];
    // Фаза и отряд бродяги (ПН-1, docs/gdd/path_of_sword.md, «Решения ПН-1»): только за выключателем Пути меча и только целой
    // записью (`sim/roam.mergeRoam`). Выключен — партия читается лордом: ни правка хранилища, ни чужая запись в фазу бродяги не
    // пускают.
    delete s.phase;
    delete s.roam;
    if (roamOn()) Object.assign(s, mergeRoam(data));
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
    migrate(s, from, data, fold);
    // Склад не выше вместимости (решение владельца, docs/audit/OWNER-DECISIONS.md, п. 1): партия, записанная, когда лавка и
    // указ клали сверх неё, приводится здесь — сгоревшее называет строка летописи после входа, тихо не пропадает ничего.
    const line = trimStock(s, undefined, true);
    if (line) tell(s, line, 'bad');
    // Вещи с агентов (ДР-7, docs/city_v3.md, «Решения ДР-7»): их надевают только на правителя — надетое на агента при чтении
    // снято (`mergeAgents` его не читает) и лежит в сундуке, во владении; без потерь, одной строкой летописи при входе.
    if (gearOff(data.agents)) tell(s, 'Вещи с агентов — в сундуке: их надевают только на правителя.', 'info');
    readFrom.set(s, from);
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
  /**
   * Эпоха мира устройства (`net/era.knownEra`, docs/test_world.md). Партия другой эпохи не загружается — ни с диска, ни
   * из облака: начинается новая. Нет — эпоху не сверяют (стенды и отчёты).
   */
  era?: number;
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
  if (chosen) await readyToRead(chosen);
  const read = chosen ? deserialize(chosen) : null;
  // Партия прошлой эпохи мира: сервер с тех пор стёрт (`/wipeworld ДА`), и её не загружают — ни с диска, ни из облака.
  // Начинается новая; старая строка на диске ляжет под первой же записью новой партии (docs/test_world.md).
  const stale = read !== null && hooks.era !== undefined && (read.era ?? 0) !== hooks.era;
  const state = stale ? null : read;
  if (!state) {
    // Что-то лежало, но прочитать это нельзя — старый формат. Молча стирать
    // прогресс нельзя: игроку об этом скажет отдельное окно.
    const legacy = Boolean(chosen) && !stale;
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
    tell(state, 'Партия поднята из облака Telegram. На этом устройстве её не было.');
  }

  // Часы партии — раньше первого их чтения: отлучка и вход считаются в них.
  if (CHEATS_ON) enterLead(state.lead ?? 0);
  const offline = offlineSeconds(state.lastSaved);
  if (offline > AWAY_AFTER) await hooks.onOffline?.(offline);
  enter(state);
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
