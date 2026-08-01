//! Недельные сезоны.
use crate::domain::achievements::award;
use crate::domain::events::push_event;
use crate::models::*;
use chrono::{DateTime, Datelike, Utc};

pub(crate) fn iso_week_key(now: DateTime<Utc>) -> String {
    let w = now.iso_week();
    format!("{}-W{:02}", w.year(), w.week())
}

/// Закрывает прошедшую неделю: снимок счёта в seasons, сброс score (xp не трогаем).
/// Возвращает true, если состояние изменилось (нужен save).
pub(crate) fn check_week_rollover(db: &mut Db, now: DateTime<Utc>) -> bool {
    let current = iso_week_key(now);
    if db.week_key == current {
        return false;
    }
    if db.week_key.is_empty() {
        // Первый запуск с этой фичей: инициализируем молча, без снимка и события.
        db.week_key = current;
        return true;
    }
    let score_of = |id: &str| {
        db.players
            .iter()
            .find(|p| p.id == id)
            .map(|p| p.score)
            .unwrap_or(0)
    };
    let (p1s, p2s) = (score_of("p1"), score_of("p2"));
    let winner = if p1s > p2s {
        Some("p1".to_string())
    } else if p2s > p1s {
        Some("p2".to_string())
    } else {
        None
    };
    let closed = db.week_key.clone();
    db.seasons.push(SeasonResult {
        week_key: closed.clone(),
        p1_score: p1s,
        p2_score: p2s,
        winner: winner.clone(),
    });
    let text = match &winner {
        Some(id) => {
            let name = db
                .players
                .iter()
                .find(|p| p.id == *id)
                .map(|p| p.name.clone())
                .unwrap_or_default();
            format!("🏁 Неделя закрыта: 👑 {name} выигрывает сезон {closed}!")
        }
        None => format!("🏁 Неделя закрыта: ничья в сезоне {closed}!"),
    };
    push_event(db, "season", text, now);
    if let Some(pid) = &winner {
        let _ = award(db, pid, "week_winner", "Чемпион недели", "👑", now);
    }
    // Идеальная неделя: 0 сгораний и был хотя бы один клейм.
    if db.week_burns == 0 && db.week_claims > 0 {
        let ids: Vec<String> = db.players.iter().map(|p| p.id.clone()).collect();
        for pid in ids {
            let _ = award(db, &pid, "zero_fires", "Ноль пожаров", "🛡️", now);
        }
        push_event(
            db,
            "achievement",
            format!("🛡️ Идеальная неделя {closed}: ни одного пожара!"),
            now,
        );
    }
    for p in db.players.iter_mut() {
        p.score = 0; // xp не трогаем
    }
    db.week_key = current;
    db.week_burns = 0;
    db.week_claims = 0;
    true
}
