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
import type { Coord, FigureView, PlayerProfile, Rect, RegionChunk, RoamCampView, RoamPlanView, WorldInfo, WorldPulse } from '../types';
import { HOME_ID, LocalWorld, type LocalWorldOptions } from './LocalWorld';
import { CAMP_KINDS, CAMP_NAME, campWorks, roamCamp, roamCell, roamGo, roamPlan, roamWhere, type CampKind, type RoamMove } from '../roam';
import { wayGait } from '../roammove';
import { RUIN_NAME, ruinAt, ruinsIn } from '../ruins';
import { energyAt } from '../energy';
import { gaitField, type Gait } from '../gait';
import { terrainAt } from '../geography';
import { TERRAIN_META } from '../data/terrain';
import { FIGURE_BY_ID } from '../data/figures';
import { troopTotal } from '@/game/battle/kinds';
import { CASTLE_EYE, bandLook, conspicuity, detectRange } from '../sight';

/** Дверь мира бродяги к партии и серверу — её даёт стор. */
export interface RoamPort {
  /** Отряд партии сейчас; не в фазе бродяги — `null`. */
  band(): RoamState | null;
  /** Записать ход в партию одной дверью (`sim/roam.setMove`). */
  apply(m: RoamMove): void;
  /** Хлеб в обозе сейчас и через `ms` мс мира дороги в режиме `g` (`sim/roam.foodAfter`). */
  foodAfter(ms: number, g: Gait): { now: number; at: number };
  /** Что даёт лагерь вида (`sim/roam.campGain`): фураж, строка духа, раненые. */
  campGain(kind: CampKind): { forage: number; morale: number; heal: number };
  /** Часы партии, игровые секунды: ночь и сезон заметности отряда (ПН-4у). */
  partyTime(): number;
  /** Приказ серверу (реестр, `net/bandroster.bandOrder`) — в Telegram; нет — мир применяет правило сам. */
  order?: (o: BandOrder) => Promise<BandRow | string>;
}

/** Мир бродяги без места выхода не строится (`roamboot`); здесь — на случай, если запись хода пропала. */
export const NO_SEAT = 'Отряд ещё не вышел на карту: место выхода не названо.';

/** Риск засады в окне хода — до встреч с НПС (ПН-5) не считается: заглушка строкой, а не числом. */
export const AMBUSH_STUB = 'Риск засады не измерен: встреч на дорогах пока нет.';

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
    return { ...c, settlements: c.settlements.filter((s) => s.id !== HOME_ID), ruins };
  }

  async figures(): Promise<FigureView[]> {
    return [];
  }

  /** Тихий пульс: мир за несуществующий город не шагает; путь отряда открывает землю. */
  async sync(profile: PlayerProfile): Promise<WorldPulse> {
    const now = this.clock();
    this.walkFog(now);
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
    return {
      from: p.from,
      to: p.to,
      where: this.whereWords(p.to),
      block: p.block,
      gait: wayGait(m.way),
      ambush: AMBUSH_STUB,
      legs: p.legs.map((l) => ({
        gait: l.gait,
        walkMs: l.walkMs,
        start: l.start,
        until: l.until,
        price: l.price,
        halt: l.start - now,
        energy: { now: have, road: l.road, left: l.left },
        food: this.port.foodAfter(l.until - now, l.gait),
        block: l.block,
      })),
    };
  }

  async roamTo(to: Coord, gait: Gait, shownUntil?: number): Promise<string | null> {
    const m = this.move();
    if (!m) return NO_SEAT;
    const now = this.clock();
    const next = roamGo(m, to, gait, now);
    if (typeof next === 'string') return next;
    if (this.port.order) {
      // Правду о ходе выводит сервер той же дверью; его строку партия берёт из ответа реестра (`net/roster` → `setMove`).
      const got = await this.port.order({ op: 'go', to: { x: next.way.to.x, y: next.way.to.y }, ...gaitField(gait), until: shownUntil ?? next.way.until });
      return typeof got === 'string' ? got : null;
    }
    this.port.apply(next);
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
    return {
      at,
      camp: m.camp?.kind ?? null,
      works: m.camp ? campWorks(m.camp, now) : 0,
      ruin: ruin ? RUIN_NAME[ruin.kind] : null,
      rows: CAMP_KINDS.map((kind) => {
        const res = roamCamp(m, kind, men, now);
        // Заметность лагеря этого вида здесь и сейчас (ПН-4у) — дверью `world/sight`: на сколько клеток его видит круг замка.
        const look = bandLook({ ...m, way: { from: at, to: at, at: now, until: now }, camp: { kind, since: now, builders: men } }, men, this.port.partyTime(), now);
        const range = detectRange(CASTLE_EYE, conspicuity(look));
        return { kind, name: CAMP_NAME[kind], block: typeof res === 'string' ? res : null, range, ...this.port.campGain(kind) };
      }),
    };
  }

  async roamCamp(kind: CampKind | null): Promise<string | null> {
    const m = this.move();
    const r = this.port.band();
    if (!m || !r) return NO_SEAT;
    const now = this.clock();
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
