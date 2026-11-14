// Sample rail and taxa table. Both only write markup; their events are
// delegated once in ui.js.
import { state } from './state.js';
import { n, fmt, pct, cleanName, getStatus, escapeHtml, featureLabel, isSapropel, ageLabel, damageConfig } from './utils.js';

/** "GeoB15103-1_19-34cm" -> { core: "GeoB15103-1", depth: "19–34 cm" } */
export function parseSampleName(sample, fallbackCore = '') {
    const m = /^(.*)_(\d+)-(\d+)cm$/.exec(sample);
    return m ? { core: m[1], depth: `${m[2]}–${m[3]} cm` } : { core: fallbackCore || sample, depth: '' };
}

/**
 * Samples as a core log: youngest at the top, a dark band for sapropel
 * layers and a pale one for the sediment between them.
 */
export function renderSampleList() {
    const list = document.getElementById('sample-list');
    const samples = [...state.samples].sort((a, b) =>
        (a.age_ka ?? Infinity) - (b.age_ka ?? Infinity) || (a.sort_order ?? 0) - (b.sort_order ?? 0));

    list.innerHTML = samples.map(s => {
        const { core, depth } = parseSampleName(s.sample, s.core);
        const taxa = n(s.taxa_count);
        const damagedPct = taxa > 0 ? n(s.damaged_count) / taxa * 100 : 0;
        const current = s.sample === state.currentSample;
        const ticked = state.selectedSamples.includes(s.sample);
        const name = escapeHtml(s.sample);
        return `
        <li class="sample-row ${isSapropel(s.specific_feature) ? 'is-sapropel' : 'is-marl'} ${current ? 'is-current' : ''}" data-sample="${name}">
            <button type="button" class="sample-pick" ${current ? 'aria-current="true"' : ''} title="${name}">
                <span class="band" aria-hidden="true"></span>
                <span class="sample-layer">${escapeHtml(featureLabel(s.specific_feature))}</span>
                <span class="sample-age">${ageLabel(s.age_ka)}</span>
                <span class="sample-id">${escapeHtml(core)}${depth ? `, ${depth}` : ''}</span>
                <span class="sample-stats">${fmt(taxa)} genomes, ${damagedPct.toFixed(0)}% damaged</span>
                <span class="sample-meter" aria-hidden="true"><span style="width:${damagedPct}%"></span></span>
            </button>
            <label class="sample-compare" title="Include in sample comparison">
                <input type="checkbox" data-sample="${name}" ${ticked ? 'checked' : ''}>
                <span class="visually-hidden">Compare ${name}</span>
            </label>
        </li>`;
    }).join('');

    document.getElementById('sample-count').textContent = samples.length;
    updateCompareSamplesButton();
}

export function updateCompareSamplesButton() {
    const badge = document.getElementById('compare-samples-count');
    if (!badge) return;
    badge.textContent = state.selectedSamples.length;
    badge.hidden = state.selectedSamples.length === 0;
}

export function renderTable() {
    const tbody = document.getElementById('table-body');
    const rows = state.filteredData;

    if (rows.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row"><td colspan="7">
                <p><strong>No taxa match these filters.</strong></p>
                <p>${state.sampleData.length ? `${fmt(state.sampleData.length)} genomes are available in this sample.` : ''}</p>
                <button type="button" class="btn" data-action="clear-filters">Clear filters</button>
            </td></tr>`;
        return;
    }

    // Bars share one scale within the table so rows are comparable.
    const maxDamage = Math.max(damageConfig.threshold * 2, ...rows.map(d => n(d.damage))) || 1;
    const tick = (damageConfig.threshold / maxDamage * 100).toFixed(1);

    tbody.innerHTML = rows.map(d => {
        const status = getStatus(d);
        const species = escapeHtml(cleanName(d.species) || '–');
        const ticked = state.compareList.includes(d.id);
        return `
            <tr data-id="${d.id}" tabindex="0" ${state.selectedRef === d.id ? 'class="selected" aria-selected="true"' : ''}>
                <td class="cell-check"><input type="checkbox" data-id="${d.id}" ${ticked ? 'checked' : ''}
                    aria-label="Add ${species} to taxa comparison"></td>
                <th scope="row" class="cell-taxon">
                    <span class="taxon-name">${species}</span>
                    <span class="taxon-ref">${escapeHtml(d.reference)}</span>
                </th>
                <td class="cell-text">${escapeHtml(cleanName(d.family) || '–')}</td>
                <td class="cell-damage">
                    <span class="damage-value">${pct(d.damage)}%</span>
                    <span class="damage-bar" aria-hidden="true" style="--tick:${tick}%">
                        <span class="${status}" style="width:${(n(d.damage) / maxDamage * 100).toFixed(1)}%"></span>
                    </span>
                </td>
                <td class="cell-num">${n(d.significance).toFixed(1)}</td>
                <td class="cell-num">${fmt(d.n_reads)}</td>
                <td><span class="status-badge ${status}">${status}</span></td>
            </tr>`;
    }).join('');
}

/** Mark the open row without re-rendering the table. */
export function markSelectedRow() {
    document.querySelectorAll('#table-body tr').forEach(row => {
        const on = Number(row.dataset.id) === state.selectedRef;
        row.classList.toggle('selected', on);
        if (on) row.setAttribute('aria-selected', 'true'); else row.removeAttribute('aria-selected');
    });
}

export function updateSortHeaders() {
    document.querySelectorAll('.taxa-table th[data-sort]').forEach(th => {
        const active = th.dataset.sort === state.sortColumn;
        th.setAttribute('aria-sort', active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
    });
}

/** Counts in the status bar; also read out by screen readers (aria-live). */
export function updateStatusBar() {
    document.getElementById('status-showing').textContent = fmt(state.filteredData.length);
    document.getElementById('status-total').textContent = fmt(state.sampleData.length);
    document.getElementById('status-sample').textContent = state.currentSample || '–';
}
