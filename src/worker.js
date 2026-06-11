/* csv-viewer parse worker: runs processData (parse + type inference) off
 * the main thread for large files. Pure compute — no DOM, no state. */

'use strict';

importScripts('core.js');

self.onmessage = e => {
    const { gen, text, headerOverride } = e.data;
    try {
        self.postMessage({ gen, result: processData(text, headerOverride) });
    } catch (err) {
        self.postMessage({ gen, error: err.message || String(err) });
    }
};
