// Shared ontology types used by both the Worker API and the React SPA.

export type ObjectTypeId =
  | "AIRCRAFT"
  | "VESSEL"
  | "SEISMIC"
  | "WILDFIRE"
  | "STORM"
  | "VOLCANO"
  | "ICE"
  | "FLOOD"
  | "NEWS_EVENT"
  | "PORT"
  | "CHOKEPOINT"
  | "AIRPORT"
  | "DROUGHT"
  | "ALERT"
  | "FIREBALL"
  | "LAUNCH";

export interface ObjectType {
  id: ObjectTypeId;
  label: string;
  color: string;
  geom_kind: "point" | "area";
}

// Controlled domain vocabulary. Every object carries exactly one domain so a
// scope is just a filter.
export type Domain =
  | "environmental"
  | "financial"
  | "political"
  | "conflict"
  | "transport"
  | "maritime"
  | "aviation"
  | "seismic"
  | "space"
  | "health"
  | "energy"
  | "cyber"
  | "sports"
  | "civic"
  | "disaster"
  | "other";

export interface OntologyObject {
  id: string;
  type: ObjectTypeId;
  name: string;
  lat: number;
  lon: number;
  severity: number;
  ts: number;
  source: string | null;
  domain: Domain;
  admin0: string | null;
  admin1: string | null;
  props: Record<string, unknown> | null;
  first_seen: number;
  last_seen: number;
}

export type LinkKind = "PROXIMATE_TO" | "CO_LOCATED" | "ENRICHED_BY";

export interface OntologyLink {
  id: string;
  source_id: string;
  target_id: string;
  kind: LinkKind;
  meta: Record<string, unknown> | null;
  confidence: number;
  created_ts: number;
}

export type ActionKind = "WATCH" | "UNWATCH" | "FLAG" | "UNFLAG" | "ANNOTATE";

export interface ActionLogEntry {
  id: number;
  object_id: string;
  action: ActionKind;
  actor: string;
  payload: string | null;
  ts: number;
}

export interface Annotation {
  id: number;
  object_id: string;
  text: string;
  actor: string;
  ts: number;
}

export interface Entity {
  id: string;
  type: string;
  canonical_name: string;
  wikidata_qid: string | null;
  admin0: string | null;
  geonames_id: number | null;
  lat: number | null;
  lon: number | null;
  first_seen: number;
  last_seen: number;
}

export interface EntityRef {
  entity: Entity;
  role: string;
  source: string;
  confidence: number;
}

export interface HealthResponse {
  ok: boolean;
}
