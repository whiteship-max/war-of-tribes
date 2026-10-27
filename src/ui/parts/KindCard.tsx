// Карточка вида поверх меню «Дружины» (ДР-8, docs/ui_v2.md, «Решения ДР-8»): касание плитки состава открывает её над окном —
// сколько бойцов дома и в походе, жалованье вида и роспуск: число шагом «− / +» и быстрыми 1, 10, 100, «Все дома», что
// вернётся и каким станет жалованье дружины, «Распустить» — двумя касаниями. Вся карточка вида со статами — дверью «Всё о
// виде» (`TroopCardView`, ДР-6). Своей арифметики нет: можно ли и сколько — `sim/upkeep.dismissCheck`, что вернётся —
// `dismissReturns`, жалованье — `derived.armyWagesPerDay` той же партии с другим числом вида; роспуск — `dismissSoldiers`.
//
// Поверх всего — порталом: шторка ездит `transform`, и `position: fixed` внутри неё встал бы в шторке (как `ShareSheet`).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameState, TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOP_BY_ID } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { armyWagesPerDay, wageOf } from '@/game/derived';
import { troopCard } from '@/game/battle/describe';
import { dismissCheck, dismissReturns, dismissSoldiers } from '@/game/sim/upkeep';
import { num } from '@/game/num';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';
import { Btn, Num } from '@/ui/kit';
import { fmtInt } from '@/ui/next/hudTips';
import { Leave } from './leave';
import { woundedOf } from './ArmyDesk';

/** Быстрые числа роспуска; «Все дома» — четвёртой кнопкой. */
export const QUICK = [1, 10, 100] as const;

/** Сколько распустить на деле: выбор, зажатый в «один … сколько дома». Дома никого — один (кнопку гасит причина). */
export const dismissPick = (n: number, home: number): number => Math.max(1, Math.min(Math.max(1, home), Math.floor(n)));

/** Жалованье дружины в день, если вида `troop` станет `left`, — той же функцией, что ведомость. */
const wageWith = (s: GameState, troop: TroopId, left: number): number => armyWagesPerDay({ ...s, army: { ...s.army, [troop]: left } });

export interface KindCardProps {
  s: GameState;
  troop: TroopId;
  /** Выбор игрока; на экране и в деле — `dismissPick` от него. */
  n: number;
  onCount: (n: number) => void;
  onDismiss: (n: number) => void;
  onMore: () => void;
  onClose: () => void;
}

/** Тело карточки без своего состояния: число держит `KindCard`, тело только показывает и зовёт (тест жмёт без браузера). */
export function KindCardBody({ s, troop, n, onCount, onDismiss, onMore, onClose }: KindCardProps) {
  const def = TROOP_BY_ID[troop];
  const { meta, weight } = troopCard(troop);
  const have = Math.max(0, s.army[troop] ?? 0);
  const home = dismissCheck(s, troop, 1).max;
  const hurt = woundedOf(s)[troop] ?? 0;
  const k = dismissPick(n, home);
  const check = dismissCheck(s, troop, k);
  const gone = check.blocked ? 0 : k;
  const back = dismissReturns(troop, gone);
  const now = armyWagesPerDay(s);
  const after = wageWith(s, troop, have - gone);
  // Жалованье вида — на сколько ведомость дружины легче без него.
  const mine = now - wageWith(s, troop, 0);
  return (
    <div className="modal dr-card" role="dialog" aria-label={def.name} onClick={(e) => e.stopPropagation()}>
      <div className="dr-card-head">
        <span className="dr-card-ico">
          <Icon name={iconName('troop', troop)} />
        </span>
        <div className="dr-card-title">
          <b className="one-line">{def.name}</b>
          <small className="one-line">
            {meta.name} · мощь {num(weight.power, 1)}
          </small>
        </div>
        <button type="button" className="kit-close" onClick={onClose} aria-label="Закрыть">
          <Icon name="ui-close" />
        </button>
      </div>

      <div className="ms-sum dr-card-sum">
        <Num label="Дома" tip={() => ({ title: `Дома · ${fmtInt(home)}`, body: 'В городе, в обороне. Распускают только их.' })}>
          <small>Дома</small>
          <b>{fmtInt(home)}</b>
        </Num>
        <Num label="В походе" tip={() => ({ title: `В походе · ${fmtInt(have - home)}`, body: 'Вне стен: в обороне их нет, распустить — когда вернутся.' })}>
          <small>В походе</small>
          <b>{fmtInt(have - home)}</b>
        </Num>
        {hurt > 0 && (
          <Num label="Раненые" tone="warn" tip={() => ({ title: `Раненые · ${fmtInt(hurt)}`, body: 'В лазарете и в обозе отряда: встанут — вернутся в строй.' })}>
            <small>Раненые</small>
            <b>{fmtInt(hurt)}</b>
          </Num>
        )}
        <Num label="Жалованье в день" tip={() => ({ title: `Жалованье · ${num(mine, 1)} в день`, body: `Жалованье одного — ${num(wageOf(s, troop), 1)} золота в день при полном.` })}>
          <small>Жалованье</small>
          <b>
            <Icon name="res-gold" /> {fmtInt(Math.round(mine))}
          </b>
        </Num>
      </div>
      <div className="dr-card-more">
        <Btn kind="link" onClick={onMore}>
          Всё о виде <i aria-hidden="true">›</i>
        </Btn>
      </div>

      <div className="dr-dis">
        <div className="stepper wide-steps dr-steps">
          <button type="button" disabled={k <= 1} onClick={() => onCount(k - 1)} aria-label="Меньше">
            −
          </button>
          <span className="n dr-n">{fmtInt(k)}</span>
          <button type="button" disabled={k >= home} onClick={() => onCount(k + 1)} aria-label="Больше">
            +
          </button>
        </div>
        <div className="dr-quick" role="group" aria-label="Сколько распустить">
          {QUICK.map((q) => (
            <button type="button" key={q} className={`dr-chip${k === q && home > 0 ? ' on' : ''}`} aria-pressed={k === q && home > 0} disabled={q > home} onClick={() => onCount(q)}>
              {q}
            </button>
          ))}
          <button type="button" className={`dr-chip${k === home && home > 0 ? ' on' : ''}`} aria-pressed={k === home && home > 0} disabled={home < 1} onClick={() => onCount(home)}>
            Все дома
          </button>
        </div>
        {gone > 0 && (
          <dl className="dr-back">
            <div>
              <dt>Вернётся</dt>
              <dd>
                <span className="dr-got" title="Жители">
                  <Icon name="hud-pop" />+{fmtInt(back.people)}
                </span>
                {Object.entries(back.gear).map(([id, g]) => (
                  <span className="dr-got" key={id} title={EQUIPMENT_BY_ID[id as keyof typeof EQUIPMENT_BY_ID]?.name ?? id}>
                    <Icon name={iconName('gear', id)} />+{fmtInt(g ?? 0)}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt>Дружине</dt>
              <dd>
                <Icon name="res-gold" /> {num(now, 1)} → <b>{num(after, 1)}</b> <small>в день</small>
              </dd>
            </div>
          </dl>
        )}
        <Btn kind="main" wide confirm why={check.blocked} onClick={() => onDismiss(k)}>
          Распустить {fmtInt(k)}
        </Btn>
      </div>
    </div>
  );
}

/** Карточка вида партии из стора: число роспуска держит она; распустили всех — карточка закрывается. */
function KindCardLive({ troop, onClose, onMore }: { troop: TroopId; onClose: () => void; onMore: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [n, setN] = useState(1);
  const dismiss = (k: number): void => {
    if (!act((st) => dismissSoldiers(st, troop, k))) return;
    setN(1);
    const left = useGame.getState().s;
    if ((left.army[troop] ?? 0) <= 0 && !(woundedOf(left)[troop] ?? 0)) onClose();
  };
  return <KindCardBody s={s} troop={troop} n={n} onCount={setN} onDismiss={dismiss} onMore={onMore} onClose={onClose} />;
}

/**
 * Слой карточки: пока вид выбран — карточка над меню, закрыли — тает (`Leave`). Касание мимо карточки закрывает её. Без
 * документа (отрисовка в строку в тестах) слоя нет: портал рисуется только в браузере.
 */
export function KindCard({ troop, onClose, onMore }: { troop: TroopId | null; onClose: () => void; onMore: (t: TroopId) => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <Leave open={troop !== null}>
      {troop && (
        <div
          className="modal-backdrop dr-card-back"
          onClick={(e) => {
            // Портал отдаёт касание и предкам в дереве React (шторке): дальше карточки оно не идёт.
            e.stopPropagation();
            onClose();
          }}
        >
          <KindCardLive key={troop} troop={troop} onClose={onClose} onMore={() => onMore(troop)} />
        </div>
      )}
    </Leave>,
    document.body,
  );
}
