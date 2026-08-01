use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use uuid::Uuid;

/// Ценность дела растёт линейно от x1.0 в момент создания до x3.0 у дедлайна.
pub const MAX_MULTIPLIER: f64 = 3.0;
pub const DATA_FILE: &str = "fam-data.json";
pub const MAX_EVENTS: usize = 30;
/// Пользовательские шаблоны общей семейной полки.
pub const MAX_FAMILY_SHELF_ITEMS: usize = 50;
/// Общие ежегодные памятные даты семьи.
pub const MAX_MEMORABLE_DATES: usize = 100;
/// Сколько ротируемых копий `*.bak.N` хранить рядом с файлом данных.
pub const BACKUP_KEEP: usize = 5;

#[derive(Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: String,
    pub name: String,
    pub avatar: String,
    pub score: i64,
    /// Очки за всю историю: растут вместе со score, но не сбрасываются по неделям.
    #[serde(default)]
    pub xp: i64,
    /// Последний успешный клейм (для камбэк-бонуса).
    #[serde(default, with = "chrono::serde::ts_milliseconds_option")]
    pub last_claim_at: Option<DateTime<Utc>>,
    /// ISO-неделя, в которой уже выдали камбэк +5 (пустая = ещё не выдавали).
    #[serde(default)]
    pub comeback_week_key: String,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Open,
    Done,
    Burned,
    /// Ждёт interval: появится в Open при appear_at.
    Scheduled,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: Uuid,
    pub title: String,
    pub emoji: String,
    pub base_points: i64,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub deadline: DateTime<Utc>,
    pub status: TaskStatus,
    pub claimed_by: Option<String>,
    pub awarded_points: Option<i64>,
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    pub finished_at: Option<DateTime<Utc>>,
    /// Some(h) = повторяющееся дело: legacy / fallback интервал (часы).
    #[serde(default)]
    pub repeat_hours: Option<f64>,
    /// Интервал появления (часы), если отличается от фитиля. None = как repeat_hours.
    #[serde(default)]
    pub interval_hours: Option<f64>,
    /// Длительность Open-фитиля (часы). None = вывести из deadline-created.
    #[serde(default)]
    pub fuse_hours: Option<f64>,
    /// Когда Scheduled-дело станет Open (мс UTC).
    #[serde(default, with = "chrono::serde::ts_milliseconds_option")]
    pub appear_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Reaction {
    pub player_id: String,
    pub emoji: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Event {
    // default нужен, чтобы файлы данных старого формата (без id) продолжали читаться
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub kind: String,
    pub text: String,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub at: DateTime<Utc>,
    #[serde(default)]
    pub reactions: Vec<Reaction>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SeasonResult {
    pub week_key: String,
    pub p1_score: i64,
    pub p2_score: i64,
    pub winner: Option<String>,
}

/// Ачивка: выдаётся сервером, каждый key не более одного раза на игрока.
#[derive(Clone, Serialize, Deserialize)]
pub struct Achievement {
    pub id: Uuid,
    pub player_id: String,
    pub key: String,
    pub title: String,
    pub emoji: String,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub at: DateTime<Utc>,
}

/// Общий для всех LAN-клиентов шаблон дела.
///
/// `hours` — фитиль будущего Open-дела. Для повтора `interval_hours = None`
/// означает автоматический интервал, равный фитилю; `Some` — явный интервал.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FamilyShelfItem {
    pub id: Uuid,
    pub title: String,
    pub emoji: String,
    pub base_points: i64,
    pub hours: f64,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default)]
    pub interval_hours: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemorableDateKind {
    Anniversary,
    Meeting,
    Birthday,
    Custom,
}

/// Ежегодная памятная дата без времени и часового пояса.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemorableDate {
    pub id: Uuid,
    pub title: String,
    pub date: NaiveDate,
    pub kind: MemorableDateKind,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Db {
    pub players: Vec<Player>,
    pub tasks: Vec<Task>,
    pub events: VecDeque<Event>,
    // Пустая строка = "не инициализировано": первый sweep выставит текущую неделю молча.
    #[serde(default)]
    pub week_key: String,
    #[serde(default)]
    pub seasons: Vec<SeasonResult>,
    #[serde(default)]
    pub achievements: Vec<Achievement>,
    /// Сгорания в текущей ISO-неделе (для ачивки «Ноль пожаров»).
    #[serde(default)]
    pub week_burns: u32,
    /// Клеймы в текущей ISO-неделе (минимум активности для zero fires).
    #[serde(default)]
    pub week_claims: u32,
    /// Общая полка пользовательских шаблонов; порядок Vec = порядок в UI.
    #[serde(default)]
    pub family_shelf: Vec<FamilyShelfItem>,
    /// Общий ежегодный календарь; порядок Vec = стабильный порядок в UI.
    #[serde(default)]
    pub memorable_dates: Vec<MemorableDate>,
}

#[derive(Deserialize)]
pub struct NewTask {
    pub title: String,
    pub emoji: Option<String>,
    pub base_points: Option<i64>,
    pub hours: Option<f64>,
    pub repeat: Option<bool>,
    /// Интервал повтора (часы); если нет - = hours (фитиль).
    pub interval_hours: Option<f64>,
}

#[derive(Deserialize)]
pub struct ClaimReq {
    pub player_id: String,
}

#[derive(Deserialize)]
pub struct RenameReq {
    pub name: String,
}

#[derive(Deserialize)]
pub struct ReactReq {
    pub player_id: String,
    pub emoji: String,
}

#[derive(Deserialize)]
pub struct MemorableDateReq {
    pub title: String,
    /// Строго YYYY-MM-DD; строка нужна для собственного validation error.
    pub date: String,
    /// anniversary | meeting | birthday | custom.
    pub kind: String,
}

#[derive(Serialize)]
pub struct StateResponse {
    pub players: Vec<Player>,
    pub tasks: Vec<Task>,
    pub events: Vec<Event>,
    pub week_key: String,
    /// Последние 8 закрытых недель, новые первыми.
    pub seasons: Vec<SeasonResult>,
    pub achievements: Vec<Achievement>,
    /// Закрытые дела (Done/Burned) для панели статистики: новые первыми, максимум 200.
    pub history: Vec<Task>,
    pub family_shelf: Vec<FamilyShelfItem>,
    pub memorable_dates: Vec<MemorableDate>,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub server_now: DateTime<Utc>,
}

pub fn default_db() -> Db {
    Db {
        players: vec![
            Player {
                id: "p1".into(),
                name: "Игрок 1".into(),
                avatar: "🦊".into(),
                score: 0,
                xp: 0,
                last_claim_at: None,
                comeback_week_key: String::new(),
            },
            Player {
                id: "p2".into(),
                name: "Игрок 2".into(),
                avatar: "🐻‍❄️".into(),
                score: 0,
                xp: 0,
                last_claim_at: None,
                comeback_week_key: String::new(),
            },
        ],
        tasks: vec![],
        events: VecDeque::new(),
        week_key: String::new(),
        seasons: vec![],
        achievements: vec![],
        week_burns: 0,
        week_claims: 0,
        family_shelf: vec![],
        memorable_dates: vec![],
    }
}
