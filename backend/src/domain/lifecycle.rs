//! Повторы: interval/fuse, schedule, spawn.
use crate::domain::events::push_event;
use crate::models::*;
use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

/// Интервал повтора: interval_hours, иначе repeat_hours.
pub(crate) fn task_interval_hours(src: &Task) -> Option<f64> {
    src.interval_hours.or(src.repeat_hours).filter(|h| *h > 0.0)
}

/// Фитиль Open: fuse_hours, иначе (deadline-created), иначе interval.
pub(crate) fn task_fuse_hours(src: &Task) -> f64 {
    if let Some(h) = src.fuse_hours.filter(|h| *h > 0.0) {
        return h;
    }
    let span = (src.deadline - src.created_at).num_milliseconds().max(1) as f64 / 3_600_000.0;
    if span > 0.0 {
        return span;
    }
    task_interval_hours(src).unwrap_or(24.0)
}

/// Планирует повтор: status=Scheduled, appear_at = now+interval (не сразу в очереди).
pub(crate) fn schedule_respawn(src: &Task, now: DateTime<Utc>) -> Option<Task> {
    let interval = task_interval_hours(src)?;
    let fuse = task_fuse_hours(src);
    let appear = now + Duration::seconds((interval * 3600.0) as i64);
    Some(Task {
        id: Uuid::new_v4(),
        title: src.title.clone(),
        emoji: src.emoji.clone(),
        base_points: src.base_points,
        created_at: appear, // placeholder; при open перезапишем
        deadline: appear + Duration::seconds((fuse * 3600.0) as i64),
        status: TaskStatus::Scheduled,
        claimed_by: None,
        awarded_points: None,
        finished_at: None,
        repeat_hours: Some(interval),
        interval_hours: Some(interval),
        fuse_hours: Some(fuse),
        appear_at: Some(appear),
    })
}

/// Scheduled → Open, когда appear_at наступил. Возвращает число открытых.
pub(crate) fn spawn_due(db: &mut Db, now: DateTime<Utc>) -> usize {
    let mut opened = 0;
    let mut titles = vec![];
    for t in db.tasks.iter_mut() {
        if t.status != TaskStatus::Scheduled {
            continue;
        }
        let Some(at) = t.appear_at else {
            continue;
        };
        if at > now {
            continue;
        }
        let fuse = t
            .fuse_hours
            .filter(|h| *h > 0.0)
            .unwrap_or_else(|| task_interval_hours(t).unwrap_or(24.0));
        t.status = TaskStatus::Open;
        t.created_at = now;
        t.deadline = now + Duration::seconds((fuse * 3600.0) as i64);
        t.appear_at = None;
        t.claimed_by = None;
        t.awarded_points = None;
        t.finished_at = None;
        titles.push(t.title.clone());
        opened += 1;
    }
    for title in titles {
        push_event(db, "repeat", format!("🔁 «{title}» снова в очереди"), now);
    }
    opened
}
