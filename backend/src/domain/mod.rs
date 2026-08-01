//! Игровая логика (слабая зацепленность: мелкие подмодули).
//! Внешний API для routes: re-export.

mod achievements;
mod claim;
mod create_task;
mod events;
mod lifecycle;
mod memorable_dates;
mod points;
mod seasons;
mod state_view;
mod sweep;
mod task_template;
mod text;

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use achievements::award;
pub(crate) use achievements::check_claim_achievements;
pub(crate) use claim::{apply_claim, ClaimError};
pub(crate) use create_task::create_open_task;
pub(crate) use events::push_event;
pub(crate) use lifecycle::schedule_respawn;
#[cfg(test)]
pub(crate) use lifecycle::spawn_due;
#[cfg(test)]
pub(crate) use memorable_dates::MemorableDateInput;
pub(crate) use memorable_dates::{normalize_memorable_date, MemorableDateError};
pub(crate) use points::{combo_for, current_points};
#[cfg(test)]
pub(crate) use seasons::check_week_rollover;
pub(crate) use seasons::iso_week_key;
pub(crate) use state_view::state_response;
pub(crate) use sweep::sweep;
pub(crate) use task_template::{normalize_task_template, TaskTemplateError, TaskTemplateInput};
pub(crate) use text::{format_wait_label, points_word, sanitize_text};
