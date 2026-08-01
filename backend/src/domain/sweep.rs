//! Sweep: burn + schedule + spawn_due.
use crate::domain::events::push_event;
use crate::domain::lifecycle::{schedule_respawn, spawn_due};
use crate::domain::seasons::{check_week_rollover, iso_week_key};
use crate::domain::text::{format_wait_label, points_word};
use crate::models::*;
use chrono::{DateTime, Utc};

/// Сжигает просроченные Open-дела, выбранные предикатом недели.
///
/// `finished_at` хранит логический момент сгорания (deadline), а события и новый
/// интервал повтора начинаются в момент наблюдения `now`. Так поздний sweep не
/// создаёт каскад пропущенных повторов.
fn burn_expired(db: &mut Db, now: DateTime<Utc>, belongs_to_phase: impl Fn(&Task) -> bool) -> bool {
    let mut burned = vec![];
    let mut scheduled = vec![];
    for task in &mut db.tasks {
        if task.status != TaskStatus::Open || task.deadline > now || !belongs_to_phase(task) {
            continue;
        }
        task.status = TaskStatus::Burned;
        task.finished_at = Some(task.deadline);
        burned.push((task.title.clone(), (task.base_points + 1) / 2));
        if let Some(fresh) = schedule_respawn(task, now) {
            scheduled.push(fresh);
        }
    }

    if burned.is_empty() {
        return false;
    }
    db.week_burns = db.week_burns.saturating_add(burned.len() as u32);
    for (title, penalty) in burned {
        for player in &mut db.players {
            // score не уходит в минус; xp не трогаем
            player.score = (player.score - penalty).max(0);
        }
        push_event(
            db,
            "burn",
            format!(
                "🔥 «{title}» сгорело: -{penalty} {} обоим",
                points_word(penalty)
            ),
            now,
        );
    }
    for fresh in scheduled {
        let when = fresh
            .appear_at
            .map(|at| format_wait_label(now, at))
            .unwrap_or_else(|| "скоро".into());
        push_event(
            db,
            "repeat",
            format!("🔁 «{}» вернётся {when}", fresh.title),
            now,
        );
        db.tasks.push(fresh);
    }
    true
}

/// Помечает просроченные открытые дела сгоревшими и штрафует ОБОИХ игроков
/// на половину базовой цены (округление вверх). Возвращает true, если что-то изменилось.
pub(crate) fn sweep(db: &mut Db, now: DateTime<Utc>) -> bool {
    let current_week = iso_week_key(now);
    let crosses_week = !db.week_key.is_empty() && db.week_key != current_week;

    // При ленивом rollover сначала относим все дедлайны прошлых ISO-недель к
    // последнему открытому сезону. Текущая схема хранит только один активный
    // агрегат, поэтому фиктивные промежуточные сезоны не восстанавливаем.
    let burned_before_rollover = if crosses_week {
        burn_expired(db, now, |task| iso_week_key(task.deadline) != current_week)
    } else {
        false
    };

    let rolled = check_week_rollover(db, now);

    let burned_after_rollover = if crosses_week {
        burn_expired(db, now, |task| iso_week_key(task.deadline) == current_week)
    } else {
        // Обычный sweep и первая инициализация должны сжечь любую просрочку,
        // включая данные старой схемы с пустым week_key.
        burn_expired(db, now, |_| true)
    };
    let spawned = spawn_due(db, now) > 0;

    burned_before_rollover | rolled | burned_after_rollover | spawned
}
