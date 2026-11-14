// Entry point for explorer/index.html.
//
// Start-up order: config.json -> DuckDB-WASM -> sample list -> the view named
// in the URL (falling back to the last sample used, then the youngest sample).
import { state } from './state.js';
import { initDuckDB, fetchSamples } from './data.js';
import { loadConfig, announce, escapeHtml, pct, damageConfig } from './utils.js';
import { renderSampleList } from './table.js';
import { selectSample, selectReference, syncFilterControls, refresh } from './actions.js';
import { setupEventListeners } from './ui.js';
import { setupDetailPanel } from './detail-panel.js';
import { readUrlState, syncUrl } from './url-state.js';

const setLoading = (text) => { document.getElementById('loading-text').textContent = text; };

async function init() {
    setupEventListeners();
    setupDetailPanel();

    setLoading('Reading configuration…');
    await loadConfig();
    document.getElementById('threshold-note').textContent =
        `Damaged: fit not flagged bad and damage above ${pct(damageConfig.threshold)}%.`;

    setLoading('Starting DuckDB-WASM…');
    await initDuckDB();

    setLoading('Loading samples…');
    const samples = await fetchSamples();
    if (samples.length === 0) throw new Error('meta.parquet contains no samples.');

    await restoreView(samples);
}

/** Apply ?sample=…&taxon=… and friends; report anything that does not resolve. */
async function restoreView(samples) {
    const url = readUrlState();
    const names = samples.map(s => s.sample);
    const problems = [];

    Object.assign(state.filters, {
        status: url.status, search: url.search,
        minDamage: url.minDamage, minSignificance: url.minSignificance, minReads: url.minReads,
    });
    state.filterPath = url.path;
    if (url.sortColumn) { state.sortColumn = url.sortColumn; state.sortDirection = url.sortDirection; }
    state.selectedSamples = url.compare.filter(s => names.includes(s));
    syncFilterControls();

    let sample = null;
    if (url.sample) {
        if (names.includes(url.sample)) sample = url.sample;
        else problems.push(`Sample “${url.sample}” is not in this data set.`);
    }
    if (!sample) {
        let saved = null;
        try { saved = localStorage.getItem('sap-selected-sample'); } catch (e) { /* storage unavailable */ }
        const youngest = [...samples].sort((a, b) => (a.age_ka ?? Infinity) - (b.age_ka ?? Infinity))[0];
        sample = names.includes(saved) ? saved : youngest.sample;
    }
    renderSampleList();
    await selectSample(sample);

    if (url.path.length && state.sunburstData.length === 0 && state.sampleData.length > 0) {
        problems.push(`No taxa under “${url.path.join(' / ')}” in ${sample}; showing all taxa.`);
        state.filterPath = [];
        refresh();
    }
    if (url.taxon) {
        const row = state.sampleData.find(d => d.reference === url.taxon);
        if (row) selectReference(row.id);
        else problems.push(`Reference “${url.taxon}” is not present in ${sample}.`);
    }
    syncUrl();
    if (problems.length) announce(problems.join(' '), { tone: 'error' });
}

init().catch(err => {
    console.error('Start-up failed:', err);
    document.getElementById('loading').hidden = true;
    const box = document.getElementById('fatal');
    box.hidden = false;
    box.querySelector('p').innerHTML =
        `${escapeHtml(err.message || String(err))}<br>The explorer needs WebAssembly, web workers and access to
         cdn.jsdelivr.net for DuckDB-WASM. The data files can still be downloaded directly.`;
});
