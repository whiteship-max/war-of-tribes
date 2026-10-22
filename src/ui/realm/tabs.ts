// Девять разделов меню державы — по docs/realm.md, раздел 2, в том же порядке.
//
// Заведены все девять сразу, и нереализованные стоят закрытыми: игрок видит
// карту будущего, а следующий раздел просто занимает своё место. Закрытый
// раздел не обещает ни срока, ни чисел — только то, что его ещё нет.
//
// `built` — не настройка, а правда о коде: разделу ставят `true` тем же
// коммитом, которым он наполняется.
import type { IconName } from '@/ui/icons/alias';
export type RealmTab =
  | 'lineage'
  | 'government'
  | 'building'
  | 'tech'
  | 'decisions'
  | 'stability'
  | 'faith'
  | 'army'
  | 'estates';

export interface RealmTabDef {
  id: RealmTab;
  icon: IconName;
  name: string;
  built: boolean;
}

export const REALM_TABS: RealmTabDef[] = [
  { id: 'lineage', icon: 'ui-crown', name: 'Правитель', built: true },
  { id: 'government', icon: 'bld-town_hall', name: 'Указы', built: true },
  { id: 'building', icon: 'ui-hammer', name: 'Стройка', built: true },
  { id: 'tech', icon: 'ui-tech', name: 'Технологии', built: true },
  { id: 'decisions', icon: 'ui-mail', name: 'Вести', built: true },
  { id: 'stability', icon: 'ui-pillar', name: 'Стабильность', built: true },
  { id: 'faith', icon: 'bld-church', name: 'Вера', built: true },
  { id: 'army', icon: 'hud-army', name: 'Дружина', built: true },
  { id: 'estates', icon: 'ui-crown', name: 'Сословия', built: false },
];
