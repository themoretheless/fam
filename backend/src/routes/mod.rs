//! HTTP слой: маленькие независимые handlers.
mod app_state;
mod cors;
mod error;
mod events;
mod memorable_dates;
mod players;
mod shelf;
mod state;
mod tasks;

pub use app_state::AppState;

use axum::{http::StatusCode, response::Response};
use axum::{
    routing::{any, delete, get, patch, post, put},
    Router,
};
use tower_http::services::{ServeDir, ServeFile};

use cors::cors_layer;
use error::err;
use events::react_event;
use memorable_dates::{create_memorable_date, delete_memorable_date, replace_memorable_date};
use players::rename_player;
use shelf::{create_shelf_item, delete_shelf_item, replace_shelf_item};
use state::{get_state, sse_stream};
use tasks::{claim_task, create_task, delete_task};

pub(crate) async fn api_fallback() -> Response {
    err(StatusCode::NOT_FOUND, "Нет такого API-метода")
}

/// Собирает Router (разделяй и властвуй: handlers в отдельных файлах).
pub fn router(state: AppState) -> Router {
    let dist = std::env::var("FAM_STATIC")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../frontend/dist").to_string());
    let index = format!("{dist}/index.html");
    Router::new()
        .route("/api/state", get(get_state))
        .route("/api/stream", get(sse_stream))
        .route("/api/tasks", post(create_task))
        .route("/api/tasks/{id}/claim", post(claim_task))
        .route("/api/tasks/{id}", delete(delete_task))
        .route("/api/shelf", post(create_shelf_item))
        .route(
            "/api/shelf/{id}",
            put(replace_shelf_item).delete(delete_shelf_item),
        )
        .route("/api/memorable-dates", post(create_memorable_date))
        .route(
            "/api/memorable-dates/{id}",
            put(replace_memorable_date).delete(delete_memorable_date),
        )
        .route("/api/players/{id}", patch(rename_player))
        .route("/api/events/{id}/react", post(react_event))
        .route("/api/{*rest}", any(api_fallback))
        .with_state(state)
        .layer(cors_layer())
        .fallback_service(ServeDir::new(&dist).fallback(ServeFile::new(index)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::iso_week_key;
    use crate::models::{
        default_db, Db, Event, FamilyShelfItem, MemorableDate, MemorableDateKind, Task, TaskStatus,
        MAX_FAMILY_SHELF_ITEMS, MAX_MEMORABLE_DATES,
    };
    use crate::store::Store;
    use axum::body::{to_bytes, Body};
    use axum::http::{Method, Request};
    use chrono::{Duration, NaiveDate, Utc};
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::sync::{broadcast, Mutex};
    use tower::ServiceExt;
    use uuid::Uuid;

    struct SucceedingStore;

    impl Store for SucceedingStore {
        fn load(&self) -> Db {
            default_db()
        }

        fn save(&self, _db: &Db) -> Result<(), String> {
            Ok(())
        }
    }

    struct FailingStore;

    impl Store for FailingStore {
        fn load(&self) -> Db {
            default_db()
        }

        fn save(&self, _db: &Db) -> Result<(), String> {
            Err("injected failure".into())
        }
    }

    fn current_db() -> Db {
        let mut db = default_db();
        db.week_key = iso_week_key(Utc::now());
        db
    }

    fn open_task(id: Uuid) -> Task {
        let now = Utc::now();
        Task {
            id,
            title: "Проверить роутер".into(),
            emoji: "🧪".into(),
            base_points: 10,
            created_at: now,
            deadline: now + Duration::hours(1),
            status: TaskStatus::Open,
            claimed_by: None,
            awarded_points: None,
            finished_at: None,
            repeat_hours: None,
            interval_hours: None,
            fuse_hours: Some(1.0),
            appear_at: None,
        }
    }

    fn shelf_item(title: impl Into<String>) -> FamilyShelfItem {
        FamilyShelfItem {
            id: Uuid::new_v4(),
            title: title.into(),
            emoji: "📌".into(),
            base_points: 10,
            hours: 24.0,
            repeat: false,
            interval_hours: None,
        }
    }

    fn shelf_body(title: &str) -> Value {
        json!({
            "title": title,
            "emoji": "🧺",
            "base_points": 15,
            "hours": 6.0,
            "repeat": true,
            "interval_hours": 24.0
        })
    }

    fn memorable_date(
        title: impl Into<String>,
        date: &str,
        kind: MemorableDateKind,
    ) -> MemorableDate {
        MemorableDate {
            id: Uuid::new_v4(),
            title: title.into(),
            date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            kind,
        }
    }

    fn memorable_body(title: &str, date: &str, kind: &str) -> Value {
        json!({ "title": title, "date": date, "kind": kind })
    }

    fn app_with_store(
        initial: Db,
        store: Arc<dyn Store + Send + Sync>,
    ) -> (Router, Arc<Mutex<Db>>, broadcast::Receiver<()>) {
        let db = Arc::new(Mutex::new(initial));
        let (tx, rx) = broadcast::channel(8);
        let app = router(AppState {
            db: db.clone(),
            store,
            tx,
        });
        (app, db, rx)
    }

    fn json_request(method: Method, uri: &str, value: Value) -> Request<Body> {
        Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(value.to_string()))
            .unwrap()
    }

    async fn response_json(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    fn assert_one_update(events: &mut broadcast::Receiver<()>) {
        assert!(events.try_recv().is_ok());
        assert!(matches!(
            events.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test]
    async fn create_then_get_state_exposes_created_task() {
        let (app, _, _) = app_with_store(current_db(), Arc::new(SucceedingStore));
        let created_response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/tasks",
                json!({ "title": "Новая задача", "hours": 2.0 }),
            ))
            .await
            .unwrap();
        assert_eq!(created_response.status(), StatusCode::OK);
        let created = response_json(created_response).await;

        let state_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/state")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(state_response.status(), StatusCode::OK);
        let state = response_json(state_response).await;
        assert!(state["tasks"].as_array().unwrap().iter().any(|task| {
            task["id"] == created["id"] && task["title"] == "Новая задача"
        }));
    }

    #[tokio::test]
    async fn successful_claim_then_repeat_claim_is_conflict() {
        let task_id = Uuid::new_v4();
        let mut initial = current_db();
        initial.tasks.push(open_task(task_id));
        let (app, _, _) = app_with_store(initial, Arc::new(SucceedingStore));
        let claim = || {
            json_request(
                Method::POST,
                &format!("/api/tasks/{task_id}/claim"),
                json!({ "player_id": "p1" }),
            )
        };

        let first = app.clone().oneshot(claim()).await.unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let first_body = response_json(first).await;
        assert!(first_body["points"].as_i64().unwrap() > 0);

        let second = app.oneshot(claim()).await.unwrap();
        assert_eq!(second.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn family_shelf_crud_preserves_order_state_and_emits_once() {
        let (app, db, mut updates) = app_with_store(current_db(), Arc::new(SucceedingStore));

        let first_response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/shelf",
                json!({
                    "title": "  Полить цветы  ",
                    "emoji": "",
                    "base_points": 2_000,
                    "hours": 0,
                    "repeat": true
                }),
            ))
            .await
            .unwrap();
        assert_eq!(first_response.status(), StatusCode::CREATED);
        let first = response_json(first_response).await;
        assert_eq!(first["title"], "Полить цветы");
        assert_eq!(first["emoji"], "📌");
        assert_eq!(first["base_points"], 1_000);
        assert_eq!(first["hours"], 0.05);
        assert_eq!(first["repeat"], true);
        assert!(first["interval_hours"].is_null());
        assert_one_update(&mut updates);

        let second_response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/shelf",
                shelf_body("Второй"),
            ))
            .await
            .unwrap();
        assert_eq!(second_response.status(), StatusCode::CREATED);
        let second = response_json(second_response).await;
        assert_one_update(&mut updates);

        let first_id = first["id"].as_str().unwrap();
        let update_response = app
            .clone()
            .oneshot(json_request(
                Method::PUT,
                &format!("/api/shelf/{first_id}"),
                shelf_body("Первый обновлён"),
            ))
            .await
            .unwrap();
        assert_eq!(update_response.status(), StatusCode::OK);
        let updated = response_json(update_response).await;
        assert_eq!(updated["id"], first["id"]);
        assert_eq!(updated["title"], "Первый обновлён");
        assert_one_update(&mut updates);

        let state_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/state")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(state_response.status(), StatusCode::OK);
        let state = response_json(state_response).await;
        let shelf = state["family_shelf"].as_array().unwrap();
        assert_eq!(shelf.len(), 2);
        assert_eq!(shelf[0]["id"], second["id"]);
        assert_eq!(shelf[1]["id"], first["id"]);
        assert_eq!(shelf[1]["title"], "Первый обновлён");

        let delete_response = app
            .clone()
            .oneshot(json_request(
                Method::DELETE,
                &format!("/api/shelf/{first_id}"),
                json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(delete_response.status(), StatusCode::OK);
        assert_eq!(response_json(delete_response).await["ok"], true);
        assert_one_update(&mut updates);

        let stored = db.lock().await;
        assert_eq!(stored.family_shelf.len(), 1);
        assert_eq!(stored.family_shelf[0].id.to_string(), second["id"]);
        assert!(stored.events.is_empty());
    }

    #[tokio::test]
    async fn memorable_dates_crud_preserves_id_position_state_and_emits_once() {
        let (app, db, mut updates) = app_with_store(current_db(), Arc::new(SucceedingStore));

        let first_response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/memorable-dates",
                memorable_body("  День рождения Маши  ", "1990-11-12", "birthday"),
            ))
            .await
            .unwrap();
        assert_eq!(first_response.status(), StatusCode::CREATED);
        let first = response_json(first_response).await;
        assert_eq!(first["title"], "День рождения Маши");
        assert_eq!(first["date"], "1990-11-12");
        assert_eq!(first["kind"], "birthday");
        assert_one_update(&mut updates);

        // Одинаковые kind/date допустимы, если нормализованный title отличается.
        let second_response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/memorable-dates",
                memorable_body("День рождения Саши", "1990-11-12", "birthday"),
            ))
            .await
            .unwrap();
        assert_eq!(second_response.status(), StatusCode::CREATED);
        let second = response_json(second_response).await;
        assert_one_update(&mut updates);

        let first_id = first["id"].as_str().unwrap();
        let update_response = app
            .clone()
            .oneshot(json_request(
                Method::PUT,
                &format!("/api/memorable-dates/{first_id}"),
                memorable_body("Наша годовщина", "2020-07-01", "anniversary"),
            ))
            .await
            .unwrap();
        assert_eq!(update_response.status(), StatusCode::OK);
        let updated = response_json(update_response).await;
        assert_eq!(updated["id"], first["id"]);
        assert_eq!(updated["title"], "Наша годовщина");
        assert_one_update(&mut updates);

        let state_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/state")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(state_response.status(), StatusCode::OK);
        let state = response_json(state_response).await;
        let dates = state["memorable_dates"].as_array().unwrap();
        assert_eq!(dates.len(), 2);
        assert_eq!(dates[0]["id"], second["id"]);
        assert_eq!(dates[1]["id"], first["id"]);
        assert_eq!(dates[1]["title"], "Наша годовщина");

        let delete_response = app
            .clone()
            .oneshot(json_request(
                Method::DELETE,
                &format!("/api/memorable-dates/{first_id}"),
                json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(delete_response.status(), StatusCode::OK);
        assert_eq!(response_json(delete_response).await["ok"], true);
        assert_one_update(&mut updates);

        let stored = db.lock().await;
        assert_eq!(stored.memorable_dates.len(), 1);
        assert_eq!(stored.memorable_dates[0].id.to_string(), second["id"]);
        assert!(stored.events.is_empty());
    }

    async fn assert_rejected_without_save(
        initial: Db,
        method: Method,
        uri: String,
        body: Value,
        expected: StatusCode,
    ) {
        let before = serde_json::to_vec(&initial).unwrap();
        let (app, db, mut events) = app_with_store(initial, Arc::new(FailingStore));
        let response = app
            .clone()
            .oneshot(json_request(method, &uri, body))
            .await
            .unwrap();

        // FailingStore would turn an attempted save into 503.
        assert_eq!(response.status(), expected);
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
        assert!(response_json(response).await["error"].as_str().is_some());
        assert_eq!(serde_json::to_vec(&*db.lock().await).unwrap(), before);
        assert!(matches!(
            events.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test]
    async fn family_shelf_rejects_invalid_missing_duplicate_and_limit_without_save_or_sse() {
        assert_rejected_without_save(
            current_db(),
            Method::POST,
            "/api/shelf".into(),
            json!({ "title": "x".repeat(81) }),
            StatusCode::UNPROCESSABLE_ENTITY,
        )
        .await;

        let missing_id = Uuid::new_v4();
        assert_rejected_without_save(
            current_db(),
            Method::PUT,
            format!("/api/shelf/{missing_id}"),
            shelf_body("Нет такого"),
            StatusCode::NOT_FOUND,
        )
        .await;
        assert_rejected_without_save(
            current_db(),
            Method::DELETE,
            format!("/api/shelf/{missing_id}"),
            json!({}),
            StatusCode::NOT_FOUND,
        )
        .await;

        let mut duplicate_db = current_db();
        duplicate_db.family_shelf.push(FamilyShelfItem {
            id: Uuid::new_v4(),
            title: "Дубль".into(),
            emoji: "📌".into(),
            base_points: 1_000,
            hours: 0.05,
            repeat: true,
            interval_hours: None,
        });
        assert_rejected_without_save(
            duplicate_db,
            Method::POST,
            "/api/shelf".into(),
            json!({
                "title": "  Дубль  ",
                "emoji": "",
                "base_points": 2_000,
                "hours": 0,
                "repeat": true
            }),
            StatusCode::CONFLICT,
        )
        .await;

        let mut put_duplicate_db = current_db();
        let first = shelf_item("Первый");
        let second = shelf_item("Второй");
        let second_id = second.id;
        put_duplicate_db.family_shelf = vec![first, second];
        assert_rejected_without_save(
            put_duplicate_db,
            Method::PUT,
            format!("/api/shelf/{second_id}"),
            json!({
                "title": "Первый",
                "emoji": "📌",
                "base_points": 10,
                "hours": 24,
                "repeat": false,
                "interval_hours": 48
            }),
            StatusCode::CONFLICT,
        )
        .await;

        let mut full_db = current_db();
        full_db.family_shelf = (0..MAX_FAMILY_SHELF_ITEMS)
            .map(|index| shelf_item(format!("Шаблон {index}")))
            .collect();
        assert_rejected_without_save(
            full_db,
            Method::POST,
            "/api/shelf".into(),
            shelf_body("Лишний"),
            StatusCode::CONFLICT,
        )
        .await;
    }

    #[tokio::test]
    async fn memorable_dates_reject_invalid_missing_duplicate_and_limit_without_save_or_sse() {
        for body in [
            memorable_body("Дата", "2023-02-29", "custom"),
            memorable_body("Дата", "2026-2-01", "custom"),
            memorable_body("Дата", "2026-02-01", "holiday"),
            memorable_body(&"x".repeat(81), "2026-02-01", "custom"),
        ] {
            assert_rejected_without_save(
                current_db(),
                Method::POST,
                "/api/memorable-dates".into(),
                body,
                StatusCode::UNPROCESSABLE_ENTITY,
            )
            .await;
        }

        let missing_id = Uuid::new_v4();
        assert_rejected_without_save(
            current_db(),
            Method::PUT,
            format!("/api/memorable-dates/{missing_id}"),
            memorable_body("Нет такой", "2026-02-01", "custom"),
            StatusCode::NOT_FOUND,
        )
        .await;
        assert_rejected_without_save(
            current_db(),
            Method::DELETE,
            format!("/api/memorable-dates/{missing_id}"),
            json!({}),
            StatusCode::NOT_FOUND,
        )
        .await;

        let mut duplicate_db = current_db();
        duplicate_db.memorable_dates.push(memorable_date(
            "Дубль",
            "2020-07-01",
            MemorableDateKind::Anniversary,
        ));
        assert_rejected_without_save(
            duplicate_db,
            Method::POST,
            "/api/memorable-dates".into(),
            memorable_body("  Дубль  ", "2020-07-01", "anniversary"),
            StatusCode::CONFLICT,
        )
        .await;

        let mut put_duplicate_db = current_db();
        let first = memorable_date("Первая", "2020-07-01", MemorableDateKind::Meeting);
        let second = memorable_date("Вторая", "1990-11-12", MemorableDateKind::Birthday);
        let second_id = second.id;
        put_duplicate_db.memorable_dates = vec![first, second];
        assert_rejected_without_save(
            put_duplicate_db,
            Method::PUT,
            format!("/api/memorable-dates/{second_id}"),
            memorable_body("Первая", "2020-07-01", "meeting"),
            StatusCode::CONFLICT,
        )
        .await;

        let mut full_db = current_db();
        full_db.memorable_dates = (0..MAX_MEMORABLE_DATES)
            .map(|index| {
                memorable_date(
                    format!("Дата {index}"),
                    "2020-07-01",
                    MemorableDateKind::Custom,
                )
            })
            .collect();
        assert_rejected_without_save(
            full_db,
            Method::POST,
            "/api/memorable-dates".into(),
            memorable_body("Лишняя", "2026-02-01", "custom"),
            StatusCode::CONFLICT,
        )
        .await;
    }

    async fn assert_failed_mutation(initial: Db, method: Method, uri: String, body: Value) {
        let before = serde_json::to_vec(&initial).unwrap();
        let (app, db, mut events) = app_with_store(initial, Arc::new(FailingStore));

        let response = app
            .clone()
            .oneshot(json_request(method, &uri, body))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(serde_json::to_vec(&*db.lock().await).unwrap(), before);
        assert!(matches!(
            events.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test]
    async fn failed_store_keeps_db_and_emits_no_sse_for_every_mutation_route() {
        assert_failed_mutation(
            current_db(),
            Method::POST,
            "/api/tasks".into(),
            json!({ "title": "Не сохранится" }),
        )
        .await;

        let task_id = Uuid::new_v4();
        let mut claim_db = current_db();
        claim_db.tasks.push(open_task(task_id));
        assert_failed_mutation(
            claim_db,
            Method::POST,
            format!("/api/tasks/{task_id}/claim"),
            json!({ "player_id": "p1" }),
        )
        .await;

        let task_id = Uuid::new_v4();
        let mut delete_db = current_db();
        delete_db.tasks.push(open_task(task_id));
        assert_failed_mutation(
            delete_db,
            Method::DELETE,
            format!("/api/tasks/{task_id}"),
            json!({}),
        )
        .await;

        assert_failed_mutation(
            current_db(),
            Method::PATCH,
            "/api/players/p1".into(),
            json!({ "name": "Новое имя" }),
        )
        .await;

        let event_id = Uuid::new_v4();
        let mut react_db = current_db();
        react_db.events.push_back(Event {
            id: event_id,
            kind: "done".into(),
            text: "Готово".into(),
            at: Utc::now(),
            reactions: vec![],
        });
        assert_failed_mutation(
            react_db,
            Method::POST,
            format!("/api/events/{event_id}/react"),
            json!({ "player_id": "p2", "emoji": "❤️" }),
        )
        .await;

        assert_failed_mutation(
            current_db(),
            Method::POST,
            "/api/shelf".into(),
            shelf_body("Не сохранится на полку"),
        )
        .await;

        let mut replace_shelf_db = current_db();
        let replace_item = shelf_item("До изменения");
        let replace_id = replace_item.id;
        replace_shelf_db.family_shelf.push(replace_item);
        assert_failed_mutation(
            replace_shelf_db,
            Method::PUT,
            format!("/api/shelf/{replace_id}"),
            shelf_body("После изменения"),
        )
        .await;

        let mut delete_shelf_db = current_db();
        let delete_item = shelf_item("Не удалится");
        let delete_id = delete_item.id;
        delete_shelf_db.family_shelf.push(delete_item);
        assert_failed_mutation(
            delete_shelf_db,
            Method::DELETE,
            format!("/api/shelf/{delete_id}"),
            json!({}),
        )
        .await;

        assert_failed_mutation(
            current_db(),
            Method::POST,
            "/api/memorable-dates".into(),
            memorable_body("Не сохранится", "2020-07-01", "custom"),
        )
        .await;

        let mut replace_date_db = current_db();
        let replace_date =
            memorable_date("До изменения", "2020-07-01", MemorableDateKind::Anniversary);
        let replace_date_id = replace_date.id;
        replace_date_db.memorable_dates.push(replace_date);
        assert_failed_mutation(
            replace_date_db,
            Method::PUT,
            format!("/api/memorable-dates/{replace_date_id}"),
            memorable_body("После изменения", "2021-07-01", "anniversary"),
        )
        .await;

        let mut delete_date_db = current_db();
        let delete_date = memorable_date("Не удалится", "1990-11-12", MemorableDateKind::Birthday);
        let delete_date_id = delete_date.id;
        delete_date_db.memorable_dates.push(delete_date);
        assert_failed_mutation(
            delete_date_db,
            Method::DELETE,
            format!("/api/memorable-dates/{delete_date_id}"),
            json!({}),
        )
        .await;
    }
}
