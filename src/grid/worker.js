/* csv-grid parse worker: runs processData (parse + type inference) off
 * the main thread for large files. Module worker; pure compute — no DOM,
 * no state. Vite compiles this (with core.js inlined) to
 * dist/csv-grid.worker.js. */

import { processData } from './core.js';

self.onmessage = e => {
    const { gen, text, headerOverride } = e.data;
    try {
        self.postMessage({ gen, result: processData(text, headerOverride) });
    } catch (err) {
        self.postMessage({ gen, error: err.message || String(err) });
    }
};
