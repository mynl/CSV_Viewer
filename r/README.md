# csvgrid

An R [htmlwidget](https://www.htmlwidgets.org/) for **csv-viewer**'s
`CsvGrid`: render a data frame (or tibble) as an interactive, type-aware
table.

```r
csvgrid(mtcars)
```

It is the R sibling of the project's Python wrapper (`csv_grid`). Think of
it as a drop-in alternative to `DT::datatable()` for the common case, with
csv-viewer's opinions baked in:

- numbers right-aligned, text left-aligned, dates ISO and centered
- thousands separators and a uniform number of decimals per column
- ratio / rate columns (by header name) shown as percentages
- identifier-like columns (id, code, zip, account no, …) without separators
- engineering (SI-suffix) format for columns spanning many magnitudes
- **equal-risk column widths**: each column is sized so every cell is at
  least equally likely to be shown in full
- fuzzy global search, per-column filters, click-to-sort headers
- automatic dark mode (follows the host page / RStudio theme)

The column typing and all formatting happen inside the grid (the same
engine as the live web app and the Python package). This R package only
serializes your data frame and hands it over.

## Install

The package lives in the `r/` subdirectory of the
[CSV_Viewer](https://github.com/mynl/CSV_Viewer) repo, so install it with
the `subdir` argument:

```r
# install.packages("remotes")
remotes::install_github("mynl/CSV_Viewer", subdir = "r")
```

The only hard dependency is **htmlwidgets**. `DT` is suggested (used by the
demo for the side-by-side comparison). It is not on CRAN; GitHub is the
distribution channel.

## Quick start

```r
library(csvgrid)

csvgrid(mtcars)                              # row names become a column
csvgrid(iris, name = "irises")               # label in the status line
csvgrid(economics, max_rows = 15)            # cap the visible rows; rest scroll
```

Print at the console and it opens in the RStudio Viewer; return it from an
R Markdown / Quarto chunk and it embeds in the rendered document; use it in
Shiny with `csvgridOutput()` / `renderCsvgrid()` (below).

### Full tidyverse support

A tibble is a data frame, and `dplyr` / `tidyr` hand back data frames, so
the pipe just works. Factors and dates are converted for you.

```r
library(dplyr)
starwars |>
  filter(!is.na(mass)) |>
  select(name, height, mass, species, homeworld) |>
  csvgrid(name = "Star Wars characters")
```

## How it compares to DT

`DT::datatable()` wraps the DataTables JavaScript library; `csvgrid()`
wraps csv-viewer's grid. Both give you an interactive table from a data
frame. The difference is the defaults: csvgrid leads with number/date
formatting and width allocation rather than leaving them to you. For a
plain interactive table the call is the same shape:

```r
DT::datatable(df)   # ->
csvgrid(df)
```

Run `source("r/demo.R")` for a side-by-side of the two over a stocks table
(dates, variable-width text, big numbers, a percentage column) and over
`mtcars`.

## Arguments

`csvgrid(data, ...)`:

| argument | default | meaning |
|---|---|---|
| `data` | — | a data frame or tibble |
| `name` | `NULL` | label shown in the status line |
| `rownames` | `TRUE` | include character row names (e.g. `mtcars`) as a leading column; default integer row names are never shown |
| `global_search` | `TRUE` | fzf search box |
| `column_filters` | `TRUE` | per-column filter row |
| `sortable` | `TRUE` | click headers to sort |
| `status_bar` | `TRUE` | row-count status line |
| `expand_buttons` | `TRUE` | Expand / Contract buttons |
| `width_mode` | `"equal-risk"` | or `"coverage"` (maximize fully-shown cells) |
| `align` | `NULL` | per-column override string, e.g. `"llrcr"` (l/r/c) |
| `formats` | `NULL` | per-column format list; `NA` = auto, else `[,][.N](f\|d\|%\|e\|s)`, `"year"`, `"eng"` |
| `display_mode` | `"auto"` | `"auto"` (formatted) or `"raw"` (verbatim) |
| `max_rows` | `NULL` | cap the scroll viewport to ~N rows |
| `width`, `height` | `NULL` | widget sizing (htmlwidgets) |
| `elementId` | `NULL` | explicit element id |

### How columns are typed and formatted

Types are inferred from the values you send, exactly as the csv-viewer app
infers them from a CSV. A few things worth knowing:

- **Dates.** `Date` columns render `YYYY-MM-DD`. `POSIXct` columns are
  emitted at full precision and the grid shows their **finest present**
  resolution: just the date when every value is midnight, `HH:MM` when only
  minutes are present, `:SS` for whole seconds, down to `.fff` milliseconds
  for sub-second data — with a uniform fractional width per column.
- **Numbers.** Whole-valued numeric columns format as integers with
  thousands separators; columns with decimals get a uniform decimal count
  from their typical magnitude. Years (1800–2100, or a `year`-ish header)
  print without separators.
- **Ratios.** Columns whose header looks like a ratio or rate (`ratio`,
  `rate`, `roe`, `yield`, `margin`, `share`, `pct`, …) and whose values are
  small (≤ ~2) render as percentages: `0.0625` shows as `6.2%`.
- **Identifiers.** Columns whose header looks like an id (`id`, `code`,
  `zip`, `account no`, `ssn`, …) print without separators, and any column
  with a significant leading zero is kept as text.
- **Override** the alignment per column with `align`, or force a format
  with `formats` (use `NA` for the entries you want left on auto).

Override examples:

```r
# show profit as a percent, keep the rest auto; left-align the label column
csvgrid(df,
        align   = "lrr",
        formats = list(NA, NA, "%"))
```

## R Markdown / Quarto

Just return the widget from a chunk:

````markdown
```{r}
library(csvgrid)
csvgrid(mtcars)
```
````

It self-contains its JavaScript and CSS, so the rendered HTML works
offline. Set `height` (or `max_rows`) to control the block height.

## Shiny

```r
library(shiny)
library(csvgrid)

ui <- fluidPage(
  csvgridOutput("tbl", height = "600px")
)
server <- function(input, output, session) {
  output$tbl <- renderCsvgrid({
    csvgrid(mtcars)
  })
}
shinyApp(ui, server)
```

## Updating the bundled grid

The package ships the built grid assets under
`inst/htmlwidgets/lib/csv-grid/` (`csv-grid.iife.js` + `csv-grid.css`).
They are committed artifacts. The repo's `npm run build` rebuilds `dist/`
and copies the assets into this package (and the Python one), so after any
change to `src/grid/` rebuild and re-install:

```sh
npm run build
```

The package version mirrors the project version.

## License

MIT © Stephen J. Mildenhall. See `LICENSE.md`.
