// Detail panel (side) and full-view dialog for one taxon in one sample.
import { handlers, RANK_NAMES } from './state.js';
import { n, fmt, pct, cleanName, getStatus, escapeHtml, taxonLabel, damageConfig, announce } from './utils.js';
import { drawSmiley, smileyLegendHtml, smileyTableHtml } from './smiley.js';
import { openDialog, closeDialog } from './dialog.js';
import { currentUrl } from './url-state.js';

let current = null;   // row shown in the panel

const row = (label, value, hint = '') =>
    `<div><dt${hint ? ` title="${escapeHtml(hint)}"` : ''}>${label}</dt><dd>${value}</dd></div>`;

/** Metric groups shared by the panel and the dialog. */
function metricGroups(d) {
    return [
        { id: 'fit', title: 'Damage fit (metaDMG)', rows: [
            row('Damage', `${pct(d.damage)}%`, 'Amplitude A of the fitted damage curve, bias-corrected in the analysis pipeline. Set to 0 when the fit is flagged bad.'),
            row('Significance', n(d.significance).toFixed(2), 'Z: damage estimate divided by its standard deviation'),
            row('Fit quality', escapeHtml(d.fit || 'not assessed'), 'Pipeline flag for the metaDMG fit'),
            row('A', n(d.map_A).toFixed(4), 'Amplitude of the damage curve (bias-corrected)'),
            row('q', n(d.map_q).toFixed(4), 'Decay of damage with distance from the read end'),
            row('c', n(d.map_c).toFixed(4), 'Background substitution frequency'),
            row('φ', n(d.map_phi).toFixed(1), 'Concentration of the beta-binomial model'),
        ] },
        { id: 'reads', title: 'Reads and alignment', rows: [
            row('Reads', fmt(d.n_reads)),
            row('Alignments', fmt(d.n_alns)),
            row('Read length', `${n(d.read_length_mean).toFixed(1)} ± ${n(d.read_length_std).toFixed(1)} nt`, 'Mean ± standard deviation'),
            row('Read ANI', `${n(d.read_ani_mean).toFixed(2)}%`, 'Mean identity of reads to the reference'),
            row('Edit distance', n(d.edit_distances).toFixed(2), 'Mean per read'),
            row('GC content', `${n(d.gc_content).toFixed(1)}%`, 'Of aligned reads'),
        ] },
        { id: 'coverage', title: 'Coverage QC (filterBAM)', rows: [
            row('Mean depth', `${n(d.coverage_mean).toFixed(3)}×`),
            row('Breadth', `${pct(d.breadth)}%`, 'Share of the reference covered by at least one read'),
            row('Expected breadth', `${pct(d.exp_breadth)}%`, '1 − e^(−mean depth)'),
            row('B/E ratio', n(d.breadth_exp_ratio).toFixed(3), 'Breadth divided by expected breadth; near 1 for evenly spread reads'),
            row('Norm. entropy', n(d.norm_entropy).toFixed(3), 'Higher means reads are spread more evenly'),
            row('Norm. Gini', n(d.norm_gini).toFixed(3), 'Higher means reads are more clumped'),
            row('Evenness', n(d.cov_evenness).toFixed(3)),
            row('Bases covered', fmt(d.bases_covered)),
            row('Reference length', `${fmt(d.reference_length)} bp`),
        ] },
    ];
}

function lineageHtml(d) {
    const ranks = [d.domain, d.phylum, d.class_, d.order_, d.family, d.genus, d.species];
    return `<dl class="lineage">${ranks.map((v, i) =>
        `<div><dt>${RANK_NAMES[i]}</dt><dd>${escapeHtml(cleanName(v) || '–')}</dd></div>`).join('')}</dl>`;
}

function statusLine(d) {
    const status = getStatus(d);
    const reason = d.fit === 'bad'
        ? 'the metaDMG fit is flagged bad'
        : `damage ${pct(d.damage)}% is ${status === 'damaged' ? 'above' : 'at or below'} the ${pct(damageConfig.threshold)}% threshold`;
    return `<p class="status-line"><span class="status-badge ${status}">${status}</span> <span>${reason}</span></p>`;
}

export function renderDetailPanel(d) {
    current = d;
    document.getElementById('detail-title').textContent = taxonLabel(d);
    const content = document.getElementById('detail-content');
    content.innerHTML = `
        <p class="detail-ref"><span class="mono">${escapeHtml(d.reference)}</span> in <span class="mono">${escapeHtml(d.sample)}</span></p>
        ${statusLine(d)}
        <figure class="plot">
            <canvas id="smiley-canvas"></canvas>
            ${smileyLegendHtml()}
        </figure>
        <div class="detail-actions">
            <button type="button" class="btn btn-sm" data-action="full-view">Full view</button>
            <button type="button" class="btn btn-sm" data-action="track-species">Species across samples</button>
            <button type="button" class="btn btn-sm" data-action="track-genus">Genus across samples</button>
            <button type="button" class="btn btn-sm" data-action="copy-link">Copy link</button>
        </div>
        ${metricGroups(d).map((g, i) => `
            <details class="metric-group" ${i === 0 ? 'open' : ''}>
                <summary>${g.title}</summary>
                <dl class="metrics">${g.rows.join('')}</dl>
            </details>`).join('')}
        <details class="metric-group">
            <summary>Lineage</summary>
            ${lineageHtml(d)}
        </details>
    `;
    drawSmiley(document.getElementById('smiley-canvas'), d, 'compact');
}

/** Wire the panel's buttons once; they act on whichever row is open. */
export function setupDetailPanel() {
    document.getElementById('detail-content').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn || !current) return;
        switch (btn.dataset.action) {
            case 'full-view': openTaxonDialog(current); break;
            case 'track-species': handlers.trackTaxon(current.species, 'species'); break;
            case 'track-genus': handlers.trackTaxon(current.genus, 'genus'); break;
            case 'copy-link':
                try {
                    await navigator.clipboard.writeText(currentUrl());
                    announce('Link to this view copied.');
                } catch (err) {
                    announce('Copying failed. Copy the address from the browser bar.', { tone: 'error' });
                }
                break;
        }
    });
}

export function openTaxonDialog(d) {
    let overlay = document.getElementById('taxon-dialog');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'taxon-dialog';
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div class="dialog taxon-dialog">
            <header class="dialog-header">
                <div>
                    <h2>${escapeHtml(taxonLabel(d))}</h2>
                    <p class="detail-ref"><span class="mono">${escapeHtml(d.reference)}</span> in <span class="mono">${escapeHtml(d.sample)}</span></p>
                </div>
                <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            </header>
            <div class="dialog-body taxon-dialog-body">
                <section aria-label="Smiley plot">
                    ${statusLine(d)}
                    <figure class="plot">
                        <canvas id="taxon-dialog-canvas"></canvas>
                        ${smileyLegendHtml()}
                        ${smileyTableHtml(d)}
                    </figure>
                    <h3>Lineage</h3>
                    ${lineageHtml(d)}
                </section>
                <section aria-label="Metrics">
                    ${metricGroups(d).map(g => `<h3>${g.title}</h3><dl class="metrics">${g.rows.join('')}</dl>`).join('')}
                </section>
            </div>
        </div>`;
    overlay.querySelector('[data-close]').addEventListener('click', () => closeDialog(overlay));
    openDialog(overlay, { label: `Details for ${taxonLabel(d)}`, initialFocus: '[data-close]' });
    drawSmiley(document.getElementById('taxon-dialog-canvas'), d, 'full');
}
