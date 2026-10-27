// Окно дела полководца (К-2, docs/AGENTS.md, раздел 18; ДР-6): после выбора дела — сразу кто уходит и кто остаётся.
//
// По каждому виду — «остаётся в городе | уходит с полководцем» (`parts/Muster`), итог мощи уходящих и оборона остающихся, а
// над ней — подтверждение дела Р-4 (куда, что сделает, дорога туда и назад, риск, энергия). У удара и осады — участь города
// тем же выбором, что в карточке места (`FatePick`). «Отправить» — одно касание: состав и дело одним приказом мира
// (`Muster.departWith`, `ErrandOrder.troops`). Окно одно на все дела полководца: сюда ведут кольцо над целью, кнопки похода
// карточки места и «На выручку» (`world/store.openMenu` с делом, ДР-6) — раскладки в «Дружине» больше нет.
//
// Кусок едет отдельно от первой загрузки (`ActionMenu`, `lazy`): состав тянет за собой мощь и оборону.
import { useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { FATE_DEFAULT } from '@/world/spoils';
import type { ErrandOption, ErrandTarget, Fate, FateOption } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { EnergyPrice } from '@/ui/parts/Energy';
import { FatePick } from '@/ui/parts/FatePick';
import { Muster } from '@/ui/parts/Muster';
import { troopTotal } from '@/game/battle/kinds';
import { errandIcon, roadWords, sentWords } from './ActionMenu';
import { emptyRetinue } from './ring';

/** Участь по умолчанию: та, что у карточки, если её можно объявить, иначе первая доступная. */
export function firstFate(options: readonly FateOption[]): Fate {
  if (options.some((o) => o.id === FATE_DEFAULT && o.can)) return FATE_DEFAULT;
  return options.find((o) => o.can)?.id ?? FATE_DEFAULT;
}

/** Почему «Отправить» погашено в окне, где отряд дают тут же: не «иди в Раскладку», а «+» у вида. */
export const EMPTY_SEND = 'Отряд пуст: «+» у вида — боец уходит с полководцем.';

export function ArmySend({
  where,
  goal,
  o,
  fates,
  fate: chosen,
  warn,
  onBack,
}: {
  where: string;
  goal: ErrandTarget;
  o: ErrandOption;
  /** Участи города для удара и осады — из карточки места. */
  fates: FateOption[];
  /** Участь, уже выбранная в карточке места (кнопка похода, ДР-6). */
  fate?: Fate;
  warn?: string | null;
  onBack: () => void;
}) {
  const showToast = useGame((g) => g.showToast);
  const name = useWorld((g) => g.figures.find((f) => f.id === 'general')?.name ?? 'Полководец');
  const [fate, setFate] = useState<Fate>(() => chosen ?? firstFate(fates));
  // Окно короткое: только участи, которые можно объявить; закрытые с причинами — в карточке места.
  const open = fates.filter((f) => f.can);
  const done = (err: string | null): void => {
    showToast(err ?? sentWords(name, o));
    if (!err) useWorld.getState().closeMenu();
  };
  return (
    <>
      <div className="nx-am-body er-confirm">
        <div className="nx-crow er-what">
          <span className="nx-lico">
            <Icon name={errandIcon(o)} />
          </span>
          <span className="nx-crow-t">
            {o.name}
            <small>{o.does}</small>
          </span>
        </div>
        <Line label="Куда" value={where} />
        <Line label="Дорога" value={roadWords(o)} />
        <Line label="Риск" value={o.risk.length > 0 ? o.risk.join(' ') : 'Риска нет.'} bad={o.risk.length > 0} />
        {o.energy && <Line label="Энергия" value={<EnergyPrice price={o.energy.price} />} />}
        {o.fate && <FatePick options={open} value={fate} onChange={setFate} />}
        {warn && <p className="nx-bwarn">{warn}</p>}
        <Muster
          send={{
            order: { agent: 'general', target: goal, deed: o.id, shownAt: o.at, ...(o.fate ? { fate } : {}) },
            // Пустой отряд гасит дело, только пока уходящих нет: бойцов даёт это окно (`ring.emptyRetinue`).
            block: (want) =>
              o.can || (emptyRetinue(o) && troopTotal(want) > 0) ? null : emptyRetinue(o) ? EMPTY_SEND : (o.reason ?? 'Сейчас нельзя.'),
            done,
          }}
        />
      </div>
      <div className="nx-am-foot">
        <button className="nx-go nx-go-ghost" onClick={onBack}>
          Назад
        </button>
      </div>
    </>
  );
}

function Line({ label, value, bad }: { label: string; value: ReactNode; bad?: boolean }) {
  return (
    <div className="er-line">
      <span className="muted">{label}</span>
      <b className={bad ? 'bad' : ''}>{value}</b>
    </div>
  );
}

export default ArmySend;
