// Ветви державы словами словаря (docs/ui_audit.md, 4.4) и их значки — общие для шапки державы, технологий и вкладки
// «Правитель» нового вида.
import type { RealmBranch } from '@/game/types';
import type { IconName } from '@/ui/icons/alias';

/** Ветви словами словаря: управление · дипломатия · война. */
export const BRANCH_WORD: Record<RealmBranch, string> = { admin: 'Управление', diplo: 'Дипломатия', war: 'Война' };
export const BRANCH_ICON: Record<RealmBranch, IconName> = {
  admin: 'pts-adm',
  diplo: 'pts-dip',
  war: 'pts-mil',
};
