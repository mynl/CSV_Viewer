#' csvgrid: interactive, type-aware tables from data frames
#'
#' Render a data frame (or tibble) as an interactive CsvGrid table — the
#' embeddable grid from the csv-viewer project — wrapped as an
#' \pkg{htmlwidgets} widget. A drop-in alternative to
#' \code{DT::datatable()} for the common case: \code{csvgrid(df)}.
#'
#' The grid re-infers each column's type (number / date / text) from the
#' emitted values and formats them the way csv-viewer does: numbers
#' right-aligned with thousands separators and uniform decimals, ratio /
#' rate columns as percentages, identifier-like columns without
#' separators, dates as ISO and centered, text left-aligned, with
#' equal-risk column-width allocation. This wrapper only serializes the
#' frame (dates to ISO strings, factors to character, \code{NA} to blank);
#' all formatting decisions happen grid-side.
#'
#' @param data A data frame or tibble. List-columns are coerced with
#'   \code{as.character()}.
#' @param name Optional label shown in the grid's status line.
#' @param rownames Logical; when \code{TRUE} (default) and the frame has
#'   character row names (e.g. \code{mtcars}), include them as a leading
#'   column, mirroring \code{DT::datatable()}. Default integer row names
#'   are never shown.
#' @param global_search,column_filters,sortable,status_bar,expand_buttons
#'   Logical toggles for the fzf search box, the per-column filter row,
#'   click-to-sort headers, the row-count status line, and the
#'   Expand/Contract buttons. All default \code{TRUE}.
#' @param width_mode Width-squeeze allocation when the table is wider than
#'   its container: \code{"equal-risk"} (every column truncates with equal
#'   probability) or \code{"coverage"} (maximize the count of cells shown
#'   in full).
#' @param align Optional per-column alignment override, one of
#'   \code{l}/\code{r}/\code{c} per column as a single string
#'   (e.g. \code{"llrcr"}); other characters keep the type default.
#' @param formats Optional per-column format spec as a list, one entry per
#'   column. Use \code{NA} for "auto" (the default rule); otherwise a
#'   d3/Python-style spec \code{[,][.N](f|d|\%|e|s)} or the named
#'   \code{"year"} / \code{"eng"}.
#' @param display_mode \code{"auto"} (type-aware formatting) or
#'   \code{"raw"} (verbatim source text); a view lens only.
#' @param theme \code{"auto"} (default; follow the host page / OS via
#'   \code{prefers-color-scheme}), or force \code{"light"} or \code{"dark"}.
#' @param max_rows Optional integer; cap the scroll viewport to about this
#'   many rows (the rest scroll vertically).
#' @param width,height Widget sizing passed to \pkg{htmlwidgets}. In the
#'   RStudio Viewer the widget fills the pane; in R Markdown / Quarto it
#'   defaults to a 500px-tall scrollable block.
#' @param elementId Optional explicit element id.
#'
#' @return An \code{htmlwidget} object. Printed at the console it opens in
#'   the RStudio Viewer; returned from a chunk it embeds in the document.
#'
#' @examples
#' if (interactive()) {
#'   csvgrid(mtcars)
#'   csvgrid(iris, name = "Edgar Anderson's irises")
#' }
#'
#' @import htmlwidgets
#' @export
csvgrid <- function(data,
                    name = NULL,
                    rownames = TRUE,
                    global_search = TRUE,
                    column_filters = TRUE,
                    sortable = TRUE,
                    status_bar = TRUE,
                    expand_buttons = TRUE,
                    width_mode = c("equal-risk", "coverage"),
                    align = NULL,
                    formats = NULL,
                    display_mode = c("auto", "raw"),
                    theme = c("auto", "light", "dark"),
                    max_rows = NULL,
                    width = NULL,
                    height = NULL,
                    elementId = NULL) {

    width_mode <- match.arg(width_mode)
    display_mode <- match.arg(display_mode)
    theme <- match.arg(theme)

    payload <- csvgrid_payload(data, name = name, rownames = rownames)

    opts <- list(
        globalSearch   = isTRUE(global_search),
        columnFilters  = isTRUE(column_filters),
        sortable       = isTRUE(sortable),
        statusBar      = isTRUE(status_bar),
        expandButtons  = isTRUE(expand_buttons),
        widthMode      = width_mode,
        displayMode    = display_mode,
        worker         = FALSE   # data is inlined, never fetched
    )
    if (!is.null(align))    opts$align    <- align
    if (!is.null(formats))  opts$formats  <- as.list(formats)
    if (!is.null(max_rows)) opts$maxRows  <- as.integer(max_rows)

    # theme is applied to the host element by the binding (the grid reads
    # .csvgrid[data-theme=...]); "auto" leaves it to prefers-color-scheme.
    x <- list(data = payload, opts = opts, theme = theme)
    # Serialize numbers at full precision (the grid does the rounding) and
    # NA as JSON null (blank cells).
    attr(x, "TOJSON_ARGS") <- list(digits = NA, na = "null", null = "null")

    htmlwidgets::createWidget(
        name = "csvgrid",
        x = x,
        width = width,
        height = height,
        package = "csvgrid",
        elementId = elementId,
        sizingPolicy = htmlwidgets::sizingPolicy(
            defaultWidth = "100%",
            defaultHeight = 500,
            viewer.defaultWidth = "100%",
            viewer.defaultHeight = "100%",
            viewer.fill = TRUE,
            viewer.padding = 0,
            browser.fill = TRUE,
            browser.padding = 0,
            knitr.figure = FALSE,
            knitr.defaultWidth = "100%",
            knitr.defaultHeight = 500
        )
    )
}

# Convert one column to a JSON-friendly vector: dates -> ISO strings,
# factors / everything exotic -> character, numerics kept as-is (jsonlite
# emits whole-valued doubles without a trailing ".0", so the grid still
# sees them as integers). NA is preserved and becomes JSON null.
conv_col <- function(x) {
    if (inherits(x, "Date")) {
        return(format(x, "%Y-%m-%d"))
    }
    if (inherits(x, "POSIXt")) {
        midnight <- is.na(x) | format(x, "%H:%M:%S") == "00:00:00"
        return(format(x, if (all(midnight)) "%Y-%m-%d" else "%Y-%m-%d %H:%M"))
    }
    if (is.factor(x))  return(as.character(x))
    if (is.logical(x)) return(as.character(x))   # "TRUE"/"FALSE" as text
    if (is.numeric(x)) return(x)
    as.character(x)
}

# Build the {records, columns[, name]} payload the grid consumes:
# records as row-major arrays, columns in order. Character row names
# (mtcars-style) become a leading column when rownames = TRUE.
csvgrid_payload <- function(data, name = NULL, rownames = TRUE) {
    data <- as.data.frame(data, stringsAsFactors = FALSE, check.names = FALSE)

    cols <- lapply(data, conv_col)   # named list of JSON-friendly columns
    headers <- names(data)

    # Character row names (mtcars-style) become a leading column; default
    # integer row names are skipped. Prepend to the column list directly —
    # cbind() would mangle the blank header via make.names().
    if (isTRUE(rownames)) {
        rn <- attr(data, "row.names")
        if (is.character(rn)) {
            cols <- c(list(as.character(rn)), cols)
            headers <- c(" ", headers)
        }
    }

    # row-wise: each record is an unnamed list of cells (mixed types ok)
    records <- .mapply(function(...) list(...), cols, NULL)
    records <- lapply(records, unname)

    payload <- list(
        records = records,
        columns = as.list(headers)
    )
    if (!is.null(name)) payload$name <- name
    payload
}

#' Shiny bindings for csvgrid
#'
#' Output and render functions for using \code{\link{csvgrid}} inside a
#' Shiny app or interactive R Markdown document.
#'
#' @param outputId Output variable to read from.
#' @param width,height Must be valid CSS units (e.g. \code{"100\%"},
#'   \code{"400px"}) or numbers (interpreted as pixels).
#' @param expr An expression that generates a \code{\link{csvgrid}} widget.
#' @param env The environment in which to evaluate \code{expr}.
#' @param quoted Is \code{expr} a quoted expression (with
#'   \code{quote()})? Useful when wrapping this function inside another.
#'
#' @name csvgrid-shiny
#' @export
csvgridOutput <- function(outputId, width = "100%", height = "500px") {
    htmlwidgets::shinyWidgetOutput(outputId, "csvgrid", width, height,
                                   package = "csvgrid")
}

#' @rdname csvgrid-shiny
#' @export
renderCsvgrid <- function(expr, env = parent.frame(), quoted = FALSE) {
    if (!quoted) expr <- substitute(expr)
    htmlwidgets::shinyRenderWidget(expr, csvgridOutput, env, quoted = TRUE)
}
