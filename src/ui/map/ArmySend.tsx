// Окно дела полководца (К-2, docs/AGENTS.md, раздел 18; ДР-6; ДР-7): после выбора дела — сразу кто уходит и кто остаётся, и
// каким маршем.
//
// По каждому виду — «остаётся в городе | уходит с полководцем» (`parts/Muster`), под составом — режим марша (`GaitPick`, ДР-7:
// скорость, срок туда и назад, убыль и вывоз по выбранному составу, встанет ли лагерь), итог мощи уходящих и оборона
// остающихся, а над ними — подтверждение дела Р-4 (куда, что сделает, дорога туда и назад в выбранном режиме, риск, энергия).
// У удара и осады — участь города тем же выбором, что в карточке места (`FatePick`). «Отправить» — одно касание: режим, состав
// и дело одним приказом мира (`Muster.departWith`, `ErrandOrder.gait`, `.troops`). Окно одно на все дела полководца: сюда
// ведут кольцо над целью, кнопки похода карточки места и «На выручку» (`world/store.openMenu` с делом, ДР-6).
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
import { GaitPick } from '@/ui/parts/GaitPick';
import type { Gait } from '@/world/gait';
import { errandIcon, gaitRowOf, inGait, roadWords, sentWords } from './ActionMenu';
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
  gait,
  free,
  onGait,
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
  /** Режим марша окна (ДР-7, `ActionMenu.gaitFor`): по нему дорога, энергия и приказ. */
  gait: Gait;
  /** Полководец дома: режим выбирают здесь даром; не дома — только сравнить. */
  free: boolean;
  onGait: (g: Gait) => void;
  warn?: string | null;
  onBack: () => void;
}) {
  const showToast = useGame((g) => g.showToast);
  const name = useWorld((g) => g.figures.find((f) => f.id === 'general')?.name ?? 'Полководец');
  const [fate, setFate] = useState<Fate>(() => chosen ?? firstFate(fates));
  // Окно короткое: только участи, которые можно объявить; закрытые с причинами — в карточке места.
  const open = fates.filter((f) => f.can);
  // Дело в выбранном режиме: дорога туда и назад и энергия — его строки (ДР-7).
  const v = inGait(o, gait);
  const row = gaitRowOf(o, gait);
  const done = (err: string | null): void => {
    showToast(err ?? sentWords(name, v));
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
        <Line label="Дорога" value={roadWords(v)} />
        <Line label="Риск" value={o.risk.length > 0 ? o.risk.join(' ') : 'Риска нет.'} bad={o.risk.length > 0} />
        {v.energy && <Line label="Энергия" value={<EnergyPrice price={v.energy.price} />} />}
        {o.fate && <FatePick options={open} value={fate} onChange={setFate} />}
        {warn && <p className="nx-bwarn">{warn}</p>}
        <Muster
          send={{
            // Режим уходит с делом, только когда его выбирают здесь — дома; не дома приказ идёт нынешним (ДР-7).
            order: { agent: 'general', target: goal, deed: o.id, shownAt: o.at, ...(o.fate ? { fate } : {}), ...(free && row ? { gait } : {}) },
            block: (want) => sendBlock(o, gait, troopTotal(want)),
            after: (going) =>
              o.gaits && <GaitPick rows={o.gaits} men={troopTotal(going)} haul={o.haul ?? 0} value={gait} free={free} onPick={onGait} />,
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

/**
 * Почему «Отправить» погашено: отказ дела в выбранном режиме (налегке лагерь не ставят, не догнать), пустой отряд, пока
 * уходящих нет (бойцов даёт это окно, `ring.emptyRetinue`), или отказ мира. Отказ мира, который и есть отказ режима
 * полководца сейчас (`gaitRowOf` нынешнего), выбранный режим снимает: он уходит с делом (ДР-7).
 */
export function sendBlock(o: ErrandOption, gait: Gait, men: number): string | null {
  const row = gaitRowOf(o, gait);
  if (row?.block) return row.block;
  if (o.can) return null;
  if (emptyRetinue(o)) return men > 0 ? null : EMPTY_SEND;
  const gaitOnly = o.reason !== null && Boolean(o.gaits?.some((r) => r.gait !== gait && r.block === o.reason));
  return gaitOnly ? null : (o.reason ?? 'Сейчас нельзя.');
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
