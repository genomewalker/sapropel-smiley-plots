// Event wiring for the explorer shell: toolbar, table, sample rail, search.
// Everything is attached once; lists are handled by delegation.
import { state } from './state.js';
import { searchTaxa, exportCurrentTable } from './data.js';
import { refresh, selectSample, selectReference, closeDetailPanel, setFilterPath, clearFilters,
    toggleCompare, toggleSampleCompare, trackTaxon } from './actions.js';
import { cleanName, escapeHtml, fmt, announce } from './utils.js';
import { openDialog, closeDialog, hasOpenDialog } from './dialog.js';
import { currentUrl } from './url-state.js';
import { openComparePanel } from './compare.js';

const $ = (id) => document.getElementById(id);

export function setupEventListeners() {
    setupToolbar();
    setupTable();
    setupSampleRail();
    setupSearch();
    setupResizeHandle();

    $('detail-close').addEventListener('click', () => closeDetailPanel());
    const intro = $('intro');
    let introSeen = false;
    try { introSeen = localStorage.getItem('sap-intro-dismissed') === '1'; } catch (e) { /* storage unavailable */ }
    intro.hidden = introSeen;
    $('intro-dismiss').addEventListener('click', () => {
        intro.hidden = true;
        try { localStorage.setItem('sap-intro-dismissed', '1'); } catch (e) { /* storage unavailable */ }
    });

    $('sunburst-up').addEventListener('click', () => setFilterPath(state.filterPath.slice(0, -1)));
    $('clear-filters').addEventListener('click', clearFilters);

    $('export-btn').addEventListener('click', () => {
        const count = exportCurrentTable();
        announce(`Exported ${fmt(count)} rows as CSV.`);
    });
    $('share-btn').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(currentUrl());
            announce('Link to this view copied.');
        } catch (e) {
            announce('Copying failed. Copy the address from the browser bar.', { tone: 'error' });
        }
    });
    $('compare-samples-btn').addEventListener('click', async () => {
        const { openCompareSamples } = await import('./compare-samples.js');
        openCompareSamples();
    });
    $('compare-taxa-btn').addEventListener('click', openComparePanel);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !hasOpenDialog() && state.selectedRef != null) closeDetailPanel();
    });
}

function setupToolbar() {
    document.querySelectorAll('#status-filter button').forEach(btn => {
        btn.addEventListener('click', () => {
            state.filters.status = btn.dataset.status;
            document.querySelectorAll('#status-filter button').forEach(b =>
                b.setAttribute('aria-pressed', String(b === btn)));
            refresh({ rebuildSunburst: false });
        });
    });

    const numeric = { 'filter-damage': 'minDamage', 'filter-significance': 'minSignificance', 'filter-reads': 'minReads' };
    Object.entries(numeric).forEach(([id, key]) => {
        $(id).addEventListener('change', (e) => {
            state.filters[key] = Math.max(0, parseFloat(e.target.value) || 0);
            refresh();
        });
    });

    let timer = null;
    $('filter-text').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.filters.search = e.target.value.trim();
            refresh();
        }, 180);
    });
}

function setupTable() {
    document.querySelectorAll('.taxa-table th[data-sort] button').forEach(btn => {
        btn.addEventListener('click', () => {
            const col = btn.parentElement.dataset.sort;
            if (state.sortColumn === col) {
                state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortColumn = col;
                state.sortDirection = ['species', 'family'].includes(col) ? 'asc' : 'desc';
            }
            refresh({ rebuildSunburst: false });
        });
    });

    const tbody = $('table-body');
    tbody.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="clear-filters"]')) return clearFilters();
        if (e.target.closest('.cell-check')) return;    // checkbox handled on change
        const row = e.target.closest('tr[data-id]');
        if (row) selectReference(Number(row.dataset.id));
    });
    tbody.addEventListener('change', (e) => {
        if (e.target.matches('input[type="checkbox"][data-id]')) toggleCompare(Number(e.target.dataset.id));
    });
    tbody.addEventListener('keydown', (e) => {
        const row = e.target.closest('tr[data-id]');
        if (!row || e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectReference(Number(row.dataset.id));
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
            if (next) next.focus();
        }
    });
}

function setupSampleRail() {
    const list = $('sample-list');
    const rail = $('sample-rail');
    const toggle = $('rail-toggle');
    const setRail = (open) => {
        rail.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setRail(!rail.classList.contains('open')));
    $('rail-scrim').addEventListener('click', () => setRail(false));

    list.addEventListener('click', (e) => {
        const pick = e.target.closest('.sample-pick');
        if (!pick) return;
        setRail(false);
        selectSample(pick.closest('.sample-row').dataset.sample);
    });
    list.addEventListener('change', (e) => {
        if (e.target.matches('input[type="checkbox"]')) {
            const sample = e.target.dataset.sample;
            toggleSampleCompare(sample);
            // The list was re-rendered; put focus back on the same checkbox.
            const again = [...list.querySelectorAll('input[type="checkbox"]')].find(el => el.dataset.sample === sample);
            if (again) again.focus();
        }
    });
}

/** Search across all samples: a combobox with a listbox of grouped taxa. */
function setupSearch() {
    const overlay = $('search-overlay');
    const input = $('search-input');
    const results = $('search-results');
    const hint = $('search-hint');
    let hits = [];
    let active = -1;
    let timer = null;
    let seq = 0;

    const open = () => {
        openDialog(overlay, { label: 'Search taxa in all samples', initialFocus: '#search-input' });
        input.select();
    };
    $('search-trigger').addEventListener('click', open);
    document.addEventListener('keydown', (e) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
        else if (e.key === '/' && !typing && !hasOpenDialog()) { e.preventDefault(); open(); }
    });

    const setActive = (i) => {
        active = i;
        results.querySelectorAll('[role="option"]').forEach((el, j) => {
            el.setAttribute('aria-selected', String(j === i));
            if (j === i) el.scrollIntoView({ block: 'nearest' });
        });
        input.setAttribute('aria-activedescendant', i >= 0 ? `search-opt-${i}` : '');
    };

    const choose = (i) => {
        const hit = hits[i];
        if (!hit) return;
        closeDialog(overlay);
        trackTaxon(hit.name, hit.level);
    };

    const render = (query) => {
        input.setAttribute('aria-expanded', String(hits.length > 0));
        if (hits.length === 0) {
            results.innerHTML = '';
            hint.textContent = `No species, genus or family name contains “${query}”. Bacterial and archaeal names are GTDB-style, e.g. Prochlorococcus_A.`;
            return;
        }
        hint.textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'}. Enter opens the taxon in every sample where it occurs.`;
        results.innerHTML = hits.map((t, i) => `
            <li role="option" id="search-opt-${i}" data-i="${i}" aria-selected="false">
                <span class="opt-level">${t.level}</span>
                <span class="opt-name">${escapeHtml(cleanName(t.name))}</span>
                <span class="opt-meta">${t.sample_count} of ${state.samples.length} samples, ${fmt(t.row_count)} genomes, ${fmt(t.damaged_count)} damaged</span>
            </li>`).join('');
        setActive(0);
    };

    input.addEventListener('input', () => {
        const query = input.value.trim();
        clearTimeout(timer);
        if (query.length < 2) {
            hits = [];
            results.innerHTML = '';
            input.setAttribute('aria-expanded', 'false');
            hint.textContent = 'Type at least two letters of a species, genus or family name, or a reference accession.';
            return;
        }
        timer = setTimeout(async () => {
            const mine = ++seq;
            hint.textContent = 'Searching…';
            try {
                const found = await searchTaxa(query);
                if (mine !== seq) return;      // a newer query has started
                hits = found;
                render(query);
            } catch (err) {
                console.error(err);
                hint.textContent = `Search failed: ${err.message}`;
            }
        }, 160);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, hits.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    });
    results.addEventListener('click', (e) => {
        const li = e.target.closest('[role="option"]');
        if (li) choose(Number(li.dataset.i));
    });
}

/** Drag or use the arrow keys on the separator to resize the sunburst panel. */
function setupResizeHandle() {
    const handle = $('resize-handle');
    const panel = $('sunburst-panel');
    const area = panel.parentElement;
    const clamp = (w) => Math.min(Math.max(300, w), area.offsetWidth * 0.55);
    const setWidth = (w) => { panel.style.width = clamp(w) + 'px'; };

    handle.addEventListener('pointerdown', (e) => {
        const startX = e.clientX, startW = panel.offsetWidth;
        handle.setPointerCapture(e.pointerId);
        const move = (ev) => setWidth(startW + ev.clientX - startX);
        const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            window.dispatchEvent(new Event('resize'));
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        e.preventDefault();
    });
    handle.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') setWidth(panel.offsetWidth - 24);
        if (e.key === 'ArrowRight') setWidth(panel.offsetWidth + 24);
    });
}
