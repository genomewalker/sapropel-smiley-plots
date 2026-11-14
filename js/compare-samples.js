// "Compare samples" dialog: one small taxonomy sunburst per ticked sample,
// drilled down together, with each sample's most damaged genomes listed
// below and marked as shared with, or unique among, the compared samples.
/* global d3 */
import { state, handlers, RANK_COLUMNS, RANK_NAMES } from './state.js';
import { fetchSampleMeta } from './data.js';
import { fmt, pct, cleanName, getStatus, domainColor, escapeHtml, taxonLabel, featureLabel, ageLabel, cssVar } from './utils.js';
import { openDialog, closeDialog } from './dialog.js';

const RINGS = 4;        // domain → order
const SIZE = 220;
const HOLE = 34;
const TOP_N = 8;

let panels = [];        // [{ sample, rows }]
let path = [];          // shared drill-down, from the domain
let mode = 'all';       // 'all' | 'shared' | 'unique'

const overlay = () => document.getElementById('compare-overlay');
const inPath = (d) => path.every((name, i) => d[RANK_COLUMNS[i]] === name);
const speciesKey = (d) => d.species || d.reference;

export async function openCompareSamples() {
    const el = overlay();
    path = [];
    mode = 'all';
    const samples = state.selectedSamples
        .map(name => state.samples.find(s => s.sample === name)).filter(Boolean)
        .sort((a, b) => (a.age_ka ?? 0) - (b.age_ka ?? 0));

    el.innerHTML = `
        <div class="dialog compare-samples">
            <header class="dialog-header">
                <div>
                    <h2>Compare samples</h2>
                    <p id="cs-subtitle">${samples.length ? `${samples.length} sample${samples.length > 1 ? 's' : ''}, youngest first` : 'No samples selected'}</p>
                </div>
                <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            </header>
            <div class="dialog-body">
                ${samples.length === 0 ? `
                    <div class="empty-block">
                        <h3>No samples selected</h3>
                        <p>Tick the box next to two or more samples in the sample list, then open this view again.</p>
                    </div>` : `
                    <div class="cs-toolbar">
                        <div class="segmented" role="group" aria-label="Genomes listed">
                            <button type="button" data-mode="all" aria-pressed="true">All</button>
                            <button type="button" data-mode="shared" aria-pressed="false">Shared <span id="cs-shared"></span></button>
                            <button type="button" data-mode="unique" aria-pressed="false">Unique <span id="cs-unique"></span></button>
                        </div>
                        <nav id="cs-path" aria-label="Taxonomy level"></nav>
                    </div>
                    <div class="cs-grid" id="cs-grid" aria-busy="true">
                        <p class="loading-line"><span class="spinner" aria-hidden="true"></span> Loading ${samples.length} samples…</p>
                    </div>`}
            </div>
        </div>`;
    el.querySelector('[data-close]').addEventListener('click', () => closeDialog(el));
    openDialog(el, { label: 'Compare samples', initialFocus: '[data-close]' });
    if (samples.length === 0) return;

    el.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        el.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        render();
    }));

    try {
        panels = await Promise.all(samples.map(async s => ({ sample: s, rows: await fetchSampleMeta(s.sample) })));
    } catch (err) {
        console.error(err);
        document.getElementById('cs-grid').innerHTML =
            `<div class="empty-block"><h3>The samples could not be loaded</h3><p>${escapeHtml(err.message)}</p></div>`;
        return;
    }
    render();
}

function render() {
    const grid = document.getElementById('cs-grid');
    if (!grid) return;
    grid.setAttribute('aria-busy', 'false');

    // In how many compared samples does each species occur (within the path)?
    const occurrence = new Map();
    const scoped = panels.map(p => p.rows.filter(inPath));
    scoped.forEach(rows => new Set(rows.map(speciesKey)).forEach(k => occurrence.set(k, (occurrence.get(k) || 0) + 1)));
    const shared = [...occurrence.values()].filter(c => c > 1).length;
    document.getElementById('cs-shared').textContent = fmt(shared);
    document.getElementById('cs-unique').textContent = fmt(occurrence.size - shared);

    renderPath();
    grid.innerHTML = panels.map((p, i) => {
        const rows = scoped[i];
        const damaged = rows.filter(d => getStatus(d) === 'damaged').length;
        const listed = rows.filter(d => mode === 'all' || (occurrence.get(speciesKey(d)) > 1) === (mode === 'shared'));
        return `
        <section class="cs-card" aria-label="${escapeHtml(p.sample.sample)}">
            <header>
                <h3 class="mono">${escapeHtml(p.sample.sample)}</h3>
                <p>${escapeHtml(featureLabel(p.sample.specific_feature))}, ${ageLabel(p.sample.age_ka)}</p>
                <p>${fmt(damaged)} of ${fmt(rows.length)} genomes damaged</p>
            </header>
            <div class="cs-figure"><svg id="cs-svg-${i}" role="img"></svg></div>
            <h4>${mode === 'all' ? 'Highest damage' : mode === 'shared' ? 'Shared, highest damage' : 'Unique, highest damage'}
                <span class="count">${fmt(listed.length)}</span></h4>
            ${listed.length === 0 ? '<p class="muted">No genomes in this group.</p>' : `<ul class="cs-list">
                ${listed.slice(0, TOP_N).map(d => `
                    <li><button type="button" data-species="${escapeHtml(d.species || '')}" data-id="${d.id}" data-sample="${escapeHtml(d.sample)}">
                        <span class="cs-name">${escapeHtml(taxonLabel(d))}</span>
                        <span class="cs-tag">${occurrence.get(speciesKey(d)) > 1 ? `in ${occurrence.get(speciesKey(d))}` : 'unique'}</span>
                        <span class="cs-damage">${pct(d.damage)}%</span>
                    </button></li>`).join('')}
            </ul>`}
        </section>`;
    }).join('');

    panels.forEach((p, i) => drawMini(document.getElementById(`cs-svg-${i}`), scoped[i], p.sample.sample));

    grid.querySelectorAll('.cs-list button').forEach(btn => btn.addEventListener('click', () => {
        const names = panels.map(p => p.sample.sample);
        closeDialog(overlay());
        if (btn.dataset.species) handlers.trackTaxon(btn.dataset.species, 'species', names);
    }));
}

function renderPath() {
    const nav = document.getElementById('cs-path');
    nav.innerHTML = `<ol>
        <li><button type="button" class="crumb" data-depth="0" ${path.length ? '' : 'aria-current="true"'}>All taxa</button></li>
        ${path.map((name, i) => `<li><button type="button" class="crumb" data-depth="${i + 1}" title="${RANK_NAMES[i]}"
            ${i === path.length - 1 ? 'aria-current="true"' : ''}>${escapeHtml(cleanName(name))}</button></li>`).join('')}
    </ol>${path.length ? '' : '<span class="muted">Select a segment to drill down in every sample.</span>'}`;
    nav.querySelectorAll('.crumb').forEach(btn => btn.addEventListener('click', () => {
        path = path.slice(0, Number(btn.dataset.depth));
        render();
    }));
}

/** Small sunburst of the next RINGS ranks below the shared path. */
function drawMini(svgEl, rows, sampleName) {
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', [-SIZE / 2, -SIZE / 2, SIZE, SIZE]);
    const totalReads = d3.sum(rows, d => Number(d.n_reads) || 0);
    svgEl.setAttribute('aria-label', rows.length
        ? `Taxonomy of ${sampleName}${path.length ? ` within ${cleanName(path[path.length - 1])}` : ''}: ${fmt(rows.length)} genomes, ${fmt(totalReads)} reads.`
        : `${sampleName}: no genomes at this level.`);
    if (rows.length === 0) return;

    const ranks = RANK_COLUMNS.slice(path.length, path.length + RINGS);
    const root = { name: 'root', children: [], index: new Map() };
    for (const d of rows) {
        let node = root;
        for (const col of ranks) {
            const name = d[col];
            if (!name) break;
            let child = node.index.get(name);
            if (!child) {
                child = { name, children: [], index: new Map(), reads: 0, domain: d.domain };
                node.index.set(name, child);
                node.children.push(child);
            }
            node = child;
        }
        // Reads are attached to the deepest drawn rank.
        if (node !== root) node.reads += Number(d.n_reads) || 0;
    }
    const h = d3.hierarchy(root).sum(d => d.reads || 0).sort((a, b) => b.value - a.value);
    if (!h.height) return;
    d3.partition().size([2 * Math.PI, h.height + 1])(h);
    const ring = (SIZE / 2 - HOLE) / h.height;
    const arc = d3.arc()
        .startAngle(d => d.x0).endAngle(d => d.x1)
        .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.006)).padRadius(SIZE / 2)
        .innerRadius(d => HOLE + (d.y0 - 1) * ring)
        .outerRadius(d => HOLE + (d.y1 - 1) * ring - 1);

    const label = svg.append('text').attr('class', 'cs-centre').attr('text-anchor', 'middle').attr('dy', '0.35em');
    const setLabel = (text) => label.text(text.length > 11 ? text.slice(0, 10) + '…' : text);
    setLabel(fmt(rows.length));

    svg.append('g').selectAll('path')
        .data(h.descendants().slice(1).filter(d => d.x1 > d.x0))
        .join('path')
        .attr('d', arc)
        .attr('class', 'arc')
        .attr('data-name', d => d.data.name)
        .attr('fill', d => {
            const c = d3.hsl(domainColor(d.data.domain));
            c.l = Math.min(0.8, c.l + (d.depth - 1) * 0.05);
            return c.formatHex();
        })
        .attr('stroke', cssVar('--bg-deep')).attr('stroke-width', 0.4)
        .on('mouseenter', (event, d) => {
            setLabel(cleanName(d.data.name));
            // Highlight the same taxon in every sample.
            d3.selectAll('#cs-grid .arc').classed('dim', function () { return this.dataset.name !== d.data.name; });
        })
        .on('mouseleave', () => {
            setLabel(fmt(rows.length));
            d3.selectAll('#cs-grid .arc').classed('dim', false);
        })
        .on('click', (event, d) => {
            path = [...path, ...d.ancestors().reverse().slice(1).map(a => a.data.name)];
            render();
        })
        .append('title').text(d => `${cleanName(d.data.name)}: ${fmt(d.value)} reads`);
}
