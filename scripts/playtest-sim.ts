// Прогон 25 ботов-игроков перед тестом с людьми (docs/playtest_sim.md): сервер — настоящие обработчики
// (`netlify/lib/routes/`) на настоящем SQLite в памяти процесса, у каждого бота — настоящая партия (`createInitialState`,
// решения и шаг автопилота) и настоящий мир игры (`LocalWorld` с дверями войны и лазутчика к серверу). Время сжато
// подменой часов: `Date.now` процесса и `now` обработчиков идут шагом прогона, а не настоящим временем.
//
// Все 25 ходят разом (`Promise.all`): вход на остров, записи партии, заказы лавки, походы и бои в одну минуту. Прогон
// печатает сводку и падает (код 1), если нашлось опасное: ответ сервера 5xx или исключение, алмазы из ничего, бой,
// принятый партией дважды, флаг у честного бота.
//
//   npm run playtest:sim            — прогон по умолчанию (25 ботов, 40 минут боевого времени)
//   BOTS=10 MINUTES=20 npm run playtest:sim
//
// Не отчёт приёмки (правило 9): ничего не меряет для сверки, а проверяет; гоняется перед тестом с людьми.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { budgetCores } from './lib/budget';
import { away, build, memory, played, pulseOf, staff } from './autopilot';
import { openDb, sqliteStores } from '../netlify/vps/sqlite';
import { ROUTES } from '../netlify/lib/routes/index';
import { botWith } from '../netlify/lib/routes/bot';
import { STORES, type Stores } from '../netlify/lib/kv';
import { readWatchRecord } from '../netlify/lib/watch';
import type { Telegram } from '../netlify/lib/telegram';
import type {
  CastleView,
  GemsResponse,
  PullResponse,
  RosterResponse,
  SaveRecord,
  SpyMenu,
  SpyView,
  WarOrder,
  WarResponse,
  WarView,
} from '../netlify/lib/contract';
import { createInitialState } from '../src/game/state';
import type { GameState } from '../src/game/types';
import { serialize } from '../src/game/save';
import { applyGrants, adminSeen } from '../src/game/sim/admin';
import { applyGemDeeds } from '../src/game/sim/gems';
import { gameSeconds } from '../src/game/pace';
import { cardOf, claimOf, watchOf } from '../src/net/snapshot';
import { HOME_ID, LocalWorld } from '../src/world/local/LocalWorld';
import type { FigureView, MarchView, PlayerCastle } from '../src/world/types';
import { SICILY, sicilySlot } from '../src/world/spawn';

void budgetCores; // прогон однопоточный: процесс один, работников нет (бюджет железа, CLAUDE.md)

const BOTS = Math.max(2, Math.min(SICILY.length, Number(process.env.BOTS) || SICILY.length));
const MINUTES = Math.max(10, Number(process.env.MINUTES) || 40);
const TOKEN = '123456:AA-playtest-token';
const SECRET = 'playtest-secret';
const ADMIN = 777;
const T0 = 1_900_000_000_000;
const MIN = 60_000;

process.env.TELEGRAM_BOT_TOKEN = TOKEN;
process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
process.env.ADMIN_IDS = String(ADMIN);
process.env.TRIBE_SPAWN = 'sicily';
process.env.TRIBE_WAR_PACE = '60';

// ---------- Часы: одна подмена на процесс ----------
let now = T0;
Date.now = () => now;

// ---------- Сервер ----------
const dir = mkdtempSync(join(tmpdir(), 'tribe-playtest-'));
const dbFile = join(dir, 'tribe.sqlite');
const db = openDb(dbFile);
const stores: Stores = sqliteStores(db, () => now);

const said: { chat: number; text: string }[] = [];
const files: { chat: number; name: string; content: string }[] = [];
const tg: Telegram = {
  send: async () => 'ok',
  answer: async () => 'ok',
  button: async () => 'ok',
  async say(chat, text) {
    said.push({ chat, text });
    return 'ok';
  },
  async file(chat, name, content) {
    files.push({ chat, name, content });
    return 'ok';
  },
  async greet() {
    return 'ok';
  },
};
const botRoute = botWith(() => tg);

// ---------- Учёт ----------
const problems: string[] = [];
const lat = new Map<string, number[]>();
const statuses = new Map<string, number>();
const problem = (text: string): void => {
  if (problems.length < 200) problems.push(text);
};

function signInit(id: number, at: number): string {
  const fields: Record<string, string> = { auth_date: String(Math.floor(at / 1000) - 60), user: JSON.stringify({ id }) };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

async function call(path: string, user: number, era: number, method: string, body?: unknown, query = ''): Promise<{ status: number; data: any }> {
  const route = ROUTES[path];
  const req = new Request(`https://tribe.test${path}${query}`, {
    method,
    headers: {
      'x-telegram-init-data': signInit(user, now),
      'x-tribe-era': String(era),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const t0 = performance.now();
  let status = 0;
  let data: any = null;
  try {
    const res = await route(req, { stores, now, ip: null });
    status = res.status;
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    problem(`исключение ${method} ${path} (${user}): ${(e as Error).message}`);
  }
  const ms = performance.now() - t0;
  const k = `${method} ${path}`;
  (lat.get(k) ?? lat.set(k, []).get(k)!).push(ms);
  statuses.set(`${k} ${status}`, (statuses.get(`${k} ${status}`) ?? 0) + 1);
  if (status >= 500) problem(`${status} ${method} ${path} (${user}): ${JSON.stringify(data).slice(0, 160)}`);
  return { status, data };
}

async function admin(text: string): Promise<string> {
  const before = said.length;
  const req = new Request('https://tribe.test/api/bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({ update_id: 1, message: { message_id: 9, from: { id: ADMIN }, chat: { id: ADMIN, type: 'private' }, text } }),
  });
  const t0 = performance.now();
  try {
    const res = await botRoute(req, { stores, now, ip: null });
    if (res.status >= 500) problem(`${res.status} бот: ${text}`);
  } catch (e) {
    problem(`исключение бота «${text}»: ${(e as Error).message}`);
  }
  (lat.get('POST /api/bot') ?? lat.set('POST /api/bot', []).get('POST /api/bot')!).push(performance.now() - t0);
  return said.slice(before).map((s) => s.text).join('\n');
}

// ---------- Бот ----------
class Bot {
  readonly id: number;
  readonly key: string;
  era = 0;
  g: GameState;
  world: LocalWorld | null = null;
  etag: string | null = null;
  rev = 0;
  castles: PlayerCastle[] = [];
  wars: WarView[] = [];
  spies: SpyView[] = [];
  balance: number | null = null;
  last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
  slot = 0;
  home = { x: 0, y: 0 };
  /** Замок соседа так, как его называет реестр этому боту. */
  idOf(other: Bot): string {
    return this.castles.find((c) => c.x === other.home.x && c.y === other.home.y)?.id ?? '';
  }
  orders: string[] = [];

  constructor(readonly n: number) {
    this.id = 5000 + n;
    this.key = `tg-${this.id}`;
    this.g = played(createInitialState(1000 + n));
  }

  async enter(): Promise<boolean> {
    const res = await call('/api/castles', this.id, this.era, 'PUT', claimOf(this.g));
    if (res.status === 410) {
      this.era = res.data?.era ?? this.era;
      return false;
    }
    if (res.status !== 200) return false;
    const r = res.data as RosterResponse;
    if (!r.mine) return false;
    this.take(r);
    if (!this.world) {
      this.world = new LocalWorld({
        seed: 2000 + this.n,
        home: r.mine,
        now: () => now,
        storage: memory(),
        era: this.era,
        castles: () => this.castles,
        wars: () => this.wars,
        warsKnown: () => true,
        warOrder: (o) => this.order(o),
        warPace: () => 60,
        spies: () => this.spies,
        spyLook: (t) => this.spyLook(t),
      });
    }
    this.slot = sicilySlot(r.mine);
    return true;
  }

  private take(r: RosterResponse): void {
    const mine = r.mine;
    this.castles = r.castles
      .filter((c: CastleView) => !mine || c.x !== mine.x || c.y !== mine.y)
      .map((c) => ({ id: c.id, x: c.x, y: c.y, name: c.name, city: c.city, power: c.power, pop: c.pop, seenAt: c.seenAt }));
    if (mine) this.home = mine;
  }

  async pull(): Promise<void> {
    const res = await call('/api/save', this.id, this.era, 'GET');
    if (res.status !== 200) return;
    const p = res.data as PullResponse;
    this.etag = p.etag;
    if (p.record) this.rev = p.record.rev;
    if (p.admin?.grants?.length) applyGrants(this.g, p.admin.grants);
    if (p.gems) {
      this.balance = p.gems.balance;
      if (p.gems.deeds.length) applyGemDeeds(this.g, p.gems.deeds);
    }
  }

  record(): SaveRecord {
    const war = this.world?.warSheet() ?? null;
    return {
      v: 1,
      rev: this.rev,
      updatedAt: now,
      device: `bot-${this.n}`,
      game: serialize(this.g),
      world: null,
      card: cardOf(this.g),
      watch: watchOf(this.g),
      ...(war ? { war } : {}),
    };
  }

  async push(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const res = await call('/api/save', this.id, this.era, 'PUT', { baseEtag: this.etag, record: this.record() });
      if (res.status === 200) {
        this.etag = res.data.etag;
        this.rev = res.data.rev;
        if (res.data.admin?.grants?.length) applyGrants(this.g, res.data.admin.grants);
        if (res.data.gems?.deeds?.length) applyGemDeeds(this.g, res.data.gems.deeds);
        return;
      }
      if (res.status === 409) {
        this.etag = res.data?.etag ?? null;
        continue;
      }
      return;
    }
  }

  /** Минута игрока: решения, шаг партии, пульс мира. */
  async live(minutes: number): Promise<void> {
    staff(this.g);
    build(this.g);
    if (minutes > 0) away(this.g, gameSeconds(minutes * 60), 60);
    if (!this.world) return;
    const pulse = await pulseOf(this.world, this.g, this.last);
    this.last = { marches: pulse.marches, figures: pulse.figures };
  }

  async warLook(): Promise<void> {
    const res = await call('/api/war', this.id, this.era, 'GET');
    if (res.status !== 200) return;
    const r = res.data as WarResponse;
    this.wars = r.wars;
    this.spies = r.spies ?? [];
  }

  async order(o: WarOrder): Promise<string | null> {
    const res = await call('/api/war', this.id, this.era, 'POST', o);
    this.orders.push(`${o.op}:${res.status}`);
    if (res.status !== 200) return res.data?.error ?? `HTTP ${res.status}`;
    const r = res.data as WarResponse;
    this.wars = r.wars;
    this.spies = r.spies ?? this.spies;
    return r.error ?? null;
  }

  async spyLook(target: string): Promise<SpyMenu | string> {
    const res = await call('/api/war', this.id, this.era, 'GET', undefined, `?spy=${encodeURIComponent(target)}`);
    this.orders.push(`spy-menu:${res.status}`);
    if (res.status !== 200) return `HTTP ${res.status}`;
    const r = res.data as WarResponse;
    return r.spyMenu ?? r.error ?? 'нет меню';
  }

  async gems(order?: unknown): Promise<GemsResponse | null> {
    const res = await call('/api/gems', this.id, this.era, order ? 'POST' : 'GET', order);
    return res.status === 200 ? (res.data as GemsResponse) : null;
  }
}

const all = <T>(bots: Bot[], f: (b: Bot) => Promise<T>): Promise<T[]> => Promise.all(bots.map(f));
const advance = (ms: number): void => {
  now += ms;
};
const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const tell: string[] = [];
const note = (s: string): void => {
  tell.push(s);
};

async function main(): Promise<void> {
  const bots = Array.from({ length: BOTS }, (_, i) => new Bot(i));

  // 1. Первый вход: все разом, проигравшие условную запись входят снова (так делает игра).
  let left = bots;
  for (let round = 0; round < 10 && left.length > 0; round++) {
    const ok = await all(left, (b) => b.enter());
    left = left.filter((_, i) => !ok[i]);
    advance(20_000);
  }
  if (left.length) problem(`не вошли: ${left.map((b) => b.key).join(', ')}`);
  const slots = bots.map((b) => b.slot);
  if (new Set(slots).size !== bots.length || slots.some((s) => s === 0)) problem(`места не разные или вне острова: ${slots.join(',')}`);
  note(`вход: ${bots.length} ботов, места ${Math.min(...slots)}…${Math.max(...slots)}, все разные`);

  // 2. Первая запись и пульс; живой обзор — видны ли все соседи.
  await all(bots, (b) => b.pull());
  await all(bots, (b) => b.live(1));
  await all(bots, (b) => b.push());
  let seenAll = 0;
  for (const b of bots) {
    let seen = 0;
    for (const c of b.castles) if ((await b.world!.settlement(c.id))?.visible) seen++;
    if (seen === b.castles.length) seenAll++;
  }
  note(`обзор: ${seenAll} из ${bots.length} видят вживую всех соседей (${bots.length - 1})`);
  const startBalance = bots.map((b) => b.balance ?? -1);

  // 3. Указ: войско каждому (`/give`), применяет партия при следующем входе — один раз.
  advance(MIN);
  for (const b of bots) await admin(`/give ${b.id} копейщики 40 мечники 20 лучники 20`);
  await all(bots, (b) => b.pull());
  await all(bots, (b) => b.pull()); // повторный приход того же указа — партия не берёт второй раз
  const armies = bots.map((b) => Object.values(b.g.army).reduce((n, v) => n + (v ?? 0), 0));
  const wrongArmy = bots.filter((_, i) => armies[i] !== 80);
  if (wrongArmy.length) problem(`указ войска лёг не 80 бойцами: ${wrongArmy.map((b, i) => `${b.key}=${armies[bots.indexOf(b)]}`).slice(0, 5).join(', ')} (i=${wrongArmy.length})`);
  note(`указ /give: войско ${Math.min(...armies)}…${Math.max(...armies)} у каждого (ждали 80), adminSeen ${Math.min(...bots.map((b) => adminSeen(b.g)))}`);
  await all(bots, (b) => b.live(1));
  await all(bots, (b) => b.push());

  // 4. Лавка: двойной заказ с одним ключом разом — списывается один раз.
  advance(MIN);
  const bought = await all(bots, async (b) => {
    const key = `buy-${b.id}-1`;
    const [x, y] = await Promise.all([b.gems({ op: 'buy', key, res: 'stone' }), b.gems({ op: 'buy', key, res: 'stone' })]);
    return [x, y] as const;
  });
  await all(bots, (b) => b.pull());
  for (const [i, b] of bots.entries()) {
    const g = await b.gems();
    if (!g) continue;
    const spent = g.list.filter((e) => e.delta < 0).reduce((n, e) => n - e.delta, 0);
    const credit = g.list.filter((e) => e.delta > 0);
    if (credit.length !== 1 || credit[0].kind !== 'start') problem(`${b.key}: начисления кроме стартовых: ${JSON.stringify(credit).slice(0, 120)}`);
    if (g.balance !== credit.reduce((n, e) => n + e.delta, 0) - spent) problem(`${b.key}: баланс ${g.balance} не сходится с журналом`);
    if (g.list.filter((e) => e.delta < 0).length > 1) problem(`${b.key}: двойной заказ списан дважды`);
    if (g.balance > startBalance[i] && startBalance[i] >= 0) problem(`${b.key}: алмазов больше стартовых`);
    void bought;
  }
  note(`лавка: ${bots.length} двойных заказов разом, списано по одному`);
  await all(bots, (b) => b.live(1));
  await all(bots, (b) => b.push());

  // Реестр — как в игре: заявка замка повторяется, ответ приносит всех соседей (первые вошедшие видели пустой остров).
  // Проигравшие запись общего реестра (429) повторяют через 20 с, как игра.
  left = bots;
  for (let round = 0; round < 10 && left.length > 0; round++) {
    const ok = await all(left, (b) => b.enter());
    left = left.filter((_, i) => !ok[i]);
    advance(20_000);
  }
  await all(bots, (b) => b.live(0));

  // 5. Война: пары соседей по местам. Чётные идут на нечётных — штурмом и осадой через раз; остальные ждут.
  advance(MIN);
  await all(bots, (b) => b.warLook());
  const pairs: [Bot, Bot][] = [];
  for (let i = 0; i + 1 < bots.length; i += 2) pairs.push([bots[i], bots[i + 1]]);
  const marched = await Promise.all(
    pairs.map(async ([a, d], k) => {
      // Дома остаются лучники, с полководцем — пехота.
      const garrisonErr = await a.world!.setGarrison({ archer: 20 });
      if (garrisonErr) return `раскладка: ${garrisonErr}`;
      // Защитник держит пехоту при полководце — ей бить лагерь с тыла.
      await d.world!.setGarrison({ archer: 20, spearman: 20 });
      const err = k % 2 === 0 ? await a.world!.assault(a.idOf(d)) : await a.world!.warMarch(a.idOf(d), 'siege', 'plunder');
      return err;
    }),
  );
  const marchErr = marched.filter((e) => e);
  note(`походы: ${pairs.length - marchErr.length} из ${pairs.length} ушли${marchErr.length ? `; отказы: ${[...new Set(marchErr)].slice(0, 3).join(' | ')}` : ''}`);

  // 6. Лазутчик: последний бот (без пары или защитник) смотрит меню у соседа и делает первое доступное дело.
  const spyBots = bots.filter((_, i) => i % 3 === 2).slice(0, 6);
  const spyDone = await Promise.all(
    spyBots.map(async (b) => {
      const target = b.castles[0]?.id;
      if (!target) return 'нет цели';
      const menu = await b.world!.spyMenu(target);
      const opt = menu.options.find((o) => o.can);
      if (!opt) return menu.error ?? 'нет доступного дела';
      return (await b.world!.spyRival(target, opt.deed, menu.at)) ?? 'ok';
    }),
  );
  note(`лазутчики: ${spyDone.filter((x) => x === 'ok').length} из ${spyBots.length} ушли на дело${spyDone.some((x) => x !== 'ok') ? `; прочее: ${[...new Set(spyDone.filter((x) => x !== 'ok'))].slice(0, 3).join(' | ')}` : ''}`);

  // 7. Боевое время: каждая минута — все разом смотрят войну, живут, пишут. В лагере — дела полководца, у стен — вылазка
  //    и удар с тыла.
  const crafts: string[] = [];
  const sorties: string[] = [];
  const strikes: string[] = [];
  for (let m = 0; m < MINUTES; m++) {
    advance(MIN);
    await all(bots, (b) => b.warLook());
    await all(bots, (b) => b.live(1));
    if (m % 3 === 1) {
      await Promise.all(
        pairs.map(async ([a, d]) => {
          const camp = a.wars.find((w) => w.role === 'atk' && w.phase === 'camp');
          if (camp) crafts.push((await a.world!.campCraft(m % 2 ? 'fortify' : 'bombard')) ?? 'ok');
          const onUs = d.wars.find((w) => w.role === 'def' && w.phase === 'camp');
          if (onUs) {
            const r = await d.world!.sortie({ archer: 5 });
            sorties.push(r.error ?? 'ok');
            // Удар с тыла — полководец защитника с дружиной (без гарнизона).
            strikes.push((await d.world!.strikeCamp(HOME_ID, false)) ?? 'ok');
          }
        }),
      );
    }
    await all(bots, (b) => b.push());
    if (m % 5 === 4) await all(bots, (b) => b.enter());
    if (m % 10 === 0) {
      await all(bots, async (b) => {
        await call('/api/rating', b.id, b.era, 'GET');
        await call('/api/feed', b.id, b.era, 'GET');
        await call('/api/notify', b.id, b.era, 'GET');
      });
    }
  }
  note(`дела в лагере: ${crafts.filter((x) => x === 'ok').length} принято из ${crafts.length}; вылазки: ${sorties.filter((x) => x === 'ok').length} из ${sorties.length}; удары с тыла: ${strikes.filter((x) => x === 'ok').length} из ${strikes.length}${[...crafts, ...sorties, ...strikes].some((x) => x !== 'ok') ? `; отказы: ${[...new Set([...crafts, ...sorties, ...strikes].filter((x) => x !== 'ok'))].slice(0, 4).join(' | ')}` : ''}`);

  // Приказ или меню лазутчика, отказанные «слишком часто», — то, что живой игрок заметит в «час войны» (docs/playtest_sim.md,
  // «Мелкое», п. 1): ни опрос, ни давка чужих приказов этого давать не должны.
  const taps = bots.flatMap((b) => b.orders);
  const refused = taps.filter((o) => o.endsWith(':429'));
  if (refused.length) problem(`приказы войны отказаны «слишком часто»: ${refused.length} из ${taps.length} (${[...new Set(refused)].join(', ')})`);
  note(`приказы войны и меню лазутчика: ${taps.length}, отказов «слишком часто» ${refused.length}`);

  // 8. Итоги боёв: у каждой стороны каждый бой принят партией один раз, а войны у сервера и у сторон совпадают.
  let battles = 0;
  let falls = 0;
  for (const b of bots) {
    const seen = (b.world as unknown as { save: { warSeen?: string[] } }).save.warSeen ?? [];
    if (new Set(seen).size !== seen.length) problem(`${b.key}: бой принят дважды (${seen.length - new Set(seen).size})`);
    for (const w of b.wars) {
      battles += w.role === 'atk' ? w.battles.length : 0;
      if (w.fall && w.role === 'atk') falls++;
      const ids = w.battles.map((x) => x.id);
      if (new Set(ids).size !== ids.length) problem(`${b.key}: в войне ${w.id} повтор боя`);
      for (const x of w.battles) if (x.at <= now && !seen.includes(x.id)) problem(`${b.key}: бой ${x.id} прошёл, а партия его не приняла`);
    }
  }
  const ends = new Map<string, number>();
  for (const b of bots) for (const w of b.wars) if (w.role === 'atk') ends.set(w.end ?? w.phase, (ends.get(w.end ?? w.phase) ?? 0) + 1);
  note(`бои: ${battles} у нападавших, падений городов ${falls}; войны по исходу: ${[...ends].map(([k, v]) => `${k} ${v}`).join(', ') || 'нет'}`);

  // 9. Флаги наблюдения у честных ботов.
  const flagged: string[] = [];
  for (const b of bots) {
    const found = await stores(STORES.watch, 'strong').getWithMetadata(b.key);
    const rec = readWatchRecord(found ? JSON.parse(String(found.data)) : null);
    for (const f of rec.flags) flagged.push(`${b.key} ${f.kind}: ${f.text.slice(0, 120)}`);
    if (rec.flags.length && process.env.JOURNAL) console.log(b.key, b.wars.map((w) => `${w.role} ${w.atkCity}->${w.defCity} ${w.end ?? w.phase}`), b.spies.map((x) => `${x.role} ${x.deed} ${JSON.stringify(x.out?.stolen ?? null)}`), rec.journal.slice(-12).map((j) => `${(j.at - T0) / MIN}m ${j.kind} ${j.text.slice(0, 90)}`));
  }
  for (const f of flagged.slice(0, 10)) problem(`флаг у честного бота — ${f}`);
  note(`флаги у честных ботов: ${flagged.length}`);

  // 10. Админ: статистика, флаги, заморозка, итог, чистый старт и вход заново.
  advance(MIN);
  const stats = await admin('/stats');
  const flagsText = await admin('/flags');
  const frozen = await admin(`/freeze ${bots[0].id} проверка`);
  await all(bots.slice(0, 2), (b) => b.pull());
  const finalText = await admin('/final');
  note(`админ: /stats → файлов ${files.length}${stats ? ', ответ есть' : ''}; /flags → ${flagsText.split('\n')[0].slice(0, 60)}; /freeze → ${frozen.split('\n')[0].slice(0, 60)}; /final → ${finalText.split('\n')[0].slice(0, 60)}`);
  const sizeBefore = statSync(dbFile).size;
  const wipe = await admin('/wipeworld ДА');
  note(`/wipeworld ДА → ${wipe.split('\n')[0].slice(0, 80)}`);
  advance(MIN);
  // Старая эпоха: 410 и номер новой; вход заново — снова места от середины.
  const gone = await call('/api/save', bots[1].id, bots[1].era, 'GET');
  if (gone.status !== 410) problem(`после стирания старая эпоха ответила ${gone.status}, а не 410`);
  for (const b of bots) {
    b.era = gone.data?.era ?? b.era + 1;
    b.world = null;
    b.etag = null;
    b.rev = 0;
    b.g = played(createInitialState(3000 + b.n));
  }
  left = bots.slice(1);
  for (let round = 0; round < 10 && left.length > 0; round++) {
    const ok = await all(left, (b) => b.enter());
    left = left.filter((_, i) => !ok[i]);
    advance(20_000);
  }
  const again = bots.slice(1).map((b) => b.slot);
  if (left.length || new Set(again).size !== again.length) problem(`вход после стирания: не вошли ${left.length}, места ${again.join(',')}`);
  note(`вход после стирания: ${bots.length - 1 - left.length} вошли, места ${Math.min(...again)}…${Math.max(...again)}`);

  // ---------- Сводка ----------
  console.log(`=== прогон ${BOTS} ботов, ${MINUTES} мин боевого времени (TRIBE_WAR_PACE=60) ===`);
  for (const t of tell) console.log(`  ${t}`);
  console.log('  время ответа, мс (p50 / p95 / max, запросов):');
  for (const [k, xs] of [...lat].sort()) console.log(`    ${k.padEnd(18)} ${pct(xs, 50).toFixed(1)} / ${pct(xs, 95).toFixed(1)} / ${Math.max(...xs).toFixed(1)}  (${xs.length})`);
  const codes = [...statuses].filter(([k]) => !k.endsWith(' 200')).map(([k, v]) => `${k}×${v}`);
  console.log(`  ответы не 200: ${codes.join(', ') || 'нет'}`);
  console.log(`  хранилище SQLite на ${BOTS} игроков перед стиранием: ${(sizeBefore / 1024).toFixed(0)} КБ`);
  console.log(`  опасное: ${problems.length}`);
  for (const p of problems.slice(0, 30)) console.log(`    ! ${p}`);
  db.close();
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = problems.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
