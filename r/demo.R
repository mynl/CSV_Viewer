# demo.R — csvgrid side by side with DT::datatable.
#
# Run it from the repo root in RStudio:
#
#   # one-time, install the package from the local source tree:
#   install.packages(c("remotes", "DT"))     # DT only for the comparison
#   remotes::install_local("r", force = TRUE)
#
#   # then:
#   source("r/demo.R")
#
# Or, while developing the package without installing it:
#
#   # install.packages("devtools")
#   devtools::load_all("r")
#   source("r/demo.R")        # the csvgrid() calls below will use load_all()
#
# The final page opens in the RStudio Viewer (or your browser outside
# RStudio). Each row shows csvgrid on the left, DT on the right.

library(csvgrid)
have_dt <- requireNamespace("DT", quietly = TRUE)

# --- Example 1: dates, variable-width text, and formatted numbers --------
# Watch: the long company names set the text-column width while the short
# ticker stays narrow (equal-risk widths); market_cap gets thousands
# separators; div_yield (a "yield" header, values <= 1) renders as a
# percent; as_of dates render ISO and centered, including the 2024 leap day.
stocks <- data.frame(
    ticker     = c("AAPL", "MSFT", "BRK.B", "JNJ", "KO"),
    company    = c("Apple Inc.",
                   "Microsoft Corporation",
                   "Berkshire Hathaway Inc. Class B",
                   "Johnson & Johnson",
                   "The Coca-Cola Company"),
    as_of      = as.Date(c("2024-01-05", "2024-02-29", "2023-12-31",
                           "2024-03-15", "2024-06-01")),
    market_cap = c(2.95e12, 3.10e12, 8.80e11, 4.10e11, 2.65e11),
    pe_ratio   = c(28.4, 35.1, 9.7, 15.2, 24.8),
    div_yield  = c(0.005, 0.008, 0.000, 0.031, 0.029),
    shares     = c(1.55e10, 7.40e9, 1.30e9, 2.60e9, 4.30e9),
    check.names = FALSE,
    stringsAsFactors = FALSE
)

# --- Example 2: mtcars — character row names become a leading column -----
# (rownames = TRUE by default, mirroring DT::datatable.)

# --- side-by-side helper -------------------------------------------------
# Show 8 rows so DT and csvgrid occupy comparable height. scrollX lets the
# wide mtcars table scroll horizontally instead of squeezing columns.
dt_or_note <- function(df, ...) {
    if (have_dt) {
        DT::datatable(df, width = "100%",
                      options = list(pageLength = 8, lengthChange = FALSE,
                                     scrollX = TRUE),
                      ...)
    } else {
        htmltools::tags$p(
            htmltools::tags$em("install.packages(\"DT\") to see the comparison"))
    }
}

side_by_side <- function(left, right) {
    cell <- function(title, w) htmltools::tags$div(
        style = "flex:1 1 0; min-width:0;",
        htmltools::tags$h4(style = "font:600 0.9rem sans-serif; margin:0 0 6px;", title),
        w)
    htmltools::tags$div(
        style = "display:flex; gap:20px; align-items:flex-start; margin-bottom:28px;",
        cell("csvgrid", left),
        cell("DT::datatable", right))
}

page <- htmltools::browsable(htmltools::tagList(
    htmltools::tags$h3(style = "font-family:sans-serif;",
        "Example 1 — dates, variable-width text, formatted numbers"),
    side_by_side(
        csvgrid(stocks, name = "stocks", theme = "light", height = 300, width = "100%"),
        dt_or_note(stocks)),
    htmltools::tags$h3(style = "font-family:sans-serif;",
        "Example 2 — mtcars (row names as a leading column)"),
    side_by_side(
        csvgrid(mtcars, name = "mtcars", theme = "light", height = 360, width = "100%"),
        dt_or_note(mtcars))
))

print(page)
