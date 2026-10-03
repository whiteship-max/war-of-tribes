// Ветви державы словами словаря (docs/ui_audit.md, 4.4) и их значки — общие для шапки державы, технологий и вкладки
// «Правитель» нового вида.
import type { RealmBranch } from '@/game/types';

/** Ветви словами словаря: управление · дипломатия · война. */
export const BRANCH_WORD: Record<RealmBranch, string> = { admin: 'Управление', diplo: 'Дипломатия', war: 'Война' };
export const BRANCH_ICON: Record<RealmBranch, { name: string; glyph: string }> = {
  admin: { name: 'pts-adm', glyph: '📜' },
  diplo: { name: 'pts-dip', glyph: '🕊️' },
  war: { name: 'pts-mil', glyph: '⚔️' },
};
