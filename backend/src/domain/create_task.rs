//! Create open task from a normalized template, then add its feed event.
use crate::domain::{normalize_task_template, push_event, TaskTemplateInput};
use crate::models::{Db, Task, TaskStatus};
use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

/// Build and push an Open task. Returns the created task.
pub(crate) fn create_open_task(
    db: &mut Db,
    req: TaskTemplateInput,
    now: DateTime<Utc>,
) -> Result<Task, crate::domain::TaskTemplateError> {
    let normalized = normalize_task_template(req)?;
    let interval = normalized.effective_interval_hours();
    let task = Task {
        id: Uuid::new_v4(),
        title: normalized.title,
        emoji: normalized.emoji,
        base_points: normalized.base_points,
        created_at: now,
        deadline: now + Duration::seconds((normalized.hours * 3600.0) as i64),
        status: TaskStatus::Open,
        claimed_by: None,
        awarded_points: None,
        finished_at: None,
        repeat_hours: interval,
        interval_hours: interval,
        fuse_hours: Some(normalized.hours),
        appear_at: None,
    };
    push_event(
        db,
        "new",
        format!("{} Новое дело: «{}»", task.emoji, task.title),
        now,
    );
    db.tasks.push(task.clone());
    Ok(task)
}
