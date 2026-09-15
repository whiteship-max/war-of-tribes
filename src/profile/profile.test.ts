import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVATARS } from '@/data/avatars';
import { createInitialState, SAVE_VERSION } from '@/game/state';
import { MIN_SAVE_VERSION, deserialize, serialize } from '@/game/save';
import { tick } from '@/game/sim/tick';
import { startUpgrade } from '@/game/sim/actions';
import { applyExpedition } from '@/game/sim/expedition';
import { buildingOfType } from '@/game/derived';
import { DAY_LENGTH } from '@/game/constants';
import { DEFAULT_AVATAR, DEFAULT_NAME, faceSrc, profileName } from './identity';
import {
  PROFILE_DAYS,
  recordBattle,
  recordProduced,
  recordRaidLoss,
  refreshCard,
  setAvatar,
  setName,
  setTelegramIdentity,
} from './stats';
import { power } from './power';

/**
 * Сохранение восьмой версии, записанное до профиля. Оно зафиксировано строкой
 * нарочно: собери его из `createInitialState()` — и оно поедет вслед за
 * состоянием, а проверять надо ровно то, что лежит у игрока на диске сегодня.
 */
const SAVE_V8 = `{
  "version": 8,
  "time": 12345.5,
  "resources": { "wood": 1200, "stone": 640, "food": 1580, "hides": 210, "bones": 96, "copper": 240, "iron": 175 },
  "equipment": { "spear": 7, "bow": 3, "axe": 0, "shield": 2, "sword": 1, "armor": 0 },
  "army": { "clubman": 4, "spearman": 12, "archer": 6, "axeman": 0, "swordsman": 2, "shieldman": 0, "rider": 0, "legionary": 3 },
  "recruits": [],
  "forging": "spear",
  "forgeWork": 12,
  "decree": "none",
  "ration": "normal",
  "tax": "low",
  "gold": 415,
  "gems": 25,
  "market": { "day": 205, "bought": { "food": 20 } },
  "caravans": [],
  "daily": { "day": 20330, "result": "won" },
  "pop": 120,
  "workers": { "5": 20, "6": 4 },
  "freeJobs": { "gatherer": 6 },
  "buildings": [
    { "id": 1, "type": "campfire", "level": 1, "work": 0, "workRequired": 0 },
    { "id": 2, "type": "town_hall", "level": 4, "work": 0, "workRequired": 0 },
    { "id": 3, "type": "houses", "level": 5, "work": 0, "workRequired": 0 },
    { "id": 4, "type": "storage", "level": 3, "work": 0, "workRequired": 0 },
    { "id": 5, "type": "farm", "level": 3, "work": 0, "workRequired": 0 },
    { "id": 6, "type": "smithy", "level": 2, "work": 0, "workRequired": 0 },
    { "id": 7, "type": "barracks", "level": 2, "work": 0, "workRequired": 0 }
  ],
  "completedQuests": ["first_hunt", "first_scout"],
  "activeEvent": null,
  "nextEventAt": 12400,
  "morale": 63.5,
  "prestige": 11,
  "patron": "wolf",
  "hero": { "name": "Радим Хмурый", "kind": "infantry", "downUntil": 0, "marchId": null },
  "starvation": 0,
  "freezing": 0,
  "winterWarnedYear": 10,
  "winterWarning": false,
  "growth": 0.4,
  "popDay": 119,
  "warriorsAway": 0,
  "scoutsAway": 0,
  "defenseFormation": null,
  "battlePlans": [],
  "battleWatch": true,
  "feastUntil": 0,
  "feastAt": 11000,
  "tutorialStep": 0,
  "tutorialDone": true,
  "log": [{ "at": 12000, "text": "Пришла зима. Пора считать запасы.", "kind": "bad" }],
  "stats": { "hunts": 9, "battlesWon": 3, "battlesLost": 1, "born": 140, "died": 50, "eventsResolved": 12, "scouted": 4, "raids": 2, "castles": 1, "purchases": 6, "dailyWins": 3 },
  "nextId": 8,
  "lastSaved": 1757000000000
}`;

describe('сейв профиля', () => {
  it('версия поднята над той, что отбрасывала старые сохранения', () => {
    expect(SAVE_VERSION).toBeGreaterThan(8);
    expect(MIN_SAVE_VERSION).toBe(8);
    // Всё, что старше восьмёрки, отбрасывается по-прежнему: там приводить нечего.
    for (const old of [5, 6, 7]) {
      const raw = JSON.parse(SAVE_V8) as Record<string, unknown>;
      raw.version = old;
      expect(deserialize(JSON.stringify(raw)), `версия ${old}`).toBeNull();
    }
    // И сохранение из будущего тоже: полей, которых мы не знаем, читать нечем.
    const ahead = JSON.parse(SAVE_V8) as Record<string, unknown>;
    ahead.version = SAVE_VERSION + 1;
    expect(deserialize(JSON.stringify(ahead))).toBeNull();
  });

  it('старый сейв открывается без потери прогресса', () => {
    const s = deserialize(SAVE_V8);
    expect(s).not.toBeNull();
    const g = s!;
    expect(g.version).toBe(SAVE_VERSION);

    // Посёлок, хозяйство и дружина — всё на месте.
    expect(g.pop).toBe(120);
    expect(g.gold).toBe(415);
    expect(g.resources.food).toBe(1580);
    expect(g.army.spearman).toBe(12);
    expect(g.army.legionary).toBe(3);
    expect(g.equipment.spear).toBe(7);
    expect(buildingOfType(g, 'town_hall')!.level).toBe(4);
    expect(buildingOfType(g, 'houses')!.level).toBe(5);
    expect(g.workers[5]).toBe(20);
    expect(g.freeJobs.gatherer).toBe(6);
    expect(g.completedQuests).toEqual(['first_hunt', 'first_scout']);
    expect(g.stats.battlesWon).toBe(3);
    // Имя героя перешло полководцу — это один человек (ступень 12 → 13).
    expect(g.agents.general.name).toBe('Радим Хмурый');
    expect('name' in g.hero).toBe(false);
    expect(g.tutorialDone).toBe(true);
    // Покровитель (`"patron": "wolf"` в сейве) с двенадцатой версии не
    // существует: ступень 11 → 12 его отпускает, чтобы он не ездил в сохранении
    // мёртвым полем, и говорит об этом в летописи.
    expect((g as unknown as { patron?: unknown }).patron).toBeUndefined();
    expect(g.log.some((l) => l.text.includes('Покровитель племени отпущен'))).toBe(true);
    // Вера при этом не подставлена: её назовёт мир по клетке замка.
    expect(g.faith.id).toBeNull();
    expect(g.faith.observance).toBe('even');
    // Здания, появившиеся после того, как сохранение записали, приезжают сами.
    expect(buildingOfType(g, 'market')!.level).toBe(1);
  });

  it('у старого сейва статистика с нуля, мощь посчитана, аватар по умолчанию', () => {
    const g = deserialize(SAVE_V8)!;
    const p = g.profile;

    expect(p.totals.produced).toBe(0);
    expect(p.totals.spent).toBe(0);
    expect(p.totals.troopsLost).toBe(0);
    expect(Object.values(p.totals.raidLoss).every((n) => n === 0)).toBe(true);

    // Мощь не обнуляется: она выводится из посёлка и дружины, а они в сейве есть.
    expect(p.card.power).toBe(power(g));
    expect(p.card.power).toBeGreaterThan(0);
    // Счёт битв у партии был — он и остаётся: считает его по-прежнему `s.stats`.
    expect(p.card.battlesWon).toBe(3);
    expect(p.card.battlesLost).toBe(1);

    expect(p.avatarId).toBeNull();
    expect(p.card.avatarId).toBe(DEFAULT_AVATAR);
    expect(p.card.name).toBe(DEFAULT_NAME);

    // Приведение не проходит молча: о нём сказано в летописи.
    expect(g.log.some((e) => /грамота вождя/i.test(e.text))).toBe(true);
    // Старая запись при этом не потерялась.
    expect(g.log.some((e) => /Пришла зима/.test(e.text))).toBe(true);
  });

  it('сейв текущей версии читается как есть, без записи о приведении', () => {
    const s = createInitialState();
    setName(s, 'Ольга');
    setAvatar(s, '13_queen');
    recordProduced(s, 250);
    recordBattle(s, 'won');
    const back = deserialize(serialize(s))!;

    expect(back.profile.name).toBe('Ольга');
    expect(back.profile.avatarId).toBe('13_queen');
    expect(back.profile.totals.produced).toBe(250);
    expect(back.profile.card.battlesWon).toBe(1);
    expect(back.log.some((e) => /грамота вождя/i.test(e.text))).toBe(false);
  });
});

describe('сбор статистики', () => {
  it('производство копится тиком, и только то, что легло на склад', () => {
    const s = createInitialState();
    tick(s, 10);
    const first = s.profile.totals.produced;
    expect(first).toBeGreaterThan(0);
    tick(s, 10);
    expect(s.profile.totals.produced).toBeGreaterThan(first);

    // Полный склад ничего не добавил — и в итогах этого нет.
    const s2 = createInitialState();
    for (const r of Object.keys(s2.resources) as (keyof typeof s2.resources)[]) s2.resources[r] = 1e9;
    tick(s2, 10);
    expect(s2.profile.totals.produced).toBe(0);
  });

  it('трата на стройку записывается там, где платят, а не в интерфейсе', () => {
    const s = createInitialState();
    const houses = buildingOfType(s, 'houses')!;
    expect(startUpgrade(s, houses.id)).toBeNull();
    expect(s.profile.totals.spent).toBeGreaterThan(0);
  });

  it('набег списывается по ресурсам, поход — итогом и золотом', () => {
    const s = createInitialState();
    s.army.spearman = 10;
    applyExpedition(s, {
      warriorsLost: 3,
      scoutsLost: 0,
      resources: { food: -40, wood: -25 },
      gold: 0,
      prestige: 0,
      morale: 0,
      battle: 'lost',
      text: 'Отряд не дошёл.',
      kind: 'bad',
    });
    expect(s.profile.totals.raidLoss.food).toBe(40);
    expect(s.profile.totals.raidLoss.wood).toBe(25);
    expect(s.profile.totals.raids).toBe(1);
    expect(s.profile.totals.troopsLost).toBe(3);
    expect(s.profile.card.battlesLost).toBe(1);

    applyExpedition(s, {
      warriorsLost: 0,
      scoutsLost: 0,
      resources: { food: 60, iron: 15 },
      gold: 120,
      prestige: 1,
      morale: 1,
      battle: 'won',
      text: 'Замок взят.',
      kind: 'good',
    });
    expect(s.profile.totals.lootResources).toBe(75);
    expect(s.profile.totals.lootGold).toBe(120);
    expect(s.profile.card.battlesWon).toBe(1);
    // Обратно ничего не утекло: добыча не уменьшает потери.
    expect(s.profile.totals.raidLoss.food).toBe(40);
  });

  it('суточные корзины кольцевые: старше месяца выпадают', () => {
    const s = createInitialState();
    for (let day = 0; day < PROFILE_DAYS + 12; day++) {
      s.time = day * DAY_LENGTH;
      recordProduced(s, 10);
      refreshCard(s);
    }
    const days = s.profile.days;
    expect(days.length).toBeLessThanOrEqual(PROFILE_DAYS);
    const newest = days[days.length - 1].day;
    expect(newest - days[0].day).toBeLessThan(PROFILE_DAYS);
    // Мощь в корзине — не ноль: её кладёт та же дверь, что и остальное.
    expect(days[days.length - 1].power).toBe(power(s));
    // Итог за партию корзинами не режется: он накопительный.
    expect(s.profile.totals.produced).toBe((PROFILE_DAYS + 12) * 10);
  });

  it('одна корзина на игровой день, а не на вызов', () => {
    const s = createInitialState();
    recordProduced(s, 5);
    recordRaidLoss(s, { stone: 7 });
    recordProduced(s, 5);
    expect(s.profile.days).toHaveLength(1);
    expect(s.profile.days[0].produced).toBe(10);
    expect(s.profile.days[0].raidLoss).toBe(7);
  });
});

describe('имя и лицо', () => {
  it('порядок источников: свой выбор, потом Telegram, потом умолчание', () => {
    const s = createInitialState();
    expect(profileName(s.profile)).toBe(DEFAULT_NAME);
    expect(faceSrc(s.profile)).toBe(AVATARS.find((a) => a.id === DEFAULT_AVATAR)!.face);

    setTelegramIdentity(s, 'Мария', 'https://t.me/i/userpic/320/x.jpg');
    expect(profileName(s.profile)).toBe('Мария');
    expect(faceSrc(s.profile)).toBe('https://t.me/i/userpic/320/x.jpg');

    // Переопределение приоритетнее Telegram — и имя, и лицо.
    expect(setName(s, '  Ярослава  ')).toBeNull();
    expect(setAvatar(s, '18_duchess')).toBeNull();
    expect(profileName(s.profile)).toBe('Ярослава');
    expect(faceSrc(s.profile)).toBe(AVATARS.find((a) => a.id === '18_duchess')!.face);

    // Отказ от своего имени возвращает телеграмное, а не пустую строку.
    setName(s, '   ');
    expect(s.profile.name).toBeNull();
    expect(profileName(s.profile)).toBe('Мария');
  });

  it('визитка пересобирается сразу, а не к следующему игровому дню', () => {
    // Именно её увидят чужие глаза на карте мира. Дожидаться смены суток нельзя:
    // игрок переименовался, вышел — и остался под старым именем.
    const s = createInitialState();
    setName(s, 'Всеволод');
    expect(s.profile.card.name).toBe('Всеволод');
    setAvatar(s, '17_duke');
    expect(s.profile.card.avatarId).toBe('17_duke');
    setTelegramIdentity(s, 'Пётр', null);
    expect(s.profile.card.name).toBe('Всеволод');
    setName(s, '');
    expect(s.profile.card.name).toBe('Пётр');
  });

  it('экран выбора строится из набора, а не из прописанных карточек', () => {
    // Двадцать четыре карточки руками — это двадцать четыре места, которые
    // разъедутся с набором при первой же перегенерации листов.
    const src = readFileSync(join(__dirname, '..', 'ui', 'parts', 'AvatarPicker.tsx'), 'utf8');
    const named = AVATARS.filter((a) => src.includes(a.id)).map((a) => a.id);
    expect(named).toEqual([]);
    expect(src).toMatch(/AVATARS\.map/);
  });

  it('несуществующий аватар не принимается, а умолчание есть в наборе', () => {
    const s = createInitialState();
    expect(setAvatar(s, '99_nobody' as (typeof AVATARS)[number]['id'])).not.toBeNull();
    expect(s.profile.avatarId).toBeNull();
    expect(AVATARS.some((a) => a.id === DEFAULT_AVATAR)).toBe(true);
  });
});
