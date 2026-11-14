// Smiley plot: substitution frequency against read position.
//
//   left half   C→T, positions 1…25 counted from the 5′ end
//   right half  G→A, positions 25…1 counted from the 3′ end (mirrored)
//   markers     observed frequency (circles 5′, squares 3′)
//   lines       metaDMG fit
//
// One renderer serves every place a plot appears. Colours are read from the
// CSS tokens at draw time and every canvas is redrawn when the window size
// changes.
import { n, pct, cssVar, taxonLabel, escapeHtml } from './utils.js';

const POSITIONS = 25;

const VARIANTS = {
    // Detail modal: axes, ticks and a hover read-out.
    full:    { height: 320, pad: { top: 18, right: 18, bottom: 46, left: 52 }, yTicks: 4, marker: 3.2, line: 2.2, axes: 'full' },
    // Detail panel.
    compact: { height: 180, pad: { top: 12, right: 10, bottom: 30, left: 38 }, yTicks: 2, marker: 2.2, line: 1.8, axes: 'short' },
    // Cards in the comparison views.
    card:    { height: 104, pad: { top: 8, right: 8, bottom: 18, left: 8 }, yTicks: 2, marker: 1.6, line: 1.5, axes: 'ends' },
};

/** canvas -> { data, variant }, so plots can be redrawn on resize. */
const registry = new Map();

export function smileySeries(data) {
    const pick = (prefix) => Array.from({ length: POSITIONS }, (_, i) => n(data[`${prefix}${i + 1}`]));
    return { fp: pick('fp'), fm: pick('fm'), dp: pick('dp'), dm: pick('dm') };
}

/** Shared y maximum: at least 35 % so weak profiles are not stretched to look strong. */
function yMax(s) {
    return Math.max(0.35, ...s.fp, ...s.fm, ...s.dp, ...s.dm);
}

/** One-sentence text alternative used as the canvas aria-label. */
export function describeSmiley(data) {
    const s = smileySeries(data);
    return `Smiley plot for ${taxonLabel(data)} in ${data.sample}. ` +
        `C to T at the 5′ end: ${pct(s.fp[0])}% observed at position 1 (fit ${pct(s.dp[0])}%), ` +
        `${pct(s.fp[POSITIONS - 1])}% at position ${POSITIONS}. ` +
        `G to A at the 3′ end: ${pct(s.fm[0])}% observed at position 1 (fit ${pct(s.dm[0])}%), ` +
        `${pct(s.fm[POSITIONS - 1])}% at position ${POSITIONS}.`;
}

/** The plotted values as an HTML table (inside a <details>), for screen readers and copy-paste. */
export function smileyTableHtml(data) {
    const s = smileySeries(data);
    const rows = s.fp.map((_, i) => `
        <tr><th scope="row">${i + 1}</th>
            <td>${pct(s.fp[i])}</td><td>${pct(s.dp[i])}</td>
            <td>${pct(s.fm[i])}</td><td>${pct(s.dm[i])}</td></tr>`).join('');
    return `
        <details class="plot-data">
            <summary>Plotted values</summary>
            <table>
                <caption>Substitution frequency (%) by position for ${escapeHtml(taxonLabel(data))}</caption>
                <thead><tr>
                    <th scope="col">Position</th>
                    <th scope="col">C→T 5′ observed</th><th scope="col">C→T 5′ fit</th>
                    <th scope="col">G→A 3′ observed</th><th scope="col">G→A 3′ fit</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </details>`;
}

/** Legend markup matching the plot's marks. */
export function smileyLegendHtml() {
    return `
        <ul class="plot-legend" aria-label="Plot legend">
            <li><span class="key key-5p" aria-hidden="true"></span>C→T, 5′ end</li>
            <li><span class="key key-3p" aria-hidden="true"></span>G→A, 3′ end</li>
            <li><span class="key key-obs" aria-hidden="true"></span>observed</li>
            <li><span class="key key-fit" aria-hidden="true"></span>metaDMG fit</li>
        </ul>`;
}

export function drawSmiley(canvas, data, variant = 'compact') {
    if (!canvas || !data) return;
    registry.set(canvas, { data, variant });
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', describeSmiley(data));
    paint(canvas, data, variant);
    if (variant === 'full') attachReadout(canvas);
}

function layout(canvas, variant) {
    const v = VARIANTS[variant] || VARIANTS.compact;
    const w = Math.max(160, Math.floor(canvas.parentElement.clientWidth));
    const h = v.height;
    const plotW = w - v.pad.left - v.pad.right;
    const plotH = h - v.pad.top - v.pad.bottom;
    const gap = variant === 'card' ? 6 : 14;           // space between the two halves
    const halfW = (plotW - gap) / 2;
    const step = halfW / (POSITIONS - 1);
    return { v, w, h, plotW, plotH, gap, halfW, step,
        x5: (i) => v.pad.left + i * step,                                 // position i+1 from 5′
        x3: (i) => v.pad.left + halfW + gap + (POSITIONS - 1 - i) * step, // position i+1 from 3′
    };
}

function paint(canvas, data, variant) {
    const L = layout(canvas, variant);
    const { v, w, h, plotH } = L;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colour = {
        bg: cssVar('--plot-bg'), grid: cssVar('--plot-grid'), axis: cssVar('--plot-axis'),
        five: cssVar('--damage-5prime'), three: cssVar('--damage-3prime'),
    };
    const mono = cssVar('--font-mono') || 'monospace';
    const sans = cssVar('--font-sans') || 'sans-serif';

    const s = smileySeries(data);
    const max = yMax(s);
    const y = (val) => v.pad.top + plotH - (val / max) * plotH;
    const baseY = v.pad.top + plotH;

    ctx.fillStyle = colour.bg;
    ctx.fillRect(0, 0, w, h);

    // Horizontal grid and y labels
    ctx.lineWidth = 1;
    ctx.strokeStyle = colour.grid;
    ctx.fillStyle = colour.axis;
    ctx.font = `${variant === 'full' ? 11 : 10}px ${mono}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= v.yTicks; i++) {
        const val = max * i / v.yTicks;
        const yy = Math.round(y(val)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(v.pad.left, yy);
        ctx.lineTo(w - v.pad.right, yy);
        ctx.stroke();
        if (v.axes !== 'ends') ctx.fillText((val * 100).toFixed(0) + '%', v.pad.left - 7, yy);
    }

    // X labels
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colour.axis;
    if (v.axes === 'full') {
        ctx.font = `10px ${mono}`;
        ctx.textAlign = 'center';
        [1, 5, 10, 15, 20, 25].forEach(p => {
            ctx.fillText(String(p), L.x5(p - 1), baseY + 15);
            ctx.fillText(String(p), L.x3(p - 1), baseY + 15);
        });
        ctx.font = `12px ${sans}`;
        ctx.fillText('Position from 5′ end', v.pad.left + L.halfW / 2, h - 8);
        ctx.fillText('Position from 3′ end', v.pad.left + L.halfW + L.gap + L.halfW / 2, h - 8);
        ctx.save();
        ctx.translate(13, v.pad.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Substitution frequency', 0, 0);
        ctx.restore();
    } else {
        ctx.font = `10px ${sans}`;
        ctx.textAlign = 'left';
        ctx.fillText('5′', v.pad.left, h - 5);
        ctx.textAlign = 'right';
        ctx.fillText('3′', w - v.pad.right, h - 5);
        if (v.axes === 'short') {
            ctx.textAlign = 'center';
            ctx.fillText('read position', v.pad.left + L.plotW / 2, h - 5);
        }
    }

    const line = (values, xOf, stroke) => {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = v.line;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        values.forEach((val, i) => (i === 0 ? ctx.moveTo(xOf(i), y(val)) : ctx.lineTo(xOf(i), y(val))));
        ctx.stroke();
    };

    // Observed: circles (5′) and squares (3′), with a surface-coloured ring
    // so they stay legible on top of the fit line.
    const r = v.marker;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colour.bg;
    line(s.dp, L.x5, colour.five);
    line(s.dm, L.x3, colour.three);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colour.bg;
    ctx.fillStyle = colour.five;
    s.fp.forEach((val, i) => {
        ctx.beginPath();
        ctx.arc(L.x5(i), y(val), r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });
    ctx.fillStyle = colour.three;
    s.fm.forEach((val, i) => {
        ctx.beginPath();
        ctx.rect(L.x3(i) - r, y(val) - r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
    });
}

/** Hover/keyboard read-out for the full-size plot. */
function attachReadout(canvas) {
    if (canvas.dataset.readout) return;
    canvas.dataset.readout = '1';
    const out = document.createElement('p');
    out.className = 'plot-readout';
    out.setAttribute('aria-live', 'off');
    out.textContent = 'Point at the plot to read values.';
    canvas.insertAdjacentElement('afterend', out);

    canvas.addEventListener('mousemove', (e) => {
        const entry = registry.get(canvas);
        if (!entry) return;
        const L = layout(canvas, entry.variant);
        const s = smileySeries(entry.data);
        const x = e.clientX - canvas.getBoundingClientRect().left;
        const mid = L.v.pad.left + L.halfW + L.gap / 2;
        const clamp = (i) => Math.max(0, Math.min(POSITIONS - 1, i));
        if (x < mid) {
            const i = clamp(Math.round((x - L.v.pad.left) / L.step));
            out.textContent = `Position ${i + 1} from 5′ end: C→T observed ${pct(s.fp[i])}%, fit ${pct(s.dp[i])}%`;
        } else {
            const i = clamp(POSITIONS - 1 - Math.round((x - L.v.pad.left - L.halfW - L.gap) / L.step));
            out.textContent = `Position ${i + 1} from 3′ end: G→A observed ${pct(s.fm[i])}%, fit ${pct(s.dm[i])}%`;
        }
    });
    canvas.addEventListener('mouseleave', () => { out.textContent = 'Point at the plot to read values.'; });
}

function redrawAll() {
    for (const [canvas, { data, variant }] of registry) {
        if (!canvas.isConnected) registry.delete(canvas);
        else if (canvas.offsetParent !== null) paint(canvas, data, variant);
    }
}

let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawAll, 150);
});
