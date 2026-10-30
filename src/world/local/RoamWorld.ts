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
import type { BandOrder, BandRow } from '../../../netlify/lib/contract';
import type { RoamState } from '@/game/types';
import type { FightOut } from '@/game/sim/roamfight';
import type { Coord, FigureView, PlayerProfile, Rect, RegionChunk, RoamAimView, RoamCampGain, RoamCampView, RoamPlanView, WorldInfo, WorldPulse } from '../types';
import { HOME_ID, LocalWorld, type LocalWorldOptions } from './LocalWorld';
import { CAMP_KINDS, CAMP_NAME, campWorks, roamCamp, roamCell, roamGo, roamMoving, roamPlan, roamWhere, type CampKind, type RoamMove } from '../roam';
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
  /** Приказ серверу (реестр, `net/bandroster.bandOrder`) — в Telegram; нет — мир применяет правило сам. */
  order?: (o: BandOrder) => Promise<BandRow | string>;
}

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
    return { ...c, settlements: c.settlements.filter((s) => s.id !== HOME_ID && !this.beaten(s.id, now)), ruins, points };
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
    const p = roamPlan(m, to, now);
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
    // Встречи прежнего хода, чья минута прошла, — до того, как ход сменится.
    this.settleTrip(now);
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
}
