// User actions: the only module that changes state and then re-renders.
// View modules reach these through `handlers` (state.js) to avoid circular imports.
import { state, handlers } from './state.js';
import { fetchSampleRows, computeFiltered } from './data.js';
import { renderSampleList, renderTable, markSelectedRow, updateSortHeaders, updateStatusBar } from './table.js';
import { buildSunburst, applyStatusOverlay } from './sunburst.js';
import { renderDetailPanel } from './detail-panel.js';
import { syncUrl } from './url-state.js';
import { announce, cleanName } from './utils.js';
import { trackTaxonAcrossSamples, updateBasketBadge } from './compare.js';

/** Recompute filters and redraw. Pass rebuildSunburst:false when only the status filter changed. */
export function refresh({ rebuildSunburst = true } = {}) {
    computeFiltered();
    renderTable();
    updateSortHeaders();
    updateStatusBar();
    renderFilterSummary();
    if (rebuildSunburst) buildSunburst();
    else applyStatusOverlay(state.filters.status);
    syncUrl();
}

/** Load a sample and show it. Resolves when its rows are on screen. */
export async function selectSample(sample) {
    if (!state.samples.some(s => s.sample === sample)) return false;
    state.currentSample = sample;
    state.compareList = [];
    updateBasketBadge();
    closeDetailPanel({ sync: false });
    try { localStorage.setItem('sap-selected-sample', sample); } catch (e) { /* storage unavailable */ }
    renderSampleList();
    setBusy(true);
    try {
        state.sampleData = await fetchSampleRows(sample);
    } catch (err) {
        console.error(err);
        state.sampleData = [];
        announce(`Could not load ${sample}: ${err.message}`, { tone: 'error' });
    } finally {
        setBusy(false);
    }
    refresh();
    return true;
}

/** Open the detail panel for a row of the current sample. */
export function selectReference(id) {
    const row = state.sampleData.find(d => d.id === id);
    if (!row) return false;
    state.selectedRef = id;
    markSelectedRow();
    renderDetailPanel(row);
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('detail-panel').removeAttribute('inert');
    syncUrl();
    return true;
}

export function closeDetailPanel({ sync = true } = {}) {
    const panel = document.getElementById('detail-panel');
    const hadFocus = panel.contains(document.activeElement);
    panel.classList.remove('open');
    panel.setAttribute('inert', '');
    const id = state.selectedRef;
    state.selectedRef = null;
    markSelectedRow();
    if (hadFocus && id != null) {
        const row = document.querySelector(`#table-body tr[data-id="${id}"]`);
        if (row) row.focus();
    }
    if (sync) syncUrl();
}

export function setFilterPath(path) {
    state.filterPath = [...path];
    refresh();
    const name = path.length ? cleanName(path[path.length - 1]) : 'all taxa';
    document.getElementById('sr-status').textContent =
        `Showing ${name}: ${state.filteredData.length} genomes.`;
}

export function clearFilters() {
    state.filterPath = [];
    Object.assign(state.filters, { status: 'all', minDamage: 0, minSignificance: 0, minReads: 0, search: '' });
    syncFilterControls();
    refresh();
}

export function toggleCompare(id) {
    const i = state.compareList.indexOf(id);
    if (i === -1) state.compareList.push(id); else state.compareList.splice(i, 1);
    updateBasketBadge();
}

export function toggleSampleCompare(sample) {
    const i = state.selectedSamples.indexOf(sample);
    if (i === -1) state.selectedSamples.push(sample); else state.selectedSamples.splice(i, 1);
    renderSampleList();
    syncUrl();
}

export function trackTaxon(name, level, samples = null) {
    if (name) trackTaxonAcrossSamples(name, level, samples);
}

/** Push state.filters into the toolbar inputs (after URL restore or reset). */
export function syncFilterControls() {
    const f = state.filters;
    document.querySelectorAll('#status-filter button').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.status === f.status)));
    document.getElementById('filter-damage').value = f.minDamage || '';
    document.getElementById('filter-significance').value = f.minSignificance || '';
    document.getElementById('filter-reads').value = f.minReads || '';
    document.getElementById('filter-text').value = f.search;
}

function renderFilterSummary() {
    const f = state.filters;
    const active = state.filterPath.length > 0 || f.status !== 'all' || f.search ||
        f.minDamage > 0 || f.minSignificance > 0 || f.minReads > 0;
    document.getElementById('clear-filters').hidden = !active;
}

function setBusy(busy) {
    document.getElementById('main').setAttribute('aria-busy', String(busy));
    document.getElementById('loading').hidden = !busy;
}

Object.assign(handlers, {
    selectSample, selectReference, setFilterPath, toggleCompare, toggleSampleCompare, trackTaxon, refresh,
});
