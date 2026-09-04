// Подготовка похода и оборона поселения — одна панель. Разница между ними в
// двух вещах: у похода есть цель, дорога и кнопка «отправить», у обороны —
// таймер прибытия и заморозка за пять минут. Всё остальное — состав,
// расстановка, план, приказы, резерв — одно и то же, и разводить это по двум
// экранам значило бы держать две копии одной панели.
//
// Прогноза исхода здесь нет. Ни шансов, ни предварительного расчёта: игрок не
// знает плана и резерва противника, и вся неопределённость держится на этом.
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, defenseLock, worldNow } from '@/world/store';
import { defense, homeArmy, soldierPower } from '@/game/derived';
import { homeTroops, militiaMen } from '@/world/bridge';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { formatCoord, formatLeft, marchSeconds, secondsLeft } from '@/world/geo';
import { CASTLE_ICON, RELATION_META, STAGE_BY_ID } from '@/world/data/meta';
import {
  applyTemplate,
  cloneFormation,
  kindsPresent,
  placedTroops,
  presetFormation,
  TEMPLATES_MAX,
  stashUnplaced,
  toArmySetup,
  unplacedTroops,
  type Formation,
} from '@/game/battle/formation';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { deleteTemplate, saveTemplate, setDefenseFormation } from '@/game/battle/actions';
import type { Sector } from '@/battle';
import type { TroopId } from '@/game/types';
import { FormationGrid } from '../battle/FormationGrid';
import { SectorEditor } from '../battle/SectorEditor';
import { OrdersPicker, PlanPicker, ReservePicker } from '../battle/Tactics';
import { IntelCard } from '../battle/IntelCard';

const fmt = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString());

const troopsLine = (t: TroopStack): string =>
  TROOP_IDS.filter((id) => (t[id] ?? 0) > 0)
    .map((id) => `${TROOP_BY_ID[id].icon}${t[id]}`)
    .join(' ') || '—';

/** Расстановка со всем, что игрок не разложил, — в резерв: армия не теряется. */
const settled = (f: Formation, rest: TroopStack): Formation =>
  troopTotal(rest) > 0 ? stashUnplaced(f, rest) : f;

interface Props {
  /** Цель похода. Пусто — оборона своей деревни. */
  targetId?: string;
}

export function BattlePanel({ targetId }: Props) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const showToast = useGame((g) => g.showToast);
  const openWorldTile = useGame((g) => g.openWorldTile);
  const card = useWorld((g) => g.card);
  const send = useWorld((g) => g.send);
  const marches = useWorld((g) => g.marches);
  const attack = Boolean(targetId);

  const home = useMemo(() => homeTroops(s), [s]);
  const lock = defenseLock(marches, worldNow());

  const [picked, setPicked] = useState<TroopStack>(() => (attack ? { ...home } : home));
  const [formation, setFormation] = useState<Formation>(() =>
    attack ? presetFormation(home, 'standard') : (s.defenseFormation ?? presetFormation(home, 'defense')),
  );
  const [sel, setSel] = useState<Sector | 'rest' | null>(null);
  const [busy, setBusy] = useState(false);

  // Оборона правится «на месте»: у неё нет кнопки «отправить», и настройка,
  // не доехавшая до сохранения, пропала бы при закрытии шторки.
  useEffect(() => {
    if (attack || lock.frozen) return;
    act((g) => setDefenseFormation(g, formation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formation, attack, lock.frozen]);

  const unplaced = unplacedTroops(picked, formation);
  const placed = placedTroops(formation);
  const sent = troopTotal(picked);
  const locked = !attack && lock.frozen;

  const setPick = (t: TroopId, n: number): void => {
    const max = home[t] ?? 0;
    const next = { ...picked, [t]: Math.max(0, Math.min(max, n)) };
    setPicked(next);
    // Убрали больше, чем лежит вне схемы, — снимаем и с расстановки.
    if ((next[t] ?? 0) < (placed[t] ?? 0)) {
      const f = cloneFormation(formation);
      let over = (placed[t] ?? 0) - (next[t] ?? 0);
      for (const id of ['R', 'F', 'D', 'E', 'C', 'A', 'B'] as Sector[]) {
        if (over <= 0) break;
        const have = f.sectors[id][t] ?? 0;
        const take = Math.min(have, over);
        if (take > 0) {
          f.sectors[id][t] = have - take;
          over -= take;
        }
      }
      setFormation(f);
    }
  };

  const place = (t: TroopId, n: number): void => {
    if (locked || sel === null || sel === 'rest') return;
    const f = cloneFormation(formation);
    f.sectors[sel][t] = Math.max(0, n);
    setFormation(f);
  };

  /**
   * Тап по клетке. «Не расставлены» — не сектор, а остаток: открывать над ним
   * степперы бессмысленно (забирать оттуда некуда), поэтому тап по нему просто
   * убирает остаток в резерв — то же, что случится при отправке, но видимо.
   */
  const pick = (id: Sector | 'rest'): void => {
    if (id === 'rest') {
      if (!locked && troopTotal(unplaced) > 0) setFormation(stashUnplaced(formation, unplaced));
      setSel(null);
      return;
    }
    setSel(sel === id ? null : id);
  };

  const applyPreset = (): void => {
    setFormation(presetFormation(picked, attack ? 'standard' : 'defense'));
    setSel(null);
  };

  const doSend = async (): Promise<void> => {
    const final = settled(formation, unplaced);
    const troops = placedTroops(final);
    const men = troopTotal(troops);
    if (men === 0) {
      showToast('Отряд пустой.');
      return;
    }
    setBusy(true);
    const err = await send({
      target: targetId as string,
      mission: 'raid',
      units: { warrior: men },
      troops,
      setup: toArmySetup(final),
    });
    setBusy(false);
    if (err) {
      showToast(err);
      return;
    }
    showToast('Отряд вышел.');
    if (card) openWorldTile(card.x, card.y);
  };

  // ---------- Шапка ----------

  const strength = soldierPower(s);
  const def = defense(s);
  const defAfter = Math.max(0, def - sent * strength);
  const eta = card ? marchSeconds(card.distance, card.terrainFactor, { warrior: Math.max(1, sent) }) : 0;
  const stage = card ? STAGE_BY_ID[card.stage] : null;

  const head = attack ? (
    <div className="bhead">
      <div className="ico">{card?.castle ? CASTLE_ICON : (stage?.icon ?? '⚔️')}</div>
      <div className="body">
        <div className="name">Поход на {card?.name ?? 'цель'}</div>
        <div className="lvl">
          {card?.castle ? 'Замок' : (stage?.name ?? '')} ·{' '}
          {card && <span style={{ color: RELATION_META[card.relation].color }}>{RELATION_META[card.relation].name}</span>}
        </div>
      </div>
      {card && <span className="wm-coord-tag">{formatCoord(card)}</span>}
    </div>
  ) : (
    <div className="bhead">
      <div className="ico">🏠</div>
      <div className="body">
        <div className="name">Оборона деревни</div>
        <div className="lvl">
          гарнизон {homeArmy(s)} · ополчение {militiaMen(s)}
        </div>
      </div>
    </div>
  );

  return (
    <div className="panel">
      {head}

      {!attack && lock.march && (
        <div className={`card ${locked ? 'danger' : ''}`}>
          <div className="ico">{locked ? '🔒' : '⚠️'}</div>
          <div className="body">
            <div className="title">
              {lock.march.fromName}
              <span className="count">{formatLeft(secondsLeft(lock.march.arriveAt, worldNow()))}</span>
            </div>
            <div className="desc">
              {locked
                ? 'Оборона заперта: меньше пяти минут до удара, строй уже не переставить.'
                : 'Чужая армия в пути. Менять оборону можно до отметки «минус 5 минут».'}
            </div>
          </div>
        </div>
      )}

      {attack && <IntelCard intel={card?.intel ?? null} name={card?.name ?? 'это место'} />}

      <h3>
        Состав <small>{attack ? `дома ${homeArmy(s)}` : 'весь гарнизон'}</small>
      </h3>
      {troopTotal(home) === 0 ? (
        <div className="desc">Бойцов дома нет. Найми кого-нибудь в казармах.</div>
      ) : attack ? (
        TROOP_IDS.filter((t) => (home[t] ?? 0) > 0).map((t) => {
          const d = TROOP_BY_ID[t];
          const n = picked[t] ?? 0;
          const max = home[t] ?? 0;
          return (
            <div className="slot pick" key={t}>
              <span className="ico">{d.icon}</span>
              <span className="who">
                {d.name}
                <i className="talent"> дома {max}</i>
              </span>
              <div className="stepper">
                <button disabled={n <= 0} onClick={() => setPick(t, n - 1)}>
                  −
                </button>
                <span className="n">{n}</span>
                <button disabled={n >= max} onClick={() => setPick(t, n + 1)}>
                  +
                </button>
              </div>
              <button className="mini text" disabled={n >= max} onClick={() => setPick(t, max)}>
                все
              </button>
            </div>
          );
        })
      ) : (
        <div className="mod-list">
          {TROOP_IDS.filter((t) => (home[t] ?? 0) > 0).map((t) => (
            <div className="mod" key={t}>
              <span className="ico">{TROOP_BY_ID[t].icon}</span>
              <span className="name">{TROOP_BY_ID[t].name}</span>
              <span className="val">{home[t]}</span>
            </div>
          ))}
          <div className="mod total">
            <span className="ico">🪵</span>
            <span className="name">Ополчение (частокол и жители)</span>
            <span className="val">{militiaMen(s)}</span>
          </div>
        </div>
      )}

      {attack && (
        <div className="mod-list">
          <div className="mod">
            <span className="ico">⏱</span>
            <span className="name">Дорога туда</span>
            <span className="val">{sent > 0 ? formatLeft(eta) : '—'}</span>
          </div>
          <div className="mod total">
            <span className="ico">🏠</span>
            <span className="name">Оборона деревни станет</span>
            <span className={`val ${defAfter < def * 0.5 ? 'neg' : ''}`}>
              {fmt(def)} → {fmt(defAfter)}
            </span>
          </div>
        </div>
      )}

      <h3>
        Расстановка{' '}
        <button className="mini text" disabled={locked} onClick={applyPreset}>
          разложить заново
        </button>
      </h3>
      <FormationGrid
        formation={formation}
        unplaced={unplaced}
        selected={sel}
        onSelect={pick}
      />
      {sel !== null && !locked && (
        <SectorEditor
          sector={sel}
          here={sel === 'rest' ? unplaced : formation.sectors[sel]}
          free={sel === 'rest' ? {} : unplaced}
          onChange={place}
          onClose={() => setSel(null)}
        />
      )}
      {sel !== null && locked && <p className="note bad">Оборона заперта — расстановку уже не изменить.</p>}

      <h3>План боя</h3>
      <PlanPicker
        value={formation.plan}
        onChange={(plan) => !locked && setFormation({ ...cloneFormation(formation), plan })}
      />

      <h3>Приказы</h3>
      <OrdersPicker
        kinds={kindsPresent(placed)}
        orders={formation.orders}
        onChange={(orders) => !locked && setFormation({ ...cloneFormation(formation), orders })}
      />

      <h3>Резерв входит</h3>
      <ReservePicker
        value={formation.reserve}
        onChange={(reserve) => !locked && setFormation({ ...cloneFormation(formation), reserve })}
      />

      {attack && (
        <>
          <h3>
            Схемы <small>{(s.battlePlans ?? []).length}/{TEMPLATES_MAX}</small>
          </h3>
          {(s.battlePlans ?? []).length === 0 ? (
            <div className="desc">Схем нет. Сохрани нынешнюю — и следующий поход уйдёт в два нажатия.</div>
          ) : (
            (s.battlePlans ?? []).map((tpl) => (
              <div className="card" key={tpl.id}>
                <div className="ico">📋</div>
                <div className="body">
                  <div className="title">{tpl.name}</div>
                  <div className="desc">{troopsLine(tpl.troops)}</div>
                  <div className="cost">
                    <button
                      className="mini text"
                      onClick={() => {
                        const out = applyTemplate(tpl, home);
                        setPicked(out.troops);
                        setFormation(out.formation);
                        setSel(null);
                        if (out.short) showToast('Дома нашлись не все — взяли сколько есть.');
                      }}
                    >
                      Взять
                    </button>
                    <button className="mini text" onClick={() => act((g) => deleteTemplate(g, tpl.id))}>
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
          <button
            className="btn ghost wide"
            onClick={() => act((g) => saveTemplate(g, settled(formation, unplaced)))}
          >
            💾 Сохранить нынешнюю схему
          </button>

          <button className="btn wide" disabled={busy || sent === 0} onClick={() => void doSend()}>
            ⚔️ Отправить {troopsLine(picked)}
          </button>
        </>
      )}

      {!attack && (
        <p className="note">
          Так деревня встретит следующий набег. Ополчение — частокол, башня и сами жители — встаёт во фронт
          само, расставлять его не нужно.
        </p>
      )}
    </div>
  );
}

export function DefensePanel() {
  return <BattlePanel />;
}
