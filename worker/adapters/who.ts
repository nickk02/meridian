import type { IngestObject } from "./types";
import type { Adapter } from "./types";
import { cachedFetchJson } from "../cache";
import countries from "../geo/countries.json";

const WHO_BASE = "https://www.who.int/api/news/diseaseoutbreaknews";

interface Country {
  iso3: string;
  bbox: [number, number, number, number];
  polys: number[][][][];
}

const COUNTRIES = countries as Country[];

// Build a map of ISO3 to bbox for fast lookup
const ISO3_TO_BBOX: Record<string, [number, number, number, number]> = {};
for (const c of COUNTRIES) {
  ISO3_TO_BBOX[c.iso3] = c.bbox;
}

// Name to ISO3, covering the countries that actually appear in WHO DON
// titles in practice. A country not in this table just yields a null
// admin0 rather than a wrong guess.
const COUNTRY_TO_ISO3: Record<string, string> = {
  "Democratic Republic of the Congo": "COD",
  "Uganda": "UGA",
  "India": "IND",
  "Egypt": "EGY",
  "Ethiopia": "ETH",
  "Nigeria": "NGA",
  "Kenya": "KEN",
  "South Sudan": "SSD",
  "Sudan": "SDN",
  "Yemen": "YEM",
  "Pakistan": "PAK",
  "Afghanistan": "AFG",
  "Indonesia": "IDN",
  "Philippines": "PHL",
  "Bangladesh": "BGD",
  "Madagascar": "MDG",
  "Zambia": "ZMB",
  "Zimbabwe": "ZWE",
  "Mozambique": "MOZ",
  "Tanzania": "TZA",
  "Cameroon": "CMR",
  "Chad": "TCD",
  "Niger": "NER",
  "Mali": "MLI",
  "Guinea": "GIN",
  "Liberia": "LBR",
  "Sierra Leone": "SLE",
  "Cote d'Ivoire": "CIV",
  "Somalia": "SOM",
  "Haiti": "HTI",
  "Brazil": "BRA",
  "Peru": "PER",
  "Colombia": "COL",
  "Mexico": "MEX",
  "China": "CHN",
  "Viet Nam": "VNM",
  "Thailand": "THA",
  "Saudi Arabia": "SAU",
  "United States of America": "USA",
  "United Kingdom": "GBR",
};

function findCountry(title: string): string | undefined {
  for (const [name, iso3] of Object.entries(COUNTRY_TO_ISO3)) {
    if (title.includes(name)) return iso3;
  }
  return undefined;
}

function getCountryCoords(iso3: string): [number, number] | null {
  const bbox = ISO3_TO_BBOX[iso3];
  if (!bbox) return null;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lon = (minLon + maxLon) / 2;
  const lat = (minLat + maxLat) / 2;
  return [lat, lon];
}

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

interface WhoItem {
  Id: string;
  PublicationDate: string;
  Title: string;
  ItemDefaultUrl: string;
  Overview?: string | null;
}
interface WhoResponse {
  value: WhoItem[];
}

export function normalizeWho(feed: WhoResponse): IngestObject[] {
  const out: IngestObject[] = [];
  for (const item of feed.value ?? []) {
    const ts = Date.parse(item.PublicationDate);
    if (!Number.isFinite(ts)) continue;
    const admin0 = findCountry(item.Title);

    // If admin0 is found, look up its bbox and compute center coords.
    // If not found in countries.json, skip this object (don't emit bad coords).
    let lat = 0;
    let lon = 0;
    if (admin0) {
      const coords = getCountryCoords(admin0);
      if (!coords) continue; // Skip if ISO3 has no bbox entry
      [lat, lon] = coords;
    }

    out.push({
      id: `WHO-${item.Id}`,
      type: "NEWS_EVENT",
      name: item.Title,
      lat,
      lon,
      severity: 2,
      ts,
      source: "who",
      admin0,
      props: {
        overview: stripHtml(item.Overview),
        url: `https://www.who.int${item.ItemDefaultUrl}`,
      },
    });
  }
  return out;
}

export const whoAdapter: Adapter = {
  source: "who",
  async fetchRaw(cache) {
    const url = `${WHO_BASE}?$top=50&$orderby=PublicationDate desc&$select=Id,PublicationDate,Title,ItemDefaultUrl,Overview`;
    return cachedFetchJson<WhoResponse>(cache, "feed:who", url, 21600);
  },
  normalize(raw) {
    return normalizeWho(raw as WhoResponse);
  },
};
