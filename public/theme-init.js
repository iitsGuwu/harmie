// Pre-paint theme setup (CSP-safe external script)
(function () {
  // Suppress MetaMask/extension noisy logs in console
  (function () {
    const suppressPatterns = [
      'MaxListenersExceededWarning',
      'EventEmitter memory leak detected',
      'ObjectMultiplex',
      'orphaned data for stream',
      'malformed chunk without name'
    ];

    function shouldSuppress(args) {
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (typeof arg === 'string') {
          for (let j = 0; j < suppressPatterns.length; j++) {
            if (arg.includes(suppressPatterns[j])) {
              return true;
            }
          }
        } else if (arg && typeof arg === 'object') {
          try {
            const str = JSON.stringify(arg);
            for (let j = 0; j < suppressPatterns.length; j++) {
              if (str.includes(suppressPatterns[j])) {
                return true;
              }
            }
          } catch (_) {}
        }
      }
      return false;
    }

    const origWarn = console.warn;
    console.warn = function (...args) {
      if (shouldSuppress(args)) return;
      origWarn.apply(console, args);
    };

    const origError = console.error;
    console.error = function (...args) {
      if (shouldSuppress(args)) return;
      origError.apply(console, args);
    };

    const origLog = console.log;
    console.log = function (...args) {
      if (shouldSuppress(args)) return;
      origLog.apply(console, args);
    };
  })();

  try {
    var saved = localStorage.getItem('harmies_theme_mode');
    var theme = saved === 'light' || saved === 'mid' || saved === 'dark' ? saved : 'mid';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'mid');
  }
})();
