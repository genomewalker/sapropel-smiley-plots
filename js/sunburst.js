// Taxonomy sunburst for the current sample.
//
// Rings run from the current drill-down level (centre) outwards to single
// reference genomes (outer ring). Arc angle is proportional to read count.
// Colour encodes the domain; in the outer ring a solid fill marks a damaged
// genome and a hatched fill a non-damaged one.
//
// The SVG itself is exposed as one image with a text summary. Keyboard and
// screen-reader users drill down through the breadcrumb and the list of
// groups at the current level rendered below it, which mirror the arcs.
/* global d3 */
import { state, handlers, RANK_COLUMNS, RANK_NAMES } from './state.js';
import { fmt, cleanName, getStatus, domainColor, DOMAINS, escapeHtml, reducedMotion, taxonLabel, cssVar } from './utils.js';

const SIZE = 480;
const HOLE = 62;          // radius of the centre label
const LIST_LIMIT = 8;     // groups listed before "Show all"

let paths = null;         // d3 selection of arcs, kept for the status overlay
let listExpanded = false;

/** A hierarchical path starts at the domain; other paths are single names. */
const isHierarchical = (path) => path.length > 0 && /^d__/.test(path[0]);

function buildHierarchy(rows, baseDepth) {
    const root = { name: 'root', children: [], index: new Map() };
    for (const d of rows) {
        let node = root;
        for (let i = baseDepth; i < RANK_COLUMNS.length; i++) {
            const name = d[RANK_COLUMNS[i]];
            if (!name) continue;
            let child = node.index.get(name);
            if (!child) {
                child = { name, rank: i, children: [], index: new Map() };
                node.index.set(name, child);
                node.children.push(child);
            }
            node = child;
        }
        node.children.push({ name: d.species || d.reference, row: d, status: getStatus(d) });
    }
    return root;
}

const isLeaf = (d) => !!d.data.row;

/** Names from the first ring down to this node. */
function relativePath(d) {
    return d.ancestors().reverse().slice(1).filter(a => !isLeaf(a)).map(a => a.data.name);
}

export function buildSunburst() {
    const rows = state.sunburstData;
    const base = isHierarchical(state.filterPath) ? state.filterPath : [];
    const svg = d3.select('#sunburst');
    svg.selectAll('*').remove();
    paths = null;

    document.getElementById('sunburst-empty').hidden = rows.length > 0;
    document.getElementById('sunburst-figure').classList.toggle('is-empty', rows.length === 0);
    renderBreadcrumb();
    if (rows.length === 0) {
        setCentre('', '');
        document.getElementById('sunburst-levels').innerHTML = '';
        document.getElementById('sunburst-summary').textContent = 'No taxa match the current filters.';
        return;
    }

    const root = d3.hierarchy(buildHierarchy(rows, base.length))
        .sum(d => (d.row ? Number(d.row.n_reads) || 0 : 0))
        .sort((a, b) => b.value - a.value);
    // Depth d occupies y in [d, d + 1]; depth 0 (the root) is the centre hole.
    d3.partition().size([2 * Math.PI, root.height + 1])(root);

    const ring = (SIZE / 2 - HOLE) / root.height;
    const arc = d3.arc()
        .startAngle(d => d.x0)
        .endAngle(d => d.x1)
        .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.004))
        .padRadius(SIZE / 2)
        .innerRadius(d => HOLE + (d.y0 - 1) * ring)
        .outerRadius(d => HOLE + (d.y1 - 1) * ring - 1);

    svg.attr('viewBox', [-SIZE / 2, -SIZE / 2, SIZE, SIZE]);

    // Hatch patterns for non-damaged genomes, one per domain colour.
    const surface = cssVar('--bg-deep');
    const defs = svg.append('defs');
    const patternId = (domain) => 'hatch-' + String(domain).replace(/\W/g, '');
    [...DOMAINS, 'other'].forEach(domain => {
        const colour = domainColor(domain);
        const pat = defs.append('pattern')
            .attr('id', patternId(domain))
            .attr('patternUnits', 'userSpaceOnUse')
            .attr('width', 5).attr('height', 5)
            .attr('patternTransform', 'rotate(45)');
        pat.append('rect').attr('width', 5).attr('height', 5).attr('fill', surface);
        pat.append('rect').attr('width', 5).attr('height', 5).attr('fill', colour).attr('fill-opacity', 0.2);
        pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5)
            .attr('stroke', colour).attr('stroke-width', 1.4);
    });

    const domainOf = (d) => {
        if (isLeaf(d)) return d.data.row.domain;
        const top = d.ancestors().find(a => /^d__/.test(a.data.name));
        return top ? top.data.name : (base[0] || 'other');
    };
    const fill = (d) => {
        const domain = domainOf(d);
        if (isLeaf(d)) {
            return d.data.status === 'damaged' ? domainColor(domain)
                : `url(#${patternId(DOMAINS.includes(domain) ? domain : 'other')})`;
        }
        // Inner rings: the domain colour, slightly lighter with depth.
        const c = d3.hsl(domainColor(domain));
        c.l = Math.min(0.8, c.l + (d.depth - 1) * 0.04);
        return c.formatHex();
    };

    const nodes = root.descendants().slice(1).filter(d => d.x1 > d.x0);
    paths = svg.append('g')
        .selectAll('path')
        .data(nodes)
        .join('path')
        .attr('d', arc)
        .attr('fill', fill)
        .attr('stroke', surface)
        .attr('stroke-width', 0.4)
        .attr('class', d => (isLeaf(d) ? 'arc leaf' : 'arc'))
        .on('mouseenter', (event, d) => {
            const lineage = new Set(d.ancestors());
            paths.classed('dim', p => !lineage.has(p));
            setCentre(isLeaf(d) ? taxonLabel(d.data.row) : cleanName(d.data.name),
                `${fmt(d.value)} reads` + (isLeaf(d) ? `, ${d.data.status}` : ''));
        })
        .on('click', (event, d) => {
            if (isLeaf(d)) handlers.selectReference(d.data.row.id);
            else handlers.setFilterPath([...base, ...relativePath(d)]);
        });
    svg.on('mouseleave', () => {
        paths.classed('dim', false);
        resetCentre(root);
    });

    applyStatusOverlay(state.filters.status, { animate: false });
    resetCentre(root);
    renderLevels(root, base);
    renderSummary(root);
    renderLegend();
}

function setCentre(title, sub) {
    document.getElementById('sunburst-centre-title').textContent = title;
    document.getElementById('sunburst-centre-sub').textContent = sub;
}

function resetCentre(root) {
    const path = state.filterPath;
    setCentre(path.length ? cleanName(path[path.length - 1]) : 'All taxa', `${fmt(root.value)} reads`);
}

/** Dim outer-ring arcs that do not match the status filter. */
export function applyStatusOverlay(status, { animate = true } = {}) {
    if (!paths) return;
    const hidden = (d) => status !== 'all' && isLeaf(d) && d.data.status !== status;
    const sel = animate && !reducedMotion() ? paths.transition().duration(180) : paths;
    sel.attr('opacity', d => (hidden(d) ? 0.1 : 1));
    paths.attr('pointer-events', d => (hidden(d) ? 'none' : null));
}

function renderBreadcrumb() {
    const nav = document.getElementById('sunburst-breadcrumb');
    const path = state.filterPath;
    const hier = isHierarchical(path);
    const crumbs = path.map((name, i) => {
        const current = i === path.length - 1;
        return `<li><button type="button" class="crumb" data-depth="${i + 1}" ${current ? 'aria-current="true"' : ''}
            title="${hier ? RANK_NAMES[i] : 'Taxon'}">${escapeHtml(cleanName(name))}</button></li>`;
    }).join('');
    nav.innerHTML = `<ol>
        <li><button type="button" class="crumb" data-depth="0" ${path.length ? '' : 'aria-current="true"'}>All taxa</button></li>
        ${crumbs}</ol>`;
    nav.querySelectorAll('.crumb').forEach(btn => {
        btn.addEventListener('click', () => {
            const depth = Number(btn.dataset.depth);
            handlers.setFilterPath(hier ? path.slice(0, depth) : (depth === 0 ? [] : path));
        });
    });
    document.getElementById('sunburst-up').hidden = path.length === 0;
}

/** The first ring as a list of buttons: the keyboard route through the taxonomy. */
function renderLevels(root, base) {
    const el = document.getElementById('sunburst-levels');
    const children = root.children || [];
    const leaves = children.length > 0 && isLeaf(children[0]);
    const rankName = leaves ? 'Reference genomes' : (RANK_NAMES[base.length] || 'Groups');
    const shown = listExpanded ? children : children.slice(0, LIST_LIMIT);

    el.innerHTML = `
        <h3 id="levels-heading">${rankName} by reads <span class="count">${children.length}</span></h3>
        <ul aria-labelledby="levels-heading">
            ${shown.map((c, i) => {
                const share = root.value ? (c.value / root.value * 100) : 0;
                const label = leaves ? taxonLabel(c.data.row) : cleanName(c.data.name);
                const domain = leaves ? c.data.row.domain : (base[0] || (/^d__/.test(c.data.name) ? c.data.name : 'other'));
                const detail = leaves ? c.data.status : `${fmt(c.leaves().length)} genome${c.leaves().length === 1 ? '' : 's'}`;
                return `<li><button type="button" class="level-item" data-i="${i}">
                    <span class="swatch" style="background:${domainColor(domain)}" aria-hidden="true"></span>
                    <span class="level-name">${escapeHtml(label)}</span>
                    <span class="level-meta">${detail}</span>
                    <span class="level-share">${share < 0.1 ? '<0.1' : share.toFixed(1)}%</span>
                    <span class="level-bar" aria-hidden="true"><span style="width:${Math.max(share, 0.5)}%;background:${domainColor(domain)}"></span></span>
                </button></li>`;
            }).join('')}
        </ul>
        ${children.length > LIST_LIMIT ? `<button type="button" class="btn btn-ghost btn-sm" id="levels-toggle"
            aria-expanded="${listExpanded}">${listExpanded ? 'Show fewer' : `Show all ${children.length}`}</button>` : ''}
    `;
    el.querySelectorAll('.level-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const c = shown[Number(btn.dataset.i)];
            if (isLeaf(c)) handlers.selectReference(c.data.row.id);
            else handlers.setFilterPath([...base, c.data.name]);
        });
    });
    const toggle = document.getElementById('levels-toggle');
    if (toggle) toggle.addEventListener('click', () => {
        listExpanded = !listExpanded;
        renderLevels(root, base);
        document.getElementById('levels-toggle').focus();
    });
}

function renderSummary(root) {
    const top = (root.children || []).slice(0, 3).map(c => {
        const name = isLeaf(c) ? taxonLabel(c.data.row) : cleanName(c.data.name);
        return `${name} ${(c.value / root.value * 100).toFixed(0)}%`;
    });
    const scope = state.filterPath.length ? ` within ${cleanName(state.filterPath[state.filterPath.length - 1])}` : '';
    const leaves = root.leaves();
    const damaged = leaves.filter(l => l.data.status === 'damaged').length;
    document.getElementById('sunburst-summary').textContent =
        `Taxonomy of ${state.currentSample}${scope}: ${fmt(leaves.length)} reference genomes, ` +
        `${fmt(root.value)} reads, ${fmt(damaged)} genomes classed as damaged. ` +
        `Largest groups by reads: ${top.join(', ')}.`;
}

function renderLegend() {
    const el = document.getElementById('sunburst-legend');
    const present = DOMAINS.filter(dom => state.sampleData.some(d => d.domain === dom));
    el.innerHTML = `
        <ul aria-label="Domain colours">
            ${present.map(dom => `<li><span class="swatch" style="background:${domainColor(dom)}" aria-hidden="true"></span>${cleanName(dom)}</li>`).join('')}
        </ul>
        <ul aria-label="Outer ring fill">
            <li><span class="swatch swatch-solid" aria-hidden="true"></span>damaged</li>
            <li><span class="swatch swatch-hatch" aria-hidden="true"></span>non-damaged</li>
        </ul>`;
}
