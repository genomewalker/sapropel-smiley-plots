// Shareable view state in the query string.
//
//   sample            sample name, e.g. GeoB15103-1_19-34cm
//   taxon             reference accession of the open taxon, e.g. GCF_000759875.1
//   path              taxonomy drill-down, "/"-separated with rank prefixes,
//                     e.g. d__Bacteria/p__Cyanobacteria
//   status            damaged | non-damaged
//   q                 text filter over taxonomy columns
//   min_damage        minimum damage estimate (0–1)
//   min_significance  minimum significance (Z)
//   min_reads         minimum read count
//   sort              column:asc|desc, e.g. n_reads:desc
//   compare           comma-separated sample names ticked for comparison
//
// Defaults are left out of the URL. The same list is documented in llms.txt.
import { state } from './state.js';

const STATUSES = ['damaged', 'non-damaged'];
export const SORT_COLUMNS = ['species', 'family', 'damage', 'significance', 'n_reads'];

const num = (v) => {
    const x = parseFloat(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
};

/** Parse the current query string. Values are validated by the caller where
 *  they depend on loaded data (sample, taxon, compare). */
export function readUrlState() {
    const p = new URLSearchParams(window.location.search);
    const [sortCol, sortDir] = (p.get('sort') || '').split(':');
    return {
        sample: p.get('sample'),
        taxon: p.get('taxon'),
        path: (p.get('path') || '').split('/').filter(Boolean),
        status: STATUSES.includes(p.get('status')) ? p.get('status') : 'all',
        search: p.get('q') || '',
        minDamage: Math.min(num(p.get('min_damage')), 1),
        minSignificance: num(p.get('min_significance')),
        minReads: num(p.get('min_reads')),
        sortColumn: SORT_COLUMNS.includes(sortCol) ? sortCol : null,
        sortDirection: sortDir === 'asc' ? 'asc' : 'desc',
        compare: (p.get('compare') || '').split(',').filter(Boolean),
    };
}

/** Write the current state to the URL without adding a history entry. */
export function syncUrl() {
    const p = new URLSearchParams();
    const f = state.filters;
    if (state.currentSample) p.set('sample', state.currentSample);
    const open = state.selectedRef != null && state.sampleData.find(d => d.id === state.selectedRef);
    if (open) p.set('taxon', open.reference);
    if (state.filterPath.length) p.set('path', state.filterPath.join('/'));
    if (f.status !== 'all') p.set('status', f.status);
    if (f.search) p.set('q', f.search);
    if (f.minDamage > 0) p.set('min_damage', f.minDamage);
    if (f.minSignificance > 0) p.set('min_significance', f.minSignificance);
    if (f.minReads > 0) p.set('min_reads', f.minReads);
    if (state.sortColumn !== 'damage' || state.sortDirection !== 'desc') {
        p.set('sort', `${state.sortColumn}:${state.sortDirection}`);
    }
    if (state.selectedSamples.length) p.set('compare', state.selectedSamples.join(','));

    // Keep "/", "," and ":" readable; they are safe in a query string.
    const qs = p.toString().replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%3A/g, ':');
    history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

/** Absolute URL of the current view, for the "Copy link" button. */
export function currentUrl() {
    syncUrl();
    return window.location.href;
}
