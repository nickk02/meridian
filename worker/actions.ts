// Audited operator actions. Every action appends an immutable actions_log row.
// WATCH/FLAG also write the durable state row; ANNOTATE also writes an
// annotation. The log is the audit trail and is never updated in place.

import { z } from "zod";

export const ActionBody = z
  .object({
    object_id: z.string().min(1),
    action: z.enum(["WATCH", "UNWATCH", "FLAG", "UNFLAG", "ANNOTATE"]),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (b) =>
      b.action !== "ANNOTATE" ||
      (typeof b.payload?.["text"] === "string" &&
        (b.payload["text"] as string).trim().length > 0),
    { message: "ANNOTATE requires payload.text" },
  );

export type ActionInput = z.infer<typeof ActionBody>;

const STATE_KEY: Record<string, "watch" | "flag" | null> = {
  WATCH: "watch",
  UNWATCH: "watch",
  FLAG: "flag",
  UNFLAG: "flag",
  ANNOTATE: null,
};
const STATE_VALUE: Record<string, number> = { WATCH: 1, UNWATCH: 0, FLAG: 1, UNFLAG: 0 };

export interface ActionResult {
  ok: true;
  state: { watch: number; flag: number };
}

export async function applyAction(
  db: D1Database,
  input: ActionInput,
): Promise<ActionResult> {
  const now = Date.now();
  const writes: D1PreparedStatement[] = [];

  // Always: append the audit row.
  writes.push(
    db
      .prepare(
        "INSERT INTO actions_log (object_id, action, actor, payload, ts) VALUES (?1, ?2, 'operator', ?3, ?4)",
      )
      .bind(input.object_id, input.action, input.payload ? JSON.stringify(input.payload) : null, now),
  );

  const key = STATE_KEY[input.action];
  if (key) {
    writes.push(
      db
        .prepare(
          `INSERT INTO state (object_id, key, value, ts) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(object_id, key) DO UPDATE SET value = excluded.value, ts = excluded.ts`,
        )
        .bind(input.object_id, key, STATE_VALUE[input.action], now),
    );
  }

  if (input.action === "ANNOTATE") {
    writes.push(
      db
        .prepare(
          "INSERT INTO annotations (object_id, text, actor, ts) VALUES (?1, ?2, 'operator', ?3)",
        )
        .bind(input.object_id, String(input.payload?.["text"]), now),
    );
  }

  await db.batch(writes);

  const stateRows = await db
    .prepare("SELECT key, value FROM state WHERE object_id = ?")
    .bind(input.object_id)
    .all<{ key: string; value: number }>();
  const state = { watch: 0, flag: 0 };
  for (const r of stateRows.results) {
    if (r.key === "watch") state.watch = r.value;
    if (r.key === "flag") state.flag = r.value;
  }
  return { ok: true, state };
}
