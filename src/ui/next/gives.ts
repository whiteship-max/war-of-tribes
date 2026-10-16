// «Что даёт городу» в окне постройки (UI-8, docs/ui_v2.md, 5.7): строка на то, что постройка даёт, — таблицей, каждая
// цифра с разбором, у показателя города — дверь к его окну (docs/ui_v2.md, 2.1–2.3). Прежде — строки `.mod` без касания, и
// у казарм оборона стояла дважды: «К обороне города» и «Оборона города» (Д8), у домов жители — второй раз после верха, у
// кузницы — «Мощь дружины» (Л3), у Дозора — «Округа разведана» третьим ходом разведки (Д11).
//
// Теперь у показателя города одна строка — вклад этой постройки, — а итог города стоит в её подсказке разбором (те же
// подсказки, что у верха, `hudTips`) и в окне числа за дверью «›». Своих чисел нет (правило 18): вклады — `buildingStat`,
// `buildingHousing`; службы — те же чтения, что прежде (`derived`, `sim/tech`).
import type { Building, GameState } from '@/game/types';
import {
  bedsTaken,
  buildingHousing,
  buildingStat,
  cavalryTrain,
  crafterBuildShare,
  healShare,
  infirmaryBeds,
  intelKeen,
  maxLevelFor,
  stalls,
  stallsTaken,
  stashAt,
  storageCap,
  warningSeconds,
  woundedStacks,
} from '@/game/derived';
import { troopTotal } from '@/game/battle/kinds';
import { troopBlock, troopOpen } from '@/game/sim/tech';
import { asGame } from '@/game/pace';
import { dec } from '@/game/num';
import { waitMinSec } from '@/ui/parts/wait';
import { WINDOW, type Source } from '@/ui/kit/sources';
import type { TipContent } from './tip';
import { defenseTip, fmtInt, housingTip, moraleTip, type TipGo } from './hudTips';

/** Строка «Что даёт городу»: значок, что, сколько; подсказка — разбор или слова; дверь — окно числа. */
export interface GiveRow {
  key: string;
  icon: { name: string; glyph: string };
  label: string;
  value: string;
  tip: () => TipContent;
  /** Окно показателя города; нет — строка только объясняет. */
  to?: Source;
}

const words = (title: string, body: string) => (): TipContent => ({ title, body });

/**
 * Что постройка даёт городу — строками. Вклад в показатель города (жильё, склад, оборона, мораль) — со своей дверью и
 * подсказкой-разбором всего числа города; службы (лазарет, Дозор, конюшня, тайник, мастерская) — со словами. Подсказки
 * разбора уводят своей дверью в окно числа (`TipGo`), а строка — своей «›».
 */
export function buildingGives(s: GameState, b: Building, go: TipGo): GiveRow[] {
  const rows: GiveRow[] = [];
  const housing = buildingHousing(b);
  if (housing) {
    rows.push({ key: 'housing', icon: { name: 'bld-houses', glyph: '🛏️' }, label: 'Жилых мест', value: `+${fmtInt(housing)}`, tip: () => housingTip(s, go), to: WINDOW.pop });
  }
  const storage = buildingStat(b, 'storage');
  if (storage) {
    rows.push({
      key: 'storage',
      icon: { name: 'bld-storage', glyph: '🧺' },
      label: 'К вместимости склада',
      value: `+${fmtInt(storage)}`,
      tip: words('Вместимость склада', `Склад держит до ${fmtInt(storageCap(s))} каждого запаса.`),
      to: WINDOW.food,
    });
  }
  const defense = buildingStat(b, 'defense');
  if (defense) {
    rows.push({ key: 'defense', icon: { name: 'gear-shield', glyph: '🛡️' }, label: 'К обороне города', value: `+${fmtInt(defense)}`, tip: () => defenseTip(s, go), to: WINDOW.defense });
  }
  const morale = buildingStat(b, 'morale');
  if (morale) {
    rows.push({ key: 'morale', icon: { name: 'mood-good', glyph: '😊' }, label: 'К морали', value: `+${fmtInt(morale)}`, tip: () => moraleTip(s, go), to: WINDOW.morale });
  }

  if (b.type === 'infirmary') {
    // Числа — из тех же чтений, что кладут раненых (`sim/infirmary`): доля, места, кто лежит, кто при полководце.
    const { lying, carried } = woundedStacks(s);
    const heads = troopTotal(lying);
    const soon = (s.wounded ?? []).reduce((m, g) => (g.until === null ? m : Math.min(m, g.until)), Infinity);
    rows.push({
      key: 'heal',
      icon: { name: 'ui-bandage', glyph: '🩹' },
      label: 'Раненых среди павших',
      value: `${Math.round(healShare(s) * 100)}%`,
      tip: words('Раненые', 'Такая доля павших в бою не гибнет, а ложится в лазарет. Растёт с уровнем лазарета.'),
    });
    // Место — боец строя: всадник занимает столько, сколько весит в бою (docs/stable.md).
    rows.push({
      key: 'beds',
      icon: { name: 'ui-bandage', glyph: '🛏️' },
      label: 'Мест занято',
      value: `${Math.round(bedsTaken(s))} из ${infirmaryBeds(s)}`,
      tip: words('Места лазарета', 'Всадник занимает больше места, чем пеший. Мест нет — раненые гибнут.'),
    });
    if (heads > 0) {
      rows.push({ key: 'lying', icon: { name: 'ui-bandage', glyph: '🩹' }, label: 'Лежит раненых', value: fmtInt(heads), tip: words('Лежат', 'Встанут и вернутся в строй.') });
    }
    if (Number.isFinite(soon)) {
      rows.push({ key: 'soon', icon: { name: 'ui-time', glyph: '⏳' }, label: 'Первые встанут через', value: waitMinSec(asGame(soon - s.time)), tip: words('Срок', 'Когда первые раненые вернутся в строй.') });
    }
    if (troopTotal(carried) > 0) {
      rows.push({
        key: 'carried',
        icon: { name: 'ui-bandage', glyph: '🩹' },
        label: 'Раненых в отряде полководца',
        value: fmtInt(troopTotal(carried)),
        tip: words('Раненые отряда', 'Встав, вернутся к полководцу, когда он дома.'),
      });
    }
  }
  if (b.type === 'watch') {
    rows.push({
      key: 'keen',
      icon: { name: 'ui-spyglass', glyph: '🔭' },
      label: 'Сведения стареют',
      value: `в ${dec(intelKeen(s), 2)} раза медленнее`,
      tip: words('Сведения', 'Донесения о соседях и логовах с уровнем Дозора стареют медленнее.'),
    });
    // Минуты с секундами, а не округлённые минуты: округление и было враньём кнопки — девять уровней обещали девять
    // минут, а давали шесть. «Округа разведана» — строкой таблицы разведки ниже (`parts/Watch`), не здесь (Д11).
    rows.push({
      key: 'warning',
      icon: { name: 'ui-time', glyph: '⏳' },
      label: 'Набег виден дольше на',
      value: waitMinSec(warningSeconds(s)),
      tip: words('Набег', 'Столько Дозор прибавляет к сроку, за который видно идущий набег.'),
    });
  }
  if (b.type === 'stable') {
    rows.push({ key: 'stalls', icon: { name: 'troop-horse', glyph: '🐎' }, label: 'Стойла заняты', value: `${stallsTaken(s)} из ${stalls(s)}`, tip: words('Стойла', 'Сколько коней держит конюшня. Растёт с её уровнем.') });
    rows.push({ key: 'train', icon: { name: 'troop-horse', glyph: '🐎' }, label: 'Конница учится быстрее', value: `×${dec(cavalryTrain(s), 2)}`, tip: words('Учёба', 'Конюшня ускоряет учёбу конницы.') });
    // Латных всадников открывает доспех в военной ветви (решение владельца 3); строку говорит гейт.
    rows.push({
      key: 'knight',
      icon: { name: 'troop-knight', glyph: '🏇' },
      label: 'Латные всадники',
      value: troopOpen(s, 'knight') ? 'нанимают здесь' : 'закрыто',
      tip: words('Латные всадники', troopBlock(s, 'knight') ?? 'Нанимают в этой конюшне.'),
    });
  }
  // Тайник: главный довод его строить — «сколько будет», и оба числа стоят рядом; всё сверх спрятанного победитель уносит.
  if (b.type === 'cache') {
    const now = stashAt(b.level);
    rows.push({ key: 'stash', icon: { name: 'ui-loot', glyph: '🧰' }, label: 'Прячет сейчас', value: `по ${fmtInt(now)}`, tip: words('Тайник', 'Столько каждого запаса набег не унесёт. Всё сверх — уносит.') });
    if (b.level < maxLevelFor(b.type)) {
      const next = stashAt(b.level + 1);
      rows.push({ key: 'stash-next', icon: { name: 'ui-crate', glyph: '📦' }, label: `На ур. ${b.level + 1}`, value: `${fmtInt(next)} · +${fmtInt(next - now)}`, tip: words('Следующий уровень', 'Столько тайник будет прятать уровнем выше.') });
    }
  }
  if (b.type === 'workshop') {
    rows.push({
      key: 'build',
      icon: { name: 'ui-hammer', glyph: '🔨' },
      label: 'К скорости стройки',
      value: `+${dec(crafterBuildShare(s), 1)}`,
      tip: words('Скорость стройки', 'Мастера мастерской прибавляют к скорости стройки города.'),
      to: { kind: 'build' },
    });
  }
  return rows;
}
