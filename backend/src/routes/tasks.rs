//! Task HTTP handlers (thin: map request → domain → persist).
use crate::domain::{apply_claim, create_open_task, sweep, ClaimError};
use crate::models::*;
use crate::routes::app_state::AppState;
use crate::routes::error::{commit_or_503, err, task_template_err};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use uuid::Uuid;

pub(crate) async fn create_task(
    State(state): State<AppState>,
    Json(req): Json<NewTask>,
) -> Response {
    let now = Utc::now();
    let mut db = state.db.lock().await;
    let mut candidate = db.clone();
    match create_open_task(&mut candidate, req.into(), now) {
        Ok(task) => {
            if let Some(r) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
                return r;
            }
            let _ = state.tx.send(());
            Json(task).into_response()
        }
        Err(error) => task_template_err(error),
    }
}

pub(crate) async fn claim_task(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<ClaimReq>,
) -> Response {
    let now = Utc::now();
    let mut db = state.db.lock().await;
    let mut candidate = db.clone();
    let swept = sweep(&mut candidate, now);
    match apply_claim(&mut candidate, id, &req.player_id, now) {
        Ok(ok) => {
            if let Some(r) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
                return r;
            }
            let _ = state.tx.send(());
            Json(serde_json::json!({
                "points": ok.total_award,
                "task_points": ok.awarded,
                "comeback": ok.comeback,
                "players": db.players.clone(),
                "combo_count": ok.combo_count,
                "combo_mult": ok.combo_mult,
                "new_achievements": ok.new_achievements,
            }))
            .into_response()
        }
        Err(error) => {
            if swept {
                if let Some(r) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
                    return r;
                }
                let _ = state.tx.send(());
            }
            match error {
                ClaimError::UnknownPlayer => {
                    err(StatusCode::UNPROCESSABLE_ENTITY, "Неизвестный игрок")
                }
                ClaimError::NotFound => err(StatusCode::NOT_FOUND, "Дело не найдено"),
                ClaimError::Burned => err(StatusCode::CONFLICT, "Поздно: дело уже сгорело"),
                ClaimError::Taken => err(StatusCode::CONFLICT, "Дело уже разобрано"),
            }
        }
    }
}

pub(crate) async fn delete_task(State(state): State<AppState>, Path(id): Path<Uuid>) -> Response {
    let mut db = state.db.lock().await;
    let mut candidate = db.clone();
    let before = candidate.tasks.len();
    candidate
        .tasks
        .retain(|t| !(t.id == id && t.status == TaskStatus::Open));
    if candidate.tasks.len() == before {
        return err(StatusCode::NOT_FOUND, "Дело не найдено");
    }
    if let Some(r) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return r;
    }
    let _ = state.tx.send(());
    Json(serde_json::json!({ "ok": true })).into_response()
}
