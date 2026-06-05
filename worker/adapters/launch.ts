// Upcoming orbital launches via The Space Devs Launch Library 2 (keyless, heavily
// rate-limited so cached hard). Pad coordinates are native. New type LAUNCH.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

// The production host rate-limits Cloudflare's shared egress IPs; the lldev
// mirror serves the same data with more lenient limits. Cached 6h regardless.
const URL = "https://lldev.thespacedevs.com/2.2.0/launch/upcoming/?limit=30";

interface Launch {
  id: string;
  name: string;
  net: string;
  status?: { abbrev?: string; name?: string };
  launch_service_provider?: { name?: string };
  pad?: { name?: string; latitude?: string | number; longitude?: string | number };
}
interface LaunchResp {
  results: Launch[] | null;
}

export function normalizeLaunches(resp: LaunchResp): IngestObject[] {
  const out: IngestObject[] = [];
  for (const l of resp.results ?? []) {
    const lat = Number(l.pad?.latitude);
    const lon = Number(l.pad?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ts = Date.parse(l.net);
    out.push({
      id: `LAUNCH-${l.id}`,
      type: "LAUNCH",
      name: l.name,
      lat,
      lon,
      severity: 1,
      ts: Number.isFinite(ts) ? ts : 0,
      source: "launchlibrary",
      props: {
        net: l.net,
        status: l.status?.abbrev ?? l.status?.name ?? null,
        provider: l.launch_service_provider?.name ?? null,
        pad: l.pad?.name ?? null,
      },
    });
  }
  return out;
}

export const launchAdapter = {
  source: "launchlibrary",
  fetchRaw(cache: KVNamespace | undefined): Promise<unknown> {
    // Cache 6h: the upstream is rate-limited and the upcoming list changes slowly.
    return cachedFetchJson<LaunchResp>(cache, "feed:launch", URL, 21600);
  },
  normalize(raw: unknown): IngestObject[] {
    return normalizeLaunches(raw as LaunchResp);
  },
};
