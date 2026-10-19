// Строка-ссылка «Летопись» в «Заданиях» (ВС-2, docs/ui_v2.md, 5.8): летопись переехала в «Вести» вкладкой, а здесь, где её
// искали прежде, осталась дверь туда. Строка целиком — кнопка 44 со стрелкой (`kit/Row`, `go`).
import { Row } from '@/ui/kit/Row';
import { useRealm } from './open';

export function ChronLink() {
  const openChronicle = useRealm((r) => r.openChronicle);
  return (
    <Row
      icon={{ name: 'ui-book', glyph: '📖' }}
      label="Летопись"
      sub="В «Вестях»: бои, набеги, стройка — по дням"
      go={() => openChronicle(null)}
      goLabel="Летопись в «Вестях»"
    />
  );
}
