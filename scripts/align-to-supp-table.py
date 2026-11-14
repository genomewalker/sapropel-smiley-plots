#!/usr/bin/env python3
"""
Align meta.parquet with Supplementary Table 4 ("4 - Community") of the paper.

Run after build-parquet.py. The table is the published record, so the
dashboard takes these fields from it:

  - lineage (domain, phylum, class, order, family, genus, species), which
    includes the manual placements described in the table legend
    (Mirusviricota, Nucleocytoviricota);
  - number of reads and number of alignments.

The script then checks that every (sample, reference) pair matches, that the
damage values agree, and that the dashboard rule (damage > threshold and fit
not "bad") reproduces the table's damage classification row for row. It
stops with an error if any check fails.

Usage:
  python scripts/align-to-supp-table.py SUPP_TABLE.xlsx [--sheet "4 - Community"]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "meta.parquet"
CONFIG = ROOT / "config.json"

LINEAGE = {
    "Domain": "domain", "Phylum": "phylum", "Class": "class_",
    "Order": "order_", "Family": "family", "Genus": "genus",
    "Species": "species",
}
COUNTS = {"Number of reads": "n_reads", "Number of alignments": "n_alns"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("table", type=Path)
    ap.add_argument("--sheet", default="4 - Community")
    args = ap.parse_args()

    t = pd.read_excel(args.table, sheet_name=args.sheet, header=2)
    schema = pq.read_schema(META).remove_metadata()
    m = pd.read_parquet(META)
    threshold = json.loads(CONFIG.read_text())["damage_threshold"]

    t_key = t["Sample"] + "|" + t["Reference"]
    m_key = m["sample"] + "|" + m["reference"]
    if t_key.duplicated().any() or m_key.duplicated().any():
        sys.exit("duplicate (sample, reference) pairs")
    if set(t_key) != set(m_key):
        sys.exit(f"row sets differ: {len(set(t_key) - set(m_key))} only in table, "
                 f"{len(set(m_key) - set(t_key))} only in meta.parquet")

    t = t.set_index(t_key).loc[m_key.to_numpy()]

    if not np.allclose(t["Damage"].to_numpy(float), m["damage"].to_numpy(float),
                       rtol=0, atol=1e-9):
        sys.exit("damage values differ between table and meta.parquet")

    changed = {}
    for src, dst in {**LINEAGE, **COUNTS}.items():
        new = t[src].to_numpy()
        if dst in COUNTS.values():
            new = new.astype(m[dst].dtype)
        diff = (pd.Series(new).fillna("").astype(str).to_numpy()
                != m[dst].fillna("").astype(str).to_numpy())
        changed[dst] = int(diff.sum())
        m[dst] = new

    dmg = (m["damage"] > threshold) & (m["fit"].fillna("") != "bad")
    expected = t["Damage classification"].str.lower().str.startswith("damaged").to_numpy()
    bad = int((dmg.to_numpy() != expected).sum())
    if bad:
        sys.exit(f"{bad} rows classified differently from the table at threshold {threshold}")

    pq.write_table(pa.Table.from_pandas(m, schema=schema, preserve_index=False),
                   META, compression="zstd", row_group_size=20000)
    for k, v in changed.items():
        print(f"{k:10s} {v:6d} values updated")
    print(f"{len(m):,} rows match Table 4; classification agrees at threshold {threshold}")


if __name__ == "__main__":
    main()
