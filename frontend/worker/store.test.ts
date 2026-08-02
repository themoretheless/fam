import { describe, expect, it } from "vitest";
import { MemoryD1 } from "./test-d1";
import {
  ensureSchema,
  loadState,
  MAX_CAS_ATTEMPTS,
  mutateState,
  StateConflictError,
  StateStoreError,
} from "./store";

describe("D1 state store", () => {
  it("creates and seeds the singleton exactly once per binding", async () => {
    const database = new MemoryD1();

    await Promise.all([ensureSchema(database), ensureSchema(database)]);
    const loaded = await loadState(database);

    expect(database.schemaRuns).toBe(1);
    expect(database.insertRuns).toBe(1);
    expect(loaded.revision).toBe(0);
    expect(loaded.state.players.map((player) => player.id)).toEqual(["p1", "p2"]);
  });

  it("deep-clones state and leaves storage untouched when a reducer fails", async () => {
    const database = new MemoryD1();
    const before = await loadState(database);

    await expect(
      mutateState(database, (draft) => {
        draft.players[0]!.name = "Не сохранять";
        throw new Error("domain failure");
      }),
    ).rejects.toThrow("domain failure");

    const after = await loadState(database);
    expect(after).toEqual(before);
    expect(database.updateRuns).toBe(0);
  });

  it("replays the reducer after CAS conflicts and commits the latest draft", async () => {
    const database = new MemoryD1();
    database.conflictsRemaining = 2;
    let reducerRuns = 0;

    const result = await mutateState(database, (draft) => {
      reducerRuns += 1;
      draft.week_claims += 1;
      return { changed: true, value: draft.week_claims };
    });

    expect(reducerRuns).toBe(3);
    expect(database.updateRuns).toBe(3);
    expect(result.revision).toBe(3);
    expect(result.value).toBe(1);
    expect((await loadState(database)).state.week_claims).toBe(1);
  });

  it("returns a conflict error after five failed CAS attempts", async () => {
    const database = new MemoryD1();
    database.conflictsRemaining = MAX_CAS_ATTEMPTS;
    let reducerRuns = 0;

    await expect(
      mutateState(database, (draft) => {
        reducerRuns += 1;
        draft.week_claims += 1;
        return { changed: true, value: null };
      }),
    ).rejects.toBeInstanceOf(StateConflictError);

    expect(reducerRuns).toBe(MAX_CAS_ATTEMPTS);
    expect(database.updateRuns).toBe(MAX_CAS_ATTEMPTS);
  });

  it("wraps D1 write failures as service-availability errors", async () => {
    const database = new MemoryD1();
    database.failUpdates = true;

    await expect(
      mutateState(database, (draft) => {
        draft.week_claims += 1;
        return { changed: true, value: null };
      }),
    ).rejects.toBeInstanceOf(StateStoreError);
  });

  it("compacts old finished tasks before enforcing the 1.5 MB limit", async () => {
    const database = new MemoryD1();
    const longTitle = "x".repeat(5_000);

    const result = await mutateState(database, (draft) => {
      for (let index = 0; index < 400; index += 1) {
        draft.tasks.push({
          id: `done-${index}`,
          title: longTitle,
          emoji: "✅",
          base_points: 1,
          created_at: index,
          deadline: index + 1,
          status: "done",
          claimed_by: "p1",
          awarded_points: 1,
          finished_at: index,
          repeat_hours: null,
          interval_hours: null,
          fuse_hours: 1,
          appear_at: null,
        });
      }
      return { changed: true, value: null };
    });

    expect(result.state.tasks).toHaveLength(200);
    expect(result.state.tasks[0]!.id).toBe("done-399");
    expect(new TextEncoder().encode(database.row!.state_json).byteLength).toBeLessThanOrEqual(
      1_500_000,
    );
  });
});
