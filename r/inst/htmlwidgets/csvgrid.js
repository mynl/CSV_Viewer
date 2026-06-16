HTMLWidgets.widget({

  name: "csvgrid",
  type: "output",

  factory: function (el, width, height) {

    // One CsvGrid instance per widget element, rebuilt on each render
    // (Shiny may re-send data into the same element).
    var grid = null;

    return {

      renderValue: function (x) {
        if (grid && typeof grid.destroy === "function") grid.destroy();
        el.replaceChildren();
        // Force light/dark, or fall back to the OS via prefers-color-scheme.
        // The grid reads .csvgrid[data-theme="light"|"dark"].
        if (x.theme && x.theme !== "auto") {
          el.setAttribute("data-theme", x.theme);
        } else {
          el.removeAttribute("data-theme");
        }
        // x.data = {records, columns[, name]}; x.opts = CsvGrid options.
        // CsvGrid is the global from csv-grid.iife.js (loaded as a
        // dependency before this binding).
        grid = new CsvGrid(el, x.data, x.opts || {});
        el.csvgrid = grid;   // expose for debugging / HTMLWidgets.find()
        // The container's final width may not be settled the instant the
        // widget is inserted; the grid solves widths against the parent's
        // clientWidth, so re-solve once layout has stabilized.
        window.requestAnimationFrame(function () {
          if (grid) grid.applyLayout();
        });
      },

      // The grid keeps no resize listener of its own (by design — no
      // document-level listeners). Re-solve widths against the new box.
      resize: function (width, height) {
        if (grid) grid.applyLayout();
      },

      getGrid: function () { return grid; }
    };
  }
});
