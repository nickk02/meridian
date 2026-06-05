import { useEffect, useRef, useState, useCallback } from "react";
import type {
  ObjectType,
  OntologyObject,
  OntologyLink,
} from "../../shared/types";
import { api } from "./api";

export type ApiState = "idle" | "ok" | "down";

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
