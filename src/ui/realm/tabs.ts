// Девять разделов меню державы — по docs/realm.md, раздел 2, в том же порядке.
//
// Заведены все девять сразу, и нереализованные стоят закрытыми: игрок видит
// карту будущего, а следующий раздел просто занимает своё место. Закрытый
// раздел не обещает ни срока, ни чисел — только то, что его ещё нет.
//
// `built` — не настройка, а правда о коде: разделу ставят `true` тем же
// коммитом, которым он наполняется.
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
  icon: string;
  name: string;
  built: boolean;
}

export const REALM_TABS: RealmTabDef[] = [
  { id: 'lineage', icon: '🌳', name: 'Правитель', built: true },
  { id: 'government', icon: '🏛️', name: 'Указы', built: true },
  { id: 'building', icon: '🔨', name: 'Стройка', built: true },
  { id: 'tech', icon: '📚', name: 'Технологии', built: true },
  { id: 'decisions', icon: '✉️', name: 'Вести', built: true },
  { id: 'stability', icon: '⚖️', name: 'Порядок', built: false },
  { id: 'faith', icon: '⛪', name: 'Вера', built: true },
  { id: 'army', icon: '⚔️', name: 'Дружина', built: true },
  { id: 'estates', icon: '👑', name: 'Сословия', built: false },
];
