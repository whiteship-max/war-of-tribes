// Окно войска полководца (К-2, docs/AGENTS.md, раздел 18): после выбора дела — сразу кто уходит и кто остаётся.
//
// По каждому виду — «остаётся в городе | уходит с полководцем»: та же передача, что в «Дружине» (`parts/Muster`, режим
// `send`), итог мощи уходящих и оборона остающихся, а над ней — подтверждение дела Р-4 (куда, что сделает, дорога туда и
// назад, риск, энергия). У удара и осады — участь города тем же выбором, что в карточке места (`FatePick`). «Отправить» —
// одно касание: раскладка и дело одной дверью (`Muster.departWith`).
//
// Кусок едет отдельно от первой загрузки (`ActionMenu`, `lazy`): передача тянет за собой мощь и оборону.
import { useState, type ReactNode } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { FATE_DEFAULT } from '@/world/spoils';
import type { ErrandOption, ErrandTarget, Fate, FateOption } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { EnergyPrice } from '@/ui/parts/Energy';
import { FatePick } from '@/ui/parts/FatePick';
import { Muster } from '@/ui/parts/Muster';
import { errandIcon, roadWords, sentWords } from './ActionMenu';

/** Участь по умолчанию: та, что у карточки, если её можно объявить, иначе первая доступная. */
export function firstFate(options: readonly FateOption[]): Fate {
  if (options.some((o) => o.id === FATE_DEFAULT && o.can)) return FATE_DEFAULT;
  return options.find((o) => o.can)?.id ?? FATE_DEFAULT;
}

export function ArmySend({
  where,
  goal,
  o,
  fates,
  warn,
  onBack,
}: {
  where: string;
  goal: ErrandTarget;
  o: ErrandOption;
  /** Участи города для удара и осады — из карточки места. */
  fates: FateOption[];
  warn?: string | null;
  onBack: () => void;
}) {
  const showToast = useGame((g) => g.showToast);
  const name = useWorld((g) => g.figures.find((f) => f.id === 'general')?.name ?? 'Полководец');
  const [fate, setFate] = useState<Fate>(() => firstFate(fates));
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
        {o.fate && <FatePick options={fates} value={fate} onChange={setFate} />}
        {warn && <p className="nx-bwarn">{warn}</p>}
        <Muster
          send={{
            order: { agent: 'general', target: goal, deed: o.id, shownAt: o.at, ...(o.fate ? { fate } : {}) },
            block: o.can ? null : (o.reason ?? 'Сейчас нельзя.'),
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
