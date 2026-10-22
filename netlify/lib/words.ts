/**
 * Слова сообщений бота — по виду и числам пункта, одним модулем (docs/NOTIFY.md, разделы 12 и 13). Свободного текста от
 * клиента сервер не принимает: клиент присылает вид, имя двора, участь и минуты, а слова собираются здесь, в минуту
 * отправки и в поясе игрока.
 *
 * Голос — гонца, о своих победах — полководца (docs/voice.md, 10): на «ты», коротко, без восклицаний и без пересказа
 * устройства игры. **ВС-1 (16.10.2026): каждая весть говорит три вещи — что случилось, чем грозит, что сделать**, если
 * сделать что-то можно (людей на стены, наказ чинить пролом, ответ до срока); итог, который уже не изменить, отсылает к
 * донесению. Чисел здесь два вида — минута («в 14:40», поясом игрока) и то, что записано в самой вести (проломы, уровень
 * постройки, числа указа): потери и добыча устаревают и лежат в донесении (правило 18 — числа нет, и считать его нечем).
 *
 * Письмо из нескольких вестей (склейка, правка, утренняя сводка) — `letterText`: шапка с числом и по строке на весть.
 */
import { cityOr, STOCK_KEYS, TROOP_KEYS, type NoticeFate, type NoticeItem, type RatingRow, type WarMachine } from './contract.js';
import { localTime, TOPICS, topicOf, zoneOf, type BotPrefs, type Head, type Letter, type NotifyRecord, type Topic } from './notify.js';
import type { PanelButton } from './telegram.js';
import { SICILY } from '../../src/world/spawn.js';
import { BLOCKADE_GIVES } from '../../src/world/blockade.js';
import { PROPOSALS, waitWords } from '../../src/world/proposals.js';
import { count } from '../../src/ui/parts/plural.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { keptType } from '../../src/game/yardmerge.js';
import { TROOPS } from '../../src/game/data/troops.js';
import { RESOURCE_META } from '../../src/game/constants.js';

/** Кнопки под вестью: открыть игру (решение владельца 06.10.2026) и настройки вестей (ВС-1). */
export const BUTTON_OPEN = 'Открыть игру';
export const BUTTON_SETUP = 'Настроить вести';

/** Рычаг в настройках: выключить всё, когда включено, и наоборот. */
export const BUTTON_OFF = 'Выключить все вести';
export const BUTTON_ON = 'Включить вести';

/**
 * Что кнопки шлют боту. Других данных у кнопок нет: вебхук принимает только эти строки (`routes/bot.ts`).
 * `notify:off` и `notify:on` стоят и под старыми сообщениями прежнего ряда — их по-прежнему понимают.
 */
export const CALLBACK_OFF = 'notify:off';
export const CALLBACK_ON = 'notify:on';
export const CALLBACK_MENU = 'notify:menu';
/** Рычаг в настройках — свои данные: нажатие правит сообщение настроек, а не ряд под вестью. */
export const CALLBACK_PANEL_OFF = 'notify:p:off';
export const CALLBACK_PANEL_ON = 'notify:p:on';
export const CALLBACK_QUIET = 'notify:quiet';
export const CALLBACK_URGENT = 'notify:urgent';
export const callbackTopic = (t: Topic): string => `notify:t:${t}`;

/** Ответ на нажатие — всплывающая строка в Telegram. */
export const SWITCHED_OFF = 'Вести выключены';
export const SWITCHED_ON = 'Вести включены';
export const SAVED = 'Записано';
export const FAILED = 'Не вышло. Нажми ещё раз.';

const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Платёж Telegram (`lib/tgpay.ts`, docs/security.md): счетов Telegram игра не выставляет — алмазы покупают в Сокровищнице
 * за USDT в сети TON. Отказ предоплатной проверке Telegram показывает плательщику (до 255 знаков), деньги не списываются.
 */
export const PAY_NOT_SOLD = 'Алмазы покупают только в игре: Сокровищница, USDT в сети TON. Деньги не списаны.';

/** Платёж Telegram всё же пришёл — игра его не засчитала, и деньги вернут мастера игры. */
export const PAY_NOT_COUNTED = 'Этот платёж игра не засчитала: алмазы покупают только в Сокровищнице, за USDT в сети TON. Мастера игры вернут деньги — напиши им.';

/** «14:40» в поясе игрока. */
export function clock(ms: number, tz: string): string {
  return hhmm(localTime(ms, tz).minute);
}

/** Что стало с городом — участью, уже случившейся. */
const FATE_DONE: Record<NoticeFate, string> = {
  plunder: 'Склад разграбили.',
  captives: 'Людей увели в полон.',
  burn: 'Город сожгли.',
};

/** Чем грозят идущие на город — объявленной участью. */
const THREAT: Record<NoticeFate, string> = {
  plunder: 'Идут за добром со склада.',
  captives: 'Идут за людьми.',
  burn: 'Идут жечь.',
};

/** Что сделал чужой лазутчик — по участи, которой сервер назвал дело (`war.spyFate`): огонь, кража, смута. */
const SPY_DONE: Record<NoticeFate, string> = {
  burn: 'В {at} горел склад: поджёг чужой лазутчик. Что сгорело, сказано в донесении.',
  plunder: 'В {at} обокрали склад: работа чужого лазутчика. Что пропало, сказано в донесении.',
  captives: 'В {at} в городе смута: её посеял чужой лазутчик. Что с людьми, сказано в донесении.',
};

/** Что делать, когда на город идут: до прихода дружину можно перевести в гарнизон (docs/NOTIFY.md, 12.11). */
const TO_WALLS = 'Успей поставить людей на стены.';
/** Город пал: изменить уже нечего, смотреть — в донесение. */
const WHAT_LEFT = 'Что уцелело, сказано в донесении.';

/** Хвост вести рода, который в письме из нескольких строк говорится один раз. */
const AFTER: Partial<Record<Topic, string>> = {
  build: 'Что строить дальше, решают в ратуше.',
  grants: 'Всё ляжет в город, как зайдёшь в игру.',
};

/** Слова одной вести. `tz` — пояс получателя. */
export function noticeText(item: NoticeItem, tz: string): string {
  const p = item.p;
  const at = clock(p.about, tz);
  switch (item.kind) {
    // Ответить можно до самого прихода — срок один, «у стен в» (решение владельца 06.10.2026, docs/NOTIFY.md, 12.11).
    case 'raid':
      return `Набег из «${p.from}» идёт на твой город. ${THREAT[p.fate]} У стен будут в ${at}. ${TO_WALLS}`;
    case 'raid-fight':
      // Перехват: бой был в поле, до стен (`field`); кто победил, посчитает мир при заходе.
      if (p.field) return `В ${at} полководец встретил набег из «${p.from}» в поле. Чем кончился бой, сказано в донесении.`;
      return `В ${at} набег из «${p.from}» ударил в стены. Чем кончился бой, сказано в донесении.`;
    case 'siege-fall':
      return p.gates
        ? `В ${at} город открыл ворота лагерю «${p.from}». Гарнизон ушёл живым. ${FATE_DONE[p.fate]} ${WHAT_LEFT}`
        : `В ${at} в городе кончился хлеб, и лагерь «${p.from}» вошёл в ворота. ${FATE_DONE[p.fate]} ${WHAT_LEFT}`;
    case 'siege-phase':
    case 'war-phase':
      return phaseText(item, at);
    case 'war':
      return p.mode === 'storm'
        ? `Из «${p.from}» вышел отряд на твой город — на штурм. ${THREAT[p.fate]} У стен будут в ${at}. ${TO_WALLS}`
        : `Из «${p.from}» вышел отряд на твой город — встанут лагерем у ворот. ${THREAT[p.fate]} У стен будут в ${at}. Хлеб и люди на стенах решат, долго ли город выстоит.`;
    case 'war-fall':
      if (p.role === 'atk') return p.gates ? `«${p.from}» открыл нам ворота, не дождавшись голода. Город наш.` : `В «${p.from}» кончился хлеб. Ворота открыты, город наш.`;
      return p.gates
        ? `В ${at} город открыл ворота отряду из «${p.from}». Гарнизон ушёл живым. ${FATE_DONE[p.fate]} ${WHAT_LEFT}`
        : `В ${at} в городе кончился хлеб, и отряд из «${p.from}» вошёл в ворота. ${FATE_DONE[p.fate]} ${WHAT_LEFT}`;
    case 'war-fight':
      return fightText(item);
    // Тайное нападение (docs/spy_pvp.md): чей лазутчик, город не знает — имени в словах нет. Ловят таких стража и Дозор.
    case 'war-spy':
      return `${SPY_DONE[p.fate].replace('{at}', at)} Таких ловят стража и Дозор.`;
    case 'war-parley':
      return parleyText(item, at);
    // Пакт между игроками (docs/siege_v2.md, 19.2; ДП-1): предложили — ответ в «Вестях», кнопка ведёт к предложению; итог —
    // той стороне, что не действовала сама. Что даёт союз — одной строкой с «Вестями» (`world/proposals`).
    case 'war-pact':
      return pactText(item);
    case 'war-relief':
      return reliefText(item, at);
    case 'build':
      return `Достроили: ${buildLine(item)}. ${AFTER.build}`;
    case 'grant':
      return `Пришёл указ: ${grantLine(item)}. ${AFTER.grants}`;
    // Стабильность (docs/stability.md, 2.8): одна весть, когда мятеж близок, и одна — о мятеже; без чисел, которые устареют.
    case 'stab-near':
      return `Мятеж близок: ${GROUP_WORD[p.group ?? 'folk'].who} на пределе. Что их злит и как унять — в игре, раздел «Стабильность».`;
    case 'stab-revolt':
      return `${GROUP_WORD[p.group ?? 'folk'].rose} Ответ — в игре, в «Вестях»: без ответа стража выйдет сама.`;
  }
}

/** Группы недовольных в вестях стабильности — словами получателя. */
const GROUP_WORD: Record<NonNullable<NoticeItem['p']['group']>, { who: string; rose: string }> = {
  folk: { who: 'податные', rose: 'Мятеж в городе: податные бросили работу.' },
  hungry: { who: 'голодные', rose: 'Хлебный бунт: голодные вышли на площадь.' },
  bonded: { who: 'невольники', rose: 'Мятеж невольников: работа стоит.' },
  army: { who: 'дружина', rose: 'Дружина не ждёт жалованья.' },
};

/** Весть о союзе словами получателя (ДП-1). */
function pactText(item: NoticeItem): string {
  const { from, pact, role } = item.p;
  const def = PROPOSALS.pact;
  switch (pact) {
    case 'made':
      return `«${from}» принял союз. Теперь вы приходите друг другу на выручку.`;
    case 'no':
      return `«${from}» отклонил наше предложение ${def.of}.`;
    case 'withdrawn':
      return `«${from}» отозвал предложение ${def.of}.`;
    case 'broken':
      return `«${from}» разорвал союз с нами. Теперь он может пойти на нас походом, и на выручку не придёт.`;
    case 'expired':
      return role === 'atk' ? `«${from}» не ответил на предложение ${def.of}: срок вышел.` : `Предложение ${def.of} от «${from}» осталось без ответа: срок вышел.`;
    default:
      return `Город «${from}» ${def.asks}. ${def.gives} Ответ — в игре, в «Вестях»: предложение ждёт ${waitWords('pact')}.`;
  }
}

/** Постройка вести стройки: «кузница, 4-й уровень». */
function buildLine(item: NoticeItem): string {
  // Весть, записанная до объединения дворов (ЗД-1), называет прежнюю постройку — её двор.
  const type = keptType(String(item.p.building ?? ''));
  const def = type ? BUILDING_BY_ID[type] : undefined;
  return `${def ? def.name.toLowerCase() : 'постройка'}, ${item.p.level ?? 2}-й уровень`;
}

const signed = (v: number): string => (v > 0 ? `+${v}` : `−${-v}`);

const stockName = (k: string): string => ((RESOURCE_META as Record<string, { name: string } | undefined>)[k]?.name ?? 'Золото').toLowerCase();
const troopName = (k: string): string => (TROOPS.find((t) => t.id === k)?.name ?? k).toLowerCase();

/** Что прибавил и убавил указ: «древесина +500, копейщики −10» — именами игры. */
function grantLine(item: NoticeItem): string {
  const { stock = {}, troops = {} } = item.p;
  return [
    ...STOCK_KEYS.filter((k) => stock[k]).map((k) => `${stockName(k)} ${signed(stock[k] as number)}`),
    ...TROOP_KEYS.filter((k) => troops[k]).map((k) => `${troopName(k)} ${signed(troops[k] as number)}`),
  ].join(', ');
}

/**
 * Выручка союзника глазами получателя (docs/siege_v2.md, 19.2): осаждённому — кто идёт и когда ударит, и что не пробился;
 * союзнику — его бой или что его дружина не пробилась через рогатки. Потерь в словах нет: они в донесении.
 */
function reliefText(item: NoticeItem, at: string): string {
  const { from, relief, won, ally } = item.p;
  if (relief === 'going') return `Союзник «${ally ?? '—'}» идёт на выручку. Ударит по лагерю «${from}» с тыла в ${at} — продержись до тех пор.`;
  if (relief === 'turned') {
    return ally
      ? `Выручка из «${ally}» не пробилась к лагерю «${from}»: проход в рогатках занят. Город держится сам.`
      : `В ${at} наша дружина не пробилась к лагерю под «${from}»: проход в рогатках занят. Отряд цел и стоит в поле.`;
  }
  return won
    ? `В ${at} наша дружина ударила с тыла по лагерю под «${from}» и разбила его. Осада с союзника снята.`
    : `В ${at} наша дружина ударила с тыла по лагерю под «${from}», но лагерь устоял. Потери — в донесении.`;
}

/** Машина лагеря в вести о вылазке на неё — кого сожгли. */
const MACHINE_ACC: Record<WarMachine, string> = {
  ladders: 'лестницы',
  ram: 'таран',
  tower: 'осадную башню',
  mangonel: 'камнемёт',
  trebuchet: 'требушет',
};

/** Условия сдачи словами: что станет с городом, если откроет ворота. */
const TERMS_FATE: Record<NoticeFate, string> = {
  plunder: 'склад ограбят, людей не тронут',
  captives: 'склад ограбят и уведут людей, но город не сожгут',
  burn: 'город сожгут',
};

/**
 * Переговоры у стен глазами получателя (docs/siege_v2.md, 7.3): пришло предложение — до какой минуты отвечать; ответ на
 * своё — отклонили или дань приняли. Цены дани в словах нет: она в окне осады (правило 18 — считать её здесь нечем).
 */
function parleyText(item: NoticeItem, at: string): string {
  const { from, offer, answer, fate } = item.p;
  if (answer === 'no') return offer === 'terms' ? `«${from}» не принял наших условий. Осада идёт.` : `Лагерь «${from}» не взял дань. Осада идёт.`;
  if (answer === 'yes') return `Лагерь «${from}» взял дань и уходит.`;
  if (offer === 'terms') return `Лагерь «${from}» предлагает сдачу: гарнизон уйдёт живым, ${TERMS_FATE[fate]}. Ответ — до ${at}, в окне осады.`;
  return `«${from}» предлагает дань, чтобы ты снял осаду. Ответ — до ${at}, в окне осады.`;
}

/** Что значит кольцо для осаждённого — словами двери кольца (правило 18: `world/blockade.BLOCKADE_GIVES`). */
const RING_ON = `${BLOCKADE_GIVES} Прорвать его можно вылазкой на пост.`;
const RING_OFF = 'Добыча и караваны снова идут.';

/**
 * Фаза осады глазами получателя (docs/siege_v2.md, 8.3): пролом и мор — значимое; наказ, сработавший в эту минуту, —
 * строкой следом. Своя сторона: `role` у войны, у осады логова получатель — всегда осаждённый. Пролом в своей стене зовёт
 * дать наказ чинить — если город уже чинит его по наказу, звать не к чему.
 */
function phaseText(item: NoticeItem, at: string): string {
  const { from, role, phase, k, breaches, order, ring, lost, broke } = item.p;
  const atk = role === 'atk';
  const lines: string[] = [];
  // Кольцо блокады (Р-5, docs/siege_v2.md, 21): замкнули — город отрезан; разомкнули — чем, видно в окне осады.
  if (ring === 'on') return `В ${at} лагерь «${from}» замкнул кольцо вокруг города. ${RING_ON}`;
  if (ring === 'off') return atk ? `В ${at} кольцо вокруг «${from}» разомкнуто. Замкнуть снова можно со следующей фазы.` : `В ${at} кольцо лагеря «${from}» разомкнуто. ${RING_OFF}`;
  const holes = breaches ? `: проломов ${breaches} из 3` : '';
  if (phase === 'breach') {
    lines.push(
      atk
        ? `В ${at} наш лагерь пробил стену «${from}»${holes}.`
        : `В ${at} лагерь «${from}» пробил стену${holes}. Со следующей фазы город может сдаться.${order === 'repair' ? '' : ' Дай наказ заделать пролом.'}`,
    );
  }
  if (phase === 'plague') lines.push(atk ? `В ${at} в нашем лагере под «${from}» мор. Людей всё меньше.` : `В ${at} в лагере «${from}» мор. Осаждающих всё меньше.`);
  if (order === 'volley') lines.push('По наказу лагерь дал залп по стенам.');
  if (order === 'storm') lines.push('По наказу лагерь пошёл на штурм. Чем кончился бой, сказано в донесении.');
  if (order === 'repair') lines.push('По наказу город заделывает пролом. К концу фазы стена будет цела.');
  if (order === 'ration') lines.push('Хлеба меньше половины. По наказу город урезал паёк — продержится дольше.');
  // Обстрел за фазу (Р-5): что он отнял.
  if (lost) lines.push(`Обстрел лагеря «${from}»: ${count(lost, 'постройка теряет', 'постройки теряют', 'построек теряют')} уровень.`);
  if (broke && atk) lines.push(`Требушет со стены «${from}» разбил ${broke === 1 ? 'машину' : count(broke, 'машину', 'машины', 'машин')} нашего лагеря.`);
  if (broke && !atk) lines.push(`Машины лагеря «${from}» разбили требушет на стене.`);
  return lines.join(' ') || `В ${at} прошла ${k}-я фаза осады «${from}».`;
}

/** Бой между игроками глазами получателя: `won` — победила ли его сторона. */
function fightText(item: NoticeItem): string {
  const { from, role, site, won, taken, fate, machine, ally } = item.p;
  if (site === 'wall') {
    if (role === 'atk') return won ? `Взяли «${from}» штурмом. Что взяли, сказано в донесении.` : `Штурм «${from}» не удался: стены устояли. Отряд отходит домой.`;
    if (won) return `Отряд из «${from}» ходил на штурм и откатился. Стены выстояли.`;
    return taken
      ? `Отряд из «${from}» взял город штурмом. ${FATE_DONE[fate]} ${WHAT_LEFT}`
      : `Отряд из «${from}» ходил на штурм, и стены не выстояли. Чем кончилось, сказано в донесении.`;
  }
  // Вылазка на пост кольца (Р-5): бой за кольцо, а не за лагерь — лагерь стоит при любом исходе.
  if (site === 'sortie' && item.p.ring === 'off') {
    if (role === 'def') return won ? `Гарнизон вышел из ворот и прорвал кольцо лагеря «${from}». Осада идёт, но город снова дышит.` : `Вылазку на пост кольца отбили. Кольцо лагеря «${from}» стоит.`;
    return won ? `Из «${from}» вышли на пост кольца. Пост отбился, кольцо стоит.` : `Вылазка из «${from}» прорвала наше кольцо. Замкнуть снова можно со следующей фазы.`;
  }
  // Вылазка на машину (docs/siege_v2.md, раздел 5): бой за машину, а не за лагерь — лагерь стоит при любом исходе.
  if (site === 'sortie' && machine) {
    const m = MACHINE_ACC[machine];
    if (role === 'def') return won ? `Гарнизон вышел из ворот и спалил ${m} лагеря «${from}».` : `Вылазку на ${m} отбили, лагерь «${from}» стоит у ворот. Осада идёт.`;
    return won ? `Из «${from}» вышли жечь ${m}. Охрана отбилась.` : `Вылазка из «${from}» сожгла ${m} нашего лагеря. Что осталось, сказано в донесении.`;
  }
  if (site === 'sortie') {
    if (role === 'def') return won ? `Гарнизон вышел из ворот и разбил лагерь «${from}». Осада снята.` : `Вылазку отбили, лагерь «${from}» стоит у ворот. Осада идёт.`;
    return won ? `Из «${from}» вышли на вылазку, но лагерь отбился. Осада идёт.` : `Вылазка из «${from}» разбила наш лагерь. Осада снята, отряд отходит домой.`;
  }
  // Выручка союзника (19.2): по лагерю ударил не наш полководец, а союзник.
  if (ally && role === 'def') return won ? `«${ally}» пришёл на выручку и с тыла разбил лагерь «${from}». Осада снята.` : `Выручку из «${ally}» лагерь «${from}» отбил. Осада идёт.`;
  // Удар полководца города по лагерю — один или с гарнизоном. Лагерь разбит — осада снята (`war.hitCamp` → `turnBack`).
  if (role === 'def') return won ? `Наш удар разбил лагерь «${from}». Осада снята.` : `Удар по лагерю «${from}» отбит. Осада идёт.`;
  return won ? `По нашему лагерю под «${from}» ударили. Отбились, осада идёт.` : `Наш лагерь под «${from}» разбит ударом. Осада снята, отряд отходит домой.`;
}

// ------------------------------------------------ письмо из нескольких вестей (ВС-1) ---

const news = (n: number): string => count(n, 'весть', 'вести', 'вестей');

/** Шапка письма с числом: «3 указа:», «2 боя:», «За ночь — 4 вести:». */
const HEAD: Record<Head, (n: number) => string> = {
  fights: (n) => `${count(n, 'бой', 'боя', 'боёв')}:`,
  sieges: (n) => `${news(n)} с осады:`,
  build: (n) => `Достроено ${count(n, 'постройка', 'постройки', 'построек')}:`,
  grants: (n) => `${count(n, 'указ', 'указа', 'указов')}:`,
  neighbors: (n) => `${news(n)} от соседей:`,
  realm: (n) => `${news(n)} державы:`,
  mix: (n) => `Пока тебя не было — ${news(n)}:`,
  night: (n) => `За ночь — ${news(n)}:`,
};

/** Строка вести внутри письма: у стройки и указа — коротко, их общий хвост письмо говорит один раз. */
function lineOf(item: NoticeItem, tz: string): string {
  if (item.kind === 'build') return buildLine(item);
  if (item.kind === 'grant') return grantLine(item);
  return noticeText(item, tz);
}

/**
 * Слова письма. Одна весть — её слова целиком. Несколько — шапка с числом и по строке на весть; сводка и утреннее письмо
 * — родами по порядку настроек; сверх `LETTER_LINES` — «…и раньше ещё N». Хвост стройки и указа — один на письмо.
 */
export function letterText(letter: Pick<Letter, 'head' | 'items' | 'n'>, tz: string): string {
  const { items } = letter;
  if (letter.n <= 1 && items.length === 1) return noticeText(items[0], tz);
  const order = (i: NoticeItem): number => TOPICS.indexOf(topicOf(i));
  const sorted = letter.head === 'mix' || letter.head === 'night' ? [...items].sort((a, b) => order(a) - order(b) || a.fireAt - b.fireAt) : items;
  const lines = [HEAD[letter.head](letter.n), ...sorted.map((i) => `— ${lineOf(i, tz)}`)];
  if (letter.n > items.length) lines.push(`…и раньше ещё ${letter.n - items.length}.`);
  for (const t of TOPICS) if (AFTER[t] && items.some((i) => topicOf(i) === t)) lines.push(AFTER[t] as string);
  return lines.join('\n');
}

// ------------------------------------------------ настройки вестей: /notify (ВС-1) ---

/** Роды на кнопках настроек. */
const TOPIC_NAME: Record<Topic, string> = { fights: 'Бои', sieges: 'Осады', build: 'Стройка', grants: 'Указы', neighbors: 'Соседи', realm: 'Держава' };
/** Роды в строке «бот пишет о …». */
const TOPIC_ABOUT: Record<Topic, string> = { fights: 'боях', sieges: 'осадах', build: 'стройке', grants: 'указах', neighbors: 'соседях', realm: 'державе' };

const listed = (xs: string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`);

const quietWords = (q: BotPrefs['quiet']): string => (q ? `${hhmm(q.from)}–${hhmm(q.to)}` : 'нет');

/** Строка «что срочное» — одна на настройки и на «только срочное». */
const URGENT_IS = 'набег, осада, сдача города, предложение условий или союза';

/** Что видно в настройках: какие роды, тихий час в поясе игрока и что значит «срочное». */
export function panelText(rec: Pick<NotifyRecord, 'prefs' | 'bot'>): string {
  const { prefs, bot } = rec;
  const lines = ['Вести в Telegram', ''];
  if (!prefs.on) lines.push('Вести выключены: бот молчит, пока их не включишь.');
  else if (bot.urgent) lines.push(`Только срочное: ${URGENT_IS}.`);
  else {
    const on = TOPICS.filter((t) => !bot.mute.includes(t));
    lines.push(on.length ? `Бот пишет о ${listed(on.map((t) => TOPIC_ABOUT[t]))}.` : 'Все роды выключены: бот молчит.');
    lines.push(`Срочное — ${URGENT_IS} — приходит сразу. Прочее — одним письмом за несколько минут.`);
  }
  lines.push(
    bot.quiet
      ? `Тихий час: ${quietWords(bot.quiet)} (${zoneOf(prefs.tz)}). Ночью срочное приходит без звука, прочее — утром одной сводкой.`
      : 'Тихого часа нет: вести приходят со звуком в любое время.',
  );
  return lines.join('\n');
}

/**
 * Кнопки настроек: роды, тихий час по кругу, «только срочное», общий рычаг. «Открыть игру» ставит адаптер. Состояние —
 * словом после двоеточия («Стройка: да»), без значков: вести бота — чистый текст (docs/icons.md, ЗН-1).
 */
export function panelRows(rec: Pick<NotifyRecord, 'prefs' | 'bot'>): PanelButton[][] {
  const { prefs, bot } = rec;
  const yes = (on: boolean): string => (on ? 'да' : 'нет');
  const topic = (t: Topic): PanelButton => ({ text: `${TOPIC_NAME[t]}: ${yes(!bot.mute.includes(t))}`, act: callbackTopic(t) });
  return [
    [topic('fights'), topic('sieges'), topic('build')],
    [topic('grants'), topic('neighbors'), topic('realm')],
    [{ text: `Тихий час: ${quietWords(bot.quiet)}`, act: CALLBACK_QUIET }],
    [{ text: `Только срочное: ${yes(bot.urgent)}`, act: CALLBACK_URGENT }],
    [prefs.on ? { text: BUTTON_OFF, act: CALLBACK_PANEL_OFF } : { text: BUTTON_ON, act: CALLBACK_PANEL_ON }],
  ];
}

// ------------------------------------------------ приветствие и итоги (docs/rating.md) ---

/** Мест на острове — столько, сколько их в данных мира (`world/spawn.SICILY`). */
const SICILY_PLACES = SICILY.length;

/** Ответ на `/start`: что за игра, коротко. Под ним — одна кнопка «Открыть игру» (`telegram.greet`). */
export function greeting(sicily: boolean): string {
  return [
    'TRIBE. Европа, 1200 год.',
    'Город уже стоит, дружины ещё нет. Куй снаряжение, нанимай бойцов, жги логова варваров и ходи походами на соседей. Заход — несколько минут.',
    ...(sicily ? ['', `Сейчас идёт испытание на Сицилии. На одном острове до ${SICILY_PLACES} городов, и каждый сам за себя.`] : []),
    '',
    'О набегах и боях бот напишет сам. Что присылать и когда молчать — /notify.',
  ].join('\n');
}

/** Сколько строк итоговой таблицы помещается в сообщение с запасом: игроков теста — до двенадцати. */
export const FINAL_ROWS = 30;

/** Строка таблицы: место, город, очки; под ней — из чего они. */
function finalRow(r: RatingRow): string {
  return [
    `${r.place}. «${cityOr(r.city)}» — ${count(r.points, 'очко', 'очка', 'очков')}`,
    `    мощь ${r.power}, ${count(r.won, 'победа', 'победы', 'побед')}, ${count(r.taken, 'город взят', 'города взято', 'городов взято')}`,
  ].join('\n');
}

/**
 * Итоговая таблица для игрока (`/final`). Первые `FINAL_ROWS` строк; своя строка, если ниже, — отдельно. `me` — строка
 * получателя; нет её (заморожен или не в реестре) — таблица без своего места.
 */
export function finalText(rows: RatingRow[], me: RatingRow | null): string {
  const top = rows.slice(0, FINAL_ROWS);
  return [
    'Испытание окончено. Так встали города:',
    '',
    ...top.map(finalRow),
    ...(rows.length > top.length ? [`…и ещё ${rows.length - top.length}`] : []),
    ...(me ? ['', `Твоё место — ${me.place} из ${rows.length}.`] : []),
    '',
    'Спасибо за игру.',
  ].join('\n');
}
