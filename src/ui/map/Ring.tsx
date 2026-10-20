// Кольцо значков над целью и короткие сведения «i» (К-2, docs/AGENTS.md, раздел 18).
//
// Касание места на карте без человека в руке поднимает над ним дугу из четырёх значков: письмо (дипломат), меч
// (полководец), глаз (разведчик и лазутчик) и «i». Касание горящего значка — короткий список дел этого человека у этой цели
// (`ActionMenu`, то же меню, что из «Походов»); погашенного — подсказка словами мира, почему (`ring.ts`). «i» — короткая
// карточка места без прокрутки, и из неё ссылкой — прежняя полная карточка (главный путь теперь кольцо, старый оставлен).
//
// Кусок едет отдельно от первой загрузки (`WorldMap`, `lazy`): кольцо нужно только после касания.
import './ring.css';
import { useGame } from '@/game/store';
import { useWorld, worldNow, type RingState, type WorldStore } from '@/world/store';
import { formatEstimate } from '@/world/intel';
import { formatCoord, secondsLeft } from '@/world/geo';
import { RELATION_META, STAGE_BY_ID } from '@/world/data/meta';
import { FATE_META } from '@/world/data/fates';
import { hireWhere } from '@/game/sim/hire';
import type { Estimate } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { realLeft } from '@/ui/parts/wait';
import { tipAt } from '@/ui/next/tip';
import { roomOf } from '@/world/muster';
import { RING_ORDER, musterable, ringSlots, type RingSlot } from './ring';

/** Радиус дуги и размер значка, px: значок не меньше пальца (`--tap` 44), дуга не налезает на соседние места. */
export const RING_R = 70;
export const RING_BTN = 52;
export const RING_LIFT = 26;

/** Где встанет каждый значок: дуга над точкой слева направо, от −160° до −20°; у края экрана дуга сдвигается внутрь. */
export function ringPlaces(at: { x: number; y: number }, vp: { w: number; h: number }): { x: number; y: number }[] {
  const pad = RING_BTN / 2 + 6;
  const cx = Math.min(Math.max(at.x, RING_R + pad), vp.w - RING_R - pad);
  // Середина дуги — над местом, а не на нём: значок места под пальцем остаётся виден.
  const cy = Math.min(Math.max(at.y - RING_LIFT, RING_R + pad), vp.h - pad);
  const n = RING_ORDER.length;
  return RING_ORDER.map((_, i) => {
    const a = ((-160 + (140 * i) / (n - 1)) * Math.PI) / 180;
    return { x: cx + RING_R * Math.cos(a), y: cy + RING_R * Math.sin(a) };
  });
}

/** Что делает касание гнезда: «i» — сведения, погашенное — подсказка «почему», горящее — дела этого человека у цели. */
export function ringTap(
  slot: RingSlot,
  ring: RingState,
  el: Element,
  g: Pick<WorldStore, 'ringInfo' | 'closeRing' | 'openChase' | 'openMenu'> = useWorld.getState(),
): void {
  if (slot.id === 'info') return g.ringInfo(true);
  if (!slot.on || !slot.agent) return tipAt(el, { title: `${slot.label}: сейчас нельзя`, body: slot.why ?? undefined });
  g.closeRing();
  if (ring.goal.kind === 'march' && ring.march) void g.openChase(ring.march, slot.agent);
  else void g.openMenu(slot.agent, ring.cell);
}

const est = (e: Estimate): string => (e.precision === 'unknown' ? '?' : formatEstimate(e));

export function RingLayer({ at, vp }: { at: { x: number; y: number } | null; vp: { w: number; h: number } }) {
  const ring = useWorld((g) => g.ring);
  const figures = useWorld((g) => g.figures);
  const marches = useWorld((g) => g.marches);
  const s = useGame((g) => g.s);
  if (!ring) return null;
  if (ring.info) return <Brief />;
  if (!at) return null;
  const rival = Boolean(ring.card?.castle && !ring.card.mine);
  const muster = musterable(figures.find((f) => f.id === 'general'), roomOf(s.army, marches ?? []));
  const slots = ringSlots(ring.goal, ring.deeds, figures, (a) => hireWhere(s, a), rival, muster);
  const places = ringPlaces(at, vp);

  return (
    <div className="rg-layer" aria-label={`Кого послать: ${ring.name}`}>
      <span className="rg-name one-line" style={{ left: places[1].x / 2 + places[2].x / 2, top: Math.max(4, places[1].y - RING_BTN / 2 - 30) }}>
        {ring.name}
      </span>
      {slots.map((slot, i) => (
        <button
          key={slot.id}
          type="button"
          className={`rg-btn${slot.on ? '' : ' off'}${slot.id === 'info' ? ' info' : ''}`}
          style={{ left: places[i].x - RING_BTN / 2, top: places[i].y - RING_BTN / 2 }}
          aria-label={slot.on ? slot.label : `${slot.label}: ${slot.why ?? 'нельзя'}`}
          aria-disabled={!slot.on}
          data-slot={slot.id}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => ringTap(slot, ring, e.currentTarget)}
        >
          <Icon name={slot.icon} />
        </button>
      ))}
    </div>
  );
}

/** Сведения «i»: что за место, чьё, мощь, жители, добыча, осада; отряд — откуда, куда, когда дойдёт. Без прокрутки. */
export function Brief() {
  const ring = useWorld((g) => g.ring);
  if (!ring) return null;
  const card = ring.card;
  const march = ring.march;
  const g = useWorld.getState();
  const back = (): void => g.ringInfo(false);
  const close = (): void => g.closeRing();
  const kind = march
    ? 'Отряд в пути'
    : !card
      ? 'Считаем…'
      : card.mine
        ? 'Свой город'
        : card.ruin
          ? 'Пепелище'
          : card.castle
            ? 'Город соседа'
            : STAGE_BY_ID[card.stage].name;
  const facts: [string, string][] = march
    ? [
        ['Откуда', march.fromName],
        ['Куда', march.toName],
        ['Дойдут', `через ${realLeft(secondsLeft(march.arriveAt, worldNow()))}`],
      ]
    : card
      ? [
          ['Мощь', est(card.power)],
          ['Жители', est(card.pop)],
          [card.mine ? 'На складе' : 'Добыча', est(card.loot)],
        ]
      : [];
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="panel nx-bpanel nx-am rg-brief">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name="ui-info" />
          </span>
          <div className="nx-btitle">
            <b className="one-line">{ring.name}</b>
            <span className="nx-blvl">
              {kind}
              {card && !card.mine && !card.ruin && (
                <>
                  {' · '}
                  <span style={{ color: RELATION_META[card.relation].color }}>{RELATION_META[card.relation].name}</span>
                </>
              )}
              {' · '}
              {formatCoord(ring.cell)}
            </span>
          </div>
          <button className="nx-bclose" onClick={close} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="rg-facts">
          {facts.map(([k, v]) => (
            <div key={k} className="er-line">
              <span className="muted">{k}</span>
              <b>{v}</b>
            </div>
          ))}
          {card?.owner && !card.mine && (
            <div className="er-line">
              <span className="muted">Правитель</span>
              <b className="one-line">{card.owner}</b>
            </div>
          )}
          {card?.siege && (
            <div className="er-line">
              <span className="muted">Осада</span>
              <b className="bad one-line">{card.siege.mine ? `наш лагерь · ${FATE_META[card.siege.fate].name}` : `${card.siege.byName} у ворот`}</b>
            </div>
          )}
          {card && !card.mine && <p className="nx-tnote">{card.intel ? 'Числа — по донесению.' : 'Сведений нет: числа узнает разведчик или лазутчик (глаз).'}</p>}
        </div>
        <div className="nx-am-foot">
          <button className="nx-go nx-go-ghost" onClick={back}>
            Назад
          </button>
          {!march && (
            <button
              className="nx-go nx-go-ghost"
              onClick={() => {
                close();
                void g.select(ring.cell);
              }}
            >
              Вся карточка
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default RingLayer;
