//! Общая нормализация полей дела и пользовательского шаблона.
use crate::domain::sanitize_text;
use crate::models::{FamilyShelfItem, NewTask};
use uuid::Uuid;

const DEFAULT_POINTS: i64 = 10;
const DEFAULT_HOURS: f64 = 24.0;
const MIN_HOURS: f64 = 0.05;
const MAX_HOURS: f64 = 24.0 * 30.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskTemplateError {
    BadTitle,
    NonFiniteNumber,
}

pub(crate) struct TaskTemplateInput {
    pub title: String,
    pub emoji: Option<String>,
    pub base_points: Option<i64>,
    pub hours: Option<f64>,
    pub repeat: Option<bool>,
    pub interval_hours: Option<f64>,
}

impl From<NewTask> for TaskTemplateInput {
    fn from(req: NewTask) -> Self {
        Self {
            title: req.title,
            emoji: req.emoji,
            base_points: req.base_points,
            hours: req.hours,
            repeat: req.repeat,
            interval_hours: req.interval_hours,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NormalizedTaskTemplate {
    pub title: String,
    pub emoji: String,
    pub base_points: i64,
    pub hours: f64,
    pub repeat: bool,
    /// None сохраняет режим auto; effective interval вычисляется при создании Task.
    pub interval_hours: Option<f64>,
}

impl NormalizedTaskTemplate {
    pub(crate) fn effective_interval_hours(&self) -> Option<f64> {
        self.repeat
            .then_some(self.interval_hours.unwrap_or(self.hours))
    }

    pub(crate) fn into_shelf_item(self, id: Uuid) -> FamilyShelfItem {
        FamilyShelfItem {
            id,
            title: self.title,
            emoji: self.emoji,
            base_points: self.base_points,
            hours: self.hours,
            repeat: self.repeat,
            interval_hours: self.interval_hours,
        }
    }
}

fn bounded_hours(value: f64) -> Result<f64, TaskTemplateError> {
    if !value.is_finite() {
        return Err(TaskTemplateError::NonFiniteNumber);
    }
    Ok(value.clamp(MIN_HOURS, MAX_HOURS))
}

pub(crate) fn normalize_task_template(
    req: TaskTemplateInput,
) -> Result<NormalizedTaskTemplate, TaskTemplateError> {
    // Берём 81 символ, чтобы отличить допустимые 80 от слишком длинного ввода.
    let title = sanitize_text(&req.title, 81);
    if title.is_empty() || title.chars().count() > 80 {
        return Err(TaskTemplateError::BadTitle);
    }

    let emoji_raw = req.emoji.unwrap_or_else(|| "📌".into());
    let emoji = if emoji_raw.chars().count() > 8 || sanitize_text(&emoji_raw, 8).is_empty() {
        "📌".into()
    } else {
        sanitize_text(&emoji_raw, 8)
    };
    let base_points = req.base_points.unwrap_or(DEFAULT_POINTS).clamp(1, 1000);
    let hours = bounded_hours(req.hours.unwrap_or(DEFAULT_HOURS))?;
    let repeat = req.repeat.unwrap_or(false);
    let normalized_interval = req.interval_hours.map(bounded_hours).transpose()?;
    let interval_hours = repeat.then_some(normalized_interval).flatten();

    Ok(NormalizedTaskTemplate {
        title,
        emoji,
        base_points,
        hours,
        repeat,
        interval_hours,
    })
}
