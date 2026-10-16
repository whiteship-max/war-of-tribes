// Поход на город живого игрока — блок карточки чужого города (docs/pvp.md).
//
// Бой здесь не считается и не предсказывается: его считает сервер в минуту прихода, тем же ядром, что бой
// с логовом. Блок говорит, что с войной сейчас — их поход, наш поход, лагерь, — и держит пакт. Выступить — блоком удара
// самой карточки, одним на логово и на город игрока (UI-7, docs/ui_v2.md, 5.6; Д16).
import { useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld, worldNow } from '@/world/store';
import type { SettlementCard } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { count } from '@/ui/parts/plural';
import { realLeft } from '@/ui/parts/wait';
import { hungerLeft } from '@/ui/parts/hunger';
import { EnergyPrice } from '@/ui/parts/Energy';

const left = (at: number, now: number): string => realLeft(Math.max(0, (at - now) / 1000));

export function WarCard({ card }: { card: SettlementCard }) {
  const recallFigure = useWorld((g) => g.recallFigure);
  const pact = useWorld((g) => g.pact);
  const relief = useWorld((g) => g.relief);
  const showToast = useGame((g) => g.showToast);
  const openCamp = useGame((g) => g.openCamp);
  const openSiege = useGame((g) => g.openSiege);
  const [busy, setBusy] = useState(false);
  const war = card.war;
  if (!war) return null;
  const now = worldNow();

  // Пакт и выручка (docs/siege_v2.md, раздел 5): пакт значит одно — союзник может прийти на выручку, а походом на него не пойти.
  const pactAct = async (on: boolean): Promise<void> => {
    setBusy(true);
    const err = await pact(card.id, on);
    setBusy(false);
    if (err) showToast(err);
  };
  const reliefGo = async (): Promise<void> => {
    setBusy(true);
    const err = await relief(card.id);
    setBusy(false);
    showToast(err ?? `Полководец идёт на выручку к «${card.name}».`);
  };
  const recall = async (): Promise<void> => {
    setBusy(true);
    const err = await recallFigure('general');
    setBusy(false);
    showToast(err ?? 'Отряд поворачивает домой.');
  };

  return (
    <div className="nx-war">
      <h3>Война</h3>
      {war.theirs && (
        <>
          <p className="nx-tnote bad">
            {war.theirs.phase === 'march'
              ? `Их отряд идёт на наш город. У стен будет через ${left(war.theirs.arriveAt, now)}.`
              : 'Их лагерь стоит под нашими стенами.'}
          </p>
          {war.theirs.phase === 'camp' && (
            <button className="nx-cact" onClick={openSiege}>
              <Icon name="ui-target" glyph="⛺" />
              Открыть осаду
            </button>
          )}
        </>
      )}

      {war.ours ? (
        <>
          {war.ours.phase === 'march' && (
            <>
              <p className="nx-tnote">
                Наш отряд идёт {war.ours.mode === 'storm' ? 'на штурм с ходу' : 'в осаду'}. У стен через {left(war.ours.arriveAt, now)}. Бой
                будет в минуту прихода, даже если ты не в игре.
              </p>
              <button className="nx-cact" disabled={busy} onClick={() => void recall()}>
                <Icon name="ui-time" glyph="↩️" />
                Отозвать поход
              </button>
            </>
          )}
          {war.ours.phase === 'camp' && (
            <>
              <p className="nx-tnote">
                Наш лагерь стоит под стенами.
                {war.ours.starvesAt !== undefined ? ` Хлеба в городе на ${hungerLeft(war.ours.starvesAt, now)}.` : ''}
              </p>
              <button className="nx-cact" onClick={openCamp}>
                <Icon name="ui-target" glyph="⛺" />
                Открыть лагерь
              </button>
            </>
          )}
          {war.ours.phase === 'back' && (
            <p className="nx-tnote">Отряд возвращается. Дома через {left(war.ours.backAt ?? now, now)}.</p>
          )}
        </>
      ) : null}
      {/* Выступить — «Дойти и ударить» и «Осадить» с выбором участи — блоком удара карточки, один на логово и на город
          игрока (Д16, UI-7, docs/ui_v2.md, 5.6): прежде здесь был второй выбор участи и свои кнопки. */}
      <h3>Пакт</h3>
      {war.pact === 'pact' ? (
        <>
          <p className="nx-tnote">Пакт заключён. Если город осадят, наш полководец может ударить по лагерю с тыла. Походом на союзника не пойти.</p>
          {war.relief && (
            <>
              {war.relief.going !== undefined ? (
                <p className="nx-tnote">Наша дружина идёт на выручку. Ударит по лагерю через {left(war.relief.going, now)}.</p>
              ) : (
                <button className="nx-go nx-cgo" disabled={busy || !war.relief.can} onClick={() => void reliefGo()}>
                  На выручку · {count(war.relief.men, 'боец', 'бойца', 'бойцов')}
                  {war.relief.energy && <EnergyPrice price={war.relief.energy.price} />}
                </button>
              )}
              {!war.relief.can && war.relief.going === undefined && war.relief.reason && <p className="nx-tnote bad">{war.relief.reason}</p>}
            </>
          )}
          <button className="nx-cact" disabled={busy} onClick={() => void pactAct(false)}>
            Разорвать пакт
          </button>
        </>
      ) : war.pact === 'offered' ? (
        <>
          <p className="nx-tnote">Пакт предложен. Ждём ответа.</p>
          <button className="nx-cact" disabled={busy} onClick={() => void pactAct(false)}>
            Отозвать
          </button>
        </>
      ) : war.pact === 'asked' ? (
        <>
          <p className="nx-tnote">Они предлагают пакт: в осаде союзники выручают друг друга.</p>
          <button className="nx-go nx-cgo" disabled={busy} onClick={() => void pactAct(true)}>
            Принять пакт
          </button>
          <button className="nx-cact" disabled={busy} onClick={() => void pactAct(false)}>
            Отклонить
          </button>
        </>
      ) : (
        <>
          <p className="nx-tnote">Союзники выручают друг друга в осаде: полководец бьёт лагерь под городом союзника с тыла.</p>
          <button className="nx-cact" disabled={busy} onClick={() => void pactAct(true)}>
            Предложить пакт
          </button>
        </>
      )}
    </div>
  );
}
