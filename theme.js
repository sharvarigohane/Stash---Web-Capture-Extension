// Runs in <head> before first paint: picks the saved theme (or the system one)
// and initializes the compact popup size before first paint.
(function () {
  const root = document.documentElement;
  let theme = null;
  try { theme = localStorage.getItem('theme'); } catch (e) {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.dataset.theme = theme;
  root.dataset.mode = 'compact';
  root.dataset.size = 'normal';
})();
