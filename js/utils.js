// ========== UTILITY FUNCTIONS ==========

// Safe number formatting
export const n = (v) => Number(v) || 0;
export const fmt = (v) => n(v).toLocaleString();
export const pct = (v) => (n(v) * 100).toFixed(1);

// Clean taxonomy name by removing prefix
export const cleanName = (name) => name ? name.replace(/^[dpcofgs]__/, '') : '-';

// Pipeline-derived damage cutoff (scripts/05--taxonomic-profiling.R):
//   damage > Q3(A_b | fit=="good", sample=MED-2021-1) AND fit != "bad".
// Loaded from config.json at startup; defaults to 0 until then.
export const damageConfig = { threshold: 0, ready: false };

export async function loadDamageConfig() {
    try {
        const baseUrl = new URL('/', window.location.href).href;
        const r = await fetch(baseUrl + 'config.json', { cache: 'no-cache' });
        if (!r.ok) throw new Error(`config.json HTTP ${r.status}`);
        const cfg = await r.json();
        damageConfig.threshold = Number(cfg.damage_threshold) || 0;
        damageConfig.ready = true;
        return cfg;
    } catch (e) {
        console.warn('damage config load failed:', e);
        return null;
    }
}

export function getStatus(d) {
    if (d.fit === 'bad') return 'non-damaged';
    const dmg = Number(d.damage) || 0;
    return dmg > damageConfig.threshold ? 'damaged' : 'non-damaged';
}

// Convert DuckDB result to plain objects with BigInt handling
export function convertResults(result) {
    const rows = result.toArray();
    const schema = result.schema;
    const fields = schema.fields.map(f => f.name);

    return rows.map((row, idx) => {
        const obj = {};

        for (const field of fields) {
            let val = row[field];

            // Handle BigInt
            if (typeof val === 'bigint') {
                val = Number(val);
            }
            // Handle Vector/Array aggregates (DuckDB returns these as objects with numeric indices)
            else if (val && typeof val === 'object' && '0' in val) {
                val = typeof val[0] === 'bigint' ? Number(val[0]) : val[0];
            }

            obj[field] = val;
        }

        return obj;
    });
}
