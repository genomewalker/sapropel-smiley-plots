// Landing and help pages: fill in values that come from the data files so
// the static text never has to be edited after a data rebuild.
//   [data-sample-count]   number of samples
//   [data-config="key"]   a value from config.json (dot paths allowed)
//   #sample-table, #core-chart   built from samples.json
import { SITE_ROOT, escapeHtml, featureLabel, isSapropel } from './utils.js';
import { parseSampleName } from './table.js';

const getJson = (file) => fetch(SITE_ROOT + file, { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return r.json();
});

const explorerUrl = (sample) => `${SITE_ROOT}explorer/?sample=${encodeURIComponent(sample)}`;

function fillConfig(cfg) {
    document.querySelectorAll('[data-config]').forEach(el => {
        let value = el.dataset.config.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg);
        if (value == null) return;
        if (el.dataset.format === 'percent') value = (Number(value) * 100).toFixed(1) + '%';
        if (el.dataset.format === 'date') value = new Date(Number(value) * 1000).toISOString().slice(0, 10);
        if (Array.isArray(value)) value = value.join(', ');
        el.textContent = value;
    });
}

function renderSampleTable(samples) {
    const tbody = document.querySelector('#sample-table tbody');
    if (!tbody) return;
    tbody.innerHTML = samples.map(s => {
        const { core, depth } = parseSampleName(s.sample, s.core);
        return `<tr>
            <th scope="row"><a class="mono" href="${explorerUrl(s.sample)}">${escapeHtml(s.sample)}</a></th>
            <td>${escapeHtml(s.core || core)}</td>
            <td>${escapeHtml(depth)}</td>
            <td><span class="layer ${isSapropel(s.specific_feature) ? 'is-sapropel' : 'is-marl'}">${escapeHtml(featureLabel(s.specific_feature))}</span></td>
            <td class="num">${Number(s.age_ka).toLocaleString('en-GB', { maximumFractionDigits: 2 })}</td>
        </tr>`;
    }).join('');
}

/** One lane per core on a shared age axis; each sample is a band and a link. */
function renderCoreChart(samples) {
    const el = document.getElementById('core-chart');
    if (!el) return;
    const cores = [...new Set(samples.map(s => s.core))].sort();
    const maxAge = Math.ceil(Math.max(...samples.map(s => s.age_ka)) / 20) * 20;
    const W = 860, left = 104, right = 20, top = 30, lane = 34, gap = 12;
    const H = top + cores.length * (lane + gap) + 34;
    const x = (age) => left + (age / maxAge) * (W - left - right);
    const ticks = Array.from({ length: maxAge / 20 + 1 }, (_, i) => i * 20);

    // Layer labels (S1, S3, …) once per distinct sapropel age.
    const layers = new Map();
    samples.filter(s => isSapropel(s.specific_feature)).forEach(s => layers.set(s.age_ka, s.specific_feature));

    el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">
        ${[...layers].map(([age, f]) => `<text class="layer-label" x="${x(age)}" y="${top - 10}" text-anchor="middle">${escapeHtml(f.replace(/^Sapropel/, 'S'))}</text>`).join('')}
        ${cores.map((core, i) => {
            const y = top + i * (lane + gap);
            return `<text class="core-label" x="${left - 12}" y="${y + lane / 2 + 4}" text-anchor="end">${escapeHtml(core)}</text>
                    <rect class="lane" x="${left}" y="${y}" width="${W - left - right}" height="${lane}" rx="3"/>
                    ${samples.filter(s => s.core === core).map(s => `
                        <a href="${explorerUrl(s.sample)}" aria-label="${escapeHtml(s.sample)}, ${escapeHtml(featureLabel(s.specific_feature))}, ${s.age_ka} ka">
                            <rect class="sample-band ${isSapropel(s.specific_feature) ? 'is-sapropel' : 'is-marl'}" x="${x(s.age_ka) - 6}" y="${y}" width="12" height="${lane}">
                                <title>${escapeHtml(s.sample)}: ${escapeHtml(featureLabel(s.specific_feature))}, ${s.age_ka} ka</title>
                            </rect>
                        </a>`).join('')}`;
        }).join('')}
        ${ticks.map(t => `<line class="tick" x1="${x(t)}" x2="${x(t)}" y1="${H - 30}" y2="${H - 25}"/>
                          <text class="tick-label" x="${x(t)}" y="${H - 11}" text-anchor="middle">${t}</text>`).join('')}
        <text class="axis-label" x="${left - 12}" y="${H - 11}" text-anchor="end">Age (ka)</text>
    </svg>`;
}

async function init() {
    const [samples, cfg] = await Promise.all([
        getJson('samples.json').catch(() => null),
        getJson('config.json').catch(() => null),
    ]);
    if (cfg) fillConfig(cfg);
    if (samples) {
        const byAge = [...samples].sort((a, b) => a.age_ka - b.age_ka || a.sort_order - b.sort_order);
        document.querySelectorAll('[data-sample-count]').forEach(el => { el.textContent = `${samples.length} sediment`; });
        renderSampleTable(byAge);
        renderCoreChart(byAge);
    } else {
        const cell = document.querySelector('#sample-table tbody td');
        if (cell) cell.innerHTML = 'The sample list could not be loaded. Try <a href="samples.json">samples.json</a> directly.';
    }
}

init();
