// Light/dark theme. Loaded as a classic blocking script in <head> so the
// theme is set before first paint. Any element with [data-theme-toggle]
// switches it; a `themechange` event on window lets canvases redraw.
(function () {
    var KEY = 'sap-theme';
    var root = document.documentElement;

    function stored() {
        try { return localStorage.getItem(KEY); } catch (e) { return null; }
    }

    function systemTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function apply(theme) {
        root.dataset.theme = theme;
        document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
            var next = theme === 'dark' ? 'light' : 'dark';
            btn.setAttribute('aria-label', 'Switch to ' + next + ' theme');
            btn.setAttribute('title', 'Switch to ' + next + ' theme');
        });
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
    }

    apply(stored() || systemTheme());

    document.addEventListener('DOMContentLoaded', function () {
        apply(root.dataset.theme);
        document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
                try { localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
                apply(next);
            });
        });
    });

    // Follow the system setting until the user picks a theme.
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            if (!stored()) apply(systemTheme());
        });
    }
})();
