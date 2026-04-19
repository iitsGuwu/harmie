// Pre-paint theme setup (CSP-safe external script)
(function () {
  try {
    var saved = localStorage.getItem('harmies_theme_mode');
    var theme = saved === 'light' || saved === 'mid' || saved === 'dark' ? saved : 'mid';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'mid');
  }
})();
