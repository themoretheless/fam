//! Event reactions HTTP.
use crate::models::*;
use crate::routes::app_state::AppState;

use crate::routes::error::{commit_or_503, err};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;

pub(crate) async fn react_event(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<ReactReq>,
) -> Response {
    let allowed = ["🙏", "❤️", "🔥"];
    if !allowed.contains(&req.emoji.as_str()) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Некорректная реакция");
    }
    if !matches!(req.player_id.as_str(), "p1" | "p2") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Неизвестный игрок");
    }
    let mut db = state.db.lock().await;
    let mut candidate = db.clone();
    let Some(ev) = candidate.events.iter_mut().find(|e| e.id == id) else {
        return err(StatusCode::NOT_FOUND, "Событие не найдено");
    };
    if ev.kind != "done" {
        return err(StatusCode::CONFLICT, "Реакция только на выполненные дела");
    }
    if let Some(r) = ev
        .reactions
        .iter_mut()
        .find(|r| r.player_id == req.player_id)
    {
        r.emoji = req.emoji.clone();
    } else {
        ev.reactions.push(Reaction {
            player_id: req.player_id.clone(),
            emoji: req.emoji.clone(),
        });
    }
    let out = ev.clone();
    if let Some(r) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
        return r;
    }
    let _ = state.tx.send(());
    Json(out).into_response()
}
