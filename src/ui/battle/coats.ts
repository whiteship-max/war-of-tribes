// Гербы сторон на знамёнах роликов боя и осады (`render/reel/heraldry`, docs/gfx.md, «Знамёна»; docs/polish.md, П-2) — по
// записи боя и донесению. Ролик мира не читает: кто был против нас, говорит донесение, которое игрок и так держит в руках.
//
// Наш герб — герб державы из профиля (`profile/identity.profileArms`), тот же, что в шапке. Чужие: война с соседом-игроком
// (донесение войны, `war…` — их пишет только `LocalWorld.stepWars` и удар по городу игрока) — его герб из реестра замков;
// бой с логовом — герб логова по его номеру; разбойники без логова (набег, ворота) — топоры на чёрном. Стая знамён не носит
// вовсе (план ролика).
import type { BattleRecord, Report } from '@/world/types';
import { coatsFor, type SideCoats } from '@/render/reel/heraldry';
import { BANDIT_ARMS, DEFAULT_ARMS, armsCode, armsOr, lairArms } from '@/heraldry/arms';
import { useGame } from '@/game/store';
import { profileArms } from '@/profile/identity';
import { settlementAt } from '@/world/cache';
import { wars } from '@/net/war';
import { castles } from '@/net/roster';

/** Донесение войны между игроками: его номер начинается с `war`. */
export const isWarReport = (report: Report | undefined): boolean => report?.id.startsWith('war') ?? false;

/** Свой герб строкой — из профиля партии. */
export const ownArmsCode = (): string => armsCode(profileArms(useGame.getState().s.profile));

/**
 * Номер замка противника в донесении войны: война, в чьих боях или чей номер есть в номере донесения; наша сторона —
 * нападение — против защитника, иначе (защита, выручка союзника) — против нападавшего. Войны уже нет в списке — цель
 * донесения, если это не наш город.
 */
export function warFoeCastle(report: Report): string | null {
  const w = wars().find((v) => report.id.includes(v.id) || v.battles.some((b) => report.id === `war-${b.id}`));
  if (w) return w.role === 'atk' ? w.defCastle : w.atkCastle;
  const at = settlementAt(report.target.x, report.target.y);
  return at && at.castle && !at.mine ? at.id : null;
}

/** Герб противника строкой: сосед из реестра, логово по номеру, разбойники. */
export function foeArmsCode(report: Report | undefined): string {
  if (!report) return armsCode(BANDIT_ARMS);
  if (isWarReport(report)) {
    const id = warFoeCastle(report);
    const row = id ? castles().find((c) => c.id === id) : undefined;
    return armsCode(row ? armsOr(row.arms) : DEFAULT_ARMS);
  }
  const at = settlementAt(report.target.x, report.target.y);
  if (at && at.relation === 'barbarian' && at.id === report.target.id) return armsCode(lairArms(at.id));
  return armsCode(BANDIT_ARMS);
}

export function coatsOfRecord(rec: BattleRecord, report: Report | undefined): SideCoats {
  return coatsFor(rec.us, ownArmsCode(), foeArmsCode(report));
}
