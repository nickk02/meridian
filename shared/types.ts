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
  source_url: string | null;
  fetched_at: number | null;
  confidence: number;
  domain: Domain;
  admin0: string | null;
  admin1: string | null;
  incident_id: string | null;
  props: Record<string, unknown> | null;
  first_seen: number;
  last_seen: number;
}

export type LinkKind =
  | "PROXIMATE_TO"
  | "CO_LOCATED"
  | "ENRICHED_BY"
  | "CORRELATED_WITH";

export interface OntologyLink {
  id: string;
  source_id: string;
  target_id: string;
  kind: LinkKind;
  basis: string;
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

export interface Incident {
  id: string;
  label: string;
  domain: Domain;
  centroid_lat: number;
  centroid_lon: number;
  t_start: number;
  t_end: number;
  member_count: number;
  severity_max: number;
  created_ts: number;
}

// Cross-domain incident (Stage G): events of different types that co-occur in
// space and time AND share a plausible mechanism. Members carry their distance
// and time offset from the anchor as the per-link basis.
export interface CrossMember {
  id: string;
  name: string;
  domain: Domain;
  type: ObjectTypeId;
  severity: number;
  km: number;
  dtHr: number;
}

export interface CrossIncident {
  id: string;
  label: string;
  anchor_id: string;
  centroid_lat: number;
  centroid_lon: number;
  t_start: number;
  t_end: number;
  member_count: number;
  type_count: number;
  severity_max: number;
  types: ObjectTypeId[];
  domains: Domain[];
  members: CrossMember[];
}

export interface HealthResponse {
  ok: boolean;
}
