// Заглушки Пути меча (ПН-3, docs/gdd/path_of_sword.md, «Как читать числа» и «Решения ПН-3»): числа, которые ходу и лагерю нужны
// сейчас, а вывести их ещё нечем — нет ни встреч с НПС (ПН-5), ни заметности (ПН-4у), ни происхождений (ПН-17), на которых их
// мерить. Ориентир ГДД в код без вывода не идёт; это — единственное исключение, и у него три замка:
//   1. **за выключателем**: заглушку читают только двери пути (отряд, руины, место выхода), а они живут за `roamOn` и на
//      клиенте, и на сервере — у лорда ни одна заглушка не читается (держит тест-отпечаток и сторож чтений `watchStubs`);
//   2. **заглушка прибора**: каждая лежит входом-заглушкой `roam:report` с тем же числом (входы прибора, `fromGame`),
//      и раздел, который её прочёл, печатается «НЕ ИЗМЕРЕНО» — выдать её за выведенное нельзя (тест прибора и сторож чтений);
//   3. **строка в реестре ориентиров ГДД** (реестр прибора, `ORIENTS`): какой раздел ГДД, какая пачка выведет.
// Число правится здесь — и только здесь: прибор берёт его отсюда, второго числа нет.
//
// Без `@/`: модуль собирает и сервер (место выхода и руины считает реестр).

/** Заглушка: число, у которого ещё нет вывода (ПН-5: и строка чисел — по ступеням, по видам). */
export interface RoamStub {
  value: number | readonly number[] | Readonly<Record<string, number>>;
  /** Раздел ГДД, откуда число. */
  gdd: string;
  /** Что это — словами, для легенды прибора и шапки раздела. */
  what: string;
  /** Пачка, которая выведет число (ГДД 7.1). */
  batch: string;
  /** `true` — число — ориентир ГДД; `false` — в ГДД его нет вовсе («+», «до N»), число прибора. */
  orient: boolean;
}

export const ROAM_STUBS = {
  spawnGap: {
    value: 25,
    gdd: '3.5.6',
    what: 'место выхода бродяги — не ближе N клеток к замкам игроков и к другим новичкам',
    batch: 'ПН-17',
    orient: true,
  },
  forageHidden: {
    value: 0.5,
    gdd: '3.5.3',
    what: 'фураж скрытого лагеря — доля полного (открытого)',
    batch: 'ПН-5',
    orient: true,
  },
  forageRuin: {
    value: 0.8,
    gdd: '3.5.3',
    what: 'фураж лагеря в руинах — доля полного (открытого)',
    batch: 'ПН-5',
    orient: true,
  },
  campMorale: {
    value: 5,
    gdd: '3.5.3',
    what: 'дух открытого лагеря (костры, шатры) — очков морали',
    batch: 'ПН-5',
    orient: false,
  },
  coldCamp: {
    value: 5,
    gdd: '3.3.3',
    what: '«холодный лагерь»: скрытый лагерь без огня в самую лютую стужу — очков морали минус (доля — дрова под открытым небом сезона)',
    batch: 'ПН-5',
    orient: false,
  },
  healOpen: {
    value: 1.5,
    gdd: '3.5.3',
    what: 'раненые в открытом лагере встают быстрее — во сколько раз',
    batch: 'ПН-5',
    orient: false,
  },
  tracker: {
    value: 1.5,
    gdd: '3.2.2',
    what: 'следопыт в отряде — радиус обнаружения отряда больше во столько раз (соратников до ПН-9 нет — не читается)',
    batch: 'ПН-9',
    orient: true,
  },
  // ---------- ПН-5: точки мира и встречи с НПС (ГДД 3.5.1, 3.6) ----------
  stages: {
    value: [0, 50, 150, 400, 1000] as readonly number[],
    gdd: '3.9.1',
    what: 'пороги ступеней престижа: 0, 50, 150, 400, 1000 (ступень по ним — дверь ПН-2 `prestigeStage`; первый читатель в игре — сила НПС)',
    batch: 'ПН-10',
    orient: true,
  },
  foeTable: {
    value: [12, 79, 79, 243, 682] as readonly number[],
    gdd: '3.6.2',
    what: 'сила НПС по ступеням престижа, мощи — что напечатал раздел «Сила НПС — неподвижная точка» (на заглушках автопилота)',
    batch: 'ПН-17',
    orient: false,
  },
  foeShare: {
    value: { lair: 1, band: 0.7, militia: 0.5 } as Readonly<Record<'lair' | 'band' | 'militia', number>>,
    gdd: '3.6.2',
    what: 'доля вида цели в силе противника: логово 1, ватага 0.7, ополчение села 0.5',
    batch: 'ПН-17',
    orient: false,
  },
  foeRipe: {
    value: [0.6, 1] as readonly number[],
    gdd: '3.6.2',
    what: 'спелость противника — от и до, доля силы ступени (у точки — своим хешем)',
    batch: 'ПН-17',
    orient: false,
  },
  prestigeS: {
    value: 4,
    gdd: '3.8.3',
    what: 'делитель мощи в престиже: победа даёт мощь противника / S (договор — ещё тир × 10, ПН-7)',
    batch: 'ПН-17',
    orient: false,
  },
  defeatPurse: {
    value: 0.5,
    gdd: '3.6.4',
    what: 'отряд перебит — доля кошеля победителю',
    batch: 'ПН-13',
    orient: true,
  },
  defeatPrestige: {
    value: 0.1,
    gdd: '3.9',
    what: 'проигранный бой — доля престижа минус',
    batch: 'ПН-17',
    orient: false,
  },
  heirPrestige: {
    value: 0.25,
    gdd: '3.6.5',
    what: 'наследник пути получает долю престижа погибшего героя',
    batch: 'ПН-9',
    orient: true,
  },
  heroFall: {
    value: 0.25,
    gdd: '3.6.4',
    what: 'отряд перебит — доля боёв, где герой гибнет (иначе ранен)',
    batch: 'ПН-9',
    orient: false,
  },
  bandWound: {
    value: 0.25,
    gdd: '3.3.1',
    what: 'раненые без лазарета — доля павших боя отряда (лежат при отряде)',
    batch: 'ПН-9',
    orient: false,
  },
  ambushBase: {
    value: 0.04,
    gdd: '3.6.3',
    what: 'засада НПС — шанс на 10 клеток дороги при заметности 1 (колонна по полю — видна ватагам так же, как кругу замка)',
    batch: 'ПН-17',
    orient: false,
  },
  ambushCap: {
    value: 0.6,
    gdd: '3.6.3',
    what: 'засада НПС — шанс не выше этого на одну дорогу',
    batch: 'ПН-17',
    orient: false,
  },
  townBlock: {
    value: 28,
    gdd: '3.5.1',
    what: 'густота вольных городов НПС: один на квадрат N × N клеток (общие, постоянной солью)',
    batch: 'ПН-17',
    orient: false,
  },
  townTier: {
    value: [0.55, 0.3, 0.15] as readonly number[],
    gdd: '3.5.1',
    what: 'ступени вольных городов I, II, III — доли',
    batch: 'ПН-17',
    orient: false,
  },
  villageBlock: {
    value: 16,
    gdd: '3.5.1',
    what: 'густота сёл: одно на квадрат N × N клеток (свои, сидом мира)',
    batch: 'ПН-17',
    orient: false,
  },
  vatagaBlock: {
    value: 20,
    gdd: '3.5.1',
    what: 'густота ватаг НПС: одна на квадрат N × N клеток (свои, сидом мира)',
    batch: 'ПН-17',
    orient: false,
  },
  // ---------- ПН-6: люди и город (ГДД 3.4, 3.7.1, 3.7.7, 4.2) ----------
  askBase: {
    value: { lo0: 2, hi0: 4, lo4: 12, hi4: 20 } as Readonly<Record<'lo0' | 'hi0' | 'lo4' | 'hi4', number>>,
    gdd: '3.4.1',
    what: '«Просятся в отряд» — сколько приходит: ступень 0 — 2…4, ступень 4 — 12…20, между ними — прямой',
    batch: 'ПН-17',
    orient: true,
  },
  askCamp: {
    value: { open: 1.5, hidden: 0.5, ruin: 0.8, none: 1 } as Readonly<Record<'open' | 'hidden' | 'ruin' | 'none', number>>,
    gdd: '3.4.1',
    what: '«Просятся в отряд» — множитель лагеря: открытый ×1.5 (костры видно), скрытый ×0.5, руины ×0.8, без лагеря ×1',
    batch: 'ПН-17',
    orient: true,
  },
  askWinter: {
    value: 0.6,
    gdd: '3.4.1',
    what: '«Просятся в отряд» — зимой ×0.6',
    batch: 'ПН-17',
    orient: true,
  },
  askSpirit: {
    value: { below: 40, mult: 0.5 } as Readonly<Record<'below' | 'mult', number>>,
    gdd: '3.4.1',
    what: '«Просятся в отряд» — мораль ниже 40 — ×0.5',
    batch: 'ПН-17',
    orient: true,
  },
  askFeed: {
    value: 2,
    gdd: '3.4.1',
    what: '«Взять, сколько прокормим» — хлеба в обозе на столько игр. дн. всему отряду с новыми',
    batch: 'ПН-17',
    orient: false,
  },
  captiveShare: {
    value: 0.2,
    gdd: '3.4.5',
    what: 'пленные после выигранного боя — доля уцелевших врагов, которых можно принять дубинщиками',
    batch: 'ПН-17',
    orient: false,
  },
  boardFee: {
    value: 0.2,
    gdd: '4.2',
    what: 'постой в вольном городе — золота за голову и игр. день',
    batch: 'ПН-17',
    orient: true,
  },
  townMarket: {
    value: [3, 6, 9] as readonly number[],
    gdd: '3.7.1',
    what: 'уровень рынка вольного города по ступени I, II, III (глубина, запас и кошель привоза — правила рынка лорда)',
    batch: 'ПН-17',
    orient: false,
  },
  townYard: {
    value: [2, 4, 6] as readonly number[],
    gdd: '3.7.7',
    what: 'уровень дворов вольного города по ступени I, II, III — от него добыча промысла на заработках',
    batch: 'ПН-17',
    orient: false,
  },
  // ---------- ПН-7: договоры НПС (ГДД 3.8) ----------
  boardSize: {
    value: 5,
    gdd: '3.8.1',
    what: 'договоров на доске вольного города за привоз (3 ч)',
    batch: 'ПН-17',
    orient: false,
  },
  dealReach: {
    value: { target: 25, threat: 8 } as Readonly<Record<'target' | 'threat', number>>,
    gdd: '3.8.2',
    what: 'договоры: цель — не дальше N клеток от заказчика; угроза селу — живая ватага не дальше M клеток',
    batch: 'ПН-17',
    orient: false,
  },
  dealRoads: {
    value: { lair: 2, vataga: 1, defend: 0, cargo: 1.5, head: 1, garrison: 0, scout: 2 } as Readonly<Record<
      'lair' | 'vataga' | 'defend' | 'cargo' | 'head' | 'garrison' | 'scout',
      number
    >>,
    gdd: '3.8.2',
    what: 'срок договора — столько дорог от заказчика к цели: логово ×2, ватага ×1, груз ×1.5, голова ×1, разведка ×2',
    batch: 'ПН-17',
    orient: true,
  },
  dealDays: {
    value: { lair: 4, vataga: 6, defend: 0, cargo: 0, head: 10, garrison: 0, scout: 0 } as Readonly<Record<
      'lair' | 'vataga' | 'defend' | 'cargo' | 'head' | 'garrison' | 'scout',
      number
    >>,
    gdd: '3.8.2',
    what: 'срок договора — игр. дн. сверх дороги: логово +4, ватага +6, голова +10',
    batch: 'ПН-17',
    orient: true,
  },
  dealStand: {
    value: { defendLo: 6, defendHi: 12, garrisonLo: 12, garrisonHi: 24 } as Readonly<Record<'defendLo' | 'defendHi' | 'garrisonLo' | 'garrisonHi', number>>,
    gdd: '3.8.2',
    what: 'стоянка договора: набег на село — через 6…12 игр. дн., гарнизонная служба — 12…24 игр. дн.',
    batch: 'ПН-17',
    orient: true,
  },
  dealCargo: {
    value: 0.5,
    gdd: '3.8.2',
    what: '«Доставить груз» — груз занимает эту долю обоза эталона тира',
    batch: 'ПН-17',
    orient: false,
  },
  // ---------- ПН-10: вольные замки (3.11, 6.4) ----------
  castleLevel: {
    value: [2, 4, 6] as readonly number[],
    gdd: '3.11.1',
    what: 'гарнизон вольного замка I, II, III — строка таблицы у ворот (`GATE_POWER.raiders`) этого уровня, строй замка (`castle`)',
    batch: 'ПН-10',
    orient: true,
  },
  castlePrestige: {
    value: [150, 400, 1000] as readonly number[],
    gdd: '3.11.1',
    what: 'доступ к вольному замку I, II, III — престиж не ниже',
    batch: 'ПН-10',
    orient: true,
  },
  castlePop: {
    value: [30, 45, 70] as readonly number[],
    gdd: '3.11.1',
    what: 'жители вольного замка I, II, III (хлеб осады — кладовая НПС `townLarder`, добыча участи)',
    batch: 'ПН-11',
    orient: true,
  },
  castleWall: {
    value: [2, 3, 5] as readonly number[],
    gdd: '3.11.1',
    what: 'частокол вольного замка I, II, III (стена осады и обстрела)',
    batch: 'ПН-11',
    orient: true,
  },
  castleTower: {
    value: [2, 3, 4] as readonly number[],
    gdd: '3.11.1',
    what: 'башня вольного замка I, II, III',
    batch: 'ПН-11',
    orient: true,
  },
  castleHall: {
    value: [1, 2, 3] as readonly number[],
    gdd: '3.11.1',
    what: 'Ратуша вольного замка I, II, III (прочие постройки — 1-го уровня)',
    batch: 'ПН-11',
    orient: true,
  },
  castleShare: {
    value: [0.5, 0.3, 0.2] as readonly number[],
    gdd: '6.4',
    what: 'ступени вольных замков пула I, II, III — доли',
    batch: 'ПН-17',
    orient: false,
  },
  castlePool: {
    value: { base: 4, share: 0.5 },
    gdd: '6.4',
    what: 'пул вольных замков: max(базовый, ceil(бродяг × доля))',
    batch: 'ПН-17',
    orient: true,
  },
} as const satisfies Record<string, RoamStub>;

export type RoamStubId = keyof typeof ROAM_STUBS;

/** Все заглушки по имени — функцией, а не списком при загрузке модуля: вычисление на верхнем уровне сборщик не выбросил бы. */
export const roamStubIds = (): RoamStubId[] => Object.keys(ROAM_STUBS) as RoamStubId[];

/** Кто слушает чтения заглушек: прибор (раздел, не объявивший заглушку, — исключение) и тест «у лорда не читается ни одна». */
let watcher: ((id: RoamStubId) => void) | null = null;

/** Слушать чтения заглушек; `null` — перестать. */
export function watchStubs(fn: ((id: RoamStubId) => void) | null): void {
  watcher = fn;
}

/** Значение заглушки — единственная дверь чтения: сторож слышит каждое. */
export function roamStub<K extends RoamStubId>(id: K): (typeof ROAM_STUBS)[K]['value'] {
  watcher?.(id);
  return ROAM_STUBS[id].value;
}
