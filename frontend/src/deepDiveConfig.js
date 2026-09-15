// Central config for the generic Deep Dive system — one entry per check
// that has daily-snapshot tracking. Both App.jsx (to render DeepDivePage)
// and ValidationPage.jsx (to decide whether to show the "Deep Dive"
// button, and with what label) read from this same object, so adding
// Deep Dive support for a new check is just adding one entry here.

export const METRICS_BY_CHECK = {
  missing_dob: [
    { key: "total_count", label: "Total records (verified + active)", color: "#2F3A4A" },
    { key: "flagged_count", label: "DOB missing", color: "#A6403D", byTlKey: "by_tl_missing" },
    { key: "partial_count", label: "DOB partial", color: "#B08A2E", byTlKey: "by_tl_partial" },
  ],
  partial_dates: [
    { key: "total_count", label: "Total records", color: "#2F3A4A" },
    { key: "blank_start", label: "Blank start date", color: "#A6403D", byTlKey: "by_tl_blank_start" },
    { key: "blank_end", label: "Blank end date", color: "#B08A2E", byTlKey: "by_tl_blank_end" },
    { key: "partial_count", label: "Partial (year/month only)", color: "#4C8A63", byTlKey: "by_tl_partial" },
  ],
  prefix: [
    { key: "total_count", label: "Records checked", color: "#2F3A4A" },
    { key: "flagged_count", label: "Mismatched prefix", color: "#A6403D", byTlKey: "by_tl_missing" },
    { key: "partial_count", label: "Blank prefix", color: "#B08A2E", byTlKey: "by_tl_partial" },
  ],
  full_name: [
    { key: "total_count", label: "Records checked", color: "#2F3A4A" },
    { key: "flagged_count", label: "Format errors", color: "#A6403D", byTlKey: "by_tl_missing" },
  ],
  naming_convention: [
    { key: "total_count", label: "Office titles checked", color: "#2F3A4A" },
    { key: "flagged_count", label: "Format mismatches", color: "#A6403D", byTlKey: "by_tl_missing" },
  ],
  spelling: [
    { key: "total_count", label: "Records checked", color: "#2F3A4A" },
    { key: "flagged_count", label: "Likely typos", color: "#A6403D", byTlKey: "by_tl_missing" },
    { key: "partial_count", label: "Unrecognized words", color: "#B08A2E", byTlKey: "by_tl_partial" },
  ],
  selection_method: [
    { key: "total_count", label: "Records checked", color: "#2F3A4A" },
    { key: "flagged_count", label: "Possible mismatch", color: "#A6403D", byTlKey: "by_tl_missing" },
  ],
  social_media: [
    { key: "total_count", label: "Total records", color: "#2F3A4A" },
    { key: "flagged_count", label: "Missing ALL personal platforms", color: "#2E8B84", byTlKey: "by_tl_missing" },
    { key: "partial_count", label: "Missing ALL official platforms", color: "#7A5AA8", byTlKey: "by_tl_partial" },
  ],
  overlapping_tenures: [
    { key: "total_count", label: "People checked", color: "#2F3A4A" },
    { key: "flagged_count", label: "Overlapping pairs", color: "#A6403D" },
  ],
  lookalike_parties: [
    { key: "total_count", label: "Distinct party names", color: "#2F3A4A" },
    { key: "flagged_count", label: "Similar-looking pairs", color: "#A6403D", byTlKey: "by_tl_missing" },
  ],
  multi_party: [
    { key: "total_count", label: "People checked", color: "#2F3A4A" },
    { key: "flagged_count", label: "Linked to 2+ parties", color: "#A6403D" },
  ],
  upcoming_deadlines: [
    { key: "total_count", label: "Tenures with an end date", color: "#2F3A4A" },
    { key: "flagged_count", label: "Ending soon", color: "#A6403D", byTlKey: "by_tl_missing" },
  ],
};

export const DEEP_DIVE_TITLES = {
  missing_dob: ["DOB Deep Dive", "Total records, total missing, total partial, and each team lead's missing/partial counts — tracked day over day."],
  partial_dates: ["Partial Dates Deep Dive", "Total records, blank start, blank end, and partial dates — tracked day over day, by team lead."],
  prefix: ["Prefix Deep Dive", "Records checked, mismatched prefixes, and blank prefixes — tracked day over day, by team lead."],
  full_name: ["Full Name Deep Dive", "Records checked and full name format errors — tracked day over day, by team lead."],
  naming_convention: ["Naming Convention Deep Dive", "Office titles checked and naming format mismatches — tracked day over day, by team lead."],
  spelling: ["Spelling Deep Dive", "Records checked, likely typos, and unrecognized words — tracked day over day, by team lead."],
  selection_method: ["Selection Method Deep Dive", "Records checked and selection method mismatches — tracked day over day, by team lead."],
  social_media: ["Social Media Deep Dive", "Total records, records missing every personal platform, and records missing every official platform — tracked day over day, by team lead."],
  overlapping_tenures: ["Overlapping Tenures Deep Dive", "People checked and overlapping tenure pairs found — tracked day over day."],
  lookalike_parties: ["Look-alike Parties Deep Dive", "Distinct party names and similar-looking pairs found — tracked day over day, by team lead."],
  multi_party: ["Multi-Party Deep Dive", "People checked and people linked to 2+ parties — tracked day over day."],
  upcoming_deadlines: ["Upcoming Deadlines Deep Dive", "Tenures tracked and those ending soon — tracked day over day, by team lead."],
};