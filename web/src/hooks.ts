import { useEffect, useRef, useState, useCallback } from "react";
import type {
  ObjectType,
  OntologyObject,
  OntologyLink,
} from "../../shared/types";
import { api } from "./api";

export type ApiState = "idle" | "ok" | "down";

// Tracks a max-width media query so the shell can switch to a drawer-based
// mobile layout.
export function useIsMobile(maxWidth = 820): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [match, setMatch] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

export function useUtcClock(): string {
  const [now, setNow] = useState(() => formatUtc(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatUtc(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

export interface Ontology {
  types: ObjectType[];
  objects: OntologyObject[];
  links: OntologyLink[];
  loaded: boolean;
  status: ApiState;
  lastSync: number | null;
  refresh: () => void;
}

export interface ObjectDetail {
  object: OntologyObject;
  neighbors: { object: OntologyObject; link: OntologyLink }[];
  state: { watch: number; flag: number };
  annotations: { id: number; object_id: string; text: string; actor: string; ts: number }[];
  entities: import("../../shared/types").EntityRef[];
}

// Fetches full detail for the selected object and exposes a refresh, used after
// an audited action so the inspector reflects the new state immediately.
export function useObjectDetail(id: string | null): {
  detail: ObjectDetail | null;
  loading: boolean;
  refresh: () => void;
} {
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      const d = (await api.object(id)) as unknown as ObjectDetail;
      if (alive.current) setDetail(d);
    } catch {
      if (alive.current) setDetail(null);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  return { detail, loading, refresh };
}

// Loads types/objects/links and polls every 60s so the picture reflects a
// fresh cron cycle. Status doubles as the API health signal.
export function useOntology(pollMs = 60_000): Ontology {
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [objects, setObjects] = useState<OntologyObject[]>([]);
  const [links, setLinks] = useState<OntologyLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<ApiState>("idle");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [t, o, l] = await Promise.all([
        api.types(),
        api.objects(),
        api.links(),
      ]);
      if (!alive.current) return;
      setTypes(t);
      setObjects(o);
      setLinks(l);
      setStatus("ok");
      setLastSync(Date.now());
      setLoaded(true);
    } catch {
      if (alive.current) setStatus("down");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const id = window.setInterval(refresh, pollMs);
    return () => {
      alive.current = false;
      window.clearInterval(id);
    };
  }, [refresh, pollMs]);

  return { types, objects, links, loaded, status, lastSync, refresh };
}
