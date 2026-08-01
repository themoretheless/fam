//! Claim mutator: no I/O; deterministic given Db + now.
use crate::domain::{
    check_claim_achievements, combo_for, current_points, format_wait_label, iso_week_key,
    points_word, push_event, schedule_respawn,
};
use crate::models::{Achievement, Db, Task, TaskStatus};
use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ClaimError {
    NotFound,
    Burned,
    Taken,
    UnknownPlayer,
}

pub(crate) struct ClaimOk {
    pub total_award: i64,
    pub awarded: i64,
    pub comeback: i64,
    pub combo_count: usize,
    pub combo_mult: f64,
    pub new_achievements: Vec<Achievement>,
}

/// Apply claim for open task `id` by `player_id`. Caller must have swept already.
pub(crate) fn apply_claim(
    db: &mut Db,
    id: Uuid,
    player_id: &str,
    now: DateTime<Utc>,
) -> Result<ClaimOk, ClaimError> {
    if !db.players.iter().any(|p| p.id == player_id) {
        return Err(ClaimError::UnknownPlayer);
    }
    let Some(idx) = db.tasks.iter().position(|t| t.id == id) else {
        return Err(ClaimError::NotFound);
    };
    if db.tasks[idx].status != TaskStatus::Open {
        return Err(if db.tasks[idx].status == TaskStatus::Burned {
            ClaimError::Burned
        } else {
            ClaimError::Taken
        });
    }
    let pts = current_points(&db.tasks[idx], now);
    let (combo_count, combo_mult) = combo_for(db, player_id, now);
    let awarded = (pts as f64 * combo_mult).round() as i64;
    let (title, emoji, deadline) = (
        db.tasks[idx].title.clone(),
        db.tasks[idx].emoji.clone(),
        db.tasks[idx].deadline,
    );
    {
        let t = &mut db.tasks[idx];
        t.status = TaskStatus::Done;
        t.claimed_by = Some(player_id.to_string());
        t.awarded_points = Some(awarded);
        t.finished_at = Some(now);
    }
    let week = if db.week_key.is_empty() {
        iso_week_key(now)
    } else {
        db.week_key.clone()
    };
    let mut comeback = 0i64;
    let (pname, pavatar) = {
        let p = db
            .players
            .iter_mut()
            .find(|p| p.id == player_id)
            .expect("player checked above");
        if let Some(prev) = p.last_claim_at {
            if now - prev >= Duration::hours(48) && p.comeback_week_key != week {
                comeback = 5;
                p.comeback_week_key = week.clone();
            }
        }
        p.last_claim_at = Some(now);
        p.score += awarded + comeback;
        p.xp += awarded + comeback;
        (p.name.clone(), p.avatar.clone())
    };
    db.week_claims = db.week_claims.saturating_add(1);
    let total_award = awarded + comeback;
    let mut text = format!(
        "{pavatar} {pname}: {emoji} «{title}» готово, +{awarded} {}",
        points_word(awarded)
    );
    if combo_count >= 2 {
        text.push_str(&format!(" 🔥 КОМБО ×{combo_mult}"));
    }
    if comeback > 0 {
        text.push_str(&format!(" · камбэк +{comeback}"));
        push_event(
            db,
            "comeback",
            format!("💪 {pname} возвращается: камбэк +{comeback}"),
            now,
        );
    }
    push_event(db, "done", text, now);
    let done_snapshot: Task = db.tasks[idx].clone();
    if let Some(fresh) = schedule_respawn(&done_snapshot, now) {
        let when = fresh
            .appear_at
            .map(|a| format_wait_label(now, a))
            .unwrap_or_else(|| "скоро".into());
        push_event(
            db,
            "repeat",
            format!("🔁 «{}» вернётся {when}", fresh.title),
            now,
        );
        db.tasks.push(fresh);
    }
    let new_achievements = check_claim_achievements(db, player_id, now, deadline, combo_mult);
    Ok(ClaimOk {
        total_award,
        awarded,
        comeback,
        combo_count,
        combo_mult,
        new_achievements,
    })
}
