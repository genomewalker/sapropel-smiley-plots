# Sapropel smiley plots

Static site for browsing ancient-DNA damage estimates in metagenomes from
eastern Mediterranean sediment cores GeoB15103-1, -2 and -3 (sapropels S1, S3,
S5 and S6 and non-sapropel intervals, 0.7–173 ka). Damage was estimated with
metaDMG from competitively mapped reads; coverage statistics come from
filterBAM.

Site: https://sapropels.paleogenomics.eu
Article: Fernandez-Guerra et al., in review.

There is no build step. The pages are plain HTML, CSS and ES modules, and the
browser reads the Parquet files with DuckDB-WASM.

## Layout

```
index.html            front page: samples, how to read a smiley plot, data files
help.html             plots, metrics, damage status rule, URL parameters
explorer/index.html   the explorer
css/tokens.css        colour, type and spacing tokens (light and dark), shared base styles
css/explorer.css      explorer layout and components
css/pages.css         front page and help page
js/                   ES modules, see below
meta.parquet          one row per (sample, reference genome)
freq.parquet          per-position substitution frequencies
samples.json          sample list
config.json           damage threshold and build settings
data/README.md        column descriptions and example queries
data/schema.json      column names and types
llms.txt              plain-text site description for scripts and AI agents
scripts/              data build (not used by the site at run time)
docs/screenshots/     screenshots from the last manual check
CNAME, .nojekyll      GitHub Pages settings
```

### JavaScript modules

| Module | Role |
|---|---|
| `app.js` | Entry point: loads config, DuckDB and samples, restores the view from the URL |
| `state.js` | Shared state and the `handlers` registry that views call into |
| `actions.js` | State changes: select sample, open genome, set filters, refresh |
| `data.js` | DuckDB-WASM set-up and all SQL |
| `url-state.js` | Reads and writes the query string |
| `ui.js` | Event wiring: toolbar, table, sample list, search, keyboard |
| `table.js` | Sample list and genome table markup |
| `sunburst.js` | Taxonomy sunburst, breadcrumb, group list, text summary |
| `detail-panel.js` | Genome details panel and full-view dialog |
| `smiley.js` | The smiley-plot renderer (canvas), its text description and data table |
| `compare.js` | Taxon across samples, and the taxa comparison |
| `compare-samples.js` | Side-by-side sample comparison |
| `dialog.js` | Modal behaviour: focus trap, Escape, focus return |
| `utils.js` | Formatting, config access, damage status rule, CSV export |
| `theme.js` | Light/dark theme; a classic script loaded in `<head>` |
| `landing.js` | Fills the front page and help page from `samples.json` and `config.json` |

View modules do not import `actions.js`; they call `handlers.*` from
`state.js`, which `actions.js` fills in. This keeps the import graph free of
cycles.

The damage status rule lives in one place, `getStatus` and `damagedSql` in
`utils.js`: damaged when `fit` is not `bad` and `damage` is greater than
`damage_threshold` from `config.json`.

Libraries are loaded from CDNs at pinned versions: d3 7.9.0 (cdnjs, with an
SRI hash) and `@duckdb/duckdb-wasm` 1.28.0 (jsDelivr). Fonts come from Google
Fonts.

## Local preview

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/. Any free port works. The site must be served
over HTTP; opening the files directly does not work because of ES modules and
the Parquet range requests.

`python3 -m http.server` sends no cache headers, so browsers may keep old CSS
and JS. Reload with the cache disabled while developing.

## Data build

The data are built in two steps, on a machine with access to the analysis
outputs:

```sh
python scripts/build-parquet.py
python scripts/align-to-supp-table.py SUPP_TABLE.xlsx
```

1. `build-parquet.py` reads the metaDMG and filterBAM outputs of the analysis
   repository and writes `meta.parquet`, `freq.parquet`, `samples.json` and
   `config.json`, including the damage threshold.
2. `align-to-supp-table.py` takes lineage and read and alignment counts from
   the article's supplementary community table, and stops with an error if the
   rows, damage values or damage classification do not match that table.

The site depends on the file names and on the column names described in
`data/README.md`. After a rebuild, check that `data/schema.json` still matches
(`DESCRIBE SELECT * FROM 'meta.parquet'` in DuckDB). `build_id` in
`config.json` is appended to the Parquet URLs, so a new build is not served
from cache.

Text on the site does not repeat values that a rebuild can change. The
threshold, QC filters, sample count and build date are read from the JSON
files when a page loads.

## Deployment

The site is served by GitHub Pages from the repository root, with the custom
domain in `CNAME` (`sapropels.paleogenomics.eu`).

1. Push to the default branch.
2. In the repository settings, under Pages, choose "Deploy from a branch", the
   default branch and `/ (root)`.
3. Point a DNS `CNAME` record for `sapropels.paleogenomics.eu` at
   `<owner>.github.io`. If Cloudflare proxies the record, set its SSL mode to
   "Full".

`.nojekyll` stops Pages from running Jekyll over the files. Parquet files are
served with range requests, which Pages supports; `meta.parquet` and
`freq.parquet` are well under the 100 MB file limit.

## Design

- Identity: a sediment core. Pale marl surfaces, olive-black sapropel bands,
  a deep-water teal for interaction. The sample list is drawn as a core log.
- Type: Bricolage Grotesque for headings, IBM Plex Sans for text, IBM Plex
  Mono for identifiers and numbers.
- All colours are tokens in `css/tokens.css`, with a dark set under
  `:root[data-theme="dark"]`. Canvas and SVG charts read the tokens when they
  draw and redraw on the `themechange` event.
- Chart colours (domains: blue, magenta, ochre; smiley series: orange-red and
  blue) were checked for separation under protan, deutan and tritan
  simulation on both surfaces. If you change them, check again.
- Status and series are never encoded by colour alone: badges carry text and
  a filled or outlined shape, sunburst leaves are solid or hatched, smiley
  markers are circles (5′) or squares (3′).
- Every chart has a text alternative: the sunburst has a group list and a
  summary, each smiley plot has an `aria-label` with the end-position values
  and, in the full view, a table of plotted values.

## Open items

Search the source for `TODO(` to find them.

- `TODO(publication)`: article reference and DOI (front page, help page).
- `TODO(data)`: sequencing-data accession and archive DOIs (front page).
