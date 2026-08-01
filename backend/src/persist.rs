use crate::models::{default_db, Db, BACKUP_KEEP, DATA_FILE};

pub(crate) fn load_from(path: &std::path::Path) -> Db {
    match std::fs::read_to_string(path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(db) => db,
            Err(e) => {
                // Битый файл не затираем молча: откладываем копию и стартуем с чистого состояния.
                // fam-data.json → fam-data.json.corrupt
                let backup = {
                    let mut b = path.as_os_str().to_os_string();
                    b.push(".corrupt");
                    std::path::PathBuf::from(b)
                };
                let _ = std::fs::write(&backup, &s);
                eprintln!(
                    "{} не читается ({e}); копия сохранена в {}, начинаю с чистого состояния",
                    path.display(),
                    backup.display()
                );
                default_db()
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => default_db(),
        Err(e) => {
            eprintln!(
                "не удалось прочитать {}: {e}; начинаю с чистого состояния",
                path.display()
            );
            default_db()
        }
    }
}

pub(crate) fn data_path() -> std::path::PathBuf {
    std::env::var("FAM_DATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from(DATA_FILE))
}

pub(crate) fn load() -> Db {
    load_from(&data_path())
}

/// Сдвигает bak.N: bak.(KEEP-2)→bak.(KEEP-1), …, текущий файл → bak.0.
/// Ошибки ротации только логируем: важнее записать новое состояние.
pub(crate) fn rotate_backups(path: &std::path::Path) {
    if !path.exists() {
        return;
    }
    if BACKUP_KEEP == 0 {
        return;
    }
    let bak = |n: usize| {
        let mut p = path.as_os_str().to_os_string();
        p.push(format!(".bak.{n}"));
        std::path::PathBuf::from(p)
    };
    // Вытесняем самый старый слот.
    if BACKUP_KEEP >= 2 {
        let _ = std::fs::remove_file(bak(BACKUP_KEEP - 1));
        for n in (0..BACKUP_KEEP - 1).rev() {
            let from = bak(n);
            let to = bak(n + 1);
            if from.exists() {
                let _ = std::fs::rename(&from, &to);
            }
        }
    }
    let dest = bak(0);
    if let Err(e) = std::fs::copy(path, &dest) {
        eprintln!(
            "не удалось сделать бэкап {} → {}: {e}",
            path.display(),
            dest.display()
        );
    }
}

pub(crate) fn save_to(path: &std::path::Path, db: &Db) -> Result<(), String> {
    // compact JSON: меньше I/O; load() читает и pretty, и compact
    let json = serde_json::to_string(db).map_err(|e| format!("сериализация: {e}"))?;
    rotate_backups(path);
    let tmp = {
        let mut t = path.as_os_str().to_os_string();
        t.push(".tmp");
        std::path::PathBuf::from(t)
    };
    {
        use std::io::Write;
        let mut f =
            std::fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("write {}: {e}", tmp.display()))?;
        f.sync_all()
            .map_err(|e| format!("fsync {}: {e}", tmp.display()))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("rename → {}: {e}", path.display()))?;
    Ok(())
}

pub(crate) fn save(db: &Db) -> Result<(), String> {
    save_to(&data_path(), db)
}
