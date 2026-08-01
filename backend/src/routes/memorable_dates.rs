//! CRUD общего ежегодного календаря памятных дат.
use crate::domain::normalize_memorable_date;
use crate::models::{MemorableDate, MemorableDateReq, MAX_MEMORABLE_DATES};
use crate::routes::app_state::AppState;
use crate::routes::error::{commit_or_503, err, memorable_date_err};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;

fn same_date(left: &MemorableDate, right: &MemorableDate) -> bool {
    left.title == right.title && left.date == right.date && left.kind == right.kind
}

pub(crate) async fn create_memorable_date(
    State(state): State<AppState>,
    Json(request): Json<MemorableDateReq>,
) -> Response {
    let normalized = match normalize_memorable_date(request.into()) {
        Ok(normalized) => normalized,
        Err(error) => return memorable_date_err(error),
    };
    let item = normalized.into_item(Uuid::new_v4());

    let mut db = state.db.lock().await;
    if db.memorable_dates.len() >= MAX_MEMORABLE_DATES {
        return err(
            StatusCode::CONFLICT,
            "В семейном календаре уже 100 памятных дат",
        );
    }
    if db
        .memorable_dates
        .iter()
        .any(|existing| same_date(existing, &item))
    {
        return err(StatusCode::CONFLICT, "Такая памятная дата уже есть");
    }

    let mut candidate = db.clone();
    candidate.memorable_dates.insert(0, item.clone());
    if let Some(response) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return response;
    }
    let _ = state.tx.send(());
    (StatusCode::CREATED, Json(item)).into_response()
}

pub(crate) async fn replace_memorable_date(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(request): Json<MemorableDateReq>,
) -> Response {
    let normalized = match normalize_memorable_date(request.into()) {
        Ok(normalized) => normalized,
        Err(error) => return memorable_date_err(error),
    };
    let replacement = normalized.into_item(id);

    let mut db = state.db.lock().await;
    let Some(position) = db.memorable_dates.iter().position(|item| item.id == id) else {
        return err(StatusCode::NOT_FOUND, "Памятная дата не найдена");
    };
    if db
        .memorable_dates
        .iter()
        .enumerate()
        .any(|(index, existing)| index != position && same_date(existing, &replacement))
    {
        return err(StatusCode::CONFLICT, "Такая памятная дата уже есть");
    }

    let mut candidate = db.clone();
    candidate.memorable_dates[position] = replacement.clone();
    if let Some(response) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return response;
    }
    let _ = state.tx.send(());
    Json(replacement).into_response()
}

pub(crate) async fn delete_memorable_date(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Response {
    let mut db = state.db.lock().await;
    let Some(position) = db.memorable_dates.iter().position(|item| item.id == id) else {
        return err(StatusCode::NOT_FOUND, "Памятная дата не найдена");
    };

    let mut candidate = db.clone();
    candidate.memorable_dates.remove(position);
    if let Some(response) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return response;
    }
    let _ = state.tx.send(());
    Json(serde_json::json!({ "ok": true })).into_response()
}
