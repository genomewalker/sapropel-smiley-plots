// Modal dialog behaviour shared by every overlay: ARIA roles, focus trap,
// Escape to close, click on the backdrop to close, focus returned to the
// control that opened it. Overlays are shown with the `open` class.

const stack = [];   // open overlays, top-most last

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, summary, [tabindex]:not([tabindex="-1"])';

export const hasOpenDialog = () => stack.length > 0;

/**
 * @param {HTMLElement} overlay  backdrop element; its first child is the dialog
 * @param {{ label: string, onClose?: () => void, initialFocus?: string }} options
 */
export function openDialog(overlay, { label, onClose, initialFocus } = {}) {
    const existing = stack.find(d => d.overlay === overlay);
    const panel = overlay.firstElementChild;
    if (panel) {
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        if (label) panel.setAttribute('aria-label', label);
        panel.tabIndex = -1;
    }
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    if (existing) {            // re-rendered while open: keep the original opener
        existing.onClose = onClose;
    } else {
        stack.push({ overlay, onClose, opener: document.activeElement });
        overlay.addEventListener('mousedown', onBackdrop);
    }
    const target = (initialFocus && overlay.querySelector(initialFocus)) || panel;
    if (target) target.focus({ preventScroll: true });
}

export function closeDialog(overlay) {
    const i = stack.findIndex(d => d.overlay === overlay);
    overlay.classList.remove('open');
    if (i === -1) return;
    const [entry] = stack.splice(i, 1);
    overlay.removeEventListener('mousedown', onBackdrop);
    if (stack.length === 0) document.body.style.overflow = '';
    if (entry.onClose) entry.onClose();
    if (entry.opener && entry.opener.isConnected) entry.opener.focus({ preventScroll: true });
}

function onBackdrop(e) {
    if (e.target === e.currentTarget) closeDialog(e.currentTarget);
}

document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
        e.stopPropagation();
        closeDialog(top.overlay);
        return;
    }
    if (e.key !== 'Tab') return;
    const items = [...top.overlay.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!top.overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}, true);
