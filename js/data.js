// Data access. DuckDB-WASM reads meta.parquet and freq.parquet in the
// browser; nothing here touches the DOM.
//
// Data contract (do not rename without rebuilding the data):
//   meta.parquet  one row per (sample, reference genome); key `id`
//   freq.parquet  per-position frequencies for the same `id`:
//                 fp/fm = observed C→T (5′) / G→A (3′), dp/dm = metaDMG fit
//   samples.json  sample order, sapropel layer, age (ka) and core
//   config.json   damage_threshold, build_id, QC thresholds
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';
import { state, RANK_COLUMNS } from './state.js';
import { convertResults, getStatus, damagedSql, loadConfig, sqlString, SITE_ROOT, exportHeaders, exportRow, downloadCsv } from './utils.js';

export const N_POSITIONS = 25;

/** "f.fp1, …, f.dm25": the four per-position series of the smiley plot. */
const FREQ_COLUMNS = ['fp', 'fm', 'dp', 'dm']
    .flatMap(prefix => Array.from({ length: N_POSITIONS }, (_, i) => `f.${prefix}${i + 1}`))
    .join(', ');

export async function initDuckDB() {
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    state.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await state.db.instantiate(bundle.mainModule);
    URL.revokeObjectURL(workerUrl);
    state.conn = await state.db.connect();

    // build_id changes on every data rebuild, so it busts cached parquet files.
    const cfg = await loadConfig();
    const v = cfg.build_id || Date.now();
    for (const file of ['meta.parquet', 'freq.parquet']) {
        await state.db.registerFileURL(file, `${SITE_ROOT}${file}?v=${v}`,
            duckdb.DuckDBDataProtocol.HTTP, false);
    }
    await state.conn.query(`CREATE VIEW meta AS SELECT * FROM 'meta.parquet'`);
    await state.conn.query(`CREATE VIEW freq AS SELECT * FROM 'freq.parquet'`);
}

async function query(sql) {
    return convertResults(await state.conn.query(sql));
}

/** Samples in samples.json order, each with taxa and damaged counts. */
export async function fetchSamples() {
    const stats = await query(`
        SELECT sample,
               COUNT(*) AS taxa_count,
               SUM(n_reads) AS total_reads,
               SUM(CASE WHEN ${damagedSql()} THEN 1 ELSE 0 END) AS damaged_count
        FROM meta GROUP BY sample
    `);
    const byName = new Map(stats.map(s => [s.sample, s]));

    let order = [];
    try {
        const r = await fetch(SITE_ROOT + 'samples.json', { cache: 'no-cache' });
        if (r.ok) order = await r.json();
    } catch (e) {
        console.warn('samples.json could not be loaded; using parquet order', e);
    }
    state.samples = order.length
        ? order.filter(o => byName.has(o.sample)).map(o => ({ ...byName.get(o.sample), ...o }))
        : stats;
    return state.samples;
}

/** All rows for one sample, with the smiley-plot series joined on. */
export async function fetchSampleRows(sample) {
    return query(`
        SELECT m.*, ${FREQ_COLUMNS}
        FROM meta m JOIN freq f ON m.id = f.id
        WHERE m.sample = ${sqlString(sample)}
    `);
}

/** Rows (meta only) for one sample; used by the sample-comparison view. */
export async function fetchSampleMeta(sample) {
    return query(`SELECT * FROM meta WHERE sample = ${sqlString(sample)} ORDER BY damage DESC`);
}

/** One taxon in every sample (or in `samples`), with smiley series. */
export async function fetchTaxonAcrossSamples(name, level, samples = null) {
    const column = ['species', 'genus', 'family'].includes(level) ? level : 'species';
    const prefix = column[0] + '__';
    const bare = name.replace(/^[dpcofgs]__/i, '');
    const sampleClause = samples && samples.length
        ? `AND m.sample IN (${samples.map(sqlString).join(',')})` : '';
    return query(`
        SELECT m.*, ${FREQ_COLUMNS}
        FROM meta m JOIN freq f ON m.id = f.id
        WHERE (m.${column} = ${sqlString(name)} OR m.${column} = ${sqlString(prefix + bare)})
        ${sampleClause}
        ORDER BY m.damage DESC
    `);
}

/** Search taxon names in every sample. Returns up to `limit` grouped hits. */
export async function searchTaxa(text, limit = 20) {
    const like = sqlString('%' + text.toLowerCase().replace(/[%_]/g, '') + '%');
    return query(`
        WITH hits AS (
            SELECT species AS name, 'species' AS level, sample, damage, n_reads, fit FROM meta
            WHERE lower(species) LIKE ${like} OR lower(reference) LIKE ${like}
            UNION ALL
            SELECT genus, 'genus', sample, damage, n_reads, fit FROM meta WHERE lower(genus) LIKE ${like}
            UNION ALL
            SELECT family, 'family', sample, damage, n_reads, fit FROM meta WHERE lower(family) LIKE ${like}
        )
        SELECT name, level,
               COUNT(DISTINCT sample) AS sample_count,
               COUNT(*) AS row_count,
               SUM(n_reads) AS total_reads,
               SUM(CASE WHEN ${damagedSql()} THEN 1 ELSE 0 END) AS damaged_count
        FROM hits
        GROUP BY name, level
        ORDER BY CASE level WHEN 'family' THEN 0 WHEN 'genus' THEN 1 ELSE 2 END,
                 sample_count DESC, total_reads DESC
        LIMIT ${Number(limit) || 20}
    `);
}

/** True when a row lies under the taxonomy path (exact match per rank). */
function matchesPath(d, path) {
    // Paths from the sunburst start at the domain; anything else is a
    // single taxon name of unknown rank, matched against every rank.
    if (path.length && /^d__/.test(path[0])) {
        return path.every((name, i) => d[RANK_COLUMNS[i]] === name);
    }
    return path.every(name => RANK_COLUMNS.some(col => d[col] === name) || d.species === name);
}

/**
 * Apply filters and sorting to state.sampleData.
 * sunburstData ignores the status filter (the sunburst dims instead of
 * dropping arcs); filteredData is what the table shows.
 */
export function computeFiltered() {
    const f = state.filters;
    const text = f.search.trim().toLowerCase();
    let rows = state.sampleData.filter(d =>
        (f.minDamage <= 0 || d.damage >= f.minDamage) &&
        (f.minSignificance <= 0 || d.significance >= f.minSignificance) &&
        (f.minReads <= 0 || d.n_reads >= f.minReads) &&
        (state.filterPath.length === 0 || matchesPath(d, state.filterPath)) &&
        (!text || [d.species, d.genus, d.family, d.order_, d.class_, d.phylum, d.domain, d.reference]
            .some(v => v && v.toLowerCase().includes(text)))
    );
    state.sunburstData = rows;

    if (f.status !== 'all') rows = rows.filter(d => getStatus(d) === f.status);

    const col = state.sortColumn;
    const dir = state.sortDirection === 'asc' ? 1 : -1;
    state.filteredData = [...rows].sort((a, b) => {
        const av = a[col], bv = b[col];
        if (typeof av === 'string' || typeof bv === 'string') {
            return dir * String(av || '').localeCompare(String(bv || ''));
        }
        return dir * (Number(av) - Number(bv));
    });
}

export function exportCurrentTable() {
    downloadCsv(`sapropel_damage_${state.currentSample || 'export'}.csv`,
        exportHeaders(), state.filteredData.map(exportRow));
    return state.filteredData.length;
}
