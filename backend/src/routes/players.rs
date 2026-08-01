//! Player HTTP handlers.
use crate::domain::sanitize_text;
use crate::models::*;
use crate::routes::app_state::AppState;

use crate::routes::error::{commit_or_503, err};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

pub(crate) async fn rename_player(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<RenameReq>,
) -> Response {
    let name = sanitize_text(&req.name, 24);
    if name.is_empty() || name.chars().count() > 24 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Имя должно быть от 1 до 24 символов",
        );
    }
    let mut db = state.db.lock().await;
    let mut candidate = db.clone();
    let Some(p) = candidate.players.iter_mut().find(|p| p.id == id) else {
        return err(StatusCode::NOT_FOUND, "Игрок не найден");
    };
    p.name = name;
    if let Some(r) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return r;
    }
    let _ = state.tx.send(());
    Json(serde_json::json!({ "players": db.players.clone() })).into_response()
}
