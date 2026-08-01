mod domain;
mod models;
mod persist;
mod routes;
mod store;

use routes::{router, AppState};
use std::sync::Arc;
use store::{default_store, Store};
use tokio::sync::Mutex;

#[tokio::main]
async fn main() {
    let (tx, _) = tokio::sync::broadcast::channel::<()>(64);
    // D: загрузка через trait Store, не напрямую из путей в main.
    let store: Arc<dyn Store + Send + Sync> = Arc::new(default_store());
    let state = AppState {
        db: Arc::new(Mutex::new(store.load())),
        store,
        tx,
    };
    let app = router(state);
    let bind = std::env::var("FAM_BIND").unwrap_or_else(|_| "0.0.0.0:7878".into());
    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|e| panic!("не удалось слушать {bind}: {e}"));
    println!("fam backend: http://{bind}");
    println!("fam data: {}", persist::data_path().display());
    axum::serve(listener, app).await.unwrap();
}
