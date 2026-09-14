// Мир, который умеет составлять черновики уведомлений (docs/NOTIFY.md).
//
// Наследником, а не методом `LocalWorld`, ради одного: **выключенные уведомления не должны
// стоить игроку ни байта.** Метод класса сборщик не выбрасывает никогда — даже тот, который
// никто не зовёт, — и черновики с правилом разрыва ехали бы в чанке игры у каждого. Этот
// класс заводит только `world/store.ts` и только за `if (NOTIFY_ON)`, и при выключенном
// замке сборщик выбрасывает его вместе с `world/notice.ts`.
//
// Всё, что он читает у мира, у `LocalWorld` открыто как `protected`, а не `private`, — и
// только это. Писать он не пишет ничего.
import { LocalWorld, HOME_ID } from './LocalWorld';
import { ourCamp, siegeSince, starvesAt } from '../siege';
import { worksRipeAt } from '../works';
import { DEFENSE_FREEZE } from '../data/tuning';
import { draftNotices, sightFrom, type Break, type Drafts, type NoticeWorld } from '../notice';

export class NotifyingWorld extends LocalWorld {
  /**
   * Черновики на эту минуту. Только чтение: ни пульса, ни сведения передачи дружины, ни
   * записи — список составляется из того, что уже лежит в сохранении, и зовут его сразу
   * после пульса.
   */
  async notices(): Promise<Drafts> {
    const now = this.clock();
    return draftNotices(this.noticeWorld(now), now);
  }

  /**
   * Факты для черновиков. Разрывы названы по местам `LocalWorld`, где окно или поход
   * пересчитываются. Новый повод для `resiege` без строки здесь — это уведомление, которое
   * однажды соврёт; ловит это тест «разрыв держит правду» (`world/notice.test.ts`).
   */
  private noticeWorld(now: number): NoticeWorld {
    const save = this.save;
    const breaks: Break[] = [];

    // Свой отряд доходит домой и вливается в гарнизон. Раньше всего — у идущего назад; у
    // идущего туда и у стоящего в чужих стенах берётся нижняя граница: молчание, пришедшее
    // раньше нужного, правды не портит.
    for (const m of save.marches) {
      if (!m.own) continue;
      const at =
        m.phase === 'back'
          ? m.arriveAt
          : m.phase === 'stay'
            ? (m.stayUntil ?? m.arriveAt)
            : m.arriveAt + Math.max(0, m.arriveAt - m.departAt);
      breaks.push({ kind: 'march-home', at });
    }

    const g = save.figures.general;
    if (g.handover) breaks.push({ kind: 'handover', at: g.handover.until });
    if (g.phase === 'moving') {
      if (g.chase) breaks.push({ kind: 'chase', at: g.arriveAt, march: g.chase.marchId });
      else if (g.strike?.id === HOME_ID) breaks.push({ kind: 'strike', at: g.arriveAt });
      else if (this.touching(g.to)?.home) breaks.push({ kind: 'general-home', at: g.arriveAt });
    }

    const m = save.marches.find((x) => !x.own && x.targetId === HOME_ID && x.phase === 'out' && !x.relief);
    const raid: NoticeWorld['raid'] = m
      ? {
          id: m.id,
          from: m.fromName,
          fate: this.fateFor(m.fate, HOME_ID, m.arriveAt),
          departAt: m.departAt,
          arriveAt: m.arriveAt,
          // Та же минута, с которой отряд показывает `visibleMarches`: донесение Дозора или
          // живой обзор — что раньше.
          seenFrom: Math.min(m.arriveAt - this.warningMs(), sightFrom(m, this.sightDiscs(now))),
          freezeAt: m.arriveAt - DEFENSE_FREEZE,
        }
      : null;

    const w = this.homeSiege(now);
    let siege: NoticeWorld['siege'] = null;
    if (w && !ourCamp(w)) {
      const since = siegeSince(w);
      const ripe = (side: 'front' | 'rear'): number | null => {
        const t = worksRipeAt(since, side, w.wood);
        return Number.isFinite(t) ? t : null;
      };
      siege = {
        campId: w.campId,
        from: this.byId.get(w.byId)?.name ?? 'Чужаки',
        fate: this.fateFor(w.fate, HOME_ID, starvesAt(w)),
        since,
        starvesAt: starvesAt(w),
        frontAt: ripe('front'),
        rearAt: ripe('rear'),
      };
    }
    return { raid, siege, breaks };
  }
}
