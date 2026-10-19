// Вести края словами (docs/feed.md): заголовок, строка и значок записи ленты. Числа — сроки — функцией сроков
// (`game/span.realSpan`, правило 18); имена городов и правителей — как их назвали игроки, поэтому склонять их нельзя:
// город стоит после слова «город», правитель — после слова «правитель», оба в именительном.
import type { FeedItem } from '@/net/feed';
import { realSpan } from '@/game/span';
import { cityOr } from '../../../netlify/lib/contract';
import type { IconName } from '@/ui/icons/alias';

export interface FeedWords {
  title: string;
  line: string;
  icon: IconName;
}

/** Срок, округлённый до своей единицы: «12 мин», «3 ч», «2 дн.». */
function coarse(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 3600) return realSpan(Math.max(60, Math.floor(sec / 60) * 60));
  if (sec < 48 * 3600) return realSpan(Math.floor(sec / 3600) * 3600);
  return realSpan(Math.floor(sec / 86_400) * 86_400);
}

/** Давно ли: «только что», «12 мин назад», «3 ч назад», «2 дн. назад». */
export const agoText = (ms: number): string => (ms < 60_000 ? 'только что' : `${coarse(ms)} назад`);

/** Другая сторона: «отряд из города Катания, правитель Андрей». */
const party = (item: FeedItem, what: string): string =>
  `${what} из города ${cityOr(item.byCity)}${item.byRuler ? `, правитель ${item.byRuler}` : ''}`;

const DEED: Record<string, { title: string; line: string; icon: FeedWords['icon'] }> = {
  fire: { title: 'Пожар', line: 'Склад поджёг чужой лазутчик.', icon: 'evt-fire' },
  theft: { title: 'Кража', line: 'Чужой лазутчик унёс запасы со склада.', icon: 'ui-pouch' },
  unrest: { title: 'Смута', line: 'Чужой лазутчик сманил жителей.', icon: 'spy-revolt' },
};

export function feedWords(item: FeedItem): FeedWords {
  const name = cityOr(item.city);
  const city = `город ${name}`;
  const City = `Город ${name}`;
  switch (item.kind) {
    case 'fell': {
      const how =
        item.how === 'hunger'
          ? `Сдался голоду${item.siegeMs ? ` после ${coarse(item.siegeMs)} осады` : ''}.`
          : item.how === 'gates'
            ? `Открыл ворота${item.siegeMs ? ` после ${coarse(item.siegeMs)} осады` : ''}.`
            : item.siegeMs
            ? `Пал при штурме после ${coarse(item.siegeMs)} осады.`
            : 'Пал при штурме.';
      return { title: `${City} взят`, line: `${how} Победитель — ${party(item, 'отряд')}.`, icon: 'ui-banner' };
    }
    case 'siege':
      return { title: `${City} в осаде`, line: `Под стенами встал лагерем ${party(item, 'отряд')}.`, icon: 'stage-camp' };
    case 'lifted': {
      const how =
        item.how === 'retreat'
          ? 'Враг снял осаду и ушёл.'
          : item.how === 'beaten'
            ? 'Штурм из лагеря отбили.'
            : item.how === 'paid'
              ? 'Откупился данью, лагерь ушёл.'
              : 'Защитники вышли из ворот и разбили лагерь.';
      return { title: `${City} выстоял`, line: `${how} Осаждал ${party(item, 'отряд')}.`, icon: 'gear-shield' };
    }
    case 'repelled':
      return { title: `${City} отбил штурм`, line: `Штурмовал ${party(item, 'отряд')}, но ушёл ни с чем.`, icon: 'gear-shield' };
    case 'spy': {
      const d = DEED[item.how ?? ''] ?? DEED.fire;
      return { title: `${d.title}, ${city}`, line: `${d.line} Чей он, так и не узнали.`, icon: d.icon };
    }
    case 'caught':
      return {
        title: `${item.how === 'dead' ? 'Убит' : 'Схвачен'} лазутчик, ${city}`,
        // «Послали», а не «послал»: правитель может быть и правительницей, а имя пишет игрок.
        line: `Его послали из города ${cityOr(item.byCity)}${item.byRuler ? `, правитель ${item.byRuler}` : ''}.`,
        icon: 'fig-spy',
      };
    case 'settled':
      return item.mine
        ? { title: `${City} встал на карте`, line: `Правитель ${item.ruler || 'без имени'}.`, icon: 'stage-village' }
        : { title: `Новый сосед, ${city}`, line: `Правитель ${item.ruler || 'без имени'}.`, icon: 'stage-village' };
    case 'leader':
      return {
        title: 'Первенство сменилось',
        line: `Первым в рейтинге стал ${city}, правитель ${item.ruler || 'без имени'}.`,
        icon: 'ui-crown',
      };
  }
}
