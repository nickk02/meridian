import type {
  ObjectType,
  OntologyObject,
  OntologyLink,
  ActionLogEntry,
  Annotation,
} from "../../shared/types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  types: () => getJson<ObjectType[]>("/api/types"),
  objects: () => getJson<OntologyObject[]>("/api/objects?limit=5000"),
  links: () => getJson<OntologyLink[]>("/api/links?limit=20000"),
  object: (id: string) =>
    getJson<{
      object: OntologyObject;
      neighbors: { object: OntologyObject; link: OntologyLink }[];
    }>(`/api/object/${encodeURIComponent(id)}`),
  activity: () => getJson<ActionLogEntry[]>("/api/activity"),

  async action(body: {
    object_id: string;
    action: string;
    payload?: unknown;
  }): Promise<{ ok: boolean; state?: Record<string, number>; annotation?: Annotation }> {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`/api/action -> ${res.status}`);
    return res.json();
  },
};
