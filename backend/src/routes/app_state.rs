//! Shared application state.
use crate::models::Db;
use crate::store::Store;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct AppState {
    pub(crate) db: Arc<Mutex<Db>>,
    pub(crate) store: Arc<dyn Store + Send + Sync>,
    pub(crate) tx: tokio::sync::broadcast::Sender<()>,
}
