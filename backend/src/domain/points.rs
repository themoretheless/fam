//! Начисление очков и комбо.
use crate::models::*;
use chrono::{DateTime, Duration, Utc};

pub(crate) fn current_points(task: &Task, now: DateTime<Utc>) -> i64 {
    let total = (task.deadline - task.created_at).num_milliseconds().max(1);
    let elapsed = (now - task.created_at).num_milliseconds().clamp(0, total);
    let mult = 1.0 + (MAX_MULTIPLIER - 1.0) * (elapsed as f64 / total as f64);
    (task.base_points as f64 * mult).round() as i64
}

/// Комбо: считает Done-дела игрока за последние 60 минут, включая текущий клейм.
/// Вызывать ДО мутации задачи (текущая задача ещё Open, поэтому +1 вручную).
pub(crate) fn combo_for(db: &Db, player_id: &str, now: DateTime<Utc>) -> (usize, f64) {
    let cutoff = now - Duration::minutes(60);
    let prior = db
        .tasks
        .iter()
        .filter(|t| {
            matches!(t.status, TaskStatus::Done)
                && t.claimed_by.as_deref() == Some(player_id)
                && t.finished_at.is_some_and(|f| f >= cutoff)
        })
        .count();
    let count = prior + 1; // +1 за текущее дело
    let mult = if count >= 3 {
        1.5
    } else if count == 2 {
        1.25
    } else {
        1.0
    };
    (count, mult)
}
