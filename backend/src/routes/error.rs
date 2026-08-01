//! HTTP ошибки и save-or-503.
use crate::domain::{MemorableDateError, TaskTemplateError};
use crate::models::Db;
use crate::store::Store;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

pub(crate) fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(serde_json::json!({ "error": msg }))).into_response()
}

pub(crate) fn task_template_err(error: TaskTemplateError) -> Response {
    match error {
        TaskTemplateError::BadTitle => err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Название должно быть от 1 до 80 символов",
        ),
        TaskTemplateError::NonFiniteNumber => err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Числовые поля должны быть конечными",
        ),
    }
}

pub(crate) fn memorable_date_err(error: MemorableDateError) -> Response {
    match error {
        MemorableDateError::Title => err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Название должно быть от 1 до 80 символов",
        ),
        MemorableDateError::Date => err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Дата должна существовать и иметь формат YYYY-MM-DD",
        ),
        MemorableDateError::Kind => err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Тип даты: anniversary, meeting, birthday или custom",
        ),
    }
}

/// Сначала сохраняет кандидата и только затем заменяет общее состояние.
/// При ошибке `current` остаётся ровно таким, каким был до мутации.
pub(crate) fn commit_or_503(
    store: &dyn Store,
    current: &mut Db,
    candidate: Db,
) -> Option<Response> {
    match store.save(&candidate) {
        Ok(()) => {
            *current = candidate;
            None
        }
        Err(e) => {
            eprintln!("persist failed: {e}");
            Some(err(
                StatusCode::SERVICE_UNAVAILABLE,
                "Не удалось сохранить данные, попробуйте ещё раз",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::default_db;

    struct FailingStore;

    impl Store for FailingStore {
        fn load(&self) -> Db {
            default_db()
        }

        fn save(&self, _db: &Db) -> Result<(), String> {
            Err("injected failure".into())
        }
    }

    #[test]
    fn failed_commit_returns_503_and_keeps_db_byte_for_byte() {
        let mut current = default_db();
        current.players[0].name = "До".into();
        let before = serde_json::to_vec(&current).unwrap();

        let mut candidate = current.clone();
        candidate.players[0].name = "После".into();
        let response =
            commit_or_503(&FailingStore, &mut current, candidate).expect("failing store");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(serde_json::to_vec(&current).unwrap(), before);
    }
}
