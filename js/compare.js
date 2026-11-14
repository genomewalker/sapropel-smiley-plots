// Two dialogs that put smiley plots side by side:
//
//   trackTaxonAcrossSamples()  one species, genus or family in every sample
//                              where it occurs, ordered by sample age
//   openComparePanel()         the taxa collected for comparison: rows ticked
//                              in the table plus rows added from the first dialog
import { state, handlers } from './state.js';
import { fetchTaxonAcrossSamples } from './data.js';
import { n, fmt, pct, cleanName, getStatus, escapeHtml, taxonLabel, featureLabel, ageLabel,
    announce, downloadCsv, exportHeaders, exportRow } from './utils.js';
import { drawSmiley, smileyLegendHtml } from './smiley.js';
import { openDialog, closeDialog } from './dialog.js';
import { renderTable } from './table.js';

const MAX_CARDS = 48;       // plots drawn at once; the CSV export has every row

/** Rows added from the tracking dialog (they may belong to any sample). */
const basket = [];
const sameRow = (a, b) => a.id === b.id && a.sample === b.sample;

const sampleInfo = (name) => state.samples.find(s => s.sample === name) || {};
const sampleAge = (name) => sampleInfo(name).age_ka ?? Infinity;

function getOverlay(id) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'overlay';
        document.body.appendChild(el);
    }
    return el;
}

const closeButton = `
    <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>`;

function card(d, i, { removable = false } = {}) {
    const status = getStatus(d);
    const info = sampleInfo(d.sample);
    return `
        <article class="plot-card" data-i="${i}" data-status="${status}">
            <header>
                <h3>${escapeHtml(taxonLabel(d))}</h3>
                <p class="mono">${escapeHtml(d.sample)}</p>
                <p>${escapeHtml(featureLabel(info.specific_feature))}${info.age_ka != null ? `, ${ageLabel(info.age_ka)}` : ''}</p>
            </header>
            <canvas id="card-canvas-${removable ? 'c' : 't'}-${i}"></canvas>
            <dl class="card-metrics">
                <div><dt>Damage</dt><dd>${pct(d.damage)}%</dd></div>
                <div><dt>Signif.</dt><dd>${n(d.significance).toFixed(1)}</dd></div>
                <div><dt>Reads</dt><dd>${fmt(d.n_reads)}</dd></div>
            </dl>
            <footer>
                <span class="status-badge ${status}">${status}</span>
                <button type="button" class="btn btn-sm" data-action="open">Open in sample</button>
                ${removable
                    ? '<button type="button" class="btn btn-sm" data-action="remove">Remove</button>'
                    : '<button type="button" class="btn btn-sm" data-action="add">Add to comparison</button>'}
            </footer>
        </article>`;
}

/** Jump from a card to that sample with the taxon open. */
async function openInSample(d, overlay) {
    closeDialog(overlay);
    if (state.currentSample !== d.sample) await handlers.selectSample(d.sample);
    const row = state.sampleData.find(r => r.reference === d.reference);
    if (row) handlers.selectReference(row.id);
}

export function updateBasketBadge() {
    const badge = document.getElementById('compare-taxa-count');
    if (!badge) return;
    const total = comparisonRows().length;
    badge.textContent = total;
    badge.hidden = total === 0;
}

// ---------- One taxon across samples ----------

export async function trackTaxonAcrossSamples(name, level = 'species', samples = null) {
    if (!state.conn || !name) return;
    const overlay = getOverlay('tracking-dialog');
    const title = cleanName(name);
    overlay.innerHTML = `
        <div class="dialog wide">
            <header class="dialog-header"><div><h2>${escapeHtml(title)}</h2><p>Loading…</p></div>${closeButton}</header>
            <div class="dialog-body"><p class="loading-line"><span class="spinner" aria-hidden="true"></span> Querying all samples…</p></div>
        </div>`;
    overlay.querySelector('[data-close]').addEventListener('click', () => closeDialog(overlay));
    openDialog(overlay, { label: `${title} across samples`, initialFocus: '[data-close]' });

    let rows;
    try {
        rows = await fetchTaxonAcrossSamples(name, level, samples);
    } catch (err) {
        console.error(err);
        overlay.querySelector('.dialog-body').innerHTML =
            `<div class="empty-block"><h3>The query failed</h3><p>${escapeHtml(err.message)}</p></div>`;
        return;
    }
    // Youngest sample first, then by damage within a sample.
    rows.sort((a, b) => sampleAge(a.sample) - sampleAge(b.sample) || n(b.damage) - n(a.damage));
    renderTracking(overlay, title, level, rows, samples);
}

function renderTracking(overlay, title, level, rows, samples) {
    const damaged = rows.filter(d => getStatus(d) === 'damaged').length;
    const inSamples = new Set(rows.map(d => d.sample)).size;
    const scope = samples && samples.length ? `${samples.length} compared samples` : `${state.samples.length} samples`;
    const shown = rows.slice(0, MAX_CARDS);

    overlay.innerHTML = `
        <div class="dialog wide">
            <header class="dialog-header">
                <div>
                    <h2>${escapeHtml(title)}</h2>
                    <p>${level[0].toUpperCase() + level.slice(1)} found in ${inSamples} of ${scope}:
                       ${fmt(rows.length)} reference genome${rows.length === 1 ? '' : 's'}, ${fmt(damaged)} damaged.
                       Ordered by sample age, youngest first.</p>
                </div>
                ${closeButton}
            </header>
            <div class="dialog-toolbar">
                <div class="segmented" role="group" aria-label="Damage status">
                    <button type="button" data-status="all" aria-pressed="true">All ${fmt(rows.length)}</button>
                    <button type="button" data-status="damaged" aria-pressed="false">Damaged ${fmt(damaged)}</button>
                    <button type="button" data-status="non-damaged" aria-pressed="false">Non-damaged ${fmt(rows.length - damaged)}</button>
                </div>
                ${smileyLegendHtml()}
            </div>
            <div class="dialog-body">
                ${rows.length === 0 ? `<div class="empty-block"><h3>Not found</h3>
                    <p>No reference genome of this ${level} passed the read-count and coverage filters in these samples.</p></div>` : `
                <div class="card-grid">${shown.map((d, i) => card(d, i)).join('')}</div>
                ${rows.length > MAX_CARDS ? `<p class="muted">Showing the first ${MAX_CARDS} of ${fmt(rows.length)} genomes. The CSV export contains all of them.</p>` : ''}`}
            </div>
            <footer class="dialog-footer">
                ${rows.length ? `<button type="button" class="btn" data-action="export">Export CSV</button>
                <button type="button" class="btn" data-action="add-all">Add shown to comparison</button>` : ''}
                <button type="button" class="btn btn-primary" data-close>Done</button>
            </footer>
        </div>`;
    openDialog(overlay, { label: `${title} across samples`, initialFocus: '[data-close]' });
    shown.forEach((d, i) => drawSmiley(document.getElementById(`card-canvas-t-${i}`), d, 'card'));

    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeDialog(overlay)));
    overlay.querySelectorAll('[data-status]').forEach(btn => btn.addEventListener('click', () => {
        overlay.querySelectorAll('[data-status]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        overlay.querySelectorAll('.plot-card').forEach(c => {
            c.hidden = btn.dataset.status !== 'all' && c.dataset.status !== btn.dataset.status;
        });
    }));
    overlay.querySelector('.dialog').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const cardEl = btn.closest('.plot-card');
        const d = cardEl ? shown[Number(cardEl.dataset.i)] : null;
        if (btn.dataset.action === 'open') openInSample(d, overlay);
        else if (btn.dataset.action === 'add') {
            if (!basket.some(b => sameRow(b, d))) basket.push(d);
            btn.disabled = true;
            btn.textContent = 'Added';
            updateBasketBadge();
        } else if (btn.dataset.action === 'add-all') {
            shown.forEach(r => { if (!basket.some(b => sameRow(b, r))) basket.push(r); });
            updateBasketBadge();
            closeDialog(overlay);
            openComparePanel();
        } else if (btn.dataset.action === 'export') {
            downloadCsv(`${title.replace(/[^a-zA-Z0-9]+/g, '_')}_across_samples.csv`, exportHeaders(), rows.map(exportRow));
            announce(`Exported ${fmt(rows.length)} rows as CSV.`);
        }
    });
}

// ---------- Collected taxa ----------

/** Basket rows plus rows ticked in the current table, without duplicates. */
function comparisonRows() {
    const ticked = state.compareList.map(id => state.sampleData.find(d => d.id === id)).filter(Boolean);
    return [...basket, ...ticked.filter(t => !basket.some(b => sameRow(b, t)))];
}

export function openComparePanel() {
    const overlay = getOverlay('compare-dialog');
    const rows = comparisonRows();
    const damaged = rows.filter(d => getStatus(d) === 'damaged').length;
    const nSamples = new Set(rows.map(d => d.sample)).size;

    overlay.innerHTML = `
        <div class="dialog wide">
            <header class="dialog-header">
                <div>
                    <h2>Compare taxa</h2>
                    <p>${rows.length ? `${rows.length} genome${rows.length === 1 ? '' : 's'} from ${nSamples} sample${nSamples === 1 ? '' : 's'}, ${damaged} damaged.` : 'Nothing selected yet.'}</p>
                </div>
                ${closeButton}
            </header>
            <div class="dialog-body">
                ${rows.length === 0 ? `
                <div class="empty-block">
                    <h3>No taxa selected</h3>
                    <p>Tick the box at the start of a table row to add that genome. To follow one species or genus through
                       every sample, open a taxon and choose “Species across samples”, or use the search.</p>
                </div>` : `
                <div class="dialog-toolbar inline">${smileyLegendHtml()}</div>
                <div class="card-grid">${rows.map((d, i) => card(d, i, { removable: true })).join('')}</div>
                <div class="table-scroll">
                    <table class="compare-table">
                        <caption class="visually-hidden">Metrics of the compared genomes</caption>
                        <thead><tr>
                            <th scope="col">Taxon</th><th scope="col">Sample</th><th scope="col">Status</th>
                            <th scope="col">Damage</th><th scope="col">Signif.</th>
                            <th scope="col">A</th><th scope="col">q</th><th scope="col">c</th><th scope="col">φ</th>
                            <th scope="col">Reads</th><th scope="col">Depth</th><th scope="col">Breadth</th>
                            <th scope="col">B/E</th><th scope="col">Entropy</th><th scope="col">Gini</th>
                            <th scope="col">ANI</th><th scope="col">GC</th>
                        </tr></thead>
                        <tbody>${rows.map(d => `
                            <tr>
                                <th scope="row">${escapeHtml(taxonLabel(d))}<span class="taxon-ref">${escapeHtml(d.reference)}</span></th>
                                <td class="mono">${escapeHtml(d.sample)}</td>
                                <td><span class="status-badge ${getStatus(d)}">${getStatus(d)}</span></td>
                                <td class="num">${pct(d.damage)}%</td>
                                <td class="num">${n(d.significance).toFixed(1)}</td>
                                <td class="num">${n(d.map_A).toFixed(3)}</td>
                                <td class="num">${n(d.map_q).toFixed(3)}</td>
                                <td class="num">${n(d.map_c).toFixed(4)}</td>
                                <td class="num">${n(d.map_phi).toFixed(0)}</td>
                                <td class="num">${fmt(d.n_reads)}</td>
                                <td class="num">${n(d.coverage_mean).toFixed(2)}×</td>
                                <td class="num">${pct(d.breadth)}%</td>
                                <td class="num">${n(d.breadth_exp_ratio).toFixed(2)}</td>
                                <td class="num">${n(d.norm_entropy).toFixed(3)}</td>
                                <td class="num">${n(d.norm_gini).toFixed(3)}</td>
                                <td class="num">${n(d.read_ani_mean).toFixed(1)}%</td>
                                <td class="num">${n(d.gc_content).toFixed(1)}%</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`}
            </div>
            <footer class="dialog-footer">
                ${rows.length ? `<button type="button" class="btn" data-action="export">Export CSV</button>
                <button type="button" class="btn" data-action="clear">Remove all</button>` : ''}
                <button type="button" class="btn btn-primary" data-close>Done</button>
            </footer>
        </div>`;
    openDialog(overlay, { label: 'Compare taxa', initialFocus: '[data-close]' });
    rows.forEach((d, i) => drawSmiley(document.getElementById(`card-canvas-c-${i}`), d, 'card'));

    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeDialog(overlay)));
    overlay.querySelector('.dialog').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const cardEl = btn.closest('.plot-card');
        const d = cardEl ? rows[Number(cardEl.dataset.i)] : null;
        if (btn.dataset.action === 'open') return openInSample(d, overlay);
        if (btn.dataset.action === 'export') {
            downloadCsv('sapropel_taxa_comparison.csv', exportHeaders(), rows.map(exportRow));
            return announce(`Exported ${fmt(rows.length)} rows as CSV.`);
        }
        if (btn.dataset.action === 'remove') {
            const i = basket.findIndex(b => sameRow(b, d));
            if (i !== -1) basket.splice(i, 1);
            state.compareList = state.compareList.filter(id => !(id === d.id && d.sample === state.currentSample));
        } else if (btn.dataset.action === 'clear') {
            basket.length = 0;
            state.compareList = [];
        }
        renderTable();          // untick the table checkboxes
        updateBasketBadge();
        openComparePanel();     // re-render in place
    });
}
