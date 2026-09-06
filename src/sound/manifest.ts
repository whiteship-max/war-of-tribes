// Список звуковых дорожек. Пока файлов нет — это список покупок, и он же
// единственное место, где записано, что именно должно приехать.
//
// Правило, ради которого манифест и заведён: **когда файлы появятся, работа
// сводится к тому, чтобы положить их в папку.** Ни одной правки кода. Поэтому
// дорожки названы здесь заранее, а всё остальное — загрузка, слои, громкости —
// уже написано и просто молчит, пока файла нет.
//
// Звук НЕ попадает в бандл: файлы лежат в `public/`, сборка копирует их как
// есть, а браузер тянет по адресу и кладёт в свой кэш. Сборка без файлов
// собирается и работает — просто молча.
import type { Act, MusicLayer } from '@/battle/replay';

/** Где лежат дорожки. `public/assets/music/` → `/assets/music/` в собранном виде. */
export const MUSIC_DIR = '/assets/music/';

/**
 * Формат один — mp3. Не потому, что он лучший, а потому, что он единственный,
 * который играет везде: opus не поддерживает Safari на iPhone, а вебвью
 * Telegram на iOS — это он и есть. Второй формат означал бы либо запасной путь
 * в коде, либо 404 на каждой загрузке.
 */
export const MUSIC_FORMAT = 'mp3';

/**
 * Длина каждой дорожки в секундах. Все три обязаны быть **одной длины и одного
 * темпа**: ролик не склеивает их встык, а ведёт с общего начала и переключает
 * громкости, поэтому разъехавшиеся дорожки дадут слышный шов на каждой смене
 * слоя. Петля бесшовная: самый длинный ролик — 56 секунд, и петля успевает
 * пройти дважды.
 */
export const MUSIC_LOOP = 32;

/** Сколько секунд переливается один слой в другой. Не склейка, а перелив. */
export const MUSIC_FADE = 0.6;

export interface MusicTrack {
  layer: Exclude<MusicLayer, 'silence'>;
  file: string;
  /** На каком такте ролика он звучит. */
  act: Act;
  /** Сколько секунд ролик может провести на этом такте. */
  seconds: { min: number; max: number };
  /** Что должно быть в дорожке словами. Это и есть заказ. */
  note: string;
}

/**
 * Три дорожки — один и тот же материал в трёх плотностях. Не три разные пьесы:
 * ролик переключает слои посреди такта, и разные пьесы дали бы склейку вместо
 * нарастания.
 */
export const MUSIC_TRACKS: MusicTrack[] = [
  {
    layer: 'drums',
    file: `drums.${MUSIC_FORMAT}`,
    act: 'muster',
    seconds: { min: 4, max: 4 },
    note:
      'Только ударные: ровный строевой пульс, без гармонии и без мелодии. Играет, ' +
      'пока камера стоит у земли и войска ещё не пошли. Начало должно быть слышимым ' +
      'с первой доли — ролик стартует сразу, разгона нет.',
  },
  {
    layer: 'harmony',
    file: `harmony.${MUSIC_FORMAT}`,
    act: 'pullback',
    seconds: { min: 6, max: 6 },
    note:
      'Те же ударные плюс гармония — низкие струнные или хор, без мелодии. Играет ' +
      'на отъезде камеры и на залпе: это нарастание, а не новая тема.',
  },
  {
    layer: 'full',
    file: `full.${MUSIC_FORMAT}`,
    act: 'melee',
    seconds: { min: 14, max: 54 },
    note:
      'Полный трек: ударные, гармония и мелодия. Играет весь бой линий — от ' +
      'столкновения до перелома. Самый длинный такт, петля крутится в нём.',
  },
];

/** Адрес дорожки. Единственное место, где имя файла превращается в ссылку. */
export const trackUrl = (track: MusicTrack): string => `${MUSIC_DIR}${track.file}`;

/** Дорожка слоя. У тишины дорожки нет и быть не может — это её смысл. */
export const trackOf = (layer: MusicLayer): MusicTrack | null =>
  MUSIC_TRACKS.find((t) => t.layer === layer) ?? null;

/**
 * Чем сейчас укомплектован бой: тремя слоями или одной цельной дорожкой.
 *
 * Боевой пак, который приехал, стемов не содержит — в нём пять цельных пьес.
 * Слои остаются в коде и ждут своего пака, но **просить у сервера файлы,
 * которых заведомо нет, нельзя**: это три гарантированных 404 на каждый первый
 * бой. Поэтому режим объявлен здесь одной строкой, и приедет пак со стемами —
 * меняется она, а не логика.
 */
export const MUSIC_MODE: 'layers' | 'whole' = 'whole';

/** Идентификатор цельной дорожки. Слоем он не является — он их заменяет. */
export const WHOLE_ID = 'whole';

/** Цельная боевая дорожка. */
export const BATTLE_WHOLE = {
  id: WHOLE_ID,
  file: `battle.${MUSIC_FORMAT}`,
  seconds: 52,
  note:
    'Combat Pack vol.1, «One Last Day on Earth», 110 BPM, петля 52 с. Цельная ' +
    'пьеса: вход, ведение по такту громкостью, обрыв в тишину перед финалом.',
};

/**
 * Громкость цельной дорожки по слоям. Слои остаются мерой такта даже там, где
 * играть их нечем: раскадровка по-прежнему говорит `drums` — `harmony` —
 * `full` — `silence`, а цельная дорожка отвечает на это не сменой материала, а
 * громкостью. Тишина в конце — не затухание дорожки, а обрыв, и делает его
 * проигрыватель.
 */
export const WHOLE_LEVELS: Record<MusicLayer, number> = {
  drums: 0.5,
  harmony: 0.75,
  full: 1,
  silence: 0,
};

export const battleWholeUrl = (): string => `${MUSIC_DIR}${BATTLE_WHOLE.file}`;

/**
 * Мирные дорожки деревни. Играют по кругу в перемешанном порядке, с переливом
 * между соседними; слоёв у них нет и не нужно — это разные пьесы, а не одна в
 * трёх плотностях.
 *
 * `seconds` здесь — справка и заказ (по ней видно, что вес сходится с
 * потолком). Настоящую длину проигрыватель берёт у разобранного файла: файл
 * могли пересобрать, а число в таблице — забыть.
 */
export interface VillageTrack {
  id: string;
  file: string;
  seconds: number;
  note: string;
}

export const VILLAGE_TRACKS: VillageTrack[] = [
  {
    id: 'village-1',
    file: `village-1.${MUSIC_FORMAT}`,
    seconds: 87,
    note: 'Medieval Vol.1, Track 1 — 110 BPM, 4/4, Am, полный микс',
  },
  {
    id: 'village-2',
    file: `village-2.${MUSIC_FORMAT}`,
    seconds: 82,
    note: 'Medieval Vol.1, Track 2 — 140 BPM, 4/4, C, полный микс',
  },
  {
    id: 'village-3',
    file: `village-3.${MUSIC_FORMAT}`,
    seconds: 120,
    note: 'Medieval Vol.1, Track 3 — 120 BPM, 3/4, Am, вальс',
  },
  {
    id: 'village-4',
    file: `village-4.${MUSIC_FORMAT}`,
    seconds: 110,
    note: 'Medieval Vol.1, Track 4 — 70 BPM, 4/4, Am, без вокала',
  },
];

/** Перелив между соседними дорожками деревни. Не встык и не пауза. */
export const VILLAGE_FADE = 3;

/**
 * За сколько секунд до конца дорожки тянуть следующую. Раньше нельзя: правило
 * «грузится ровно одна дорожка за раз» и есть цена вопроса — самый тяжёлый
 * файл 938 КБ, и качать их пачкой значит уронить первые секунды игры.
 * Двенадцати секунд хватает и на медленной сети, а не хватило — дорожка
 * встанет с небольшой паузой, а не сорвёт весь круг.
 */
export const VILLAGE_LEAD = 12;

/** Насколько глушится деревня под роликом о бое, и за сколько. */
export const VILLAGE_DUCK_FADE = 0.8;

export const villageUrl = (track: VillageTrack): string => `${MUSIC_DIR}${track.file}`;

/**
 * Что качать для боя и с какими громкостями это играть — **обе половины режима
 * живут здесь**. Иначе `MUSIC_MODE` разъезжается по модулям: один решает, что
 * скачать, другой — что из скачанного слышно, и первый же новый режим окажется
 * реализован наполовину.
 */
export interface BattleFile {
  id: string;
  url: string;
}

export const battleFiles = (): BattleFile[] =>
  MUSIC_MODE === 'whole'
    ? [{ id: BATTLE_WHOLE.id, url: battleWholeUrl() }]
    : MUSIC_TRACKS.map((track) => ({ id: track.layer, url: trackUrl(track) }));

/** Громкости на такте `layer`. Ключи — те же `id`, что у `battleFiles`. */
export const battleLevels = (layer: MusicLayer): Record<string, number> => {
  if (MUSIC_MODE === 'whole') return { [BATTLE_WHOLE.id]: WHOLE_LEVELS[layer] };
  const out: Record<string, number> = {};
  for (const track of MUSIC_TRACKS) out[track.layer] = track.layer === layer ? 1 : 0;
  return out;
};

/** Где замыкается петля боя. У цельной пьесы петля — она сама. */
export const battleLoop = (): number | null => (MUSIC_MODE === 'whole' ? null : MUSIC_LOOP);
