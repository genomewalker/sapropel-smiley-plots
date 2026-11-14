# Data files

The data files are in the site root, next to `index.html`. This folder holds
their description: this file and `schema.json`, which lists every column with
its type.

| File | Contents |
|---|---|
| `../meta.parquet` | One row per (sample, reference genome): lineage, read counts, metaDMG damage fit, filterBAM coverage statistics |
| `../freq.parquet` | Per-position substitution frequencies and counts for the same rows |
| `../samples.json` | Sample name, core, layer and age |
| `../config.json` | Damage threshold, build filters, build identifier |

Counts and thresholds change when the data are rebuilt. Read them from the
files.

## Keys

- `id` is the row key in both Parquet files. It is a 64-bit integer; keep it as
  an integer or string, not a float.
- `(sample, reference)` is unique in `meta.parquet`.
- `sample` matches `samples.json`.

## meta.parquet

| Column | Meaning |
|---|---|
| `sample` | Sample name, core then depth interval, e.g. `GeoB15103-1_19-34cm` |
| `reference` | Reference genome accession. `name` is the same with an `S__` prefix |
| `rank` | All rows are `subspecies`, meaning one reference genome |
| `domain`, `phylum`, `class_`, `order_`, `family`, `genus`, `species` | Lineage with rank prefixes (`d__` … `s__`) |
| `n_reads`, `n_alns` | Reads and alignments assigned to the genome |
| `damage` | `A_b`, or 0 when `fit` is `bad`. Range 0–1 |
| `significance` | metaDMG Z value of the fit |
| `fit` | `good` or `bad` |
| `A_b`, `q_b`, `c_b`, `phi_b` | Bias-corrected parameters of the fit f(x) = A(1 − q)^(x − 1) + c, with beta-binomial concentration phi |
| `A`, `q`, `c`, `phi` | The same parameters before correction |
| `A_CI_l` … `c_CI_h` | Interval bounds for A, q and c |
| `map_A`, `map_q`, `map_c`, `map_phi`, `map_damage`, `map_significance` | Copies of `A_b`, `q_b`, `c_b`, `phi_b`, `damage`, `significance`, kept for compatibility |
| `reference_length`, `bases_covered` | Genome length and covered positions, in bases |
| `breadth` | Fraction of the reference covered by at least one read |
| `exp_breadth` | Breadth expected for randomly placed reads, 1 − exp(−`coverage_mean`) |
| `breadth_exp_ratio` | `breadth` / `exp_breadth` |
| `coverage_mean` | Mean depth over all positions |
| `cov_evenness`, `norm_entropy` | Evenness measures; higher is more even |
| `norm_gini` | Normalised Gini coefficient; higher is more uneven |
| `read_ani_mean`, `read_length_mean` | Mean read identity (per cent) and mean read length (bases) |
| `*_q25`, `*_q75` | Quartiles across references for rows above subspecies rank; null in the published files |

The remaining columns are passed through from metaDMG and filterBAM; see
`schema.json` for the full list.

## freq.parquet

For each position i from 1 to 25, counted from the read end:

| Columns | Meaning |
|---|---|
| `fp{i}`, `dp{i}` | C→T at position i from the 5′ end: observed frequency, metaDMG fit |
| `fm{i}`, `dm{i}` | G→A at position i from the 3′ end: observed frequency, metaDMG fit |
| `fwK{i}`, `fwN{i}` | C→T count and number of reference C at position i (5′) |
| `bwK{i}`, `bwN{i}` | G→A count and number of reference G at position i (3′) |

## Damage status

```sql
fit <> 'bad' AND damage > (SELECT damage_threshold FROM 'config.json')
```

`damage_threshold` is the third quartile of `A_b` among genomes with a good fit
in the reference sample named by `threshold_ref_sample`, computed by
`scripts/build-parquet.py`.

## Example queries (DuckDB)

Damaged genomes per sample:

```sql
SELECT m.sample,
       count(*) AS genomes,
       count(*) FILTER (WHERE m.fit <> 'bad' AND m.damage > c.damage_threshold) AS damaged
FROM 'meta.parquet' m, 'config.json' c
GROUP BY m.sample
ORDER BY m.sample;
```

Smiley-plot values for one genome in one sample:

```sql
SELECT f.*
FROM 'meta.parquet' m JOIN 'freq.parquet' f USING (id)
WHERE m.sample = 'GeoB15103-1_19-34cm' AND m.reference = 'GCF_000759875.1';
```

## Regenerating schema.json

The column lists come from `DESCRIBE SELECT * FROM 'meta.parquet'` (and the
same for `freq.parquet`) in DuckDB. If the build adds or removes columns,
update `schema.json` to match.
