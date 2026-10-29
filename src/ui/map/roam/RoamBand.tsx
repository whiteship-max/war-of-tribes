// Окно «Отряд» бродяги (ПН-6, docs/gdd/path_of_sword.md, 3.3, 3.4.2, 3.4.5, 5.2): строки видов — сколько в строю, раненых и на
// учениях; касание вида — карточка: повысить (куда и почём), разжаловать (что ляжет в обоз), распустить; жалованье отряда было → станет
// функцией ведомости (`roamrules.bandWagesPerDay`, правило 18). Ниже — пленные «Принять в отряд» и раненые «Поднять сейчас» за алмазы.
// Своей арифметики нет: цена и можно ли — `sim/bandranks` и `promoterules`. Своим куском карты бродяги (в первую загрузку не едет).
//
// Панель «Дружины» лорда (`ArmyPanel`) здесь не берётся: она в главном куске, и развилка по фазе в ней везла бы код пути в первую
// загрузку (ВП1); строки окна — те же строки, что у окна хода и лагеря (`roam-leg`).
import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { troopTotal } from '@/game/battle/kinds';
import { num } from '@/game/num';
import { bandWagesPerDay, woundedOf } from '@/game/roamrules';
import { demoteKit, demoteTargets, promoteBill, promoteTargets } from '@/game/promoterules';
import { captivesNow, demoteBand, dismissBand, freeCaptives, promoteBand, promoteBlock, takeCaptives } from '@/game/sim/bandranks';
import { roamDoor } from '@/game/roamlazy';
import { worldNow } from '@/world/store';
import { HealRows } from '@/ui/next/Heal';
import { Icon } from '@/ui/icons/Icon';
import { useTwoTap } from '@/ui/kit/twotap';

const kitWords = (kit: Partial<Record<string, number>>): string =>
  Object.entries(kit)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([e, n]) => `${EQUIPMENT_BY_ID[e as keyof typeof EQUIPMENT_BY_ID].name.toLowerCase()} ${n}`)
    .join(', ');

/** Сделать дело отряда и отправить приказ книги (ПН-6: очередь — `net/bandbook`). */
function useBandAct(): (fn: Parameters<ReturnType<typeof useGame.getState>['act']>[0]) => void {
  const act = useGame((g) => g.act);
  return (fn) => {
    if (act(fn)) void roamDoor()?.flushBook();
  };
}

export function RoamBand({ onClose }: { onClose: () => void }) {
  const r = useGame((g) => g.s.roam);
  const [kind, setKind] = useState<TroopId | null>(null);
  const run = useBandAct();
  if (!r) return null;
  const now = worldNow();
  const hurt = woundedOf(r);
  const drill: Partial<Record<TroopId, number>> = {};
  for (const d of r.drill ?? []) drill[d.kind] = (drill[d.kind] ?? 0) + d.n;
  const kinds = TROOP_IDS.filter((id) => (r.band[id] ?? 0) + (hurt[id] ?? 0) + (drill[id] ?? 0) > 0);
  const captives = captivesNow(useGame.getState().s, now);
  const gear = kitWords(r.gear);
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel nx-bpanel nx-am">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name="ui-banner" />
          </span>
          <div className="nx-btitle">
            <b className="one-line">Отряд · {troopTotal(r.band)} чел.</b>
            <span className="nx-blvl">
              кошель {Math.floor(r.purse)} · жалованье {num(bandWagesPerDay(r.band), 1)} в игр. день
            </span>
          </div>
          <button className="nx-bclose" onClick={onClose} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="nx-am-body er-confirm">
          {gear && <p className="nx-tnote">Снаряжение в обозе: {gear}.</p>}
          {captives !== null && (
            <div className="roam-legs">
              <button className="roam-leg on" onClick={() => run((st) => takeCaptives(st, worldNow()))}>
                <b>Пленные: {captives}</b>
                <span>Принять в отряд</span>
                <small className="muted">встанут дубинщиками — жалованье и паёк как у всех</small>
              </button>
              <button className="roam-leg" onClick={() => run((st) => (freeCaptives(st), null))}>
                <b>Отпустить пленных</b>
                <span />
              </button>
            </div>
          )}
          <div className="roam-legs">
            {kinds.map((id) => (
              <button key={id} className={`roam-leg${kind === id ? ' on' : ''}`} onClick={() => setKind(kind === id ? null : id)}>
                <b>{TROOP_BY_ID[id].name}</b>
                <span>{r.band[id] ?? 0}</span>
                <small className="muted">
                  {[(hurt[id] ?? 0) > 0 ? `раненых ${hurt[id]}` : '', (drill[id] ?? 0) > 0 ? `на учениях ${drill[id]}` : ''].filter(Boolean).join(' · ') || 'в строю'}
                </small>
              </button>
            ))}
          </div>
          {kind && (r.band[kind] ?? 0) > 0 && <KindRows kind={kind} now={now} run={run} />}
          <HealRows groups={r.wounded} />
        </div>
        <div className="nx-am-foot">
          <button className="nx-go nx-go-ghost" onClick={onClose}>
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}

/** Карточка вида: повысить, разжаловать, распустить — по одному бойцу или всех. */
function KindRows({ kind, now, run }: { kind: TroopId; now: number; run: ReturnType<typeof useBandAct> }) {
  const s = useGame((g) => g.s);
  const r = s.roam!;
  const have = r.band[kind] ?? 0;
  const [all, setAll] = useState(false);
  const [armed, arm, disarm] = useTwoTap();
  const n = all ? have : 1;
  const wagesWith = (from: TroopId, to: TroopId | null): string => {
    const band = { ...r.band, [from]: have - n, ...(to ? { [to]: (r.band[to] ?? 0) + n } : {}) };
    return `${num(bandWagesPerDay(r.band), 1)} → ${num(bandWagesPerDay(band), 1)}`;
  };
  return (
    <>
      <div className="roam-legs">
        <button className={`roam-leg${!all ? ' on' : ''}`} onClick={() => setAll(false)}>
          <b>Одного</b>
          <span />
        </button>
        <button className={`roam-leg${all ? ' on' : ''}`} onClick={() => setAll(true)}>
          <b>Всех: {have}</b>
          <span />
        </button>
      </div>
      <div className="roam-legs">
        {promoteTargets(kind).map((to) => {
          const bill = promoteBill(kind, to, n, r.gear);
          const why = promoteBlock(s, kind, to, n, now);
          const kit = bill ? kitWords(bill.fromCargo) : '';
          return (
            <button key={to} className="roam-leg" disabled={why !== null} onClick={() => run((st) => promoteBand(st, kind, to, n, worldNow()))}>
              <b>Повысить в {TROOP_BY_ID[to].name.toLowerCase()}</b>
              <span>
                <Icon name="res-gold" />
                {bill?.gold ?? 0}
              </span>
              <small className="muted">{why ?? `${kit ? `из обоза — ${kit}; ` : ''}жалованье отряда ${wagesWith(kind, to)}`}</small>
            </button>
          );
        })}
        {demoteTargets(kind).map((to) => (
          <button key={to} className="roam-leg" onClick={() => run((st) => demoteBand(st, kind, to, n, worldNow()))}>
            <b>Разжаловать в {TROOP_BY_ID[to].name.toLowerCase()}</b>
            <span />
            <small className="muted">в обоз — {kitWords(demoteKit(kind, to, n) ?? {})}; золото не вернётся</small>
          </button>
        ))}
        <button
          className={`roam-leg${armed ? ' on' : ''}`}
          onClick={() => {
            if (!armed) return arm();
            disarm();
            run((st) => dismissBand(st, kind, n));
          }}
        >
          <b>{armed ? 'Точно?' : `Распустить ${n}`}</b>
          <span />
          <small className="muted">снаряжение — в обоз; жалованье отряда {wagesWith(kind, null)}</small>
        </button>
      </div>
    </>
  );
}
