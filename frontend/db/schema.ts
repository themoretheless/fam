import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appState = sqliteTable(
  "app_state",
  {
    singleton: integer("singleton").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    revision: integer("revision").notNull(),
    stateJson: text("state_json").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    contentSeedVersion: integer("content_seed_version").notNull().default(0),
  },
  (table) => [
    check("app_state_singleton_check", sql`${table.singleton} = 1`),
  ],
);
