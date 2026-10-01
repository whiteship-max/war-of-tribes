// Заглушки значков, которых нет в листе проекта (docs/ui_audit.md, раздел 8). Рисованы в стиле листа: сетка 32,
// только заливки, палитра листа. Имя — то, под которым значок ждут в листе; в макете каждый стоит с рамкой
// .not-in-sheet. Когда лист дорисуют, этот файл убирается, а <use href="#i-…"/> найдёт настоящий рисунок.
(function () {
  var S = {
    'ui-close':
      '<path d="M7 3 16 12 25 3 29 7 20 16 29 25 25 29 16 20 7 29 3 25 12 16 3 7Z" fill="#c9a878"/>' +
      '<path d="M7 6 16 15 25 6 26 7 17 16 16 17 7 8 6 7Z" fill="#e4dcc6"/>',
    'ui-info':
      '<circle cx="16" cy="16" r="14" fill="#c9a878"/><circle cx="16" cy="16" r="11" fill="#e4dcc6"/>' +
      '<rect x="14" y="13" width="4" height="11" fill="#60432a"/><rect x="14" y="7" width="4" height="4" fill="#60432a"/>',
    'ui-mail':
      '<rect x="3" y="7" width="26" height="19" fill="#e4dcc6"/><polygon points="3,7 29,7 16,19" fill="#c9a878"/>' +
      '<polygon points="3,26 12,16 16,19 20,16 29,26" fill="#d6cbb1"/><circle cx="16" cy="18" r="4" fill="#b6432f"/>',
    'ui-lock':
      '<path d="M9 14V10a7 7 0 0 1 14 0v4h-4v-4a3 3 0 0 0-6 0v4Z" fill="#8c6238"/>' +
      '<rect x="6" y="14" width="20" height="15" fill="#c9a878"/><rect x="6" y="14" width="20" height="3" fill="#e4dcc6"/>' +
      '<rect x="14" y="19" width="4" height="7" fill="#60432a"/>',
    'ui-check':
      '<polygon points="3,16 7,12 13,18 25,5 29,9 13,26" fill="#8fae5a"/><polygon points="7,12 13,18 25,5 26,6 13,20" fill="#b9d08a"/>',
    'ui-crown':
      '<polygon points="3,25 3,9 10,16 16,5 22,16 29,9 29,25" fill="#e0b04a"/><rect x="3" y="24" width="26" height="5" fill="#b07724"/>' +
      '<circle cx="16" cy="18" r="3" fill="#b6432f"/><circle cx="8" cy="20" r="2" fill="#6f8fb0"/><circle cx="24" cy="20" r="2" fill="#6f8fb0"/>',
    'ui-tech':
      '<polygon points="16,3 19,9 13,9" fill="#8c6238"/><circle cx="16" cy="9" r="4" fill="#c9a878"/>' +
      '<polygon points="13,11 16,12 8,29 5,28" fill="#ac8843"/><polygon points="19,11 16,12 24,29 27,28" fill="#ac8843"/>' +
      '<rect x="6" y="20" width="20" height="3" fill="#e4dcc6"/>',
    'ui-faith':
      '<polygon points="16,2 21,10 18,14 14,14 11,10" fill="#e8a43c"/><polygon points="16,6 18,10 16,13 14,10" fill="#f3d27a"/>' +
      '<rect x="12" y="14" width="8" height="12" fill="#e4dcc6"/><rect x="8" y="26" width="16" height="4" fill="#8c6238"/>',
    'pts-adm':
      '<polygon points="16,2 30,16 16,30 2,16" fill="#d9b45a"/><polygon points="16,6 26,16 16,26 6,16" fill="#efd68c"/>' +
      '<rect x="11" y="12" width="10" height="2" fill="#60432a"/><rect x="11" y="16" width="10" height="2" fill="#60432a"/><rect x="11" y="20" width="6" height="2" fill="#60432a"/>',
    'pts-dip':
      '<polygon points="16,2 30,16 16,30 2,16" fill="#6f9a96"/><polygon points="16,6 26,16 16,26 6,16" fill="#a9cbc4"/>' +
      '<circle cx="16" cy="16" r="5" fill="#2f4f4c"/><circle cx="16" cy="16" r="2.5" fill="#a9cbc4"/>',
    'pts-mil':
      '<polygon points="16,2 30,16 16,30 2,16" fill="#c4523f"/><polygon points="16,6 26,16 16,26 6,16" fill="#e8907e"/>' +
      '<polygon points="10,11 11,10 22,21 21,22" fill="#4a1f17"/><polygon points="22,11 21,10 10,21 11,22" fill="#4a1f17"/>',
  };
  var html = '';
  for (var k in S) html += '<symbol id="i-' + k + '" viewBox="0 0 32 32">' + S[k] + '</symbol>';
  var d = document.createElement('div');
  d.style.display = 'none';
  d.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + html + '</svg>';
  (document.body || document.documentElement).prepend(d);
})();
