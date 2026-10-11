/**
 * Слова сообщений бота — по виду и числам пункта, одним модулем (docs/NOTIFY.md, раздел 12). Свободного текста от
 * клиента сервер не принимает: клиент присылает вид, имя двора, участь и минуты, а слова собираются здесь, в минуту
 * отправки и в поясе игрока.
 *
 * Словарь — docs/ui_audit.md, раздел 4: город, набег (только входящее), отряд, лагерь, штурм, вылазка, удар,
 * донесение; на «ты», коротко, без восклицаний и без пересказа устройства игры. Чисел здесь два вида — минута
 * («в 14:40», поясом игрока) и ничего больше: потери и добыча устаревают и лежат в донесении (правило 18 — числа
 * нет, и считать его нечем).
 */
import { cityOr, type NoticeFate, type NoticeItem, type RatingRow } from './contract.js';
import { localTime } from './notify.js';
import { SICILY } from '../../src/world/spawn.js';
import { count } from '../../src/ui/parts/plural.js';

/** Подписи кнопки под сообщением: выключить, когда включено, и наоборот (решение владельца). */
export const BUTTON_OFF = 'Отключить уведомления';
export const BUTTON_ON = 'Включить уведомления';

/** Кнопка рядом — открыть игру (решение владельца 06.10.2026). */
export const BUTTON_OPEN = 'Открыть игру';

/** Что кнопка шлёт боту. Других данных у кнопок нет. */
export const CALLBACK_OFF = 'notify:off';
export const CALLBACK_ON = 'notify:on';

/** Ответ на нажатие — всплывающая строка в Telegram. */
export const SWITCHED_OFF = 'Уведомления выключены';
export const SWITCHED_ON = 'Уведомления включены';

/** «14:40» в поясе игрока. */
export function clock(ms: number, tz: string): string {
  const m = localTime(ms, tz).minute;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Что стало с городом — участью, уже случившейся. */
const FATE_DONE: Record<NoticeFate, string> = {
  plunder: 'Склад ограблен.',
  captives: 'Из города увели людей.',
  burn: 'Город сожжён.',
};

/** Что сделал чужой лазутчик — по участи, которой сервер назвал дело (`war.spyFate`): огонь, кража, смута. */
const SPY_DONE: Record<NoticeFate, string> = {
  burn: 'В {at} загорелся склад. Поджёг чужой лазутчик. Что сгорело, сказано в донесении.',
  plunder: 'В {at} обокрали склад. Это работа чужого лазутчика. Что пропало, сказано в донесении.',
  captives: 'В {at} в городе поднялась смута. Её посеял чужой лазутчик. Что с людьми, сказано в донесении.',
};

/** Слова пункта. `tz` — пояс получателя. */
export function noticeText(item: NoticeItem, tz: string): string {
  const p = item.p;
  const at = clock(p.about, tz);
  switch (item.kind) {
    // Ответить можно до самого прихода — срок один, «у стен в» (решение владельца 06.10.2026, docs/NOTIFY.md, 12.11).
    case 'raid':
      return `Набег из «${p.from}». Идут на твой город, у стен будут в ${at}.`;
    case 'raid-fight':
      return `В ${at} набег из «${p.from}» дошёл до стен. Чем кончился бой, сказано в донесении.`;
    case 'siege-fall':
      return p.gates
        ? `В ${at} ворота открыли. Лагерь «${p.from}» вошёл в город, гарнизон ушёл живым. ${FATE_DONE[p.fate]}`
        : `В ${at} в городе кончился хлеб. Лагерь «${p.from}» вошёл в ворота. ${FATE_DONE[p.fate]}`;
    case 'siege-phase':
    case 'war-phase':
      return phaseText(item, at);
    case 'war':
      return `Из города «${p.from}» вышел отряд на твой город. У стен будут в ${at}. ${p.mode === 'storm' ? 'Идут на штурм.' : 'Идут встать лагерем у ворот.'}`;
    case 'war-fall':
      if (p.gates) {
        return p.role === 'atk'
          ? `«${p.from}» открыл ворота, не дождавшись голода. Город наш.`
          : `В ${at} ворота открыли. Отряд из «${p.from}» вошёл в город, гарнизон ушёл живым. ${FATE_DONE[p.fate]}`;
      }
      return p.role === 'atk'
        ? `В «${p.from}» кончился хлеб, ворота открыты. Город наш.`
        : `В городе кончился хлеб. Отряд из «${p.from}» вошёл в ворота. ${FATE_DONE[p.fate]}`;
    case 'war-fight':
      return fightText(item);
    // Тайное нападение (docs/spy_pvp.md): чей лазутчик, город не знает — имени в словах нет.
    case 'war-spy':
      return SPY_DONE[p.fate].replace('{at}', at);
  }
}

/**
 * Фаза осады глазами получателя (docs/siege_v2.md, 8.3): пролом и мор — значимое; наказ, сработавший в эту минуту, —
 * строкой следом. Своя сторона: `role` у войны, у осады логова получатель — всегда осаждённый.
 */
function phaseText(item: NoticeItem, at: string): string {
  const { from, role, phase, k, breaches, order } = item.p;
  const atk = role === 'atk';
  const lines: string[] = [];
  if (phase === 'breach') {
    const count = breaches ? ` Проломов ${breaches} из 3.` : '';
    lines.push(
      atk
        ? `В ${at}, на ${k}-й фазе осады, в стене «${from}» пролом.${count}`
        : `В ${at}, на ${k}-й фазе осады, в стене пролом.${count} Лагерь «${from}» у ворот. Сдаться город может не раньше следующей фазы.`,
    );
  }
  if (phase === 'plague') {
    lines.push(atk ? `В ${at} в нашем лагере под «${from}» мор. Людей стало меньше.` : `В ${at} в лагере «${from}» мор. Лагерь тает.`);
  }
  if (order === 'volley') lines.push('По наказу лагерь дал залп этой фазы.');
  if (order === 'storm') lines.push('По наказу лагерь пошёл на штурм. Чем кончился бой, сказано в донесении.');
  return lines.join(' ') || `В ${at} прошла ${k}-я фаза осады «${from}».`;
}

/** Бой между игроками глазами получателя: `won` — победила ли его сторона. */
function fightText(item: NoticeItem): string {
  const { from, role, site, won, taken, fate } = item.p;
  if (site === 'wall') {
    if (role === 'atk') return won ? `Город «${from}» взят штурмом.` : `Штурм «${from}» отбит. Отряд отходит домой.`;
    if (won) return `Отряд из «${from}» пошёл на штурм. Стены выстояли.`;
    return taken ? `Отряд из «${from}» взял город штурмом. ${FATE_DONE[fate]}` : `Отряд из «${from}» пошёл на штурм, и стены не выстояли.`;
  }
  if (site === 'sortie') {
    if (role === 'def') return won ? `Гарнизон вышел из ворот и разбил лагерь «${from}».` : `Вылазку отбили. Лагерь «${from}» стоит у ворот.`;
    return won ? `Из «${from}» вышли на вылазку. Лагерь отбился и стоит.` : `Вылазка из «${from}» разбила наш лагерь.`;
  }
  // Удар полководца города по лагерю — один или с гарнизоном.
  if (role === 'def') return won ? `Ударили по лагерю «${from}» и разбили его.` : `Удар по лагерю «${from}» отбит.`;
  return won ? `По нашему лагерю под «${from}» ударили. Отбились.` : `Наш лагерь под «${from}» разбит ударом.`;
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
