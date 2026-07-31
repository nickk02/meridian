import type { Domain } from "../../../shared/types";

export const DOMAIN_COLOR: Record<string, string> = {
  seismic: "#f2a93b",
  environmental: "#5bd6a0",
  disaster: "#ff5e5e",
  maritime: "#36d6e7",
  aviation: "#8fb6ff",
  space: "#c77dff",
  political: "#e0529c",
  conflict: "#ff4d4d",
  energy: "#ffd24a",
  health: "#7fd4ff",
  transport: "#9b8cff",
  civic: "#9aa6b8",
  other: "#8a93a3",
};

export const ALL_DOMAINS: Domain[] = [
  "seismic",
  "environmental",
  "disaster",
  "maritime",
  "aviation",
  "space",
  "conflict",
  "political",
  "civic",
  "transport",
  "energy",
  "health",
  "other",
];

export const REGIONS: { code: string; label: string }[] = [
  { code: "WORLD", label: "World" },
  { code: "NA", label: "N. America" },
  { code: "SA", label: "S. America" },
  { code: "EU", label: "Europe" },
  { code: "AF", label: "Africa" },
  { code: "AS", label: "Asia" },
  { code: "OC", label: "Oceania" },
];
