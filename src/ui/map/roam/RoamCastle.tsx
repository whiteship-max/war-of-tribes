// Окно вольного замка (ПН-10, docs/gdd/path_of_sword.md, 3.11, 5.4): гарнизон по сведениям, доступ по престижу, «что нужно, чтобы
// взять», участь и два пути — штурм с ходу и осада; в лагере — фаза, проломы, прогноз голода (голод не сдаёт замок — гарнизон выйдет
// в последнюю вылазку), «Штурмовать», «Отступить», дань кастеляна. Замок взят — «Замок взят» с участью; «Сесть в замке» погашена до
// перехода (ПН-11). Числа — функциями мира (правило 18): окно — `WorldApi.roamFree`, приказы — `roamSiege`, `roamSiegeOrder`. Кнопок
// сдачи и подкупа нет: замок берут только мечом (решение В6).
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { worldApi } from '@/world/api';
import { worldNow } from '@/world/store';
import type { Fate, FreeCastleView } from '@/world/types';
import { FATE_META } from '@/world/data/fates';
import { realSpan } from '@/game/span';
import { Icon } from '@/ui/icons/Icon';

/** Переход в замок — следующая пачка (ПН-11): кнопка видна, но погашена с причиной. */
export const SEAT_LATER = 'Сесть в замке — в следующей пачке: переход бродяги в лорда (ПН-11).';

const END_WORDS: Record<string, string> = {
  taken: 'Замок взят.',
  beaten: 'Штурм отбит.',
  lifted: 'Осада снята: вылазка прорвала лагерь.',
  gone: 'Замок взял другой отряд — лагерь снят без потерь.',
  paid: 'Кастелян откупился — осада снята.',
  retreat: 'Отряд отступил.',
};

const spanTo = (at: number | null, now: number): string => (at === null ? '—' : at <= now ? 'сейчас' : realSpan(Math.ceil((at - now) / 1000)));

export function RoamCastle({ id, onClose }: { id: string; onClose: () => void }) {
  const [v, setV] = useState<FreeCastleView | string | null>(null);
  const [fate, setFate] = useState<Fate>('occupy');
  const [busy, setBusy] = useState(false);
  const showToast = useGame((g) => g.showToast);
  const castle = useGame((g) => g.s.roam?.castle ?? null);
  const read = (): void => {
    void worldApi()
      .roamFree?.(id)
      .then(setV);
  };
  useEffect(read, [id]);
  const act = (p: Promise<string | null> | undefined): void => {
    if (!p) return;
    setBusy(true);
    void p.then((why) => {
      setBusy(false);
      if (why) showToast(why);
      read();
    });
  };
  const now = worldNow();
  const view = typeof v === 'object' ? v : null;
  const live = view?.siege && (view.siege.phase === 'march' || view.siege.phase === 'camp') ? view.siege : null;
  const mine = view?.held === 'mine' && castle?.id === id ? castle : null;
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel nx-bpanel nx-am">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name="ui-banner" />
          </span>
          <div className="nx-btitle">
            <b className="one-line">{view ? view.name : 'Вольный замок'}</b>
            <span className="nx-blvl">{view ? `${view.tierWords} · кастелян ${view.castellan}` : ''}</span>
          </div>
          <button className="nx-bclose" onClick={onClose} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="nx-am-body er-confirm">
          {v === null && <p className="nx-tnote">Смотрим на стены и прикидываем дело…</p>}
          {typeof v === 'string' && <p className="nx-tnote">{v}</p>}
          {view && mine && (
            <div className="roam-legs">
              <p className="nx-tnote">
                <b>Замок взят:</b> {view.name} — «{FATE_META[mine.fate].name}». Замок держится за отрядом, пока он не сядет в нём.
              </p>
              <button className="nx-go" disabled title={SEAT_LATER}>
                Сесть в замке
              </button>
              <small className="muted">{SEAT_LATER}</small>
            </div>
          )}
          {view && !mine && (
            <div className="roam-legs">
              <div className="roam-leg roam-row">
                <span>{view.garrison.watching ? 'Гарнизон — видим стены' : 'Гарнизон издали — не больше правила ступени'}</span>
                <b>{view.garrison.lo === view.garrison.hi ? view.garrison.hi : `${view.garrison.lo}–${view.garrison.hi}`} · строй замка</b>
              </div>
              <p className="nx-tnote">Что нужно, чтобы взять:</p>
              {view.needs.map((n) => (
                <div key={n.text} className={`roam-leg roam-row${n.ok ? '' : ' roam-short'}`}>
                  <Icon name={n.ok ? 'ui-up' : 'ui-close'} />
                  <span>{n.text}</span>
                </div>
              ))}
              <p className="nx-tnote">
                Только мечом: штурм с ходу — стена и лестницы; осада — фазы, машины, обстрел; когда хлеб кончится, гарнизон не сдастся, а
                выйдет в последнюю вылазку — отбили её, замок наш.
              </p>
              {live && (
                <div className="roam-legs">
                  <p className="nx-tnote">
                    <b>{live.phase === 'march' ? 'Отряд подходит к стенам' : `Наш лагерь: фаз ${live.phases}, проломов ${live.breaches}`}</b>
                    {live.phase === 'camp' && live.starvesAt !== null && ` · хлеб кончится через ${spanTo(live.starvesAt, now)}`}
                    {` · в лагере ${live.men}`}
                  </p>
                  {live.tribute && (
                    <div className="roam-leg roam-row">
                      <span>Кастелян предлагает дань: {live.tribute.price} — снять осаду</span>
                      <button className="nx-mbtn" disabled={busy} onClick={() => act(worldApi().roamSiegeOrder?.(live.war, 'tribute-yes'))} aria-label="Принять дань">
                        <Icon name="ui-handshake" />
                      </button>
                      <button className="nx-mbtn" disabled={busy} onClick={() => act(worldApi().roamSiegeOrder?.(live.war, 'tribute-no'))} aria-label="Отказать">
                        <Icon name="ui-close" />
                      </button>
                    </div>
                  )}
                </div>
              )}
              {!live && view.siege?.end && <p className="nx-tnote">{END_WORDS[view.siege.end] ?? ''}</p>}
              {!live && !view.block && (
                <div className="roam-legs roam-tabs">
                  {view.fates.map((f) => (
                    <button key={f.id} className={`roam-leg${fate === f.id ? ' on' : ''}`} disabled={!!f.block} onClick={() => setFate(f.id)}>
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              {view.block && !live && <p className="nx-tnote">{view.block}</p>}
            </div>
          )}
        </div>
        <div className="nx-am-foot">
          {view && !mine && live?.phase === 'camp' && (
            <>
              <button className="nx-go" disabled={busy} onClick={() => act(worldApi().roamSiegeOrder?.(live.war, 'storm'))}>
                Штурмовать
              </button>
              <button className="nx-go nx-go-ghost" disabled={busy} onClick={() => act(worldApi().roamSiegeOrder?.(live.war, 'retreat'))}>
                Отступить
              </button>
            </>
          )}
          {view && !mine && !live && (
            <>
              <button className="nx-go" disabled={busy || !!view.block} onClick={() => act(worldApi().roamSiege?.(id, 'storm', fate))}>
                Штурм с ходу
              </button>
              <button className="nx-go" disabled={busy || !!view.block} onClick={() => act(worldApi().roamSiege?.(id, 'siege', fate))}>
                Осадить
              </button>
            </>
          )}
          <button className="nx-go nx-go-ghost" onClick={onClose}>
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}
