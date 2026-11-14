// Small helpers shared by every module: formatting, escaping, site paths,
// config.json, and the damage-status rule.

/** Site root, resolved from this module so the app also works under a sub-path. */
export const SITE_ROOT = new URL('../', import.meta.url).href;

// ---------- Numbers ----------
export const n = (v) => Number(v) || 0;
export const fmt = (v) => n(v).toLocaleString('en-GB');
export const pct = (v) => (n(v) * 100).toFixed(1);

// ---------- Text ----------
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Strip the rank prefix (d__, p__, … s__) and collapse runs of spaces. */
export const cleanName = (name) =>
    name ? String(name).replace(/^[dpcofgs]__/i, '').replace(/\s+/g, ' ').trim() : '';

/** Best display name for a row: species, else genus, else the reference accession. */
export const taxonLabel = (d) => cleanName(d.species) || cleanName(d.genus) || d.reference || 'Unnamed';

/** "Sapropel1" -> "Sapropel S1"; other values pass through. */
export const featureLabel = (feature) =>
    feature ? String(feature).replace(/^Sapropel(\d+)$/, 'Sapropel S$1') : 'Unknown';

export const isSapropel = (feature) => /^Sapropel/i.test(feature || '');

export const ageLabel = (ka) =>
    ka == null ? '' : `${Number(ka).toLocaleString('en-GB', { maximumFractionDigits: 1 })} ka`;

/** Escape a value for use inside a single-quoted SQL string literal. */
export const sqlString = (v) => `'${String(v).replace(/'/g, "''")}'`;

// ---------- config.json ----------
// damage_threshold comes from the analysis pipeline (see data/README.md).
export const damageConfig = { threshold: 0, ready: false, raw: {} };

let configPromise = null;
export function loadConfig() {
    if (!configPromise) {
        configPromise = fetch(SITE_ROOT + 'config.json', { cache: 'no-cache' })
            .then(r => {
                if (!r.ok) throw new Error(`config.json returned HTTP ${r.status}`);
                return r.json();
            })
            .then(cfg => {
                damageConfig.threshold = Number(cfg.damage_threshold) || 0;
                damageConfig.raw = cfg;
                damageConfig.ready = true;
                return cfg;
            });
    }
    return configPromise;
}

/**
 * The single definition of damage status used across the app:
 * "damaged" when the metaDMG fit is not flagged bad and the damage
 * estimate exceeds config.json's damage_threshold.
 */
export function getStatus(d) {
    if (d.fit === 'bad') return 'non-damaged';
    return n(d.damage) > damageConfig.threshold ? 'damaged' : 'non-damaged';
}

/** Same rule as getStatus, as a SQL boolean expression over the meta table. */
export const damagedSql = () =>
    `(damage > ${Number(damageConfig.threshold) || 0} AND (fit IS NULL OR fit <> 'bad'))`;

// ---------- DuckDB ----------
/** Arrow result -> plain objects. BigInt becomes Number (ids lose precision
 *  above 2^53 but stay consistent, since every id passes through here). */
export function convertResults(result) {
    const fields = result.schema.fields.map(f => f.name);
    return result.toArray().map(row => {
        const obj = {};
        for (const field of fields) {
            let val = row[field];
            if (typeof val === 'bigint') {
                val = Number(val);
            } else if (val && typeof val === 'object' && '0' in val) {
                val = typeof val[0] === 'bigint' ? Number(val[0]) : val[0];
            }
            obj[field] = val;
        }
        return obj;
    });
}

// ---------- Theme and motion ----------
export const cssVar = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const DOMAIN_VARS = {
    'd__Bacteria': '--domain-bacteria',
    'd__Archaea': '--domain-archaea',
    'd__Viruses': '--domain-viruses',
};
export const DOMAINS = Object.keys(DOMAIN_VARS);
export const domainColor = (domain) => cssVar(DOMAIN_VARS[domain] || '--domain-other');

export const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- CSV ----------
export function downloadCsv(filename, headers, rows) {
    const cell = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(','), ...rows.map(r => r.map(cell).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/** Columns written by every CSV export, in order. */
export const EXPORT_COLUMNS = [
    'sample', 'reference', 'domain', 'phylum', 'class_', 'order_', 'family', 'genus', 'species',
    'damage', 'significance', 'fit', 'n_reads', 'n_alns',
    'A_b', 'q_b', 'phi_b', 'c_b',
    'coverage_mean', 'breadth', 'exp_breadth', 'breadth_exp_ratio',
    'norm_entropy', 'norm_gini', 'read_ani_mean', 'gc_content',
];
export const exportRow = (d) => [...EXPORT_COLUMNS.map(c => d[c]), getStatus(d)];
export const exportHeaders = () => [...EXPORT_COLUMNS, 'status'];

// ---------- Status line ----------
/** Announce a short message in the status bar (aria-live) and as a toast. */
export function announce(message, { tone = 'info' } = {}) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }
    toast.dataset.tone = tone;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(announce.timer);
    announce.timer = setTimeout(() => toast.classList.remove('show'), tone === 'error' ? 8000 : 3200);
}
