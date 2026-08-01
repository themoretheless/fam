//! CRUD общей семейной полки шаблонов.
use crate::domain::normalize_task_template;
use crate::models::{FamilyShelfItem, NewTask, MAX_FAMILY_SHELF_ITEMS};
use crate::routes::app_state::AppState;
use crate::routes::error::{commit_or_503, err, task_template_err};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;

fn same_template(left: &FamilyShelfItem, right: &FamilyShelfItem) -> bool {
    left.title == right.title
        && left.emoji == right.emoji
        && left.base_points == right.base_points
        && left.hours == right.hours
        && left.repeat == right.repeat
        && left.interval_hours == right.interval_hours
}

pub(crate) async fn create_shelf_item(
    State(state): State<AppState>,
    Json(req): Json<NewTask>,
) -> Response {
    let normalized = match normalize_task_template(req.into()) {
        Ok(normalized) => normalized,
        Err(error) => return task_template_err(error),
    };
    let item = normalized.into_shelf_item(Uuid::new_v4());

    let mut db = state.db.lock().await;
    if db.family_shelf.len() >= MAX_FAMILY_SHELF_ITEMS {
        return err(StatusCode::CONFLICT, "На семейной полке уже 50 шаблонов");
    }
    if db
        .family_shelf
        .iter()
        .any(|existing| same_template(existing, &item))
    {
        return err(StatusCode::CONFLICT, "Такой шаблон уже есть на полке");
    }

    let mut candidate = db.clone();
    candidate.family_shelf.insert(0, item.clone());
    if let Some(response) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return response;
    }
    let _ = state.tx.send(());
    (StatusCode::CREATED, Json(item)).into_response()
}

pub(crate) async fn replace_shelf_item(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<NewTask>,
) -> Response {
    let normalized = match normalize_task_template(req.into()) {
        Ok(normalized) => normalized,
        Err(error) => return task_template_err(error),
    };
    let replacement = normalized.into_shelf_item(id);

    let mut db = state.db.lock().await;
    let Some(position) = db.family_shelf.iter().position(|item| item.id == id) else {
        return err(StatusCode::NOT_FOUND, "Шаблон не найден");
    };
    if db
        .family_shelf
        .iter()
        .enumerate()
        .any(|(index, existing)| index != position && same_template(existing, &replacement))
    {
        return err(StatusCode::CONFLICT, "Такой шаблон уже есть на полке");
    }

    let mut candidate = db.clone();
    candidate.family_shelf[position] = replacement.clone();
    if let Some(response) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return response;
    }
    let _ = state.tx.send(());
    Json(replacement).into_response()
}

pub(crate) async fn delete_shelf_item(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Response {
    let mut db = state.db.lock().await;
    let Some(position) = db.family_shelf.iter().position(|item| item.id == id) else {
        return err(StatusCode::NOT_FOUND, "Шаблон не найден");
    };

    let mut candidate = db.clone();
    candidate.family_shelf.remove(position);
    if let Some(response) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return response;
    }
    let _ = state.tx.send(());
    Json(serde_json::json!({ "ok": true })).into_response()
}
