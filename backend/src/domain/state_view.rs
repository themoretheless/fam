//! Снимок API state.
use crate::models::*;
use chrono::Utc;
use std::cmp::Reverse;

/// Liskov/exhaustive: closed tasks for history/stats (не Open, не Scheduled).
pub(crate) fn is_history_status(s: TaskStatus) -> bool {
    matches!(s, TaskStatus::Done | TaskStatus::Burned)
}

pub(crate) fn state_response(db: &Db) -> StateResponse {
    let mut open: Vec<Task> = db
        .tasks
        .iter()
        .filter(|t| matches!(t.status, TaskStatus::Open))
        .cloned()
        .collect();
    open.sort_by_key(|t| t.deadline);
    let mut history: Vec<Task> = db
        .tasks
        .iter()
        .filter(|t| is_history_status(t.status))
        .cloned()
        .collect();
    // finished_at по убыванию; None (старые данные) уходит в конец.
    // Обрезка после сортировки оставляет самые свежие.
    history.sort_by_key(|t| Reverse(t.finished_at));
    history.truncate(200);
    StateResponse {
        players: db.players.clone(),
        tasks: open,
        events: db.events.iter().cloned().collect(),
        week_key: db.week_key.clone(),
        seasons: db.seasons.iter().rev().take(8).cloned().collect(),
        achievements: db.achievements.clone(),
        history,
        family_shelf: db.family_shelf.clone(),
        memorable_dates: db.memorable_dates.clone(),
        server_now: Utc::now(),
    }
}
