/* csv-viewer — viewer app chrome.
 *
 * Ingest (drag/drop, browse, paste, ?src=<url>), the toolbar, keyboard
 * shortcuts, PWA registration, and parse dispatch (synchronous for small
 * inputs, Web Worker for large). The grid itself — render, sort, filter,
 * widths — is the CsvGrid class in src/grid/grid.js; pure data logic is
 * src/grid/core.js. The chrome feeds the grid processData results via
 * grid.setData. All data stays in the browser.
 */

'use strict';

const VERSION = '3.0.0';
const WORKER_MIN_CHARS = 1000000; // ~1 MB; below this parse synchronously

const $ = id => document.getElementById(id);

let grid = null;          // the one CsvGrid instance, created on DOMContentLoaded
let rawText = '';         // cleaned source text, kept for the header toggle
let loadedFileName = '';
let guessedHeaders = false;

/* Parse worker, created lazily. false = unavailable (file://) -> fall
 * back to synchronous processData. */
let parseWorker = null;
let loadRequest = null;       // {gen, fileName, text} awaiting the worker
let loadRequestGen = 0;

function getParseWorker() {
    if (parseWorker === null) {
        try {
            parseWorker = new Worker('src/grid/worker.js');
            parseWorker.onmessage = e => {
                const { gen, result, error } = e.data;
                if (!loadRequest || gen !== loadRequest.gen) return;   // stale reply
                const req = loadRequest;
                loadRequest = null;
                if (error) showError(error);
                else installData(result, req.fileName, req.text);
            };
            parseWorker.onerror = () => {
                if (loadRequest) { loadRequest = null; showError('Background parse failed.'); }
            };
        } catch {
            parseWorker = false;
        }
    }
    return parseWorker;
}

/* headerOverride: null = auto-detect, true = force row 1 as header,
 * false = force headerless (guessed names). Large texts parse in the
 * worker (UI stays live, status bar shows progress); small ones inline. */
function loadText(text, fileName, headerOverride = null) {
    try {
        text = cleanCsvText(text);
        if (!text.trim()) throw new Error('No data found.');
        const w = text.length >= WORKER_MIN_CHARS ? getParseWorker() : null;
        if (w) {
            loadRequest = { gen: ++loadRequestGen, fileName, text };
            $('status-bar').classList.remove('d-none');
            $('status').textContent = `parsing ${fileName || 'data'} (${(text.length / 1e6).toFixed(1)} MB)…`;
            w.postMessage({ gen: loadRequest.gen, text, headerOverride });
        } else {
            installData(processData(text, headerOverride), fileName, text);
        }
    } catch (err) {
        showError(err.message || String(err));
    }
}

/* Show the table view and hand a processData result to the grid. The view
 * switch comes first: width measurement needs the table visible. */
function installData(d, fileName, text) {
    rawText = text;                   // kept for the header toggle
    loadedFileName = fileName || '';
    guessedHeaders = d.headerless;
    $('global-filter').value = '';
    $('ingest-error').classList.add('d-none');
    $('ingest-view').classList.add('d-none');
    $('table-view').classList.remove('d-none');
    $('toolbar').classList.remove('d-none');
    $('status-bar').classList.remove('d-none');
    $('header-btn').classList.toggle('active', !d.headerless);
    grid.setData(d, loadedFileName);
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
    grid = new CsvGrid({
        table: $('data-table'),
        head: $('table-head'),
        body: $('table-body'),
        status: $('status'),
        capNote: $('render-cap-note'),
        showAllBtn: $('show-all-btn'),
    });
    initEvents();
    initPWA();
    const src = new URLSearchParams(location.search).get('src');
    if (src) loadFromUrl(src);
});
