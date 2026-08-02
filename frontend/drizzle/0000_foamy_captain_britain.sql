CREATE TABLE `app_state` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "app_state_singleton_check" CHECK("app_state"."singleton" = 1)
);
