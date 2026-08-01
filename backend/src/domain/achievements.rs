//! Ачивки: award + table-driven claim rules (OCP).
use crate::domain::events::push_event;
use crate::models::*;
use chrono::{DateTime, Duration, Timelike, Utc};
use uuid::Uuid;

/// Выдаёт ачивку, если у игрока её ещё нет. Возвращает Some(Achievement) при новой выдаче.
pub(crate) fn award(
    db: &mut Db,
    player_id: &str,
    key: &str,
    title: &str,
    emoji: &str,
    now: DateTime<Utc>,
) -> Option<Achievement> {
    if db
        .achievements
        .iter()
        .any(|a| a.player_id == player_id && a.key == key)
    {
        return None;
    }
    let name = db
        .players
        .iter()
        .find(|p| p.id == player_id)
        .map(|p| p.name.clone())
        .unwrap_or_default();
    push_event(
        db,
        "achievement",
        format!("🏅 {name} получает ачивку: {emoji} «{title}»"),
        now,
    );
    let a = Achievement {
        id: Uuid::new_v4(),
        player_id: player_id.to_string(),
        key: key.to_string(),
        title: title.to_string(),
        emoji: emoji.to_string(),
        at: now,
    };
    db.achievements.push(a.clone());
    Some(a)
}

/// Контекст клейма для Open/Closed: новые ачивки = новые правила в таблице, без правок if-лестницы.
struct ClaimAchCtx {
    done: usize,
    done_today: usize,
    xp: i64,
    task_deadline: DateTime<Utc>,
    now: DateTime<Utc>,
    combo_mult: f64,
}

enum ClaimAchCond {
    DoneAtLeast(usize),
    DoneTodayAtLeast(usize),
    XpAtLeast(i64),
    Firefighter,
    NightOwl,
    ComboAtLeast(f64),
}

struct ClaimAchRule {
    key: &'static str,
    title: &'static str,
    emoji: &'static str,
    cond: ClaimAchCond,
}

/// Open/Closed: добавлять ачивки сюда, не раздувая check_claim_achievements.
const CLAIM_ACH_RULES: &[ClaimAchRule] = &[
    ClaimAchRule {
        key: "first_task",
        title: "Первое дело",
        emoji: "🎉",
        cond: ClaimAchCond::DoneAtLeast(1),
    },
    ClaimAchRule {
        key: "ten_tasks",
        title: "Десяточка",
        emoji: "🔟",
        cond: ClaimAchCond::DoneAtLeast(10),
    },
    ClaimAchRule {
        key: "hundred_xp",
        title: "Сотня",
        emoji: "💯",
        cond: ClaimAchCond::XpAtLeast(100),
    },
    ClaimAchRule {
        key: "five_hundred_xp",
        title: "Пятисотка",
        emoji: "🚀",
        cond: ClaimAchCond::XpAtLeast(500),
    },
    ClaimAchRule {
        key: "five_a_day",
        title: "Пятидневка",
        emoji: "🖐️",
        cond: ClaimAchCond::DoneTodayAtLeast(5),
    },
    ClaimAchRule {
        key: "firefighter",
        title: "Пожарный",
        emoji: "🚒",
        cond: ClaimAchCond::Firefighter,
    },
    ClaimAchRule {
        key: "night_owl",
        title: "Сова",
        emoji: "🦉",
        cond: ClaimAchCond::NightOwl,
    },
    ClaimAchRule {
        key: "combo_master",
        title: "Комбо-мастер",
        emoji: "⚡",
        cond: ClaimAchCond::ComboAtLeast(1.5),
    },
];

fn claim_cond_met(cond: &ClaimAchCond, ctx: &ClaimAchCtx) -> bool {
    match cond {
        ClaimAchCond::DoneAtLeast(n) => ctx.done >= *n,
        ClaimAchCond::DoneTodayAtLeast(n) => ctx.done_today >= *n,
        ClaimAchCond::XpAtLeast(n) => ctx.xp >= *n,
        // Клейм проходит только при deadline >= now, разница неотрицательна.
        ClaimAchCond::Firefighter => ctx.task_deadline - ctx.now < Duration::seconds(60),
        // 00:00-05:00 UTC; ровно 05:00:00 уже не считается.
        ClaimAchCond::NightOwl => ctx.now.hour() < 5,
        ClaimAchCond::ComboAtLeast(m) => ctx.combo_mult >= *m,
    }
}

/// Проверяет все ачивки после успешного клейма: дело уже Done, очки и xp начислены.
pub(crate) fn check_claim_achievements(
    db: &mut Db,
    player_id: &str,
    now: DateTime<Utc>,
    task_deadline: DateTime<Utc>,
    combo_mult: f64,
) -> Vec<Achievement> {
    let done = db
        .tasks
        .iter()
        .filter(|t| {
            matches!(t.status, TaskStatus::Done) && t.claimed_by.as_deref() == Some(player_id)
        })
        .count();
    let done_today = db
        .tasks
        .iter()
        .filter(|t| {
            matches!(t.status, TaskStatus::Done)
                && t.claimed_by.as_deref() == Some(player_id)
                && t.finished_at
                    .is_some_and(|f| f.date_naive() == now.date_naive())
        })
        .count();
    let xp = db
        .players
        .iter()
        .find(|p| p.id == player_id)
        .map(|p| p.xp)
        .unwrap_or(0);
    let ctx = ClaimAchCtx {
        done,
        done_today,
        xp,
        task_deadline,
        now,
        combo_mult,
    };
    let mut out = vec![];
    for rule in CLAIM_ACH_RULES {
        if claim_cond_met(&rule.cond, &ctx) {
            if let Some(a) = award(db, player_id, rule.key, rule.title, rule.emoji, now) {
                out.push(a);
            }
        }
    }
    out
}
