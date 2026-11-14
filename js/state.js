// Application state. One mutable object, imported everywhere.
// View modules never import actions.js (that would be circular); they call
// the functions registered on `handlers` instead.

export const state = {
    db: null,
    conn: null,
    samples: [],          // rows of samples.json joined with per-sample counts
    currentSample: null,  // sample name shown in the main view
    selectedSamples: [],  // sample names ticked for "Compare samples"
    sampleData: [],       // all rows of the current sample (meta + freq)
    sunburstData: [],     // rows after numeric and taxonomy filters
    filteredData: [],     // sunburstData after the status filter, sorted
    selectedRef: null,    // row id open in the detail panel
    compareList: [],      // row ids ticked in the table
    sortColumn: 'damage',
    sortDirection: 'desc',
    filters: {
        status: 'all',    // 'all' | 'damaged' | 'non-damaged'
        minDamage: 0,
        minSignificance: 0,
        minReads: 0,
        search: '',       // free-text match over taxonomy columns
    },
    filterPath: [],       // taxonomy drill-down, e.g. ['d__Bacteria', 'p__…']
};

/** Taxonomy columns in drill-down order; filterPath[i] matches RANK_COLUMNS[i]. */
export const RANK_COLUMNS = ['domain', 'phylum', 'class_', 'order_', 'family', 'genus'];
export const RANK_NAMES = ['Domain', 'Phylum', 'Class', 'Order', 'Family', 'Genus', 'Species'];

/** Filled in by actions.js at start-up. */
export const handlers = {
    selectSample: null,      // (sampleName) => Promise
    selectReference: null,   // (rowId) => void
    setFilterPath: null,     // (pathArray) => void
    toggleCompare: null,     // (rowId) => void
    toggleSampleCompare: null, // (sampleName) => void
    trackTaxon: null,        // (name, level, samples?) => void
    refresh: null,           // ({ rebuildSunburst }) => void
};
