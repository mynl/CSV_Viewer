/* csv-viewer — viewer app chrome.
 *
 * Ingest (drag/drop, browse, paste, ?src=<url>), the toolbar, keyboard
 * shortcuts, and PWA registration. The grid itself — parse dispatch
 * (sync / worker), render, sort, filter, widths — is the CsvGrid class in
 * src/grid/grid.js. The chrome loads via grid.setData({csv}) and switches
 * views when the promise settles. The navbar owns the search box and
 * Expand/Contract (globalSearch:false, expandButtons:false); the grid
 * renders row counts into the footer's #status element. All data stays
 * in the browser.
 *
 * ES module (as is the whole source tree, run natively — no build step;
 * serve the repo root, e.g. python -m http.server 8080).
 */

import CsvGrid from '../grid/grid.js';
import { cleanCsvText } from '../grid/core.js';

const VERSION = '3.2.0';

const $ = id => document.getElementById(id);

let grid = null;          // the one CsvGrid instance, created on DOMContentLoaded
let rawText = '';         // cleaned source text, kept for the header toggle
let loadedFileName = '';
let guessedHeaders = false;

/* headerOverride: null = auto-detect, true = force row 1 as header,
 * false = force headerless (guessed names). The grid parses (worker for
 * large texts — UI stays live, footer shows progress); on success switch
 * to the table view, on failure back to ingest with the message. A
 * superseded load (rapid re-drop) never settles — no view flicker. */
function loadText(text, fileName, headerOverride = null) {
    const headerMode = headerOverride === null ? 'auto'
        : headerOverride ? 'first-row' : 'headerless';
    $('status-bar').classList.remove('d-none');   // shows parse progress
    grid.setData({ csv: text, name: fileName, headerMode })
        .then(() => {
            rawText = cleanCsvText(text);         // kept for the header toggle
            loadedFileName = fileName || '';
            guessedHeaders = grid.guessedHeaders;
            $('global-filter').value = '';
            $('ingest-error').classList.add('d-none');
            $('ingest-view').classList.add('d-none');
            $('table-view').classList.remove('d-none');
            $('toolbar').classList.remove('d-none');
            $('status-bar').classList.remove('d-none');
            $('header-btn').classList.toggle('active', !grid.guessedHeaders);
            setDateNote();
            grid.applyLayout();   // width solve needs the table visible
        })
        .catch(err => showError(err.message || String(err)));
}

function loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => loadText(reader.result, file.name);
    reader.onerror = () => showError(`Could not read ${file.name}.`);
    reader.readAsText(file);
}

function showError(msg) {
    showIngest();
    $('error-message').textContent = msg;
    $('ingest-error').classList.remove('d-none');
}

function showIngest() {
    $('table-view').classList.add('d-none');
    $('toolbar').classList.add('d-none');
    $('status-bar').classList.add('d-none');
    $('ingest-view').classList.remove('d-none');
}

/* Lower-right footer note: which date columns we read as US m/d/y because
 * the all-numeric order was genuinely ambiguous. Empty (hidden) otherwise.
 * The list is truncated so the note stays a single tidy line. */
function setDateNote() {
    const cols = grid.ambiguousDateCols || [];
    const shown = cols.length > 3
        ? `${cols.slice(0, 3).join(', ')}, +${cols.length - 3} more`
        : cols.join(', ');
    $('date-note').textContent = cols.length
        ? `Dates in ${shown} read as US m/d/y (ambiguous)`
        : '';
}

function initEvents() {
    const dz = $('drop-zone'), fi = $('file-input');

    dz.addEventListener('click', () => fi.click());
    $('browse-btn').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { if (fi.files.length) loadFile(fi.files[0]); fi.value = ''; });

    // drag & drop: highlight the zone, but accept a drop anywhere on the page
    document.addEventListener('dragover', e => {
        e.preventDefault();
        dz.classList.add('drag-over');
    });
    document.addEventListener('dragleave', e => {
        if (!e.relatedTarget) dz.classList.remove('drag-over');
    });
    document.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });

    $('paste-btn').addEventListener('click', () => loadText($('paste-input').value, 'pasted data'));

    // Ctrl+V on the ingest screen (outside the textarea) loads the clipboard
    document.addEventListener('paste', e => {
        if (!$('ingest-view').classList.contains('d-none')
            && e.target !== $('paste-input')) {
            const text = e.clipboardData.getData('text');
            if (text.trim()) { e.preventDefault(); loadText(text, 'pasted data'); }
        }
    });

    $('global-filter').addEventListener('input', e => grid.setGlobalFilter(e.target.value));
    $('global-filter').addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.target.value = '';
            e.target.blur();
            grid.setGlobalFilter('');
        }
    });

    // Ctrl+O: from the table, back to ingest; from ingest, straight to browse
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            if ($('ingest-view').classList.contains('d-none')) showIngest();
            else fi.click();
        }
    });
    $('clear-filters-btn').addEventListener('click', () => {
        $('global-filter').value = '';
        grid.clearFilters();
    });
    $('open-btn').addEventListener('click', showIngest);
    // separate buttons by design — no mode-flipping play/pause toggles
    $('expand-btn').addEventListener('click', () => grid.expand());
    $('contract-btn').addEventListener('click', () => grid.contract());
    // column-fit method: a two-state labeled segmented control (not a toggle)
    $('fit-balanced').addEventListener('click', () => setFit('equal-risk'));
    $('fit-maximize').addEventListener('click', () => setFit('coverage'));
    // re-interpret the loaded data with the opposite header assumption
    $('header-btn').addEventListener('click', () => {
        if (rawText) loadText(rawText, loadedFileName, guessedHeaders);
    });

    // re-solve column widths on resize (widths stay frozen w.r.t. filtering)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => grid.applyLayout(), 150);
    });

    // follow the OS light/dark preference if it changes mid-session (the
    // initial value is set inline in <head> to avoid a flash)
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        document.documentElement.setAttribute('data-bs-theme', e.matches ? 'dark' : 'light');
    });
}

/* Switch the column-fit method and reflect it in the segmented control's
 * active state. 'equal-risk' = Balanced, 'coverage' = Maximize. */
function setFit(mode) {
    grid.setWidthMode(mode);
    $('fit-balanced').classList.toggle('active', mode !== 'coverage');
    $('fit-maximize').classList.toggle('active', mode === 'coverage');
}

/* Auto-load a CSV from ?src=<url>. Subject to CORS on cross-origin hosts;
 * intended for same-origin embeds (e.g. a blog post's own resources). */
function loadFromUrl(url) {
    fetch(url)
        .then(resp => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.text();
        })
        .then(text => loadText(text, decodeURIComponent(url.split('/').pop() || url)))
        .catch(err => showError(`Could not load ?src=${url} — ${err.message}`));
}

/* Register the service worker (PWA install + offline shell). Only possible
 * on https or localhost; a no-op when opened from file://. */
function initPWA() {
    if ('serviceWorker' in navigator
        && (location.protocol === 'https:'
            || ['localhost', '127.0.0.1'].includes(location.hostname))) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

document.addEventListener('DOMContentLoaded', () => {
    $('header-version').textContent = 'v' + VERSION;
    const params = new URLSearchParams(location.search);
    const widthMode = params.get('widths') === 'coverage' ? 'coverage' : 'equal-risk';
    grid = new CsvGrid('#grid-root', null, {
        globalSearch: false,      // the navbar owns the search box
        expandButtons: false,     // the navbar owns Expand / Contract
        statusBar: $('status'),   // row counts render into the footer
        widthMode,                // ?widths=coverage opts into the coverage fit
    });
    initEvents();
    setFit(widthMode);            // sync the segmented control to the URL choice
    initPWA();
    // installed-PWA file handling: Windows "Open with" / default app for
    // .csv etc. (manifest file_handlers); launches queue until consumed
    if ('launchQueue' in window) {
        window.launchQueue.setConsumer(params => {
            if (params.files && params.files.length) {
                params.files[0].getFile().then(loadFile);
            }
        });
    }
    const src = params.get('src');
    if (src) loadFromUrl(src);
});
