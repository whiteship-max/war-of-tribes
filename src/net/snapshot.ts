/**
 * Слепок партии для сервера: две непрозрачные строки и короткая опись.
 *
 * Опись (`SaveCard`) собирается здесь, а не на сервере, нарочно. Сервер в
 * сохранение не смотрит вовсе — он хранит и раздаёт, — а показать игроку, какие
 * две партии разошлись, кто-то должен: «день 41, 320 человек, мощь 5 900»
 * читается, «две записи с разными хешами» — нет. Считается опись теми же
 * функциями, что и весь остальной интерфейс: своей формулы мощи или населения
 * здесь нет ни одной.
 */
import type { GameState } from '@/game/types';
import { type CastleClaim, type Counts, type SaveCard, type SaveRecord, type WarSheet, type WatchCard } from '../../netlify/lib/contract';
import { serialize } from '@/game/save';
import { SAVE_VERSION } from '@/game/state';
import {
  armySize,
  bondedTotal,
  buildingOfType,
  currentSite,
  dayOf,
  faithGoldPerDay,
  population,
  productionPerDay,
  recruitRate,
  recruitsQueued,
  storageCap,
  taxIncomePerDay,
  woundedStacks,
} from '@/game/derived';
import { DAY_LENGTH } from '@/game/pace';
import { RESOURCE_IDS } from '@/game/constants';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { MINIGAMES } from '@/game/data/minigames';
import { troopTotal } from '@/game/battle/kinds';
import { hiredAt } from '@/game/sim/army';
import { minigameCap } from '@/game/sim/minigames';
import { adminSeen } from '@/game/sim/admin';
import { gemSeen } from '@/game/sim/gems';
import { deviceNow, leadAt } from './clock';
import { power } from '@/profile/power';
import { cityName, profileName } from '@/profile/identity';
import { readArms } from '@/heraldry/arms';
import { browserStorage } from '@/world/local/state';
import { device } from './session';
import { warSheet } from './war';

export type { CastleClaim, SaveCard, SaveRecord };

export const cardOf = (s: GameState): SaveCard => ({
  name: profileName(s.profile),
  day: dayOf(s.time),
  pop: Math.round(population(s)),
  power: Math.round(power(s)),
  army: armySize(s),
});

/**
 * Версия игры для наблюдения и отчёта об ошибке: ступень сохранения и имя входного куска сборки (в нём хеш — у каждой
 * сборки своё). На dev-сервере куска нет — только ступень.
 */
export function buildId(): string {
  let entry = '';
  try {
    const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '';
    entry = src.split('/').pop() ?? '';
  } catch {
    /* вне браузера документа нет */
  }
  return `сохр. ${SAVE_VERSION}${entry ? ` · ${entry}` : ''}`.slice(0, 64);
}

const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/**
 * Опись наблюдения (docs/admin.md): числа партии для статистики и флагов админа. Считается теми же функциями, что
 * интерфейс; своей формулы здесь нет ни одной. Сервер сравнивает две соседние описи по правилам игры — поэтому рядом с
 * запасами лежат их пределы: выработка, вместимость склада, сколько бойцов казармы выучат за день, потолок промысла.
 */
export function watchOf(s: GameState): WatchCard {
  const stock: Counts = {};
  for (const r of RESOURCE_IDS) stock[r] = whole(s.resources[r]);
  stock.gold = whole(s.gold);
  const made = productionPerDay(s);
  const prod: Counts = {};
  for (const r of RESOURCE_IDS) prod[r] = whole(made[r]);
  // Золото — приток казны: налог и вера. Жалованье его только убавляет.
  prod.gold = whole(taxIncomePerDay(s) + faithGoldPerDay(s));
  const troops: Counts = {};
  for (const t of TROOP_IDS) if (s.army[t]) troops[t] = whole(s.army[t]);
  // Казармы учат пеших, конюшня — конных, каждая своего первого в очереди: за день не больше самого быстрого вида.
  const train = (['barracks', 'stable'] as const).reduce(
    (sum, where) => sum + Math.max(0, ...TROOP_IDS.filter((t) => hiredAt(t) === where).map((t) => (recruitRate(s, t) * DAY_LENGTH) / TROOP_BY_ID[t].work)),
    0,
  );
  const wounded = woundedStacks(s);
  const st = s.stats;
  const seen = adminSeen(s);
  // Дела алмазов (лавка кладёт припас) — тоже разовые дела: рост склада между описями ими объяснён (docs/gems.md).
  const gemmed = gemSeen(s);
  const games = st.games ?? 0;
  const site = currentSite(s);
  return {
    build: buildId(),
    city: cityName(s.profile.city) ?? '',
    clock: deviceNow(),
    time: Math.floor(s.time),
    level: buildingOfType(s, 'town_hall')?.level ?? 0,
    buildings: Object.fromEntries(s.buildings.map((b) => [b.type, whole(b.level)])),
    pop: whole(s.pop),
    stock,
    prod,
    cap: whole(storageCap(s)),
    troops,
    queued: recruitsQueued(s),
    away: troopTotal(s.away ?? {}) + (s.scoutsAway ?? 0),
    caravans: (s.caravans ?? []).length,
    wounded: troopTotal(wounded.lying) + troopTotal(wounded.carried),
    hurt: hurtOf(wounded.lying, wounded.carried),
    // Книга стройки сервера (docs/pvp.md, раздел 7): руки стройки и идущая стройка — её работу сервер подтверждает.
    bonded: whole(bondedTotal(s)),
    ...(site ? { site: { type: site.type, level: site.level + 1, done: Math.max(0, site.work) } } : {}),
    train: Math.ceil(train),
    // Закрытое задание — тоже разовое дело: награда ложится на склад разом (`sim/tick`, шаг «Задания»), и без него
    // честный игрок получал флаг «рост склада» на награде (прогон 25 ботов, docs/playtest_sim.md). Так же — добро без дела
    // (`stats.windfalls`): возврат цены отменённого заказа, дань по договору, кража лазутчика, продажа невольников
    // (docs/security.md, раздел 8).
    deeds:
      st.hunts + st.battlesWon + st.battlesLost + st.eventsResolved + st.scouted + st.raids + st.castles + st.lairs + st.purchases + st.dailyWins + games + seen + gemmed +
      s.completedQuests.length + (st.windfalls ?? 0),
    won: st.battlesWon,
    lost: st.battlesLost,
    lairs: st.lairs,
    raids: st.raids,
    games,
    haul: whole(st.haul ?? 0),
    haulCap: whole(Math.max(0, ...MINIGAMES.map((m) => Object.values(minigameCap(s, m.id)).reduce((t, n) => t + n, 0)))),
    cheated: s.cheated === true,
    lead: whole(leadAt()),
    seen,
    gemSeen: gemmed,
  };
}

/** Раненые по видам одним набором: в лазарете и при полководце (книга войска сервера считает тела, docs/pvp.md). */
function hurtOf(lying: Partial<Record<string, number>>, carried: Partial<Record<string, number>>): Counts {
  const out: Counts = {};
  for (const t of TROOP_IDS) {
    const n = whole((lying[t] ?? 0) + (carried[t] ?? 0));
    if (n > 0) out[t] = n;
  }
  return out;
}

/** Что уедет на сервер. Сохранение мира — та же строка, что лежит на диске. */
export function snapshotOf(s: GameState): SaveRecord {
  return {
    v: 1,
    rev: 0,
    updatedAt: 0,
    device: device(),
    game: serialize(s),
    world: browserStorage.read(),
    card: cardOf(s),
    watch: watchOf(s),
    // Слепок обороны для войны между игроками: его читает сервер, когда на город приходит войско (docs/pvp.md).
    ...((): { war?: WarSheet } => {
      const war = warSheet();
      return war ? { war } : {};
    })(),
  };
}

/**
 * Что игрок сообщает о себе общему реестру замков. Три числа из той же описи:
 * своей формулы мощи или населения здесь нет ни одной, и заводить её нельзя —
 * иначе соседи видели бы одну мощь, а профиль показывал другую.
 *
 * Координат тут нет и быть не может: где стоит замок, решает сервер.
 */
export function claimOf(s: GameState): CastleClaim {
  const card = cardOf(s);
  // Имя города едет очищенным, а не названное — пустой строкой: «Безымянный город» соседи
  // подставят сами тем же умолчанием, и в реестре не лягут тысячи одинаковых имён. Герб — так же: только собранный
  // игроком и прошедший набор (`readArms`, та же проверка, что у сервера); не собирал — поля нет, соседи покажут башню.
  const arms = readArms(s.profile.arms) ? (s.profile.arms as string) : null;
  return { name: card.name, city: cityName(s.profile.city) ?? '', ...(arms ? { arms } : {}), power: card.power, pop: card.pop };
}
