---
title: "csv-viewer — column width allocation"
subtitle: "The two squeeze algorithms, derived"
---

# Column width allocation

When the table is narrower than the sum of its columns' natural widths,
something has to give: some cells will be truncated (`…`). The grid offers
two policies for *which* cells, chosen by the `width_mode` option and
implemented in `solveWidths` (`util.js:258`):

- **equal-risk** (default) — a fairness rule: make every column truncate
  with the **same probability**. A Value-at-Risk / quantile allocation.
- **coverage** — a utilitarian rule: **maximize the total number of cells
  shown in full**, accepting that the few wide outliers eat all the
  truncation.

They are two answers to the same optimization, under two different
objectives — *minimize the worst column's risk* vs *maximize total
utility*. The rest of this doc sets up the shared problem, derives each, and
gives references for the coverage one (the less obvious of the two).

---

## The shared setup

After a load, the grid samples each column's rendered cell widths (a stride
sample, not every row — see the speedups plan) and sorts them ascending.
For column `j` we have:

- `arrays[j]` — the sorted vector of cell pixel-widths (the header width is
  included as the floor, below). Think of it as the empirical distribution
  of "how wide does this cell want to be."
- `floors[j]` — a hard minimum: `max(MIN_COL, header width) + CELL_PAD`
  (`MIN_COL = 50`, `CELL_PAD = 18` px; `util.js:250`). A column never goes
  below this.
- `natural[j]` — the largest cell width: the width at which **nothing** in
  the column truncates.
- `avail` — the container's available pixel width.

We must choose widths `w_j ∈ [floors[j], natural[j]]`. Both modes first
dispatch the two trivial regimes (shared, `solveWidths`):

1. **Tight** — if `Σ natural[j] ≤ avail`, everything fits: use the natural
   widths, done. No truncation anywhere.
2. **Floors + scroll** — if `Σ floors[j] ≥ avail`, even the minimums don't
   fit: use the floors and let the table scroll horizontally. Nothing more
   to optimize.

The interesting case is in between — the **squeeze** — and that is the only
place the two modes differ.

---

## Mode 1 — equal-risk (Value-at-Risk)

*This is the author's; included for completeness and contrast.*

Define column `j`'s width at quantile `q` as the floored `q`-th percentile
of its cell-width distribution:

$$
w_j(q) = \max\!\big(\text{floor}_j,\; Q_j(q)\big),
\qquad Q_j(q) = \text{arrays}[j]\big[\lfloor q\,(n_j-1)\rfloor\big].
$$

At width `w_j(q)`, a fraction `q` of column `j`'s cells fit and `1 − q` are
truncated. So **`1 − q` is column `j`'s truncation probability** — and
because the *same* `q` is used for every column, every column truncates with
the same probability. That is the Value-at-Risk idea exactly: `w_j(q)` is the
`q`-VaR of the column's width, and we equalize the risk level across
columns.

The total width `W(q) = Σ_j w_j(q)` is **monotone non-decreasing** in `q`
(higher quantiles are wider). We want the largest `q` that still fits:

$$
q^\star = \max\{\, q : W(q) \le \text{avail} \,\}.
$$

Monotonicity ⇒ **bisection** solves it (`equalRiskWidths`, `util.js:267`):
32 iterations on `q ∈ [0,1]`, each evaluating `W(q)` in O(columns). The
floors mean some columns may already exceed their quantile width — they're
pinned at the floor and the others absorb the budget. The result is "fair":
no column is singled out; a wide-tailed column and a thin one face identical
odds of clipping.

### The picture — a common water *height*

Stand each column up as a staircase of its sorted cell widths. The water
level is a **percentile** `q` — literally a height, the *same* for every
column. Raise the water; where the single waterline crosses each column's
staircase is that column's width. Keep raising until the widths just fill
the table.

```
 q  (water height = percentile, ONE level for all columns)
1.0 ┤                                    ┌───
    │              ┌─────                │
 q*-│- - - ┌───────┼──────── - ┌─────────┼- -  ← single waterline q*
    │   ┌──┘       │      ┌────┘         │
0.0 ┘───┴──────────┴──────┴──────────────┴───  cell width →
       col A        col B       col C
       w_A(q*)      w_B(q*)     w_C(q*)
        └────────── Σ wⱼ(q*) = avail ──────────┘
        crank q* up until the widths just fill the table
```

The step you reach **is** the width. A common height `q*` means every column
truncates with the **same probability** `1 − q*` — the fairness reading. The
staircase here is the column's CDF / quantile function itself.

---

## Mode 2 — coverage (maximize cells shown)

*Forget the swimming pool here — this one is plain **most cost-effective
spend**. Price every cell in pixels-per-cell, buy the cheapest cells first
until the budget runs out. That's the **fractional knapsack**; the only
twist is figuring out what a cell costs when cells can't be bought
individually (the concave envelope). Formally it's separable concave
resource allocation / water-filling, but the cheapest-first reading is the
one to carry around.*

### The objective

Let `F_j(w)` be the number of cells in column `j` whose width is `≤ w` —
i.e. the count of cells that are **fully shown** at width `w`. As a function
of `w` it is a **step function**: it jumps by one (or more, for ties) each
time `w` passes another cell's width, and it is flat in between (widening a
column changes nothing until you clear the next cell). We want to maximize
the grand total of fully-shown cells:

$$
\max_{w}\ \sum_j F_j(w_j)
\quad\text{s.t.}\quad
\sum_j w_j \le \text{avail},\quad
\text{floor}_j \le w_j \le \text{natural}_j .
$$

This is a single-budget allocation of pixels across columns, with a
separable objective (each column's contribution depends only on its own
width). The natural approach is **marginal analysis**: spend each next pixel
where it buys the most cells.

### Why cheapest-first needs a concave curve

"Buy the cheapest cell next" is **optimal only when each column's cells get
*more* expensive as you go** — diminishing returns, i.e. a concave return
curve. Then you never regret a purchase: the next cell in any column is at
least as dear as the one you just bought, so a single global cheapest-first
pass is exact. (Formally: the optimum equalizes the marginal cells-per-pixel
across all funded columns at one cutoff `λ`, the budget's shadow price —
the **water-filling** / fractional-knapsack optimality condition; Boyd &
Vandenberghe §5.5, Dantzig, Fox 1966, Ibaraki & Katoh 1988.)

But `F_j` is a *step* function, and its raw per-cell costs need **not**
increase: a column can hide a very cheap cell just behind an expensive wall
(in the example below, col 1's 4th cell costs only 1px but sits behind 5px
of earlier cells). A naïve cheapest-first on raw steps would be fooled by
that bait. The fix is to price cells so costs are monotone.

### The fix: the upper concave envelope

Replace each step function `F_j` by its **least concave majorant** — the
upper concave envelope of its `(width, cumulative-cells)` points
(`concaveEnvelope`, `util.js:326`). Geometrically: plot the staircase of
"+1 cell at each cell-width," then stretch a taut string over the top of it
from the floor onward; the string's vertices are the points of strictly
decreasing slope, and its segments are the **efficient frontier** — each
segment a *bundle* of cells you can only buy together, at the bundle's
**blended cost per cell** (`Δwidth / Δcells` = reciprocal slope). That
blending is the whole trick: it folds the cheap-cell-behind-a-wall back into
the price of getting there, so per-bundle costs rise monotonically and
cheapest-first becomes exact.

Concretely the envelope is built like a convex-hull monotone chain: walk the
distinct cell widths left to right, and pop any vertex that isn't a strict
concave turn (the cross-product test at `util.js:341`). O(k) on the sorted
column.

Two facts make this exact rather than a heuristic:

- **Width is continuous.** A column can take any pixel width, so any point
  *on* an envelope segment is achievable — we're not restricted to integer
  vertices. That is what licenses treating the discrete staircase as its
  continuous concave hull.
- **Pooling preserves per-column order for free.** Within a column the
  envelope's slopes are strictly decreasing, so if you buy segments globally
  in decreasing-slope order you can never buy a column's later (shallower)
  segment before its earlier (steeper) one. So a single global slope-sorted
  pass respects every column's internal ordering automatically.

### The algorithm (`coverageWidths`, `util.js:295`)

1. Start every column at its floor; `budget = avail − Σ floors` (and the
   cells already shown for free at the floor cost nothing).
2. For each column, take its envelope segments — each a bundle with a
   **cost per cell** `Δw / Δcells` (= reciprocal slope).
3. Pool **all** bundles across all columns; sort by cost per cell,
   **cheapest first**.
4. Buy down the list, spending `buy = min(Δw, budget)` on each, until the
   budget is gone. A partial buy on the last affordable bundle is fine —
   width is continuous; it just may not complete that bundle's cell.

Cheap, thin-tailed columns get bought out to 100%; expensive, thick-tailed
outliers are where the budget runs out and truncation piles up — exactly
where you want it (one ugly column behind `…` beats ten columns each losing
a character). The cell that finally exhausts the budget sets the cutoff cost
`λ`: nothing dearer gets bought, everything cheaper already did.

### A worked example — col 1 = 5,5,5,6 · col 2 = 0,5,25,100 · budget 15

Price the cells. The `(width, cells)` points, their concave envelopes, and
each bundle's **cost per cell** (floors set to 0 for clarity):

| column | envelope bundle | Δwidth | Δcells | **cost/cell (px)** |
|---|---|---|---|---|
| col 1 | (0,0)→(6,4) — all four cells, bundled | 6 | 4 | **1.5** |
| col 2 | width-0 cell, free at floor | 0 | 1 | **0** |
| col 2 | (0,1)→(5,2) | 5 | 1 | **5** |
| col 2 | (5,2)→(25,3) | 20 | 1 | **20** |
| col 2 | (25,3)→(100,4) | 75 | 1 | **75** |

(Col 1's raw staircase is 3 cells at width 5 then a 4th at width 6 — *rising*
returns, which the envelope bundles into one segment at the blended
`6/4 = 1.5` px/cell, cheaper than anything in col 2.) Now buy cheapest-first
with 15px:

| buy | cost/cell | cells | px | budget left |
|---|---|---|---|---|
| col 2 free cell | 0 | +1 | 0 | 15 |
| **col 1** bundle (4 cells) | 1.5 | +4 | 6 | 9 |
| **col 2** first cell | 5 | +1 | 5 | 4 |
| col 2 next cell | 20 | — | can't afford (4 < 20) | 4 |

Stop. **6 cells shown** (1 free + 4 + 1); widths **6 and 9** — col 1 fully
shown, col 2's 9 = 5 productive + 4 px of unspendable slack (the next cell
needed 20). The cutoff cost `λ` sits between 5 and 20. Exactly the "rational
world" answer, and col 1 wins outright because its cells are the cheapest on
the board.

### A tie — and a budget that splits it

Now price col 2's cheap bundle to land *exactly* on col 1's. Take **col 1 =
`5,5,5,6`**, **col 2 = `0,3,3,50,100`**:

| column | bundle | Δw | Δcells | **cost/cell** |
|---|---|---|---|---|
| col 2 | width-0 cell, free at floor | 0 | 1 | 0 |
| col 1 | (0,0)→(6,4) — bundled | 6 | 4 | **1.5** |
| col 2 | (0,1)→(3,3) — the two width-3 cells | 3 | 2 | **1.5** ← tie |
| col 2 | (3,3)→(50,4) | 47 | 1 | 47 |
| col 2 | (50,4)→(100,5) | 50 | 1 | 50 |

The merged cheapest-first queue is `0 → [1.5: col1(4) · col2(2)] → 47 → 50`.
The two columns dissolve into one price-ordered list and the **1.5 tier is
shared** — there is no "col 1 then col 2," only *price*.

**Budget 9** buys the whole 1.5 tier (6 + 3) plus the free cell: **7 cells**,
widths **6 and 3**, exactly spent. The tier is bought whole, so the order
within it doesn't matter.

**Budget 8** is the instructive one: you reach the 1.5 tier but can't afford
all of it (it costs 9). *How does the algorithm handle not being able to buy
all the cells it wants at the next price?* It just keeps going down the
sorted list doing a **proportional partial buy** — `buy = min(Δw, budget)` —
and stops when the budget hits zero. In (stable) sort order col 1's bundle
comes first: buy it whole (6px, +4 cells, 2px left), then **partially** buy
col 2's bundle, `min(3, 2) = 2px`. But col 2's two cells *both* need width 3;
at width 2 neither is covered, so those **2px complete no cell** — stranded.
Result: **5 cells** (free 1 + col 1's 4), widths 6 and 2.

And here is the catch worth seeing: the **true** best at 8px is **6 cells** —
give col 1 only 5px (its three width-5 cells show → 3 cells) and col 2 the
full 3px (+2 cells), plus the free one. The greedy misses it because
*bundling col 1 hid that 5px already buys 3 of its cells*: the concave
relaxation treats col 1 as all-or-nothing at 1.5/cell and spends the 6th px
finishing col 1's cheap 4th cell instead of completing col 2's pair. So the
answer to "what happens when you can't buy them all" is: **you take a partial
bundle that may strand its pixels, and the greedy can fall a whole cell short
of the integer optimum.**

### How exact is it?

Optimal for the concave **relaxation**; the **integer** realization can fall
short — bounded, but not always zero. The greedy buys whole bundles
cheapest-first and partially buys at most the last. A partially-bought bundle
shows only the cells whose real width is already reached, **often none**, so
its pixels strand — and because a stranded bundle can be multi-cell, the miss
can be a full cell (budget 8 above: 2px stranded, integer optimum one cell
better), not just sub-cell rounding. For the **grid** this is cosmetic — many
columns, smooth width distributions, one column partially filled at the very
end, loss well under a cell. For the **capacity** reading of all this (see
[../hacks/columns-and-capacity.md](../hacks/columns-and-capacity.md)) the
integrality gap is exactly the thing to mind, since the "bundles" are
indivisible programs and a stranded one is real money.

---

## Equal-risk vs coverage — the duality

Same feasible set, two objectives:

| | equal-risk | coverage |
|---|---|---|
| Objective | equalize truncation **probability** `1−q` across columns | maximize **total** fully-shown cells |
| Flavor | min-max fairness (a VaR/quantile measure) | utilitarian (most cells per pixel) |
| Mental model | a pool: raise the water to a common **height** `q` (percentile) and read each column's width off its staircase | a shopping list: price each cell in **px/cell**, buy **cheapest first** until the budget's gone |
| Reads the column's… | CDF (sorted widths) directly | **concave majorant** of the CDF, as per-bundle costs |
| Solved by | bisection on the shared quantile `q` | cheapest-first greedy (fractional knapsack) over the envelope bundles |
| Truncation falls on | every column equally (by probability) | concentrated on wide-tailed outliers |
| Good when | columns are comparable; you want no column singled out | a few columns are pathologically wide and you'd rather sacrifice them |
| Code | `equalRiskWidths`, `util.js:267` | `coverageWidths` / `concaveEnvelope`, `util.js:295`/`326` |

Neither dominates. Equal-risk is the safer default — it never makes one
column dramatically worse than its neighbors. Coverage shows the most data
overall but will throw a single column under the bus to do it.

---

## References

The coverage solver is a standard construction; the relevant literature:

- **S. Boyd and L. Vandenberghe**, *Convex Optimization*, Cambridge UP
  (2004), §5.5 — the **water-filling** solution to separable concave
  maximization under a sum constraint; the cutoff-slope `λ` is the
  constraint's KKT multiplier. (Free PDF on Boyd's site.)
- **T. Ibaraki and N. Katoh**, *Resource Allocation Problems: Algorithmic
  Approaches*, MIT Press (1988) — the canonical treatment of
  `max Σ f_j(x_j)` s.t. `Σ x_j = C`, including the greedy/incremental method
  and the role of concavity.
- **B. L. Fox**, "Discrete Optimization via Marginal Analysis," *Management
  Science* 13(3), 1966 — the marginal-allocation (buy-the-best-increment)
  algorithm this is an instance of.
- **G. B. Dantzig**, "Discrete-Variable Extremum Problems," *Operations
  Research* 5(2), 1957 — greedy optimality of the **fractional knapsack**
  (value-per-weight), the same ranking idea on a budget.
- **R. T. Rockafellar**, *Convex Analysis*, Princeton UP (1970) — the
  **least concave majorant** / concave hull of a function, which the upper
  concave envelope computes.

For the equal-risk side, the framing is just the standard **quantile risk
measure (Value-at-Risk)**; any quantitative-risk text (e.g. McNeil, Frey &
Embrechts, *Quantitative Risk Management*) covers VaR as the `q`-quantile of
a loss distribution — here the "loss" is a column's required width.
