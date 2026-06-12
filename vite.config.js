// Vite library build for csv-grid (the viewer app itself is NOT built —
// it runs the ES-module source natively; serve the repo root).
// Run: npm run build   →  dist/csv-grid.{es,umd}.js + .map,
//                         dist/csv-grid.worker.js, dist/csv-grid.css
// dist/ is committed so consumers can copy without building.
//
// Two passes (see package.json build script): the default pass emits the
// ES bundle, `--mode umd` the UMD one. They are separate because the
// source resolves the worker against import.meta.url, which Rolldown
// (Vite's bundler) replaces with `{}` in UMD output — breaking worker
// resolution. The UMD pass therefore rewrites import.meta.url to a
// polyfill variable (define) whose value comes from document.currentScript
// (intro); that rewrite must NOT apply to the ES pass, which keeps the
// real import.meta.url. The polyfill variable gets minifier-renamed in
// the output — that is fine.

import { defineConfig } from 'vite';
import { readFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = f => fileURLToPath(new URL(f, import.meta.url));
const pkg = JSON.parse(readFileSync(here('./package.json'), 'utf8'));
const banner = `/* csv-grid v${pkg.version} — built by Vite from src/grid/ of the
 * csv-viewer project. Generated file: do not edit. */`;

export default defineConfig(({ mode }) => {
    const umd = mode === 'umd';
    return {
        /* relative base is load-bearing: it makes Vite resolve the worker
         * asset relative to the bundle instead of emitting a root-absolute
         * '/csv-grid.worker.js'. */
        base: './',
        define: umd ? { 'import.meta.url': '__import_meta_url__' } : {},
        /* umd only: emit asset (worker) URLs against the polyfill variable.
         * Vite's default relative-base helper reads document.currentScript
         * LAZILY — null by the time the worker is created — and falls back
         * to the page's baseURI, resolving the worker against the page
         * instead of the bundle. The intro variable captures the script
         * URL at evaluation time, when currentScript is still set. */
        ...(umd && {
            experimental: {
                renderBuiltUrl(filename) {
                    return { runtime: `new URL(${JSON.stringify(filename)}, __import_meta_url__).href` };
                },
            },
        }),
        build: {
            lib: {
                entry: 'src/grid/grid.js',
                name: 'CsvGrid',
                formats: umd ? ['umd'] : ['es'],
                fileName: format => `csv-grid.${format}.js`,
            },
            outDir: 'dist',
            emptyOutDir: !umd,   // the umd pass adds to the es pass's output
            sourcemap: true,
            rollupOptions: {
                output: {
                    banner,
                    // classic <script>: the bundle's own URL at evaluation time
                    ...(umd && {
                        intro: 'var __import_meta_url__ = '
                            + "typeof document !== 'undefined' && document.currentScript && document.currentScript.src"
                            + " || (typeof document !== 'undefined' ? document.baseURI : '');",
                    }),
                },
            },
        },
        worker: {
            // the parse worker referenced by grid.js via
            // new Worker(new URL('./worker.js', import.meta.url), {type:'module'});
            // pin its emitted name so consumers can host it next to the bundle
            rollupOptions: {
                output: { entryFileNames: 'csv-grid.worker.js' },
            },
        },
        plugins: [{
            // grid.css is plain CSS (not imported from JS — the source runs
            // natively in dev, where JS-importing CSS would fail); ship it
            name: 'copy-grid-css',
            closeBundle() {
                copyFileSync(here('./src/grid/grid.css'), here('./dist/csv-grid.css'));
            },
        }],
    };
});
