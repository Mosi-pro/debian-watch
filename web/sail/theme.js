// Läuft vor dem ersten Rendern (kein Aufblitzen im falschen Theme).
(function () {
  var t = null;
  try { t = localStorage.getItem('mosisail_theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
})();
