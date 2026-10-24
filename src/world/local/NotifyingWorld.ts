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
import { ourCamp, siegeSince } from '../siege';
import { breachesOf, gatesAt, projectPhases, rowsOf, softerFate } from '../siegeroll';
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
      // Идущий туда свой поход на логово, откуда вышел набег, сожжёт его — и набег снимется (`burnLair`).
      if (m.phase === 'out') breaks.push({ kind: 'burn', at: m.arriveAt, target: m.targetId });
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
          source: m.fromId,
          from: m.fromName,
          fate: this.fateFor(m.fate, HOME_ID, m.arriveAt),
          departAt: m.departAt,
          arriveAt: m.arriveAt,
          // Та же минута, с которой отряд показывает `visibleMarches`: донесение Дозора или
          // живой обзор — что раньше.
          seenFrom: Math.min(m.arriveAt - this.warningMs(), sightFrom(m, this.sightDiscs(now))),
        }
      : null;

    const w = this.homeSiege(now);
    let siege: NoticeWorld['siege'] = null;
    if (w && !ourCamp(w)) {
      // Будущие фазы — той же дверью, что их бросит (`siegeroll.projectPhases`); сдача — участь на ступень мягче.
      // Конец осады без нашего вмешательства — та же минута, что видит окно (`hunger`; ОС-1: у нашего города — шаг голода
      // склада по прогнозу племени, а у сытого — фаза, в которую лагерь уйдёт: тогда падения нет вовсе).
      const end = this.hunger(w);
      const hungerStep = this.homeHungerStep(w);
      const ahead = projectPhases(w, end);
      const gates = gatesAt(ahead);
      const fallAt = gates ?? hungerStep;
      const declared = this.fateFor(w.fate, HOME_ID, fallAt);
      const done = rowsOf(w).length;
      let breaches = breachesOf(w);
      const phases: NonNullable<NonNullable<NoticeWorld['siege']>['phases']> = [];
      ahead.forEach((r, i) => {
        if (r.out === 'breach') breaches = Math.min(3, breaches + 1);
        if (r.out === 'breach' || r.out === 'plague') phases.push({ at: r.at, k: done + i + 1, out: r.out, breaches });
      });
      siege = {
        campId: w.campId,
        from: this.byId.get(w.byId)?.name ?? 'Враги',
        fate: gates !== null ? softerFate(declared) : declared,
        since: siegeSince(w),
        starvesAt: fallAt,
        ...(gates !== null ? { fallAt: gates, gates: true } : {}),
        ...(phases.length ? { phases } : {}),
      };
    }
    return { raid, siege, breaks };
  }
}
