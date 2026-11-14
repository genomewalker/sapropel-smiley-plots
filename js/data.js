// ========== DATA LOADING ==========
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';
import { state } from './state.js?v=91';
import { convertResults, getStatus, damageConfig } from './utils.js?v=91';
import { renderSampleList, renderTable, buildSunburst } from './table.js?v=91';

export async function initDuckDB() {
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    state.db = new duckdb.AsyncDuckDB(logger, worker);
    await state.db.instantiate(bundle.mainModule);
    URL.revokeObjectURL(worker_url);
    state.conn = await state.db.connect();

    const baseUrl = new URL('/', window.location.href).href;
    // Cache-bust via config.json's build_id so a parquet rebuild invalidates
    // any cached HTTP range responses in the browser.
    const cfgResp = await fetch(baseUrl + 'config.json', { cache: 'no-cache' });
    const cfg = cfgResp.ok ? await cfgResp.json() : {};
    const v = cfg.build_id || Date.now();
    await state.db.registerFileURL('meta.parquet', baseUrl + 'meta.parquet?v=' + v,
        duckdb.DuckDBDataProtocol.HTTP, false);
    await state.db.registerFileURL('freq.parquet', baseUrl + 'freq.parquet?v=' + v,
        duckdb.DuckDBDataProtocol.HTTP, false);

    await state.conn.query(`CREATE VIEW meta AS SELECT * FROM 'meta.parquet'`);
    await state.conn.query(`CREATE VIEW freq AS SELECT * FROM 'freq.parquet'`);
}

export async function loadSamples() {
    const thr = Number(damageConfig.threshold) || 0;
    const result = await state.conn.query(`
        SELECT sample,
               COUNT(*) as taxa_count,
               SUM(n_reads) as total_reads,
               AVG(damage) as avg_damage,
               SUM(CASE WHEN damage > ${thr} AND (fit IS NULL OR fit <> 'bad') THEN 1 ELSE 0 END) as damaged_count,
               COUNT(*) as filtered_taxa_count
        FROM meta
        GROUP BY sample
    `);

    // Order by samples.json (sapropel layers first, then by age, then core).
    const baseUrl = new URL('/', window.location.href).href;
    let order = [];
    try {
        const r = await fetch(baseUrl + 'samples.json', { cache: 'no-cache' });
        if (r.ok) order = await r.json();
    } catch (e) { console.warn('samples.json load failed:', e); }
    const meta = new Map(order.map(s => [s.sample, s]));
    const stats = new Map(convertResults(result).map(s => [s.sample, s]));
    const samples = order.length
        ? order.map(o => ({ ...stats.get(o.sample), ...o }))
              .filter(s => s.taxa_count != null)
        : [...stats.values()];
    state.samples = samples;
    state.sampleMeta = meta;
    document.getElementById('sample-count').textContent = samples.length;
    renderSampleList(samples);

    if (samples.length > 0) {
        const { selectSample } = await import('./actions.js?v=91');

        // Try to restore from localStorage
        const savedSample = localStorage.getItem('sap-selected-sample');
        if (savedSample && samples.find(s => s.sample === savedSample)) {
            selectSample(savedSample);
        } else {
            selectSample(samples[0].sample);
        }
    }
}

export async function loadSampleData() {
    if (!state.currentSample) return;

    const result = await state.conn.query(`
        SELECT m.*,
            f.fp1, f.fp2, f.fp3, f.fp4, f.fp5, f.fp6, f.fp7, f.fp8, f.fp9, f.fp10,
            f.fp11, f.fp12, f.fp13, f.fp14, f.fp15, f.fp16, f.fp17, f.fp18, f.fp19, f.fp20,
            f.fp21, f.fp22, f.fp23, f.fp24, f.fp25,
            f.fm1, f.fm2, f.fm3, f.fm4, f.fm5, f.fm6, f.fm7, f.fm8, f.fm9, f.fm10,
            f.fm11, f.fm12, f.fm13, f.fm14, f.fm15, f.fm16, f.fm17, f.fm18, f.fm19, f.fm20,
            f.fm21, f.fm22, f.fm23, f.fm24, f.fm25,
            f.dp1, f.dp2, f.dp3, f.dp4, f.dp5, f.dp6, f.dp7, f.dp8, f.dp9, f.dp10,
            f.dp11, f.dp12, f.dp13, f.dp14, f.dp15, f.dp16, f.dp17, f.dp18, f.dp19, f.dp20,
            f.dp21, f.dp22, f.dp23, f.dp24, f.dp25,
            f.dm1, f.dm2, f.dm3, f.dm4, f.dm5, f.dm6, f.dm7, f.dm8, f.dm9, f.dm10,
            f.dm11, f.dm12, f.dm13, f.dm14, f.dm15, f.dm16, f.dm17, f.dm18, f.dm19, f.dm20,
            f.dm21, f.dm22, f.dm23, f.dm24, f.dm25
        FROM meta m
        JOIN freq f ON m.id = f.id
        WHERE m.sample = '${state.currentSample}'
    `);

    state.sampleData = convertResults(result);
    applyFilters();
}

export function applyFilters({ rebuildSunburst = true } = {}) {
    let base = [...state.sampleData];

    // Numeric filters (apply to both sunburst and table)
    if (state.filters.minDamage > 0) {
        base = base.filter(d => d.damage >= state.filters.minDamage);
    }
    if (state.filters.minSignificance > 0) {
        base = base.filter(d => d.significance >= state.filters.minSignificance);
    }
    if (state.filters.minReads > 0) {
        base = base.filter(d => d.n_reads >= state.filters.minReads);
    }

    // Search filter (also applies to both)
    if (state.filters.search) {
        const search = state.filters.search.toLowerCase();
        base = base.filter(d =>
            (d.domain && d.domain.toLowerCase().includes(search)) ||
            (d.phylum && d.phylum.toLowerCase().includes(search)) ||
            (d.class_ && d.class_.toLowerCase().includes(search)) ||
            (d.order_ && d.order_.toLowerCase().includes(search)) ||
            (d.family && d.family.toLowerCase().includes(search)) ||
            (d.genus && d.genus.toLowerCase().includes(search)) ||
            (d.species && d.species.toLowerCase().includes(search)) ||
            (d.reference && d.reference.toLowerCase().includes(search))
        );
    }

    // Sunburst sees every taxon; status is rendered as a visual overlay.
    state.sunburstData = base;

    // Status filter affects only the table
    let data = base;
    if (state.filters.status !== 'all') {
        data = data.filter(d => getStatus(d) === state.filters.status);
    }

    // Sort
    data.sort((a, b) => {
        let aVal = a[state.sortColumn];
        let bVal = b[state.sortColumn];
        if (typeof aVal === 'string' || typeof bVal === 'string') {
            aVal = String(aVal || '');
            bVal = String(bVal || '');
            return state.sortDirection === 'asc'
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        }
        return state.sortDirection === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });

    state.filteredData = data;

    // Update UI
    document.getElementById('status-total').textContent = state.sampleData.length.toLocaleString();
    document.getElementById('status-showing').textContent = data.length.toLocaleString();

    renderTable();
    if (state.showSunburst) {
        if (rebuildSunburst) {
            buildSunburst();
        } else {
            import('./sunburst.js?v=91').then(({ applyStatusOverlay }) => {
                applyStatusOverlay(state.filters.status);
            });
        }
    }
}

export function exportData() {
    const headers = ['sample', 'reference', 'domain', 'phylum', 'class', 'order', 'family', 'genus', 'species', 'damage', 'significance', 'n_reads', 'status'];
    const rows = state.filteredData.map(d => [
        d.sample, d.reference, d.domain, d.phylum, d.class_, d.order_, d.family, d.genus, d.species,
        d.damage, d.significance, d.n_reads, getStatus(d)
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adna_damage_${state.currentSample || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
