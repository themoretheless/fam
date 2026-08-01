//! Dependency Inversion: domain/routes зависят от абстракции хранения, не от деталей FS.
use crate::models::Db;
use crate::persist;

/// Контракт персистентности (D в SOLID).
pub(crate) trait Store: Send + Sync {
    fn load(&self) -> Db;
    fn save(&self, db: &Db) -> Result<(), String>;
}

/// Реализация Store поверх JSON-файла.
pub(crate) struct FileStore;

impl Store for FileStore {
    fn load(&self) -> Db {
        persist::load()
    }

    fn save(&self, db: &Db) -> Result<(), String> {
        persist::save(db)
    }
}

/// Дефолтный store для production.
pub(crate) fn default_store() -> FileStore {
    FileStore
}
