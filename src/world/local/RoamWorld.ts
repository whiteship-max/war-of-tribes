// Мир бродяги (ПН-3, docs/gdd/path_of_sword.md, 3.5 и 5.2; «Решения ПН-3»): тот же мир, что у лорда (`LocalWorld`), без своего
// города — дома у бродяги нет, — и с ходом отряда. Едет своим куском: его строит `world/store` только за `roamOn` и только в
// фазе бродяги (`roamboot.ts`), поэтому ни одна строка отсюда не лежит в первой загрузке, а мир лорда — тот же, что был.
//
// Что меняется против мира лорда — и только это:
//  - **своего города на карте нет** (`region` без `HOME_ID`), фигур лорда нет (`figures` — пусто: агентов у бродяги в Срезе 1
//    нет, отряд рисует карта бродяги по записи хода партии);
//  - **мир не шагает за город**: набегов на город, которого нет, осад и вестей нет (`sync` — тихий пульс). Встречи с НПС — ПН-5;
//  - **руины** на разведанных клетках едут куском карты (`RegionChunk.ruins`, `world/ruins`) — у лорда их нет;
//  - **путь отряда открывает землю** обзором полководца (`FIGURE_BY_ID.general.sight`: отряд — полководец с дружиной без города);
//    живой обзор и заметность — ПН-4у;
//  - **ход и лагерь**: окно хода и «Идти сюда», окно лагеря и «Встать лагерем» — дверью хода `world/roam`; в Telegram приказ
//    принимает сервер (реестр той же дверью), и запись хода партия берёт из его ответа; без сервера мир применяет правило сам.
// Запись хода лежит в партии (`GameState.roam`), мир её не хранит: дверь к партии — порт `RoamPort`, его даёт стор (как реестр и
// войну — мир про партию не знает).
import type { BandOrder, BandRow, FreeView, WarOrder, WarView } from '../../../netlify/lib/contract';
import type { SiegeLook } from '@/game/sim/roamcastle';
import { FREE_FATE_IDS, castellanOf, freeAccess, freeFateBlock, freeName, freeNeeds, freePrestige, freeTierWords, freeTroops, isFreeKey } from '../freecastle';
import { FATE_META } from '../data/fates';
import { troopPower } from '@/game/battle/price';
import { breachesOf } from '../siegeroll';
import { liveOffer } from '../parley';
import type { SiegeWindow } from '../siege';
import type { RoamState } from '@/game/types';
import type { FightOut } from '@/game/sim/roamfight';
import type { Coord, Fate, FigureView, FreeCastleView, FreeMark, FreeSiegeView, PlayerProfile, Rect, RegionChunk, RoamAimView, RoamCampGain, RoamCampView, RoamPlanView, WorldInfo, WorldPulse } from '../types';
import { HOME_ID, LocalWorld, type LocalWorldOptions } from './LocalWorld';
import { CAMP_KINDS, CAMP_NAME, campWorks, liveSiege, roamCamp, roamCell, roamGo, roamMoving, roamPlan, roamWhere, siegeHoldBlock, type CampKind, type RoamMove } from '../roam';
import { wayGait, type RoamTrip, type RoamWay } from '../roammove';
import { pointAt, pointsIn, pointWords, type RoamPoint } from '../roampoints';
import { FOE_WORDS, foePower, foeRipe, type FoeKind } from '../roamfoes';
import { ambushFight, ambushOdds, ambushWords, strikeFight, tripOf, type StrikeAim } from '../encounter';
import { menOfPower } from '../garrison';
import { isLair } from '../gen';
import { realSpan } from '@/game/span';
import { gameSecondsOfMs } from '@/game/pace';
import { RUIN_NAME, ruinAt, ruinsIn } from '../ruins';
import { energyAt } from '../energy';
import { gaitField, type Gait } from '../gait';
import { terrainAt } from '../geography';
import { TERRAIN_META } from '../data/terrain';
import { FIGURE_BY_ID } from '../data/figures';
import { troopTotal } from '@/game/battle/kinds';
import { CASTLE_EYE, bandLook, conspicuity, detectRange } from '../sight';
import { campFaces, campGround, fireLit, openSky, siteAt, siteWords, skyLine, type BandPlace } from '../campsite';
import { dayPartAt } from '@/game/derived';
import type { CampGain } from '@/game/sim/roam';
import { boardsAt, type DealBoard, type DealPlace } from '../dealboard';

/** Дверь мира бродяги к партии и серверу — её даёт стор. */
export interface RoamPort {
  /** Отряд партии сейчас; не в фазе бродяги — `null`. */
  band(): RoamState | null;
  /** Записать ход в партию одной дверью (`sim/roam.setMove`). */
  apply(m: RoamMove): void;
  /** Хлеб в обозе сейчас и через `ms` мс мира дороги в режиме `g` (`sim/roam.foodAfter`). */
  foodAfter(ms: number, g: Gait): { now: number; at: number };
  /**
   * Что даёт лагерь вида (`null` — стоять в поле) в месте и погоде `open` (`sim/roam.campGain`, ПН-12л): фураж, строки духа «Лагерь» и
   * «Непогода», отдых раненых, паёк под снегом.
   */
  campGain(kind: CampKind | null, open: BandPlace | null): CampGain;
  /** Часы партии, игровые секунды: ночь и сезон заметности отряда (ПН-4у). */
  partyTime(): number;
  /** Престиж героя (ПН-5): от его ступени сила НПС (`world/roamfoes`). */
  prestige(): number;
  /** Записать встречу хода одной дверью (`sim/roam.setTrip`). */
  setTrip(t: RoamTrip | null): void;
  /** Положить итог боя (`sim/roamfight.takeFight`) и сказать о нём; вернёт строку летописи. */
  fight(f: FightOut): string;
  /** Договор сорван (ПН-7, `sim/contracts.failDeal`): набег на село пришёл, а отряда у села не было. */
  failDeal(id: string, why: string): void;
  /** Приказ серверу (реестр, `net/bandroster.bandOrder`) — в Telegram; нет — мир применяет правило сам. */
  order?: (o: BandOrder) => Promise<BandRow | string>;
  /** Вольные замки пула рядом (ПН-10) — слово реестра сервера; нет — пула не видно. */
  free?: () => FreeView[];
  /** Войны с сервера (ПН-10: осады вольных замков отряда); нет — осад нет. */
  wars?: () => WarView[];
  /** Приказ серверу войны (ПН-10); нет — связи нет: осада вольного замка идёт только сервером. */
  warOrder?: (o: WarOrder) => Promise<string | null>;
  /** Положить итог осады вольного замка одной дверью партии (`sim/roamcastle.takeSiege`); строки летописи. */
  siege?: (look: SiegeLook) => string[];
}

/** Осада вольного замка — только сервером войны (ПН-10): без связи её не начать. */
export const SIEGE_OFFLINE = 'Осада вольного замка идёт на сервере войны: нужна связь.';

/** Мир бродяги без места выхода не строится (`roamboot`); здесь — на случай, если запись хода пропала. */
export const NO_SEAT = 'Отряд ещё не вышел на карту: место выхода не названо.';


export class RoamWorld extends LocalWorld {
  private readonly port: RoamPort;
  /** До какой минуты путь отряда уже открыл землю. */
  private seenTo = -Infinity;

  constructor(opts: LocalWorldOptions, port: RoamPort) {
    super(opts);
    this.port = port;
    this.walkFog(this.clock());
  }

  /** Запись хода партии; места выхода нет — `null`. */
  private move(): RoamMove | null {
    const r = this.port.band();
    return r?.way ? { way: r.way, camp: r.camp, ...(r.energy ? { energy: r.energy } : {}) } : null;
  }

  /**
   * Путь отряда открывает землю — обзором полководца (`FIGURE_BY_ID.general.sight`): отряд — полководец с дружиной без города. От
   * прошлой отметки до минуты `now` по линии хода; стоит — кругом на месте.
   */
  private walkFog(now: number): void {
    const m = this.move();
    if (!m) return;
    const r = FIGURE_BY_ID.general.sight;
    const from = Math.max(m.way.at, this.seenTo);
    if (from < now) this.fog.revealPath(roamWhere(m.way, from), roamWhere(m.way, now), r);
    else this.fog.revealDisc(roamWhere(m.way, now), r);
    this.seenTo = now;
  }

  async info(): Promise<WorldInfo> {
    const base = await super.info();
    const m = this.move();
    // «К себе» у бродяги — к отряду: города у него нет.
    return m ? { ...base, home: roamCell(m.way, this.clock()) } : base;
  }

  async region(rect: Rect): Promise<RegionChunk> {
    const c = await super.region(rect);
    const { x, y, w, h } = c.rect;
    // Руины — только на разведанных клетках: в тумане их нет, как и поселений.
    const ruins = ruinsIn(x, y, x + w, y + h)
      .filter((r) => c.explored[(r.y - y) * w + (r.x - x)] === 1)
      .map((r) => ({ x: r.x, y: r.y, name: RUIN_NAME[r.kind], cap: r.cap }));
    // Точки бродяги (ПН-5) — тоже только на разведанном; побитая ватага и побитое логово — пепелищем до срока: на карте их нет.
    const now = this.clock();
    const points = pointsIn(this.save.seed, x, y, x + w, y + h)
      .filter((p) => c.explored[(p.y - y) * w + (p.x - x)] === 1 && !this.beaten(p.id, now))
      .map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, name: p.name, tier: p.tier }));
    // Вольные замки пула (ПН-10) — слово реестра, на разведанном; взят ли, сожжён ли, стоит ли наш лагерь — из записи войн.
    const free: FreeMark[] = (this.port.free?.() ?? [])
      .filter((f) => f.x >= x && f.x < x + w && f.y >= y && f.y < y + h && c.explored[(f.y - y) * w + (f.x - x)] === 1)
      .map((f) => this.freeMark(f, now));
    return { ...c, settlements: c.settlements.filter((s) => s.id !== HOME_ID && !this.beaten(s.id, now)), ruins, points, free };
  }

  /** Точка побита и ещё пепелище (ПН-5, `RoamState.beaten`). */
  private beaten(id: string, now: number): boolean {
    return (this.port.band()?.beaten ?? []).some((b) => b.id === id && b.until > now);
  }

  /** Живое логово мира в клетке (своё: мир бродяги строит их, как у лорда) или `null`. */
  private lairAt(c: Coord, now: number): { id: string; name: string } | null {
    for (const st of this.byId.values()) {
      if (st.x === c.x && st.y === c.y && isLair(st) && !this.beaten(st.id, now)) return { id: st.id, name: st.name };
    }
    return null;
  }

  /**
   * Точка в клетке цели (ГДД 3.5.1) и удар по ней (3.6.1): логово и ватага — бой в минуту прихода, сила — по ступени престижа
   * (`world/roamfoes`), не по отряду; город и село — место и вход (их дела — ПН-6/7; разбоя сёл нет, Р10).
   */
  private aimAt(c: Coord, now: number): (RoamAimView & { foe: FoeKind | null }) | null {
    const r = this.port.band();
    const hurt = r?.hero.hurt !== undefined && r.hero.hurt > this.port.partyTime() ? r.hero.hurt - this.port.partyTime() : 0;
    const lair = this.lairAt(c, now);
    const pt: RoamPoint | null = lair ? null : pointAt(this.save.seed, c.x, c.y);
    if (!lair && (!pt || this.beaten(pt.id, now))) return null;
    const id = lair ? lair.id : (pt as RoamPoint).id;
    const name = lair ? lair.name : (pt as RoamPoint).name;
    const foe: FoeKind | null = lair ? 'lair' : pt?.kind === 'vataga' ? 'band' : null;
    const kind: RoamAimView['kind'] = lair ? 'lair' : (pt as RoamPoint).kind;
    const words = lair ? `${name} — логово: можно напасть.` : pointWords(pt as RoamPoint);
    if (!foe) return { id, kind, name, words, strike: null, block: null, foe };
    const power = foePower(this.port.prestige(), foe, foeRipe(this.save.seed, id));
    const block = hurt > 0 ? `Герой ранен: в бой поведёт через ${realSpan(Math.ceil(hurt / gameSecondsOfMs(1000)))}.` : null;
    return { id, kind, name, words, strike: { power, men: menOfPower(power) }, block, foe };
  }

  async figures(): Promise<FigureView[]> {
    return [];
  }

  /** Тихий пульс: мир за несуществующий город не шагает; путь отряда открывает землю. */
  async sync(profile: PlayerProfile): Promise<WorldPulse> {
    const now = this.clock();
    this.walkFog(now);
    this.settleTrip(now);
    this.settleDeals(now);
    this.settleSieges();
    return { now, marches: [], figures: [], reports: [], effects: [], siege: null, faith: this.faithView(profile.faith ?? null), unread: 0 };
  }

  /** Что в клетке — словами: местность и руины. */
  private whereWords(c: Coord): string {
    const ruin = ruinAt(c.x, c.y);
    const t = TERRAIN_META[terrainAt(0, c.x, c.y)].name;
    return ruin ? `${t}, ${RUIN_NAME[ruin.kind].toLowerCase()}` : t;
  }

  async roamPlan(to: Coord): Promise<RoamPlanView | string> {
    const m = this.move();
    if (!m) return NO_SEAT;
    const now = this.clock();
    const plan = roamPlan(m, to, now);
    // Отряд в осаде (ПН-Э1): окно хода называет отказ до приказа — тем же правилом, что исполнит приказ (и сервер).
    const p = { ...plan, block: plan.block ?? siegeHoldBlock(this.sieges()) };
    const have = energyAt(m.energy, now);
    const r = this.port.band();
    const men = troopTotal(r?.band ?? {});
    const aim = p.block ? null : this.aimAt(p.to, now);
    return {
      from: p.from,
      to: p.to,
      where: this.whereWords(p.to),
      block: p.block,
      gait: wayGait(m.way),
      aim: aim ? { id: aim.id, kind: aim.kind, name: aim.name, words: aim.words, strike: aim.strike, block: aim.block } : null,
      legs: p.legs.map((l) => ({
        gait: l.gait,
        walkMs: l.walkMs,
        start: l.start,
        until: l.until,
        price: l.price,
        halt: l.start - now,
        energy: { now: have, road: l.road, left: l.left },
        food: this.port.foodAfter(l.until - now, l.gait),
        // Засада на этой дороге (ПН-5) — те же числа, что заморозит приказ (`encounter.tripOf`): шанс видимостью, сила престижем.
        ambush: ((): RoamPlanView['legs'][number]['ambush'] => {
          const o = ambushOdds(this.legWay(p.from, p.to, l.start, l.until, l.gait), men, this.port.partyTime(), now, this.port.prestige(), this.save.seed);
          return { ...o, words: ambushWords(o) };
        })(),
        block: l.block,
      })),
    };
  }

  /** Ход одного режима окна хода — та же запись, что ляжет приказом (`roam.roamGo`). */
  private legWay(from: Coord, to: Coord, start: number, until: number, g: Gait): RoamWay {
    return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, at: start, until, ...gaitField(g) };
  }

  /**
   * Заморозить встречу нового хода (ГДД 3.6.3) — в минуту приказа, теми же функциями, что окно хода: шанс и сила засады, кость, где и
   * когда встреча, удар по цели. Ход уже лёг в партию (правилом мира или строкой сервера).
   */
  private freezeTrip(now: number, aim: StrikeAim | undefined): void {
    const r = this.port.band();
    if (!r?.way) return;
    this.port.setTrip(tripOf(r.way, troopTotal(r.band), this.port.partyTime(), now, this.port.prestige(), this.save.seed, aim));
  }

  /**
   * Разобрать встречи хода, чья минута пришла (ГДД 3.6.3): засада — в минуту встречи, удар — в минуту прихода; каждая один раз
   * (отметка `done`). Зовут пульс мира и новый приказ (до того, как ход сменится).
   */
  private settleTrip(now: number): void {
    const r = this.port.band();
    const t = r?.trip;
    if (!r || !t || !r.way) return;
    let next: RoamTrip = t;
    if (t.ambush && !t.ambush.done && now >= t.ambush.at) {
      const a = t.ambush;
      const band = { ...(this.port.band()?.band ?? {}) };
      if (troopTotal(band) > 0) {
        const f = ambushFight(t.odds.power, band, a.cell, a.seed);
        this.port.fight({ how: 'ambush', id: '', name: FOE_WORDS.band, power: t.odds.power, foeMen: f.foeMen, foeLoss: f.foeLoss, won: f.won, lost: f.lost, seed: a.seed, at: a.at });
      }
      next = { ...next, ambush: { ...a, done: true } };
      this.port.setTrip(next);
    }
    const st = next.strike;
    if (st && !st.done && now >= r.way.until) {
      const band = { ...(this.port.band()?.band ?? {}) };
      if (troopTotal(band) > 0 && !this.beaten(st.id, now)) {
        const f = strikeFight(st.power, band, r.way.to, r.way.from, st.seed, st.id);
        this.port.fight({ how: 'strike', id: st.id, name: st.name, power: st.power, foeMen: f.foeMen, foeLoss: f.foeLoss, won: f.won, lost: f.lost, seed: st.seed, at: r.way.until });
      }
      next = { ...next, strike: { ...st, done: true } };
      this.port.setTrip(next);
    }
  }

  async roamTo(to: Coord, gait: Gait, shownUntil?: number, strike?: boolean): Promise<string | null> {
    const m = this.move();
    if (!m) return NO_SEAT;
    const now = this.clock();
    // Встречи прежнего хода и набеги на сёла договоров, чья минута прошла, — до того, как ход сменится.
    this.settleTrip(now);
    this.settleDeals(now);
    const held = siegeHoldBlock(this.sieges());
    if (held) return held;
    const next = roamGo(m, to, gait, now);
    if (typeof next === 'string') return next;
    // Удар по цели (ПН-5): только логово и ватага, и не раненым героем; сила — та, что показало окно (престиж той же минуты).
    let aim: StrikeAim | undefined;
    if (strike) {
      const a = this.aimAt(next.way.to, now);
      if (!a?.foe || !a.strike) return 'Здесь не с кем биться.';
      if (a.block) return a.block;
      aim = { id: a.id, kind: a.foe, name: a.name, power: a.strike.power };
    }
    if (this.port.order) {
      // Правду о ходе выводит сервер той же дверью; его строку партия берёт из ответа реестра (`net/bandroster` → `setMove`).
      const got = await this.port.order({ op: 'go', to: { x: next.way.to.x, y: next.way.to.y }, ...gaitField(gait), until: shownUntil ?? next.way.until });
      if (typeof got === 'string') return got;
    } else this.port.apply(next);
    this.freezeTrip(now, aim);
    return null;
  }

  async roamCampView(): Promise<RoamCampView | string> {
    const m = this.move();
    const r = this.port.band();
    if (!m || !r) return NO_SEAT;
    const now = this.clock();
    const men = troopTotal(r.band);
    const at = roamCell(m.way, now);
    const ruin = ruinAt(at.x, at.y);
    const partyTime = this.port.partyTime();
    // Место и погода (ПН-12л) — как у стоящего здесь (идущий встаёт там, где застал приказ): те же двери, что шаг отряда.
    const stand = { from: at, to: at, at: now, until: now };
    const open = openSky(stand, now, partyTime);
    const row = (kind: CampKind | null): RoamCampGain => {
      // Заметность лагеря этого вида здесь и сейчас (ПН-4у) — дверью `world/sight`: на сколько клеток его видит круг замка.
      const look = bandLook({ ...m, way: stand, camp: kind ? { kind, since: now, builders: men } : null }, men, partyTime, now);
      const range = detectRange(CASTLE_EYE, conspicuity(look));
      return { range, faces: campFaces(campGround(at, kind)), fire: open ? fireLit(kind, open.sky) : kind === 'open', ...this.port.campGain(kind, open) };
    };
    return {
      at,
      camp: m.camp?.kind ?? null,
      works: m.camp ? campWorks(m.camp, now) : 0,
      ruin: ruin ? RUIN_NAME[ruin.kind] : null,
      place: siteWords(siteAt(at)),
      sky: open ? skyLine(open.sky, dayPartAt(partyTime) === 'night') : 'под крышей постоя',
      field: row(null),
      rows: CAMP_KINDS.map((kind) => {
        const res = roamCamp(m, kind, men, now);
        return { kind, name: CAMP_NAME[kind], block: typeof res === 'string' ? res : null, ...row(kind) };
      }),
    };
  }

  /**
   * Набеги на сёла договоров «Защитить село» (ПН-7, ГДД 3.8.2), чья минута пришла: стоял отряд у села в минуту набега (не в пути, в его
   * клетке или соседней) — бой у ворот (ватага нападает, `encounter.ambushFight`, итог — `takeFight`, договор отмечает дверь договоров);
   * не стоял — договор сорван. Каждый набег — один раз: договор после него снят. Зовут пульс мира и новый приказ.
   */
  private settleDeals(now: number): void {
    const r = this.port.band();
    if (!r?.deals || !r.way) return;
    for (const d of r.deals) {
      if (d.kind !== 'defend' || d.due === undefined || now < d.due) continue;
      const at = roamCell(r.way, d.due);
      const stood = !roamMoving(r.way, d.due) && Math.max(Math.abs(at.x - d.target.x), Math.abs(at.y - d.target.y)) <= 1;
      const band = { ...(this.port.band()?.band ?? {}) };
      if (!stood || troopTotal(band) <= 0) {
        this.port.failDeal(d.id, 'набег пришёл, а отряда у села не было');
        continue;
      }
      const seed = (Math.imul(this.save.seed | 0, 29) ^ d.due) >>> 0;
      const f = ambushFight(d.power, band, d.target, seed);
      this.port.fight({ how: 'defend', id: d.id, name: d.target.name, power: d.power, foeMen: f.foeMen, foeLoss: f.foeLoss, won: f.won, lost: f.lost, seed, at: d.due });
    }
  }

  /** Живые логова мира для доски договоров (ПН-7): своё логово мира бродяги, не пепелище. */
  private lairPlaces(now: number): DealPlace[] {
    const out: DealPlace[] = [];
    for (const st of this.byId.values()) if (isLair(st) && !this.beaten(st.id, now)) out.push({ id: st.id, x: st.x, y: st.y, name: st.name });
    return out;
  }

  async roamBoards(): Promise<DealBoard[]> {
    const m = this.move();
    if (!m) return [];
    const now = this.clock();
    if (roamMoving(m.way, now)) return [];
    const c = roamCell(m.way, now);
    return boardsAt(this.save.seed, c, now, this.port.prestige(), { lairs: this.lairPlaces(now), beaten: (id) => this.beaten(id, now) });
  }

  async roamHere(): Promise<RoamPoint | null> {
    const m = this.move();
    if (!m) return null;
    const now = this.clock();
    if (roamMoving(m.way, now)) return null;
    const c = roamCell(m.way, now);
    let best: RoamPoint | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = pointAt(this.save.seed, c.x + dx, c.y + dy);
        if (!p || p.kind === 'vataga') continue;
        if (dx === 0 && dy === 0) return p;
        best ??= p;
      }
    }
    return best;
  }

  async roamCamp(kind: CampKind | null): Promise<string | null> {
    const m = this.move();
    const r = this.port.band();
    if (!m || !r) return NO_SEAT;
    const now = this.clock();
    this.settleTrip(now);
    this.settleDeals(now);
    const men = troopTotal(r.band);
    const next = roamCamp(m, kind, men, now);
    if (typeof next === 'string') return next;
    if (this.port.order) {
      const got = await this.port.order({ op: 'camp', kind, men });
      return typeof got === 'string' ? got : null;
    }
    this.port.apply(next);
    return null;
  }

  // ---------- вольные замки (ПН-10, ГДД 3.11, 5.4) ----------
  //
  // Замки пула — слово реестра сервера (`net/bandroster.freeCastles`), гарнизон, казна, кастелян и доступ — дверью правил
  // `world/freecastle` (той же, что у сервера войны), осада — запись войн сервера: приказ уходит туда (`port.warOrder`), а итоги своей
  // стороны мир кладёт в партию одной дверью (`sim/roamcastle.takeSiege`) на пульсе. Замок берут только мечом: кнопок сдачи и подкупа
  // нет, дань кастеляна — ответом на его предложение.

  /** Наши осады вольных замков — из записи войн сервера. */
  private sieges(): WarView[] {
    return (this.port.wars?.() ?? []).filter((w) => w.role === 'atk' && isFreeKey(w.defCastle));
  }

  /** Осада, что идёт (поход к стенам или лагерь); нет — `null`. */
  private siegeNow(): WarView | null {
    return liveSiege(this.sieges());
  }

  /** Наша осада замка `id`: идущая, иначе последняя кончившаяся; нет — `null`. */
  private freeSiegeOf(id: string): WarView | null {
    const list = this.sieges().filter((w) => w.defCastle === id);
    return list.find((w) => w.phase === 'march' || w.phase === 'camp') ?? list[list.length - 1] ?? null;
  }

  private freeMark(f: FreeView, now: number): FreeMark {
    const siege = this.freeSiegeOf(f.id);
    return {
      id: f.id,
      x: f.x,
      y: f.y,
      tier: f.tier,
      name: freeName(f.x, f.y),
      ...(f.held ? { held: f.held.mine ? ('mine' as const) : ('other' as const) } : {}),
      ...(f.burnt !== undefined && f.burnt > now ? { burnt: true } : {}),
      ...(siege && (siege.phase === 'march' || siege.phase === 'camp') ? { siege: true } : {}),
    };
  }

  /** Итоги осад с сервера — в партию одной дверью, каждый один раз (`RoamState.siege.seen`). */
  private settleSieges(): void {
    if (!this.port.siege) return;
    for (const w of this.sieges()) {
      const tier = w.npc?.tier ?? this.port.free?.().find((f) => f.id === w.defCastle)?.tier ?? 1;
      const look: SiegeLook = {
        war: w.id,
        id: w.defCastle,
        name: w.defCity,
        tier,
        went: w.went as SiegeLook['went'],
        army: w.army.troops as SiegeLook['army'],
        battles: w.battles.map((b) => ({
          id: b.id,
          at: b.at,
          site: b.site,
          // Наша сторона победила: нападали мы и победили, или нападал город и проиграл.
          won: (b.by === 'atk') === b.won,
          lost: b.atkLost as SiegeLook['went'],
          foePower: troopPower(b.homeLost as SiegeLook['went']),
          foeMen: troopTotal(b.homeTroops as SiegeLook['went']),
        })),
        ...(w.fall ? { fall: { at: w.fall.at, fate: w.fall.fate as Fate, taken: w.fall.taken, led: w.fall.led } } : {}),
        ...(w.end && w.endAt !== undefined ? { end: { end: w.end, at: w.endAt, ...(w.tribute ? { tribute: w.tribute.taken } : {}) } } : {}),
      };
      this.port.siege(look);
    }
  }

  private freeSiegeView(w: WarView, now: number): FreeSiegeView {
    const camp = w.camp as SiegeWindow | undefined;
    const offer = camp ? liveOffer(camp, 'tribute', now) : null;
    return {
      war: w.id,
      phase: w.phase,
      mode: w.mode,
      fate: w.fate as Fate,
      phases: camp?.phases?.length ?? w.phases?.length ?? 0,
      breaches: camp ? breachesOf(camp) : 0,
      starvesAt: w.starvesAt ?? null,
      men: troopTotal(w.army.troops as SiegeLook['went']),
      tribute: offer && offer.price ? { price: offer.price, until: offer.until } : null,
      end: w.end ?? null,
    };
  }

  async roamFree(id: string): Promise<FreeCastleView | string> {
    const f = (this.port.free?.() ?? []).find((x) => x.id === id);
    if (!f) return 'Этого замка больше нет.';
    const now = this.clock();
    const r = this.port.band();
    const m = this.move();
    const at = m ? roamCell(m.way, now) : null;
    const near = !!m && !!at && !roamMoving(m.way, now) && Math.max(Math.abs(at.x - f.x), Math.abs(at.y - f.y)) <= 1;
    const troops = freeTroops(id, f.tier);
    const men = troopTotal(troops);
    const power = troopPower(troops);
    const band = { men: troopTotal(r?.band ?? {}), power: troopPower(r?.band ?? {}) };
    const have = this.port.prestige();
    const need = freePrestige(f.tier);
    const siegeAll = this.freeSiegeOf(id);
    const live = this.siegeNow();
    const held = f.held ? (f.held.mine ? 'mine' : 'other') : null;
    const burntUntil = f.burnt !== undefined && f.burnt > now ? f.burnt : null;
    // Строки окна — дверью правил замка (одной с автопилотом прибора, ПН-Э1): мощь отряда и гарнизона — `troopPower`.
    const needs = freeNeeds({ prestige: have, tier: f.tier, near, band: band.power, garrison: power, online: !!this.port.warOrder }).map(({ text, ok }) => ({ text, ok }));
    const block =
      held === 'mine'
        ? 'Замок уже наш.'
        : held === 'other'
          ? 'Замок взял другой отряд.'
          : burntUntil
            ? `Замок сожжён и отстраивается: ${realSpan(Math.ceil((burntUntil - now) / 1000))}.`
            : live
              ? live.defCastle === id
                ? 'Наш лагерь уже под этими стенами.'
                : `Отряд в осаде у ${live.defCity}.`
              : freeAccess(have, f.tier) ?? (!near ? 'Сперва подойти к стенам: отряд в клетке замка или рядом.' : !this.port.warOrder ? SIEGE_OFFLINE : band.men <= 0 ? 'В отряде нет бойцов.' : null);
    return {
      id,
      name: freeName(f.x, f.y),
      tier: f.tier,
      tierWords: freeTierWords(f.tier),
      castellan: castellanOf(f.x, f.y),
      garrison: { men: Math.max(10, Math.round(men / 10) * 10), power: Math.round(power) },
      prestige: { need, have: Math.floor(have) },
      band: { men: band.men, power: Math.round(band.power) },
      near,
      needs,
      block,
      held,
      burntUntil,
      fates: FREE_FATE_IDS.map((x) => ({ id: x, name: FATE_META[x].name, block: freeFateBlock(x, 'castle') })),
      siege: siegeAll ? this.freeSiegeView(siegeAll, now) : null,
    };
  }

  async roamSiege(id: string, mode: 'storm' | 'siege', fate: Fate): Promise<string | null> {
    const v = await this.roamFree(id);
    if (typeof v === 'string') return v;
    if (v.block) return v.block;
    const r = this.port.band();
    if (!r || !this.port.warOrder) return SIEGE_OFFLINE;
    const why = freeFateBlock(fate, 'castle');
    if (why) return why;
    // Весь отряд — в бой: у бродяги раскладки нет (ГДД 3.12, ДР-6); идёт обычным маршем — он уже у стен.
    const troops = Object.fromEntries(Object.entries(r.band).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>;
    return this.port.warOrder({ op: 'march', target: id, mode, fate, army: { troops, resolve: 0, pips: {} } });
  }

  async roamSiegeOrder(war: string, act: 'storm' | 'retreat' | 'tribute-yes' | 'tribute-no'): Promise<string | null> {
    if (!this.port.warOrder) return SIEGE_OFFLINE;
    const w = this.sieges().find((x) => x.id === war);
    if (!w || w.phase !== 'camp') return 'Лагеря уже нет.';
    if (act === 'storm') return this.port.warOrder({ op: 'storm', id: war });
    if (act === 'retreat') return this.port.warOrder({ op: 'retreat', id: war });
    return this.port.warOrder({ op: 'answer', id: war, kind: 'tribute', yes: act === 'tribute-yes' });
  }
}
