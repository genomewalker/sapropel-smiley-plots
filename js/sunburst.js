// ========== SUNBURST VISUALIZATION ==========
import { state, domainColors } from './state.js?v=91';
import { fmt } from './utils.js?v=91';
import { updateFilterBar, closeTaxonomyOverlay } from './ui.js?v=91';

export function updateFilterIndicator() {
    const centerBackBtn = document.getElementById('center-back-btn');
    const bc = document.getElementById('sunburst-breadcrumb');

    if (state.filterPath.length === 0) {
        if (centerBackBtn) centerBackBtn.classList.remove('visible');
        // Reset breadcrumb to default
        bc.innerHTML = '<span style="color: var(--text-tertiary)">Hover to explore</span>';
    } else {
        if (centerBackBtn) centerBackBtn.classList.add('visible');

        // Update breadcrumb to show filter path with clickable crumbs
        bc.innerHTML = state.filterPath.map((taxon, i) =>
            `<span class="crumb" data-taxon="${taxon}" data-index="${i}">${taxon.replace(/^[dpcofgs]__/, '')}</span>`
        ).join('<span class="sep">›</span>');

        // Add click handlers for breadcrumb navigation
        bc.querySelectorAll('.crumb').forEach(crumb => {
            crumb.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(crumb.dataset.index);
                navigateToFilterLevel(index);
            });
        });
    }

    // Update the table filter bar
    updateFilterBar();
}

export async function navigateToFilterLevel(index) {
    // Navigate to a specific level in the filter path
    state.filterPath = state.filterPath.slice(0, index + 1);
    if (state.filterPath.length > 0) {
        state.filters.search = state.filterPath[state.filterPath.length - 1];
    } else {
        state.filters.search = '';
    }

    const { applyFilters } = await import('./data.js?v=91');
    const { renderTable } = await import('./table.js?v=91');

    updateFilterIndicator();
    applyFilters();
    renderTable();
    updateCenterForCurrentFilter();
}

export async function goBackOneLevel() {
    if (state.filterPath.length > 0) {
        state.filterPath.pop();
        if (state.filterPath.length > 0) {
            state.filters.search = state.filterPath[state.filterPath.length - 1];
        } else {
            state.filters.search = '';
        }

        const { applyFilters } = await import('./data.js?v=91');
        const { renderTable } = await import('./table.js?v=91');

        updateFilterIndicator();
        applyFilters();
        renderTable();
        updateCenterForCurrentFilter();
    }
}

export async function clearAllFilters() {
    state.filterPath = [];
    state.filters.search = '';

    const { applyFilters } = await import('./data.js?v=91');
    const { renderTable } = await import('./table.js?v=91');

    // Reset zoom to root
    currentFocus = currentRoot;

    updateFilterIndicator();
    applyFilters();
    renderTable();
    resetSunburstCenter();
}

export function updateCenterForCurrentFilter() {
    // Update sunburst center to reflect current filter level
    const center = document.getElementById('sunburst-center');
    const backBtnVisible = state.filterPath.length > 0 ? 'visible' : '';

    if (state.filterPath.length === 0) {
        resetSunburstCenter();
    } else {
        const currentFilter = state.filterPath[state.filterPath.length - 1];
        const name = currentFilter.replace(/^[dpcofgs]__/, '');
        // Calculate total reads for current filter
        const totalReads = state.filteredData.reduce((sum, d) => sum + (Number(d.n_reads) || 0), 0);

        center.innerHTML = `
            <button class="center-back-btn ${backBtnVisible}" id="center-back-btn" title="Go back" onclick="window.goBackOneLevel()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h4>${name}</h4>
            <p>${totalReads.toLocaleString()} reads</p>
        `;
    }
}

export function resetSunburstCenter() {
    const center = document.getElementById('sunburst-center');
    center.innerHTML = `
        <button class="center-back-btn" id="center-back-btn" title="Go back" onclick="window.goBackOneLevel()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h4>Taxonomy</h4>
        <p>Click to filter</p>
    `;
}

// Store current view state for zooming
let currentRoot = null;
let currentFocus = null;
// Active path selection so applyStatusOverlay can transition opacity
// without rebuilding the sunburst.
let currentPathSelection = null;

function leafStatus(d) {
    let n = d;
    while (n) {
        if (n.data && n.data.data) return n.data.status || 'non-damaged';
        if (!n.children || n.children.length === 0) return null;
        n = n.children[0];
    }
    return null;
}

function isLeaf(d) {
    return !!(d.data && d.data.data);
}

export function applyStatusOverlay(status) {
    if (!currentPathSelection) return;
    const matches = d => status === 'all' || (isLeaf(d) ? d.data.status === status : true);
    currentPathSelection
        .transition()
        .duration(220)
        .attr('fill-opacity', d => {
            if (!arcVisibleStatic(d.current, currentRoot)) return 0;
            if (!isLeaf(d)) return 0.85;
            return matches(d) ? 1 : 0;
        })
        .attr('pointer-events', d => {
            if (!arcVisibleStatic(d.current, currentRoot)) return 'none';
            if (!isLeaf(d)) return 'auto';
            return matches(d) ? 'auto' : 'none';
        });
    updateHiddenCountLabel(status);
}

function updateHiddenCountLabel(status) {
    const el = document.getElementById('sunburst-hidden-count');
    if (!el || !currentRoot) return;
    if (status === 'all') {
        el.textContent = '';
        el.style.display = 'none';
        return;
    }
    let shown = 0, hidden = 0;
    currentRoot.descendants().forEach(d => {
        if (!isLeaf(d)) return;
        if (d.data.status === status) shown++;
        else hidden++;
    });
    el.textContent = `${shown} ${status} shown · ${hidden} hidden`;
    el.style.display = '';
}

function arcVisibleStatic(d, root) {
    return d.y1 <= (root.height + 1) && d.y0 >= 1 && d.x1 > d.x0;
}

export function renderSunburst(root) {
    const svg = d3.select('#sunburst');
    const width = 480;
    const height = 480;
    const radius = width / 2;

    svg.attr('viewBox', [-width / 2, -height / 2, width, height]);
    svg.selectAll('*').remove();

    // Store root for zoom operations
    currentRoot = root;
    currentFocus = root;

    // Diagonal-stripe pattern per domain — non-damaged leaves render as a
    // desaturated hatched fill, damaged leaves stay solid.
    const defs = svg.append('defs');
    Object.entries(domainColors).forEach(([dom, color]) => {
        const id = 'stripes-' + dom.replace(/[^a-zA-Z0-9]/g, '');
        const pat = defs.append('pattern')
            .attr('id', id)
            .attr('patternUnits', 'userSpaceOnUse')
            .attr('width', 5)
            .attr('height', 5)
            .attr('patternTransform', 'rotate(45)');
        pat.append('rect')
            .attr('width', 5).attr('height', 5)
            .attr('fill', d3.color(color).copy({ opacity: 0.18 }));
        pat.append('line')
            .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5)
            .attr('stroke', color).attr('stroke-width', 1.6);
    });

    const partition = d3.partition().size([2 * Math.PI, root.height + 1]);
    partition(root);

    // Store original coordinates for arc interpolation
    root.each(d => d.current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 });

    function getColor(d) {
        let node = d;
        while (node) {
            if (node.data.name && node.data.name.startsWith('d__')) {
                return domainColors[node.data.name] || '#6b7280';
            }
            node = node.parent;
        }
        return '#6b7280';
    }

    // Arc generator using current coordinates
    // Add center padding to prevent overlap with center text
    const centerPadding = 45;
    const usableRadius = radius - centerPadding;

    const arc = d3.arc()
        .startAngle(d => d.current.x0)
        .endAngle(d => d.current.x1)
        .padAngle(d => Math.min((d.current.x1 - d.current.x0) / 2, 0.005))
        .padRadius(radius * 1.5)
        .innerRadius(d => centerPadding + d.current.y0 * usableRadius / (root.height + 1))
        .outerRadius(d => Math.max(centerPadding + d.current.y0 * usableRadius / (root.height + 1), centerPadding + d.current.y1 * usableRadius / (root.height + 1) - 1));

    // Create a group for all paths
    const g = svg.append('g');

    function getDomainName(d) {
        let n = d;
        while (n) {
            if (n.data.name && n.data.name.startsWith('d__')) return n.data.name;
            n = n.parent;
        }
        return null;
    }

    function fillFor(d) {
        const base = getColor(d);
        if (d.data && d.data.data) {
            if (d.data.status === 'damaged') return base;
            const c = d3.hsl(base);
            c.s *= 0.35;
            c.l = Math.min(0.92, c.l + 0.25);
            return c.formatHex();
        }
        return d3.color(base).darker((d.depth - 1) * 0.15);
    }

    const status0 = state.filters.status;
    const leafMatches0 = d => status0 === 'all' || d.data.status === status0;
    function initialOpacity(d) {
        if (!arcVisible(d.current)) return 0;
        if (!(d.data && d.data.data)) return 0.85;
        return leafMatches0(d) ? 1 : 0;
    }
    function initialPointer(d) {
        if (!arcVisible(d.current)) return 'none';
        if (!(d.data && d.data.data)) return 'auto';
        return leafMatches0(d) ? 'auto' : 'none';
    }

    const path = g.append('g')
        .selectAll('path')
        .data(root.descendants().slice(1))
        .join('path')
        .attr('fill', fillFor)
        .attr('stroke', d => (d.data && d.data.data) ? fillFor(d) : 'rgba(0,0,0,0.18)')
        .attr('fill-opacity', initialOpacity)
        .attr('pointer-events', initialPointer)
        .attr('d', d => arc(d))
        .style('cursor', 'pointer');

    currentPathSelection = path;
    updateHiddenCountLabel(status0);

    function statusOpacity(d) {
        if (!arcVisible(d.current)) return 0;
        if (!(d.data && d.data.data)) return 0.85;
        const st = state.filters.status;
        return (st === 'all' || d.data.status === st) ? 1 : 0;
    }

    path.on('mouseover', function(event, d) {
            if (!arcVisible(d.current)) return;
            const sequence = d.ancestors().reverse().slice(1);
            path.attr('fill-opacity', node => {
                if (!arcVisible(node.current)) return 0;
                const base = statusOpacity(node);
                if (base === 0) return 0;
                return sequence.includes(node) ? Math.max(base, 0.6) : base * 0.5;
            });
            updateSunburstCenter(d);
            updateBreadcrumb(d);
        })
        .on('mouseout', function() {
            path.attr('fill-opacity', statusOpacity);
        })
        .on('click', clicked);

    // Invisible center circle for clicking to zoom out
    const parent = g.append('circle')
        .datum(root)
        .attr('r', centerPadding)
        .attr('fill', 'none')
        .attr('pointer-events', 'all')
        .style('cursor', 'pointer')
        .on('click', clicked);

    // Check if arc is visible
    function arcVisible(d) {
        return d.y1 <= (root.height + 1) && d.y0 >= 1 && d.x1 > d.x0;
    }

    // Click handler with zoom animation
    async function clicked(event, p) {
        // Build ancestry path
        const ancestors = [];
        let node = p;
        while (node && node.data.name !== 'root') {
            ancestors.unshift(node.data.name);
            node = node.parent;
        }

        // If clicking a leaf, select reference instead of zooming
        if (p.data && p.data.data) {
            const { selectReference } = await import('./actions.js?v=91');
            selectReference(p.data.data.id);
            closeTaxonomyOverlay();
            return;
        }

        currentFocus = p;
        parent.datum(p.parent || root);

        root.each(d => d.target = {
            x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
            x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
            y0: Math.max(0, d.y0 - p.depth),
            y1: Math.max(0, d.y1 - p.depth)
        });

        const t = g.transition().duration(750);

        // Transition arcs
        path.transition(t)
            .tween('data', d => {
                const i = d3.interpolate(d.current, d.target);
                return t => d.current = i(t);
            })
            .filter(function(d) {
                return +this.getAttribute('fill-opacity') || arcVisible(d.target);
            })
            .attr('fill-opacity', d => {
                if (!arcVisible(d.target)) return 0;
                if (!(d.data && d.data.data)) return 0.85;
                const st = state.filters.status;
                return (st === 'all' || d.data.status === st) ? 1 : 0;
            })
            .attr('pointer-events', d => {
                if (!arcVisible(d.target)) return 'none';
                if (!(d.data && d.data.data)) return 'auto';
                const st = state.filters.status;
                return (st === 'all' || d.data.status === st) ? 'auto' : 'none';
            })
            .attrTween('d', d => () => arc(d));

        // Transition center circle
        parent.transition(t)
            .attr('r', p.depth === 0 ? 0 : centerPadding);

        // Update filter state
        const { applyFilters } = await import('./data.js?v=91');
        const { renderTable } = await import('./table.js?v=91');

        if (p === root || p.data.name === 'root') {
            state.filterPath = [];
            state.filters.search = '';
        } else {
            state.filterPath = ancestors;
            state.filters.search = p.data.name;
        }

        updateFilterIndicator();
        applyFilters();
        renderTable();

        // Update center display
        setTimeout(() => {
            const name = p.data.name === 'root' ? 'Taxonomy' : p.data.name.replace(/^[dpcofgs]__/, '');
            const centerEl = document.getElementById('sunburst-center');
            if (centerEl) {
                const totalReads = p.value || 0;
                const backBtnVisible = p !== root && p.data.name !== 'root' ? 'visible' : '';
                centerEl.innerHTML = `
                    <button class="center-back-btn ${backBtnVisible}" id="center-back-btn" title="Go back" onclick="window.goBackOneLevel()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <h4>${name}</h4>
                    <p>${fmt(totalReads)} reads</p>
                `;
            }
        }, 100);
    }
}

function updateSunburstCenter(d) {
    const center = document.getElementById('sunburst-center');
    const name = d.data.name ? d.data.name.replace(/^[dpcofgs]__/, '') : 'Taxonomy';
    const backBtnVisible = state.filterPath.length > 0 ? 'visible' : '';
    const reads = d.value ? fmt(d.value) + ' reads' : 'Click to filter';

    center.innerHTML = `
        <button class="center-back-btn ${backBtnVisible}" id="center-back-btn" title="Go back" onclick="window.goBackOneLevel()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h4>${name}</h4>
        <p>${reads}</p>
    `;
}

function updateBreadcrumb(d) {
    // Don't update breadcrumb on hover if there's an active filter
    // The filter breadcrumb is managed by updateFilterIndicator
    if (state.filterPath.length > 0) {
        return;
    }

    const ancestors = [];
    let node = d;
    while (node && node.data.name !== 'root') {
        ancestors.unshift(node.data.name);
        node = node.parent;
    }

    const bc = document.getElementById('sunburst-breadcrumb');
    if (ancestors.length === 0) {
        bc.innerHTML = '<span style="color: var(--text-tertiary)">Hover to explore taxonomy</span>';
    } else {
        bc.innerHTML = ancestors.map((a, i) =>
            `<span class="crumb" data-taxon="${a}" data-index="${i}">${a.replace(/^[dpcofgs]__/, '')}</span>`
        ).join('<span class="sep">›</span>');

        // Add click handlers for breadcrumb navigation (for hover mode without active filter)
        bc.querySelectorAll('.crumb').forEach(crumb => {
            crumb.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taxon = crumb.dataset.taxon;
                const index = parseInt(crumb.dataset.index);
                // Update filterPath to contain only ancestors up to clicked level
                state.filterPath = ancestors.slice(0, index + 1);
                state.filters.search = taxon;

                const { applyFilters } = await import('./data.js?v=91');
                const { renderTable } = await import('./table.js?v=91');

                updateFilterIndicator();
                applyFilters();
                renderTable();
                closeTaxonomyOverlay();
            });
        });
    }
}

export function updateLegend() {
    const baseColor = domainColors['d__Bacteria'] || '#22c55e';
    const swatchColor = (() => { const c = d3.hsl(baseColor); c.l = Math.max(0.25, c.l - 0.15); c.s = Math.min(1, c.s + 0.15); return c.formatHex(); })();
    const faded = (() => { const c = d3.hsl(baseColor); c.s *= 0.35; c.l = Math.min(0.92, c.l + 0.25); return c.formatHex(); })();
    const domEl = document.getElementById('sunburst-legend-domain');
    const stsEl = document.getElementById('sunburst-legend-status');
    if (domEl) {
        domEl.innerHTML = Object.entries(domainColors).map(([k, v]) => `
            <div class="legend-item">
                <span class="legend-dot" style="background:${v}"></span>
                <span class="legend-label">${k.replace('d__', '')}</span>
            </div>
        `).join('');
    }
    if (stsEl) {
        stsEl.innerHTML = `
            <div class="legend-item"><span class="legend-dot" style="background:${swatchColor}"></span><span class="legend-label">Damaged</span></div>
            <div class="legend-item"><span class="legend-dot" style="background:${faded}"></span><span class="legend-label">Non-damaged</span></div>
        `;
    }
    // Backwards-compat: if old single-container exists, fill it too
    const legacy = document.getElementById('sunburst-legend');
    if (legacy && !domEl) legacy.innerHTML = (domEl?.innerHTML || '') + (stsEl?.innerHTML || '');
}

