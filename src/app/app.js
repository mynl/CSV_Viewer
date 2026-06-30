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

const VERSION = '3.8.0';

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
            // surface the file in the window/tab title bar (PWA + browser)
            document.title = loadedFileName ? `${loadedFileName} — CSV Viewer` : 'CSV Viewer';
            guessedHeaders = grid.guessedHeaders;
            $('global-filter').value = '';
            $('ingest-error').classList.add('d-none');
            $('ingest-view').classList.add('d-none');
            $('table-view').classList.remove('d-none');
            $('toolbar').classList.remove('d-none');
            $('status-bar').classList.remove('d-none');
            syncHeaderActive();
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
    document.title = 'CSV Viewer';   // no file on screen — back to the bare title
    $('table-view').classList.add('d-none');
    $('toolbar').classList.add('d-none');
    $('status-bar').classList.add('d-none');
    $('ingest-view').classList.remove('d-none');
}

/* Lower-right footer note: which date columns we read as US m/d/y because
 * the all-numeric order was genuinely ambiguous. Empty (hidden) otherwise.
 * The list is truncated so the note stays a single tidy line. */
function setDateNote() {
    // Raw mode does no date reinterpretation, so the ambiguity note doesn't
    // apply — keep it hidden there.
    if ($('display-raw').classList.contains('active')) { $('date-note').textContent = ''; return; }
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
    // Open (inline button + "More" menu item): back to ingest, clearing any
    // stale paste text
    document.querySelectorAll('.open-action').forEach(el => el.addEventListener('click', openAction));
    // separate buttons by design — no mode-flipping play/pause toggles
    $('expand-btn').addEventListener('click', () => grid.expand());
    $('contract-btn').addEventListener('click', () => grid.contract());
    // column-fit method: a two-state labeled segmented control (not a toggle)
    $('fit-balanced').addEventListener('click', () => setFit('equal-risk'));
    $('fit-maximize').addEventListener('click', () => setFit('coverage'));
    // display lens: Inferred (type-aware formatting) vs Raw (verbatim source),
    // another labeled segmented control, parked in the footer
    $('display-inferred').addEventListener('click', () => setDisplay('auto'));
    $('display-raw').addEventListener('click', () => setDisplay('raw'));
    // re-interpret the loaded data with the opposite header assumption
    // (inline Row-1 button + "More" menu item share the handler)
    document.querySelectorAll('.header-toggle').forEach(el => el.addEventListener('click', headerAction));

    initMenus();
    initExport();

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

// --- folded controls (shared by the inline buttons and the "More" menu) ---

/* Back to ingest, clearing any stale text in the paste area. */
function openAction() {
    $('paste-input').value = '';
    showIngest();
}

/* Re-interpret the loaded data with the opposite header assumption. */
function headerAction() {
    if (rawText) loadText(rawText, loadedFileName, guessedHeaders);
}

/* Reflect the current header interpretation on every Row-1 control (the
 * inline button and the "More" menu item). */
function syncHeaderActive() {
    document.querySelectorAll('.header-toggle')
        .forEach(el => el.classList.toggle('active', !grid.guessedHeaders));
}

// --- export (Copy / Save) -------------------------------------------------

/* Split-button menus, done in ~20 lines so we don't pull in Bootstrap's JS
 * bundle just for two dropdowns: the caret toggles its own menu, a click
 * elsewhere or Escape closes any open one. The Format-values checkbox lives
 * inside a menu, so clicks on it must not bubble up and close the menu. */
function initMenus() {
    const closeAll = except => document.querySelectorAll('#toolbar .dropdown-menu.show')
        .forEach(m => { if (m !== except) m.classList.remove('show'); });
    document.querySelectorAll('.csv-menu-toggle').forEach(t => {
        t.addEventListener('click', e => {
            e.stopPropagation();
            const menu = t.parentElement.querySelector('.dropdown-menu');
            const open = menu.classList.contains('show');
            closeAll(menu);
            menu.classList.toggle('show', !open);
            t.setAttribute('aria-expanded', String(!open));
        });
    });
    document.querySelectorAll('#toolbar .dropdown-menu label').forEach(l =>
        l.addEventListener('click', e => e.stopPropagation()));
    document.addEventListener('click', () => closeAll());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
}

/* Wire the primary split-buttons (view → CSV) and every menu action, across
 * both the inline split-buttons and the narrow "More" menu. */
function initExport() {
    $('copy-btn').addEventListener('click', e => runExport(e.currentTarget, 'copy', 'view', 'csv'));
    $('save-btn').addEventListener('click', e => runExport(e.currentTarget, 'save', 'view', 'csv'));
    document.querySelectorAll('#toolbar [data-export]').forEach(item =>
        item.addEventListener('click', e => runExport(e.currentTarget,
            item.dataset.export, item.dataset.scope, item.dataset.format)));
}

/* Resolve the source control's enclosing dropdown (a Copy/Save split-button
 * or the narrow "More" menu) to read that menu's Format-values toggle and
 * find a button to flash, then export. */
function runExport(src, sink, scope, format) {
    const box = src.closest('.btn-group, .dropdown');
    const cb = box && box.querySelector('.export-formatted');
    const values = cb && cb.checked ? 'formatted' : 'raw';
    const flashBtn = box ? box.querySelector('button') : src;
    const text = grid.export({ scope, format, values });
    if (sink === 'copy') copyText(text, flashBtn);
    else saveText(text, format, flashBtn);
}

/* Clipboard copy (writeText on https/localhost/PWA; a hidden-textarea
 * fallback otherwise). Brief on-button confirmation either way. */
function copyText(text, btn) {
    const ok = () => flash(btn, 'Copied'), bad = () => flash(btn, 'Copy failed');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, bad);
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); ok(); } catch { bad(); }
        ta.remove();
    }
}

/* Download as a file. CSV gets a UTF-8 BOM (Excel reads non-ASCII right; we
 * strip BOM on input, so a round-trip stays clean); markdown gets none. */
function saveText(text, format, btn) {
    const md = format === 'md';
    const body = md ? text : '﻿' + text;   // UTF-8 BOM, CSV only
    const mime = (md ? 'text/markdown' : 'text/csv') + ';charset=utf-8';
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = exportBaseName() + (md ? '.md' : '.csv');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash(btn, 'Saved');
}

/* Loaded filename minus its extension, fallback 'table'. */
function exportBaseName() {
    const n = (loadedFileName || '').replace(/\.[^.\\/]+$/, '').trim();
    return n || 'table';
}

/* Transient confirmation on a split-button's primary face: swap the label
 * (when visible) and tint it for ~1.2s, then restore. */
function flash(btn, msg) {
    const label = btn.querySelector('.btn-label');
    if (label) {
        if (btn._restore == null) btn._restore = label.textContent;
        label.textContent = ' ' + msg;
    }
    btn.classList.add('flash-ok');
    clearTimeout(btn._flashT);
    btn._flashT = setTimeout(() => {
        btn.classList.remove('flash-ok');
        if (label && btn._restore != null) { label.textContent = btn._restore; btn._restore = null; }
    }, 1200);
}

/* Switch the column-fit method and reflect it in the segmented control's
 * active state. 'equal-risk' = Balanced, 'coverage' = Maximize. */
function setFit(mode) {
    grid.setWidthMode(mode);
    $('fit-balanced').classList.toggle('active', mode !== 'coverage');
    $('fit-maximize').classList.toggle('active', mode === 'coverage');
}

/* Switch the display lens and reflect it in the footer switch. 'auto' =
 * Inferred (type-aware formatting), 'raw' = verbatim source. The date-
 * ambiguity note is hidden in raw mode (set the active state first so
 * setDateNote sees it). */
function setDisplay(mode) {
    $('display-inferred').classList.toggle('active', mode !== 'raw');
    $('display-raw').classList.toggle('active', mode === 'raw');
    grid.setDisplayMode(mode);
    setDateNote();
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
