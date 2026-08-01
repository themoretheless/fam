//! Нормализация ежегодных памятных дат.
use crate::domain::sanitize_text;
use crate::models::{MemorableDate, MemorableDateKind, MemorableDateReq};
use chrono::NaiveDate;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemorableDateError {
    Title,
    Date,
    Kind,
}

pub(crate) struct MemorableDateInput {
    pub title: String,
    pub date: String,
    pub kind: String,
}

impl From<MemorableDateReq> for MemorableDateInput {
    fn from(request: MemorableDateReq) -> Self {
        Self {
            title: request.title,
            date: request.date,
            kind: request.kind,
        }
    }
}

pub(crate) struct NormalizedMemorableDate {
    pub title: String,
    pub date: NaiveDate,
    pub kind: MemorableDateKind,
}

impl NormalizedMemorableDate {
    pub(crate) fn into_item(self, id: Uuid) -> MemorableDate {
        MemorableDate {
            id,
            title: self.title,
            date: self.date,
            kind: self.kind,
        }
    }
}

fn parse_exact_date(value: &str) -> Result<NaiveDate, MemorableDateError> {
    let bytes = value.as_bytes();
    let exact_shape = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit());
    if !exact_shape || &value[..4] == "0000" {
        return Err(MemorableDateError::Date);
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| MemorableDateError::Date)
}

pub(crate) fn normalize_memorable_date(
    input: MemorableDateInput,
) -> Result<NormalizedMemorableDate, MemorableDateError> {
    // Берём 81 символ, чтобы отличить допустимые 80 от слишком длинного ввода.
    let title = sanitize_text(&input.title, 81);
    if title.is_empty() || title.chars().count() > 80 {
        return Err(MemorableDateError::Title);
    }
    let date = parse_exact_date(&input.date)?;
    let kind = match input.kind.as_str() {
        "anniversary" => MemorableDateKind::Anniversary,
        "meeting" => MemorableDateKind::Meeting,
        "birthday" => MemorableDateKind::Birthday,
        "custom" => MemorableDateKind::Custom,
        _ => return Err(MemorableDateError::Kind),
    };

    Ok(NormalizedMemorableDate { title, date, kind })
}
