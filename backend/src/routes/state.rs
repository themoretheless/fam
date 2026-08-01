//! GET state + SSE.
use crate::domain::{state_response, sweep};
use crate::routes::app_state::AppState;
use crate::routes::error::commit_or_503;
use axum::{
    extract::State,
    response::{
        sse::{Event as SseEvent, KeepAlive, Sse},
        IntoResponse, Response,
    },
    Json,
};
use chrono::Utc;
use futures::stream::Stream;
use tokio_stream::{wrappers::BroadcastStream, StreamExt as _};

pub(crate) async fn get_state(State(state): State<AppState>) -> Response {
    let mut db = state.db.lock().await;
    let mut candidate = db.clone();
    if sweep(&mut candidate, Utc::now()) {
        if let Some(response) = commit_or_503(state.store.as_ref(), &mut db, candidate) {
            return response;
        }
        let _ = state.tx.send(());
    }
    Json(state_response(&db)).into_response()
}

pub(crate) async fn sse_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<SseEvent, std::convert::Infallible>>> {
    let rx = state.tx.subscribe();
    let stream = BroadcastStream::new(rx)
        // Lagged тоже превращаем в "update": любой сигнал просто триггерит refresh.
        .map(|_msg| Ok(SseEvent::default().data("update")));
    Sse::new(stream).keep_alive(KeepAlive::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{default_db, Db, Task, TaskStatus};
    use crate::store::Store;
    use axum::http::StatusCode;
    use chrono::Duration;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use uuid::Uuid;

    struct FailingStore;

    impl Store for FailingStore {
        fn load(&self) -> Db {
            default_db()
        }

        fn save(&self, _db: &Db) -> Result<(), String> {
            Err("injected failure".into())
        }
    }

    #[tokio::test]
    async fn failed_cross_week_sweep_save_returns_503_without_state_or_sse() {
        let now = Utc::now();
        let mut initial = default_db();
        initial.week_key = crate::domain::iso_week_key(now - Duration::days(7));
        initial.tasks.push(Task {
            id: Uuid::new_v4(),
            title: "Просрочено".into(),
            emoji: "🔥".into(),
            base_points: 10,
            created_at: now - Duration::days(8) - Duration::hours(1),
            deadline: now - Duration::days(8),
            status: TaskStatus::Open,
            claimed_by: None,
            awarded_points: None,
            finished_at: None,
            repeat_hours: None,
            interval_hours: None,
            fuse_hours: None,
            appear_at: None,
        });
        let before = serde_json::to_vec(&initial).unwrap();
        let db = Arc::new(Mutex::new(initial));
        let (tx, mut updates) = tokio::sync::broadcast::channel(4);
        let state = AppState {
            db: db.clone(),
            store: Arc::new(FailingStore),
            tx: tx.clone(),
        };

        let response = get_state(State(state)).await;

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(serde_json::to_vec(&*db.lock().await).unwrap(), before);
        assert!(matches!(
            updates.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
    }
}
