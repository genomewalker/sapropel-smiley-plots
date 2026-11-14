#!/usr/bin/env python3
"""
Build meta.parquet + freq.parquet for the sapropel-smiley-plots web UI from
the metaDMG-LCA + filterBAM outputs in the analysis repo.

Row granularity: (sample, taxid) at every LCA rank in
{subspecies, species, genus, family, order, class, phylum}.

  - Damage smiley (fp/fm/dp/dm) + damage params: from lca-damage.tsv.gz
    (metaDMG already pools reads across descendants when fitting at rank > subspecies).
  - Headline n_reads / n_alns: from lca-damage.tsv.gz.
  - Coverage QC stats (breadth, coverage_mean, cov_evenness, norm_entropy,
    norm_gini, read_ani_mean, c_v, d_i): from mapping-summary.tsv.gz.
      * rank=subspecies: direct join (lca name = "S__<reference>").
      * rank>subspecies: aggregate across descendant subspecies references in
        the same sample → median + q25 + q75. n_refs counts contributors.
  - Abundance (tax_abund_read/aln/tad, n_reads_tad): summed over descendants
    at higher ranks, direct at subspecies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# Analysis directory of the code repository; set SAPROPEL_ANALYSIS to its path.
ANALYSIS = Path(os.environ.get("SAPROPEL_ANALYSIS", "analysis"))
LCA_DAMAGE = ANALYSIS / "data/taxonomy/damage/lca-damage.tsv.gz"
LCA_SUMMARY = ANALYSIS / "results/03_taxonomy_clean_noeuk.tsv.gz"
MAPPING_SUMMARY = ANALYSIS / "data/taxonomy/lca/mapping-summary.tsv.gz"
DMG_SUBSPECIES_LITE = ANALYSIS / "results/04_damage_subspecies_lite.tsv.gz"
DMG_SPECIES_LITE = ANALYSIS / "results/04_damage_species_lite.tsv.gz"
METADATA_XLSX = ANALYSIS / "data/metadata/samples.xlsx"
SAMPLES_TO_REMOVE = ANALYSIS / "results/01_samples_to_remove.tsv.gz"

# Pipeline label-normalisation regex (scripts/05--taxonomic-profiling.R).
LABEL_RE = re.compile(r"(MED)-(\d+)-(\d+|NC\d+|NL\d+)")

# Mapping-summary QC filter (scripts/05--taxonomic-profiling.R line 52).
QC_MIN_NORM_ENTROPY = 0.6
QC_MIN_BREADTH = 0.01
QC_MIN_BREADTH_EXP_RATIO = 0.75

# Sample whose subspecies fit=="good" A_b distribution defines the cutoff.
THRESHOLD_REF_SAMPLE = "MED-2021-1"


def normalise_label(s: pd.Series) -> pd.Series:
    parts = s.astype(str).str.extract(LABEL_RE.pattern)
    return parts[0] + "-" + parts[1] + "-" + parts[2]


def load_cdata() -> pd.DataFrame:
    """Replicate cdata join from scripts/10--virome-nt.R: cgg ⨝ basic ⨝ extra
    ⨝ dating, drop blanks, restrict to South of Cyprus, drop samples in
    01_samples_to_remove.tsv.gz. Returns ordered metadata for the 11 samples
    (display label, specific feature, age in ka, core).
    """
    def clean(df: pd.DataFrame) -> pd.DataFrame:
        return df.rename(columns=lambda c:
                         re.sub(r"[^a-zA-Z0-9]+", "_",
                                str(c).strip()).strip("_").lower())
    cgg = clean(pd.read_excel(METADATA_XLSX, sheet_name="med_metadata_cgg"))
    basic = clean(pd.read_excel(METADATA_XLSX, sheet_name="med_metadata_basic"))
    extra = clean(pd.read_excel(METADATA_XLSX, sheet_name="med_metadata_extra"))
    dating = clean(pd.read_excel(METADATA_XLSX, sheet_name="med_metadata_dating"))
    cdata = cgg.merge(basic).merge(extra).merge(dating)
    cdata = cdata[cdata["is_blank"].astype(str).str.lower() == "false"]
    cdata = cdata[cdata["geographic_location"] == "South of Cyprus"]
    to_rm = pd.read_csv(SAMPLES_TO_REMOVE, sep="\t")["label"]
    cdata = cdata[~cdata["unique_sample_id"].isin(to_rm)].copy()
    cdata["specific_feature"] = (
        cdata["specific_feature"].fillna("Non-sapropel").str.strip()
    )
    cdata["age_ka"] = cdata["estimated_age_ka_bp"].astype(float)
    # Sort: sapropel layers (Sapropel1, 3, 5, 6) before Non-sapropel,
    # then by age (oldest first), then by core_id.
    feat_rank = cdata["specific_feature"].map(
        lambda x: (0, x) if x.startswith("Sapropel") else (1, x))
    cdata["__feat_rank"] = feat_rank
    cdata = cdata.sort_values(
        ["__feat_rank", "age_ka", "core_id"]
    ).drop(columns=["__feat_rank"]).reset_index(drop=True)
    cdata["sort_order"] = range(len(cdata))
    return cdata[[
        "unique_sample_id", "internal_name_by_dom",
        "specific_feature", "age_ka", "core_id", "sort_order",
    ]].rename(columns={
        "unique_sample_id": "sample_med",
        "internal_name_by_dom": "sample",
        "core_id": "core",
    })

OUT_DIR = Path(__file__).resolve().parent.parent
OUT_META = OUT_DIR / "meta.parquet"
OUT_FREQ = OUT_DIR / "freq.parquet"

# Ranks we keep (most-coarse → finest).
KEEP_RANKS = ["phylum", "class", "order", "family", "genus", "species", "subspecies"]

# 25 metaDMG positions (0..24) → 25 UI positions (1..25).
N_POS = 25

COVERAGE_STATS = [
    "breadth", "exp_breadth", "breadth_exp_ratio",
    "coverage_mean", "coverage_mean_trunc", "coverage_covered_mean",
    "cov_evenness",
    "norm_entropy", "norm_gini",
    "read_ani_mean", "read_ani_std",
    "read_length_mean", "read_length_std",
    "read_aligned_length", "read_aln_score",
    "mapping_quality", "edit_distances",
    "gc_content",
    "c_v", "d_i",
]
ABUND_SUM_COLS = [
    "tax_abund_read", "tax_abund_aln", "tax_abund_tad", "n_reads_tad",
]


def parse_tax_path(tax_path: pd.Series) -> pd.DataFrame:
    """Pull domain..species ranks out of the lca tax_path string."""
    prefixes = {
        "domain": "d__",
        "phylum": "p__",
        "class_": "c__",
        "order_": "o__",
        "family": "f__",
        "genus": "g__",
        "species": "s__",
    }
    out = {col: [] for col in prefixes}
    for path in tax_path.fillna(""):
        parts = path.split(";")
        hits = {col: None for col in prefixes}
        for p in parts:
            for col, pref in prefixes.items():
                if p.startswith(pref) and hits[col] is None:
                    hits[col] = p
        for col in prefixes:
            out[col].append(hits[col])
    return pd.DataFrame(out)


def hash_id(label: str, taxid: int) -> int:
    h = hashlib.blake2b(f"{label}\t{taxid}".encode(), digest_size=8).digest()
    return int.from_bytes(h, "big", signed=False) >> 1  # int63, fits int64


def load_inputs():
    print(f"[load] {LCA_DAMAGE}", file=sys.stderr)
    pos_cols = []
    for p in range(N_POS):
        pos_cols += [f"fwK{p}", f"fwN{p}", f"fwf{p}", f"fwdx{p}",
                     f"bwK{p}", f"bwN{p}", f"bwf{p}", f"bwdx{p}"]
    dmg_cols = [
        "label", "taxid", "nalign", "nreads",
        "mean_rlen", "mean_gc",
        "A", "q", "c", "phi", "Zfit",
        "A_b", "q_b", "c_b", "phi_b",
        "A_CI_l", "A_CI_h", "q_CI_l", "q_CI_h",
        "c_CI_l", "c_CI_h",
    ] + pos_cols
    dmg = pd.read_csv(LCA_DAMAGE, sep="\t", usecols=lambda c: c in dmg_cols)
    dmg["label"] = normalise_label(dmg["label"])
    print(f"  rows={len(dmg):,}", file=sys.stderr)

    print(f"[load] {LCA_SUMMARY}", file=sys.stderr)
    summ = pd.read_csv(LCA_SUMMARY, sep="\t",
                       usecols=["label", "taxid", "name", "rank",
                                "abundance", "tax_path"])
    summ["label"] = normalise_label(summ["label"])
    print(f"  rows={len(summ):,}", file=sys.stderr)

    print(f"[load] {MAPPING_SUMMARY}", file=sys.stderr)
    map_cols = ["reference", "label",
                "read_length_mean", "read_length_std",
                "read_aligned_length", "read_aln_score", "edit_distances",
                "mapping_quality", "gc_content",
                "read_ani_mean", "read_ani_std",
                "bases_covered", "max_covered_bases",
                "coverage_mean", "coverage_mean_trunc", "coverage_covered_mean",
                "reference_length", "breadth", "exp_breadth", "breadth_exp_ratio",
                "norm_entropy", "norm_gini", "c_v", "d_i", "cov_evenness",
                "tax_abund_read", "tax_abund_aln", "tax_abund_tad", "n_reads_tad"]
    mapping = pd.read_csv(MAPPING_SUMMARY, sep="\t", usecols=map_cols)
    mapping["label"] = normalise_label(mapping["label"])
    n0 = len(mapping)
    mapping = mapping[
        (mapping["norm_entropy"] > QC_MIN_NORM_ENTROPY)
        & (mapping["breadth"] > QC_MIN_BREADTH)
        & (mapping["breadth_exp_ratio"] >= QC_MIN_BREADTH_EXP_RATIO)
    ].copy()
    print(f"  rows={n0:,} → {len(mapping):,} after QC "
          f"(norm_entropy>{QC_MIN_NORM_ENTROPY}, breadth>{QC_MIN_BREADTH}, "
          f"breadth_exp_ratio>={QC_MIN_BREADTH_EXP_RATIO})", file=sys.stderr)

    print(f"[load] {DMG_SUBSPECIES_LITE}", file=sys.stderr)
    sub_lite = pd.read_csv(DMG_SUBSPECIES_LITE, sep="\t")
    sub_lite = sub_lite.rename(columns={"tax_name": "taxid"})
    sub_lite["taxid"] = sub_lite["taxid"].astype(int)
    sub_lite["rank"] = "subspecies"
    print(f"  rows={len(sub_lite):,}", file=sys.stderr)

    print(f"[load] {DMG_SPECIES_LITE}", file=sys.stderr)
    sp_lite = pd.read_csv(DMG_SPECIES_LITE, sep="\t")
    sp_lite = sp_lite.rename(columns={"tax_name": "taxid"})
    sp_lite["taxid"] = sp_lite["taxid"].astype(int)
    sp_lite["rank"] = "species"
    print(f"  rows={len(sp_lite):,}", file=sys.stderr)

    lite = pd.concat([sub_lite, sp_lite], ignore_index=True)
    return dmg, summ, mapping, lite


RANK_PREFIX = {
    "phylum": "p__", "class": "c__", "order": "o__", "family": "f__",
    "genus": "g__", "species": "s__",
}


def parse_path_ranks(tax_path: pd.Series) -> pd.DataFrame:
    """Vectorised: return one column per rank holding the prefixed token."""
    out = {}
    paths = tax_path.fillna("").to_numpy()
    for rank, pref in RANK_PREFIX.items():
        col = []
        for p in paths:
            hit = None
            for tok in p.split(";"):
                if tok.startswith(pref):
                    hit = tok
                    break
            col.append(hit)
        out[rank] = col
    return pd.DataFrame(out)


def aggregate_higher_ranks(higher: pd.DataFrame,
                           summ: pd.DataFrame,
                           mapping: pd.DataFrame) -> pd.DataFrame:
    """Vectorised rollup. For each higher-rank target (label, rank, name),
    find descendant subspecies refs (same sample, tax_path contains target
    name at the target's rank), join mapping, and aggregate."""
    sub = summ[summ["rank"] == "subspecies"].copy()
    sub["reference"] = sub["name"].str.removeprefix("S__")
    rank_cols = parse_path_ranks(sub["tax_path"]).reset_index(drop=True)
    sub = sub.reset_index(drop=True).join(rank_cols)

    # Join mapping stats onto each subspecies row. Inner join: only QC-passing
    # subspecies (in `mapping`) contribute to higher-rank rollups, so medians
    # / sums reflect the same QC selection used at subspecies level.
    sub_map = sub.merge(
        mapping[["label", "reference"] + COVERAGE_STATS
                + ABUND_SUM_COLS
                + ["bases_covered", "max_covered_bases", "reference_length"]],
        on=["label", "reference"], how="inner",
    )

    pieces = []
    for rank in ["phylum", "class", "order", "family", "genus", "species"]:
        grp_keys = ["label", rank]
        g = sub_map.dropna(subset=[rank]).groupby(grp_keys, sort=False)
        agg = pd.DataFrame({
            "n_refs": g["reference"].nunique(),
        })
        for stat in COVERAGE_STATS:
            agg[stat] = g[stat].median()
            agg[stat + "_q25"] = g[stat].quantile(0.25)
            agg[stat + "_q75"] = g[stat].quantile(0.75)
        for col in ABUND_SUM_COLS + ["bases_covered", "max_covered_bases", "reference_length"]:
            agg[col] = g[col].sum(min_count=1)
        agg = agg.reset_index().rename(columns={rank: "name"})
        agg["target_rank"] = rank
        pieces.append(agg)

    rollup = pd.concat(pieces, ignore_index=True)

    # Match higher-rank rows by (label, name); rank in higher == target_rank.
    higher = higher[["label", "taxid", "name", "rank"]].copy()
    higher = higher.merge(
        rollup, left_on=["label", "name", "rank"],
        right_on=["label", "name", "target_rank"], how="left",
    ).drop(columns=["target_rank"])
    return higher


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-reads", type=int, default=50,
                    help="drop rows with fewer than this many reads (default 50)")
    args = ap.parse_args()

    dmg, summ, mapping, lite = load_inputs()

    # Restrict to the 11 dated South-of-Cyprus samples used in the manuscript
    # anvio figures (Fig 2 bact/arch + Fig 4 viruses). Matches cdata join in
    # scripts/05--taxonomic-profiling.R / 10--virome-nt.R.
    cdata_df = load_cdata()
    keep_labels = cdata_df["sample_med"].tolist()
    label_rename = dict(zip(cdata_df["sample_med"], cdata_df["sample"]))
    print(f"[cdata] keeping {len(keep_labels)} samples: {keep_labels}",
          file=sys.stderr)
    dmg = dmg[dmg["label"].isin(keep_labels)].copy()
    summ = summ[summ["label"].isin(keep_labels)].copy()
    mapping = mapping[mapping["label"].isin(keep_labels)].copy()
    lite = lite[lite["label"].isin(keep_labels)].copy()

    # Keep only the ranks we want, both in summ and dmg join.
    summ = summ[summ["rank"].isin(KEEP_RANKS)].copy()

    # Inner-join on (label, taxid). Damage table is the source of truth for
    # rows; summary supplies tax_path/name/rank.
    df = dmg.merge(summ, on=["label", "taxid"], how="inner",
                   suffixes=("", "_summ"))
    print(f"[merge] dmg+summ rows={len(df):,}", file=sys.stderr)

    # Read-count filter (applied to metaDMG nreads — the headline number).
    df = df[df["nreads"] >= args.min_reads].copy()
    print(f"[filter] >= {args.min_reads} reads → rows={len(df):,}", file=sys.stderr)

    # Replace metaDMG A_b/q_b/c_b/phi_b with the bias-corrected values from
    # script 04 and pull in the `fit` flag (subspecies + species only).
    lite_join = lite.rename(columns={
        "A_b": "A_b_lite", "q_b": "q_b_lite",
        "c_b": "c_b_lite", "phi_b": "phi_b_lite",
    })
    df = df.merge(lite_join, on=["label", "taxid", "rank"], how="left")
    for col in ("A_b", "q_b", "c_b", "phi_b"):
        df[col] = df[f"{col}_lite"].combine_first(df[col])
        df.drop(columns=[f"{col}_lite"], inplace=True)
    # Pipeline rule: damage = 0 when fit == "bad" (else use A_b).
    df["damage"] = np.where(df["fit"].eq("bad"), 0.0, df["A_b"])

    # Subspecies must have a damage-lite fit (matches pipeline
    # tax_data |> inner_join(dmg_lca) at scripts/05--taxonomic-profiling.R:106).
    n_pre = len(df)
    df = df[~((df["rank"] == "subspecies") & df["fit"].isna())].copy()
    print(f"[filter] subspecies require lite fit: {n_pre:,} → {len(df):,}", file=sys.stderr)

    # Parse tax columns once.
    tax_df = parse_tax_path(df["tax_path"]).reset_index(drop=True)
    df = df.reset_index(drop=True)
    df = pd.concat([df, tax_df], axis=1)

    # Direct mapping merge for rank=subspecies.
    print("[stats] direct merge for subspecies", file=sys.stderr)
    sub_mask = df["rank"] == "subspecies"
    sub_df = df.loc[sub_mask].copy()
    sub_df["reference"] = sub_df["name"].str.removeprefix("S__")
    n_pre = len(sub_df)
    # inner-join with QC-passing mapping rows ⇒ drop fail-QC subspecies
    # (matches pipeline scripts/05--taxonomic-profiling.R).
    sub_df = sub_df.merge(mapping, on=["label", "reference"],
                          how="inner", suffixes=("", "_map"))
    sub_df["n_refs"] = 1
    print(f"[filter] subspecies QC: {n_pre:,} → {len(sub_df):,}", file=sys.stderr)

    # Subspecies-only output. Higher-rank rollups dropped: metaDMG already
    # pools its own counts when fit at higher ranks, so an IQR ribbon over
    # reference-level fits would conflate two different statistics. The
    # rank-named columns (phylum..species) stay on each subspecies row, so
    # client-side grouping in the sunburst still works.
    out = sub_df
    out["id"] = [hash_id(l, t) for l, t in zip(out["label"], out["taxid"])]
    out = out.rename(columns={
        "label": "sample",
        "nreads": "n_reads",
        "nalign": "n_alns",
        "Zfit": "significance",
    })

    # Aliases the frontend (kapk-derived) expects.
    out["map_A"] = out["A_b"]
    out["map_q"] = out["q_b"]
    out["map_c"] = out["c_b"]
    out["map_phi"] = out["phi_b"]
    out["map_damage"] = out["damage"]
    out["map_significance"] = out["significance"]

    # Build meta DataFrame
    meta_cols = (
        ["id", "sample", "rank", "taxid", "name", "reference"]
        + ["domain", "phylum", "class_", "order_", "family", "genus", "species"]
        + ["n_reads", "n_alns", "n_refs",
           "damage", "fit", "q", "c", "phi", "significance",
           "A", "A_b", "q_b", "c_b", "phi_b",
           "A_CI_l", "A_CI_h", "q_CI_l", "q_CI_h", "c_CI_l", "c_CI_h",
           "map_A", "map_q", "map_c", "map_phi",
           "map_damage", "map_significance"]
        + ["mean_rlen", "mean_gc"]
        + ABUND_SUM_COLS
        + ["bases_covered", "max_covered_bases", "reference_length"]
    )
    for stat in COVERAGE_STATS:
        meta_cols += [stat, stat + "_q25", stat + "_q75"]
    for col in meta_cols:
        if col not in out.columns:
            out[col] = pd.NA
    meta = out[meta_cols].copy()

    # Build freq DataFrame
    freq_data = {"id": out["id"].to_numpy()}
    for p in range(N_POS):
        freq_data[f"fp{p+1}"] = out[f"fwf{p}"].to_numpy()
        freq_data[f"fm{p+1}"] = out[f"bwf{p}"].to_numpy()
        freq_data[f"dp{p+1}"] = out[f"fwdx{p}"].to_numpy()
        freq_data[f"dm{p+1}"] = out[f"bwdx{p}"].to_numpy()
        freq_data[f"fwK{p+1}"] = out[f"fwK{p}"].to_numpy()
        freq_data[f"fwN{p+1}"] = out[f"fwN{p}"].to_numpy()
        freq_data[f"bwK{p+1}"] = out[f"bwK{p}"].to_numpy()
        freq_data[f"bwN{p+1}"] = out[f"bwN{p}"].to_numpy()
    freq = pd.DataFrame(freq_data)

    # Sort by (sample, rank) so a single sample's rows are contiguous;
    # DuckDB-WASM can then range-read just the matching row group(s)
    # instead of streaming the whole file.
    order = meta.sort_values(["sample", "rank"]).index
    meta = meta.loc[order].reset_index(drop=True)
    freq = freq.loc[order].reset_index(drop=True)

    # Damage cutoff = 3rd quartile of A_b for fit=="good" subspecies in the
    # reference sample (scripts/05--taxonomic-profiling.R, lines 78–80).
    # Taken from the full damage-lite table, before the read-count and
    # coverage filters, as the pipeline does; computing it on the filtered
    # rows gives a slightly lower value than Supplementary Table 4 uses.
    ref_pool = lite[
        (normalise_label(lite["label"]) == THRESHOLD_REF_SAMPLE)
        & (lite["rank"] == "subspecies")
        & (lite["fit"] == "good")
    ]["A_b"].dropna()
    if len(ref_pool) == 0:
        print(f"[warn] no fit==good subspecies rows for {THRESHOLD_REF_SAMPLE}; "
              f"falling back to global Q3", file=sys.stderr)
        ref_pool = meta.loc[meta["fit"] == "good", "A_b"].dropna()
    threshold = float(ref_pool.quantile(0.75))
    print(f"[threshold] Q3(A_b | fit=good, sample={THRESHOLD_REF_SAMPLE}) = "
          f"{threshold:.4f}  (n={len(ref_pool)})", file=sys.stderr)

    # Rename MED-* labels to internal_name_by_dom (GeoB...) for display —
    # matches manuscript figure labels.
    meta["sample"] = meta["sample"].map(label_rename).fillna(meta["sample"])

    config = {
        "damage_threshold": threshold,
        "threshold_ref_sample": THRESHOLD_REF_SAMPLE,
        "build_id": str(int(__import__("time").time())),
        "qc": {
            "norm_entropy_gt": QC_MIN_NORM_ENTROPY,
            "breadth_gt": QC_MIN_BREADTH,
            "breadth_exp_ratio_ge": QC_MIN_BREADTH_EXP_RATIO,
        },
        "min_reads": args.min_reads,
        "ranks": KEEP_RANKS,
    }
    config_path = OUT_DIR / "config.json"
    config_path.write_text(json.dumps(config, indent=2))
    print(f"[write] {config_path}", file=sys.stderr)

    samples_path = OUT_DIR / "samples.json"
    samples_path.write_text(json.dumps(
        cdata_df.drop(columns=["sample_med"]).to_dict(orient="records"),
        indent=2,
    ))
    print(f"[write] {samples_path}  ({len(cdata_df)} samples)", file=sys.stderr)

    print(f"[write] {OUT_META}  rows={len(meta):,}", file=sys.stderr)
    pq.write_table(pa.Table.from_pandas(meta, preserve_index=False),
                   OUT_META, compression="zstd", row_group_size=20000)
    print(f"[write] {OUT_FREQ}  rows={len(freq):,}", file=sys.stderr)
    pq.write_table(pa.Table.from_pandas(freq, preserve_index=False),
                   OUT_FREQ, compression="zstd", row_group_size=20000)
    print("[done]", file=sys.stderr)


if __name__ == "__main__":
    main()
