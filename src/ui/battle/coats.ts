// Гербы сторон на знамёнах ролика боя (`render/reel/heraldry`, docs/gfx.md, «Знамёна») — по записи боя и донесению.
// Ролик мира не читает: кто был против нас, говорит донесение, которое игрок и так держит в руках.
//
// Наш герб — башня всегда (тот же, что у державы в шапке, `ui/realm/Coat.tsx`). Чужие: война с соседом-игроком
// (донесение войны, `war…` — их пишет только `LocalWorld.stepWars` и удар по городу игрока) — его башня в цвете
// чужих; прочие — разбойники логова и их отряды — скрещённые топоры. Стая знамён не носит вовсе (план ролика).
import type { BattleRecord, Report } from '@/world/types';
import { coatsFor, type SideCoats } from '@/render/reel/heraldry';

/** Донесение войны между игроками: его номер начинается с `war`. */
export const isWarReport = (report: Report | undefined): boolean => report?.id.startsWith('war') ?? false;

export function coatsOfRecord(rec: BattleRecord, report: Report | undefined): SideCoats {
  return coatsFor(rec.us, isWarReport(report) ? 'tower' : 'axes');
}
