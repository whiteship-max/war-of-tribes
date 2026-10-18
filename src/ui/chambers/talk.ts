// Разговоры в покоях (docs/city_v3.md, Г-7): слуга, служанка и супруга — реплика и три-пять ответов правителя. Речь —
// по 1200 году, коротко и живо; что говорят, зависит от часа (утро, день, вечер, ночь), от морали города и от войны, а
// слуга и супруга помнят, о чём уже шла речь (память устройства, `memory.ts`, — не партия). Механики здесь нет: просьба
// слуге — сцена в покоях (`render/chambers/life.ts`), а не дело в игре.
//
// Чистый модуль: случайность — доля `roll` от зовущего (своя, зернистая), тесты зовут его без страницы.
import type { FaithId } from '@/game/types';
import type { Order, Who, Why } from '@/render/chambers/life';

export type Daypart = 'morning' | 'day' | 'evening' | 'night';
/** Нрав супруги — один на дом правителя (выводится из его имени). */
export type Temper = 'meek' | 'merry' | 'stern' | 'pious' | 'proud';
export const TEMPER_NAME: Record<Temper, string> = { meek: 'кроткая', merry: 'весёлая', stern: 'строгая', pious: 'набожная', proud: 'гордая' };
/** О чём говорить с супругой. */
export type Topic = 'city' | 'war' | 'children' | 'home';

export type OptionId = 'cat' | 'uncat' | 'wine' | 'wife' | 'castle' | 'dismiss' | 'pour' | 'chat' | Topic | 'night' | 'leave';

export interface TalkOption {
  id: OptionId;
  text: string;
}

/** Что помнят люди покоев (устройство): сколько раз что приносил слуга, о чём говорили с супругой, что было ночью. */
export interface TalkMemory {
  v: 1;
  /** Чей это дом: сменился правитель — новая супруга, разговоры с начала. */
  house: string;
  servant: { cat: number; uncat: number; wine: number; wife: number; castle: number };
  maid: { pours: number; chat: number; nights: number };
  wife: { city: number; war: number; children: number; home: number; nights: number; visits: number };
  /** Отказала в этот приход — второй раз не спрашивают (номер прихода). */
  refused: { maid: number; wife: number };
  visits: number;
}

export const freshMemory = (house: string): TalkMemory => ({
  v: 1,
  house,
  servant: { cat: 0, uncat: 0, wine: 0, wife: 0, castle: 0 },
  maid: { pours: 0, chat: 0, nights: 0 },
  wife: { city: 0, war: 0, children: 0, home: 0, nights: 0, visits: 0 },
  refused: { maid: -1, wife: -1 },
  visits: 0,
});

/** Что видно разговору: кто, зачем подошёл, час, город, война, кот, вино, взрослые сцены, имена, память, бросок. */
export interface TalkCtx {
  who: Who;
  why: Why;
  daypart: Daypart;
  /** Мораль города 0…100. */
  morale: number;
  /** Враг у стен (осада нас) или наш лагерь под чужим городом. */
  besieged: boolean;
  campaign: boolean;
  cat: boolean;
  /** Вина в кубке 0…1. */
  wine: number;
  /** «Сцены для взрослых» включены (настройки). */
  adult: boolean;
  ruler: string;
  faith: FaithId;
  wife: { name: string; temper: Temper };
  maid: string;
  servant: string;
  heir: string | null;
  mem: TalkMemory;
  /** Своя доля 0…1 на этот ход (согласится ли, какую реплику из нескольких). */
  roll: number;
}

/** Ход разговора: реплика, ответы правителя, просьба (сцена в покоях), конец разговора, память после хода. */
export interface TalkTurn {
  line: string;
  options: TalkOption[];
  order?: Order;
  end?: boolean;
  mem: TalkMemory;
}

// ---------- Имена ----------

/** Женские имена эпохи по вере деревни: супруга — знатная, служанка — простая. */
const WIFE_NAMES: Record<FaithId, readonly string[]> = {
  catholic: ['Алиенора', 'Бланка', 'Матильда', 'Изабелла', 'Констанция', 'Агнесса', 'Беатриса', 'Маргарита', 'Аделаида', 'Ида', 'Кунигунда', 'Елизавета'],
  orthodox: ['Евфросиния', 'Евдокия', 'Феодора', 'Анна', 'Мария', 'Ольга', 'Верхуслава', 'Предслава', 'Тамара', 'Ксения', 'Агафья', 'Елена'],
  islam: ['Фатима', 'Айша', 'Зайнаб', 'Сафия', 'Хадиджа', 'Марьям', 'Шаджар', 'Зубайда', 'Рабия', 'Лейла', 'Хинд', 'Амина'],
  pagan: ['Аудра', 'Рамуне', 'Лайма', 'Мильда', 'Айно', 'Сальме', 'Юрате', 'Гинтаре', 'Вилья', 'Кайя', 'Майре', 'Эгле'],
};
const MAID_NAMES: Record<FaithId, readonly string[]> = {
  catholic: ['Марта', 'Гертруда', 'Берта', 'Эмма', 'Хильда'],
  orthodox: ['Марфа', 'Малуша', 'Агнея', 'Дуняша', 'Улита'],
  islam: ['Зухра', 'Нур', 'Салма', 'Рукайя', 'Лубна'],
  pagan: ['Ауксе', 'Дайва', 'Ниеле', 'Терхи', 'Ану'],
};
const SERVANT_NAMES: Record<FaithId, readonly string[]> = {
  catholic: ['Арнульф', 'Готфрид', 'Ансельм', 'Бернар'],
  orthodox: ['Онуфрий', 'Пахом', 'Савелий', 'Ефим'],
  islam: ['Масуд', 'Кадир', 'Хабиб', 'Нуман'],
  pagan: ['Вайдотас', 'Каупо', 'Юхан', 'Тойво'],
};
/** Как к правителю обращаются слуги. */
export const TITLE: Record<FaithId, string> = { catholic: 'сир', orthodox: 'княже', islam: 'господин', pagan: 'княже' };

/** Число из строки (имя правителя и номер в доме): имена и нрав одни на этот дом. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TEMPERS: readonly Temper[] = ['meek', 'merry', 'stern', 'pious', 'proud'];

/** Дом правителя: имя супруги, её нрав, имя служанки и слуги — из имени правителя и веры, одни на этот дом. */
export function household(ruler: string, n: number, faith: FaithId): { wife: { name: string; temper: Temper }; maid: string; servant: string; house: string } {
  const key = `${ruler}#${n}`;
  const h = hash(key);
  const w = WIFE_NAMES[faith];
  // Пустая строка у языческих имён недопустима — в списке нет пустых (тест).
  return {
    wife: { name: w[h % w.length], temper: TEMPERS[(h >>> 8) % TEMPERS.length] },
    maid: MAID_NAMES[faith][(h >>> 13) % MAID_NAMES[faith].length],
    servant: SERVANT_NAMES[faith][(h >>> 17) % SERVANT_NAMES[faith].length],
    house: key,
  };
}

// ---------- Слова ----------

const pick = <T,>(arr: readonly T[], roll: number): T => arr[Math.min(arr.length - 1, Math.floor(roll * arr.length))];
const clone = (m: TalkMemory): TalkMemory => JSON.parse(JSON.stringify(m)) as TalkMemory;
const mood = (c: TalkCtx): 'low' | 'mid' | 'high' => (c.morale < 40 ? 'low' : c.morale > 70 ? 'high' : 'mid');
const war = (c: TalkCtx): boolean => c.besieged || c.campaign;

/** Час словами слуги: утро — «доброго утра», ночь — «не спится?». */
const SERVANT_HELLO: Record<Daypart, readonly string[]> = {
  morning: ['Доброго утра, {t}. Звал?', 'С добрым утром, {t}. Чего изволишь?'],
  day: ['Звал, {t}? Слушаю.', 'Здесь я, {t}. Чего изволишь?'],
  evening: ['Добрый вечер, {t}. Звал?', 'Слушаю, {t}. Свечи уже зажгли.'],
  night: ['Не спится, {t}? Я тут, за дверью.', 'Звал, {t}? Ночь на дворе, а я не сплю.'],
};

/** Реплика слуги, когда вернулся с делом. */
function servantBack(c: TalkCtx): string {
  if (c.why === 'cat') return c.mem.servant.cat > 1 ? 'Вот он, разбойник. Опять на кухне у сметаны сидел. Ещё что, {t}?' : 'Принёс, {t}. Мурлычет уже. Ещё что?';
  if (c.why === 'uncat') return c.mem.servant.uncat > 1 ? 'Снёс на кухню, к тёплой печи. Он и не спорил. Ещё что?' : 'Унёс, {t}. Пусть мышей ловит. Ещё что?';
  return pick(SERVANT_HELLO[c.daypart], c.roll);
}

/** Что слуга знает о замке: мораль и война его словами. */
function servantNews(c: TalkCtx): string {
  if (c.besieged) return 'Враг под стенами, {t}. На кухне сухари сушат, а в людской молятся. Стены, говорят, крепки.';
  if (c.campaign) return 'Дружина в походе, {t}. Бабы на стену бегают — не видать ли гонца.';
  const m = mood(c);
  if (m === 'low') return pick(['Ропщут люди, {t}. Хлеба мало, работы много. Я б не сказал, да ты спросил.', 'Невесело в городе, {t}. Даже на кухне не поют.'], c.roll);
  if (m === 'high') return pick(['Весело в городе, {t}! На торгу шум, в кабаке песни. Давно так не жили.', 'Хорошо живём, {t}. Повар и тот добрый.'], c.roll);
  return pick(['Живём помаленьку, {t}. Конюх с кузнецом опять бранились — помирил.', 'Тихо, {t}. Дождь бы не помешал полям.'], c.roll);
}

function servantOptions(c: TalkCtx): TalkOption[] {
  return [
    c.cat ? { id: 'uncat', text: 'Унеси кота.' } : { id: 'cat', text: 'Приведи кота.' },
    { id: 'wine', text: `Позови ${femCase(c.maid, 'acc')} с вином.` },
    { id: 'wife', text: `Пригласи госпожу ${femCase(c.wife.name, 'acc')}.` },
    { id: 'castle', text: 'Что слышно в замке?' },
    { id: 'dismiss', text: 'Ступай.' },
  ];
}

function maidOptions(c: TalkCtx): TalkOption[] {
  const o: TalkOption[] = [{ id: 'chat', text: c.daypart === 'night' ? 'Отчего не спишь?' : 'Как живёшь, красавица?' }];
  if (c.wine < 0.5) o.push({ id: 'pour', text: 'Налей ещё.' });
  if (canNight(c, 'maid')) o.push({ id: 'night', text: 'Останься со мной до утра.' });
  o.push({ id: 'leave', text: 'Ступай, спасибо.' });
  return o;
}

function wifeOptions(c: TalkCtx): TalkOption[] {
  const o: TalkOption[] = [
    { id: 'city', text: 'Что говорят в городе?' },
    { id: 'war', text: war(c) ? 'О войне.' : 'Спокойно ли на границах?' },
    { id: 'children', text: c.heir ? `Как ${c.heir}?` : 'Как дети?' },
    { id: 'home', text: 'Как дом?' },
  ];
  if (canNight(c, 'wife')) o.push({ id: 'night', text: 'Останься сегодня со мной.' });
  o.push({ id: 'leave', text: 'Ступай, отдохни.' });
  // Не больше пяти: из тем — те, о которых меньше говорили.
  if (o.length > 5) {
    const topics = o.filter((x) => x.id === 'city' || x.id === 'war' || x.id === 'children' || x.id === 'home');
    topics.sort((a, b) => c.mem.wife[a.id as Topic] - c.mem.wife[b.id as Topic]);
    const drop = topics[topics.length - 1].id;
    return o.filter((x) => x.id !== drop);
  }
  return o;
}

/** Можно ли предложить ночь: включены сцены для взрослых и в этот приход она ещё не отказала. */
export function canNight(c: TalkCtx, who: 'maid' | 'wife'): boolean {
  return c.adult && c.mem.refused[who] !== c.mem.visits;
}

/** Согласится ли: служанка — охотнее вечером и ночью, днём работа; супруга — по нраву, в войну — реже. */
export function agreeChance(c: TalkCtx, who: 'maid' | 'wife'): number {
  if (who === 'maid') return c.daypart === 'evening' || c.daypart === 'night' ? 0.65 : 0.3;
  const base: Record<Temper, number> = { meek: 0.75, merry: 0.85, stern: 0.5, pious: 0.45, proud: 0.6 };
  let p = base[c.wife.temper];
  if (war(c)) p *= 0.6;
  if (c.daypart === 'night' || c.daypart === 'evening') p = Math.min(0.95, p + 0.1);
  return p;
}

/**
 * Женское имя в винительном («позови Марту», «пригласи Иду») и дательном («вели Марте») падеже: на -а — -у и -е, на -я —
 * -ю и -е, на -ия — -ию и -ии; на согласную и на -о, -у, -е (Нур, Айно, Ану, Эгле) — не склоняются.
 */
export function femCase(name: string, c: 'acc' | 'dat'): string {
  if (/ия$/.test(name)) return name.slice(0, -1) + (c === 'acc' ? 'ю' : 'и');
  if (/[кгх]а$/.test(name)) return name.slice(0, -1) + (c === 'acc' ? 'у' : 'е');
  if (/а$/.test(name)) return name.slice(0, -1) + (c === 'acc' ? 'у' : 'е');
  if (/я$/.test(name)) return name.slice(0, -1) + (c === 'acc' ? 'ю' : 'е');
  return name;
}

const fill = (s: string, c: TalkCtx): string =>
  s
    .replace(/\{t\}/g, TITLE[c.faith])
    .replace(/\{r\}/g, c.ruler)
    .replace(/\{wA\}/g, femCase(c.wife.name, 'acc'))
    .replace(/\{mA\}/g, femCase(c.maid, 'acc'))
    .replace(/\{mD\}/g, femCase(c.maid, 'dat'))
    .replace(/\{w\}/g, c.wife.name)
    .replace(/\{m\}/g, c.maid)
    .replace(/\{s\}/g, c.servant)
    .replace(/\{h\}/g, c.heir ?? 'наш мальчик');

/** Начало разговора: кто подошёл и зачем. */
export function opening(c: TalkCtx): TalkTurn {
  const mem = clone(c.mem);
  if (c.who === 'servant') {
    const line = c.why === 'arrive' || c.why === 'come' ? pick(SERVANT_HELLO[c.daypart], c.roll) : servantBack(c);
    return { line: fill(line, c), options: servantOptions(c), mem };
  }
  if (c.who === 'maid') {
    const line =
      c.why === 'poured'
        ? c.mem.maid.pours > 1
          ? pick(['Ещё налила, {t}. Вино доброе, с юга, — только не всё сразу.', 'Полный кубок, {t}. Кувшин-то лёгкий стал.'], c.roll)
          : pick(['Налила, {t}. Вино доброе, с юга.', 'Вот, {t}, полный кубок. Пей на здоровье.'], c.roll)
        : pick(['Звал, {t}?', 'Чего желаешь, {t}?'], c.roll);
    return { line: fill(line, c), options: maidOptions(c), mem };
  }
  mem.wife.visits++;
  const t = c.wife.temper;
  const first = c.mem.wife.visits === 0;
  const hello: Record<Temper, string> = {
    meek: first ? 'Ты звал меня, {r}? Я пришла.' : 'Снова позвал, {r}? Я рада.',
    merry: first ? 'Звал, {r}? А я уж думала — забыл про меня!' : 'Опять я тебе нужна, {r}? Ну, говори, говори.',
    stern: first ? 'Ты звал, {r}. Слушаю.' : 'Звал? Коротко, {r}: у меня ключница не в духе.',
    pious: first ? 'Мир тебе, {r}. Я шла с вечерни — ты звал?' : 'Звал, {r}? Я помолилась за тебя нынче.',
    proud: first ? 'Ты послал за мной слугу, {r}. Надеюсь, дело важное.' : 'Снова слуга за мной, {r}? Говори.',
  };
  const night = c.daypart === 'night' ? ' Ночь ведь.' : '';
  return { line: fill(hello[t] + night, c), options: wifeOptions(c), mem };
}

/** Ответ на выбор правителя. */
export function reply(c: TalkCtx, id: OptionId): TalkTurn {
  const mem = clone(c.mem);
  const turn = (line: string, options: TalkOption[], extra: Partial<TalkTurn> = {}): TalkTurn => ({ line: fill(line, { ...c, mem }), options, mem, ...extra });
  if (c.who === 'servant') {
    switch (id) {
      case 'cat':
        mem.servant.cat++;
        return turn(mem.servant.cat > 2 ? 'Опять кота? Сей же час, {t}, — поди, на кухне сметану стережёт.' : mem.servant.cat > 1 ? 'Снова кота? Несу, {t}.' : 'Сей же час, {t}.', [], { order: 'cat', end: true });
      case 'uncat':
        mem.servant.uncat++;
        return turn(mem.servant.uncat > 1 ? 'Унесу, {t}. Он и сам туда просится.' : 'Унесу, {t}. Кис-кис…', [], { order: 'uncat', end: true });
      case 'wine':
        mem.servant.wine++;
        return turn(mem.servant.wine > 2 ? 'Опять вина? Велю {mD} нести кувшин побольше.' : mem.servant.wine > 1 ? 'Ещё вина? Кликну {mA}.' : 'Кликну {mA}, {t}. Вина с юга?', [], { order: 'wine', end: true });
      case 'wife':
        mem.servant.wife++;
        return turn(mem.servant.wife > 1 ? 'Позову госпожу, {t}. Она нынче в добром духе, кажись.' : 'Позову госпожу {wA}, {t}.', [], { order: 'wife', end: true });
      case 'castle':
        mem.servant.castle++;
        return turn(servantNews(c), servantOptions(c).filter((o) => o.id !== 'castle'));
      default:
        return turn(c.daypart === 'night' ? 'Доброй ночи, {t}. Я за дверью, если что.' : 'Слушаюсь, {t}.', [], { order: 'dismiss', end: true });
    }
  }
  if (c.who === 'maid') {
    switch (id) {
      case 'pour':
        mem.maid.pours++;
        return turn(pick(['Налью, {t}.', 'Сейчас, {t}. Вино как раз отстоялось.'], c.roll), [], { order: 'pour', end: true });
      case 'chat': {
        mem.maid.chat++;
        const line =
          c.daypart === 'night'
            ? 'Тесто на утро ставила, {t}. Хлеб сам не поднимется.'
            : mood(c) === 'low'
              ? 'Да как все, {t}: работы много, хлеба мало. Ты не серчай.'
              : war(c)
                ? 'Боязно, {t}. Брат мой в дружине. А так — живу.'
                : pick(['Хорошо живу, {t}. Ключница добрая, повар не дерётся.', 'Весной замуж, коли отпустишь, {t}. За бондаря.'], c.roll);
        return turn(line, maidOptions({ ...c, mem }).filter((o) => o.id !== 'chat'));
      }
      case 'night': {
        const yes = c.roll < agreeChance(c, 'maid');
        if (yes) {
          mem.maid.nights++;
          return turn('Как скажешь, {t}… Только свечу задуй.', [], { order: 'night', end: true });
        }
        mem.refused.maid = mem.visits;
        const no = c.daypart === 'day' || c.daypart === 'morning' ? 'Днём-то, {t}? Меня на кухне ждут. Не серчай.' : 'Не нынче, {t}. Ключница хватится. Не серчай.';
        return turn(no, maidOptions({ ...c, mem }).filter((o) => o.id !== 'night'));
      }
      default:
        return turn(c.daypart === 'night' || c.daypart === 'evening' ? 'Доброй ночи, {t}.' : 'Пойду, {t}. Работа ждёт.', [], { order: 'dismiss', end: true });
    }
  }
  // Супруга.
  const t = c.wife.temper;
  const again = (k: Topic): number => mem.wife[k];
  switch (id) {
    case 'city': {
      mem.wife.city++;
      const m = mood(c);
      const lines = m === 'low' ? ['На торгу ропщут, {r}. Хлеб дорог, а подати — те же. Неспокойно мне.', 'Люди хмурые, {r}. Я раздала милостыню у церкви — мало этого.'] : m === 'high' ? ['В городе праздник за праздником, {r}. Тебя хвалят — я слышала сама.', 'Купцы довольны, мастера при деле. Хорошо ты правишь, {r}.'] : ['Город живёт, {r}. Купцы торгуются, мастера стучат — как всегда.', 'Тихо в городе. Говорят, к ярмарке подвоз будет.'];
      const pre = again('city') > 1 ? 'Мы ведь говорили… но скажу ещё: ' : '';
      return turn(pre + pick(lines, c.roll), wifeOptions({ ...c, mem }).filter((o) => o.id !== 'city'));
    }
    case 'war': {
      mem.wife.war++;
      const line = c.besieged
        ? t === 'stern' || t === 'proud'
          ? 'Пусть стоят под стенами, {r}. Кто сдаётся раньше голода — тот и проиграл. Мы не сдадимся.'
          : 'Враг у стен, {r}, а я сплю в одежде. Береги себя — и город.'
        : c.campaign
          ? 'Дружина далеко, {r}. Каждый вечер я гляжу на дорогу. Верни их всех.'
          : t === 'pious'
            ? 'Мир — лучшая из твоих побед, {r}. Я ставлю свечу каждый день.'
            : 'Спокойно, слава богу. Но ты не верь тишине, {r}: соседи считают наши стены.';
      return turn((again('war') > 1 ? 'Опять о войне… ' : '') + line, wifeOptions({ ...c, mem }).filter((o) => o.id !== 'war'));
    }
    case 'children': {
      mem.wife.children++;
      const lines = ['{h} опять с деревянным мечом по двору бегал — весь в тебя.', '{h} читает уже бойко. Капеллан хвалит, а я горжусь.', '{h} просится с тобой на охоту. Я сказала — спроси отца.', '{h} простыл, но жара нет. Я сама сидела у постели.'];
      const k = (again('children') - 1 + Math.floor(c.roll * 4)) % lines.length;
      return turn(lines[k], wifeOptions({ ...c, mem }).filter((o) => o.id !== 'children'));
    }
    case 'home': {
      mem.wife.home++;
      const lines =
        c.daypart === 'evening' || c.daypart === 'night'
          ? ['Ключница опять с поваром бранилась. Я их помирила — до утра.', 'Велела к зиме перины перебить и окна законопатить. Сквозит у тебя тут.']
          : ['Бельё сушим, полотно белим. К празднику новые скатерти будут.', 'В кладовой порядок, {r}. Мёд в этом году хорош.'];
      return turn((again('home') > 1 ? 'Дом как дом, {r}… ' : '') + pick(lines, c.roll), wifeOptions({ ...c, mem }).filter((o) => o.id !== 'home'));
    }
    case 'night': {
      const yes = c.roll < agreeChance(c, 'wife');
      if (yes) {
        mem.wife.nights++;
        const line: Record<Temper, string> = {
          meek: 'Останусь, {r}.',
          merry: 'А я уж думала, ты не спросишь!',
          stern: 'Хорошо. Только свечи погаси сам.',
          pious: 'Останусь, {r}. Но молитву прочтём вместе.',
          proud: 'Раз просишь — останусь.',
        };
        return turn(line[t], [], { order: 'night', end: true });
      }
      mem.refused.wife = mem.visits;
      const no: Record<Temper, string> = {
        meek: 'Не сегодня, {r}… Я устала. Не сердись.',
        merry: 'Не сегодня, милый. Голова кругом от хлопот.',
        stern: 'Не сегодня, {r}. Завтра рано вставать.',
        pious: 'Нынче пост, {r}. Потерпи.',
        proud: 'Не сегодня. Ты долго не звал меня.',
      };
      return turn(war(c) && t !== 'merry' ? 'Не до того сейчас, {r}, когда враг рядом. Не сердись.' : no[t], wifeOptions({ ...c, mem }).filter((o) => o.id !== 'night'));
    }
    default:
      return turn(c.daypart === 'night' ? 'Доброй ночи, {r}.' : 'Пойду, {r}. Дела не ждут.', [], { order: 'dismiss', end: true });
  }
}

/** Час по свету города: ночь — по глубине ночи, утро и вечер — солнце низко (утро — на востоке). */
export function daypartOf(night: number, sunY: number, sunX: number): Daypart {
  if (night > 0.55) return 'night';
  if (sunY < 0.3) return sunX > 0 ? 'morning' : 'evening';
  return 'day';
}
