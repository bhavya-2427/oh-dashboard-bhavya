// Single source of truth for the sidebar structure.
// `key` matches the backend validation key (REGISTRY key in validations.py)
// where the validation is live; `pending: true` marks placeholders.
export const NAV_GROUPS = [
  {
    label: "Identity & format",
    items: [
      { key: "prefix", label: "Prefix check" },
      { key: "spelling", label: "Spelling errors" },
      { key: "full_name", label: "Full name format" },
      { key: "naming_convention", label: "Naming convention" },
    ],
  },
  {
    label: "Completeness",
    items: [
      { key: "govt_body_status", label: "Govt body unverified", separateUpload: true },
      { key: "partial_dates", label: "Partial dates" },
      { key: "social_media", label: "Missing social media" },
      { key: "missing_dob", label: "Missing DOB" },
    ],
  },
  {
    label: "Role & tenure logic",
    items: [
      { key: "selection_method", label: "Selection method mismatch" },
      { key: "overlapping_tenures", label: "Overlapping tenures" },
      { key: "seat_status", label: "Vacant seats" },
    ],
  },
  {
    label: "Party & duplication",
    items: [
      { key: "lookalike_parties", label: "Look-alike parties" },
      { key: "multi_party", label: "Multi-party check" },
    ],
  },
  {
    label: "Translations",
    items: [{ key: "translations", label: "OH / PE / VIF pending", separateUpload: true }],
  },
  {
    label: "Alerts",
    items: [{ key: "upcoming_deadlines", label: "Upcoming deadlines" }],
  },
];
