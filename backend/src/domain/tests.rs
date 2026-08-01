//! Unit-тесты domain (отдельно от production-кода).
use super::*;
use crate::models::*;
use crate::persist::{load_from, save_to};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use std::path::PathBuf;
use uuid::Uuid;

fn t0() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-03-15T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc)
}

fn sample_task(base: i64, created: DateTime<Utc>, deadline: DateTime<Utc>) -> Task {
    Task {
        id: Uuid::new_v4(),
        title: "Тест".into(),
        emoji: "📌".into(),
        base_points: base,
        created_at: created,
        deadline,
        status: TaskStatus::Open,
        claimed_by: None,
        awarded_points: None,
        finished_at: None,
        repeat_hours: None,
        interval_hours: None,
        fuse_hours: None,
        appear_at: None,
    }
}

fn done_task(player: &str, finished: DateTime<Utc>) -> Task {
    let mut t = sample_task(
        10,
        finished - Duration::hours(1),
        finished + Duration::hours(1),
    );
    t.status = TaskStatus::Done;
    t.claimed_by = Some(player.into());
    t.finished_at = Some(finished);
    t
}

fn sample_shelf_item(title: &str) -> FamilyShelfItem {
    FamilyShelfItem {
        id: Uuid::new_v4(),
        title: title.into(),
        emoji: "📌".into(),
        base_points: 10,
        hours: 24.0,
        repeat: true,
        interval_hours: None,
    }
}

fn sample_memorable_date(title: &str, date: &str, kind: MemorableDateKind) -> MemorableDate {
    MemorableDate {
        id: Uuid::new_v4(),
        title: title.into(),
        date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
        kind,
    }
}

#[test]
fn current_points_at_created_is_base() {
    let created = t0();
    let task = sample_task(20, created, created + Duration::hours(10));
    assert_eq!(current_points(&task, created), 20);
}

#[test]
fn current_points_at_deadline_is_triple() {
    let created = t0();
    let deadline = created + Duration::hours(10);
    let task = sample_task(20, created, deadline);
    assert_eq!(current_points(&task, deadline), 60);
}

#[test]
fn current_points_midpoint_linear() {
    let created = t0();
    let deadline = created + Duration::hours(10);
    let mid = created + Duration::hours(5);
    let task = sample_task(20, created, deadline);
    // mult = 1 + 2 * 0.5 = 2.0 → 40
    assert_eq!(current_points(&task, mid), 40);
}

#[test]
fn current_points_after_deadline_clamps() {
    let created = t0();
    let deadline = created + Duration::hours(1);
    let task = sample_task(10, created, deadline);
    assert_eq!(current_points(&task, deadline + Duration::hours(5)), 30);
}

#[test]
fn current_points_zero_span_no_panic() {
    let created = t0();
    let task = sample_task(15, created, created);
    let _ = current_points(&task, created);
    let _ = current_points(&task, created + Duration::seconds(1));
}

#[test]
fn combo_for_first_claim() {
    let db = default_db();
    let now = t0();
    assert_eq!(combo_for(&db, "p1", now), (1, 1.0));
}

#[test]
fn combo_for_second_and_third() {
    let mut db = default_db();
    let now = t0();
    db.tasks.push(done_task("p1", now - Duration::minutes(10)));
    assert_eq!(combo_for(&db, "p1", now), (2, 1.25));
    db.tasks.push(done_task("p1", now - Duration::minutes(5)));
    assert_eq!(combo_for(&db, "p1", now), (3, 1.5));
}

#[test]
fn combo_for_ignores_old_other_burned() {
    let mut db = default_db();
    let now = t0();
    db.tasks.push(done_task("p1", now - Duration::minutes(90)));
    db.tasks.push(done_task("p2", now - Duration::minutes(5)));
    let mut burned = done_task("p1", now - Duration::minutes(3));
    burned.status = TaskStatus::Burned;
    db.tasks.push(burned);
    assert_eq!(combo_for(&db, "p1", now), (1, 1.0));
}

#[test]
fn respawn_task_none_and_fields() {
    let now = t0();
    let mut src = sample_task(12, now, now + Duration::hours(6));
    assert!(schedule_respawn(&src, now).is_none());
    src.repeat_hours = Some(0.0);
    assert!(schedule_respawn(&src, now).is_none());
    src.repeat_hours = Some(24.0);
    src.interval_hours = Some(24.0);
    src.fuse_hours = Some(6.0);
    src.status = TaskStatus::Done;
    src.claimed_by = Some("p1".into());
    src.awarded_points = Some(20);
    src.finished_at = Some(now);
    let fresh = schedule_respawn(&src, now).expect("schedule");
    assert_ne!(fresh.id, src.id);
    assert_eq!(fresh.status, TaskStatus::Scheduled);
    assert_eq!(fresh.appear_at, Some(now + Duration::hours(24)));
    assert_eq!(fresh.interval_hours, Some(24.0));
    assert_eq!(fresh.fuse_hours, Some(6.0));
    assert!(fresh.claimed_by.is_none());
    assert_eq!(fresh.title, src.title);
    assert_eq!(fresh.base_points, 12);
    // spawn_due opens when appear_at arrived
    let mut db = default_db();
    db.tasks.push(fresh);
    assert_eq!(spawn_due(&mut db, now + Duration::hours(23)), 0);
    assert_eq!(spawn_due(&mut db, now + Duration::hours(24)), 1);
    let open = db
        .tasks
        .iter()
        .find(|t| t.status == TaskStatus::Open)
        .unwrap();
    assert_eq!(
        open.deadline,
        now + Duration::hours(24) + Duration::hours(6)
    );
}

#[test]
fn sanitize_strips_controls() {
    let s = sanitize_text("привет\u{202e}мир\n", 80);
    assert!(!s.contains('\n'));
    assert_eq!(s, "приветмир");
}

#[test]
fn memorable_date_normalization_accepts_exact_dates_and_all_kinds() {
    for (kind, expected) in [
        ("anniversary", MemorableDateKind::Anniversary),
        ("meeting", MemorableDateKind::Meeting),
        ("birthday", MemorableDateKind::Birthday),
        ("custom", MemorableDateKind::Custom),
    ] {
        let normalized = normalize_memorable_date(MemorableDateInput {
            title: "  Наша\u{202e} дата  ".into(),
            date: "2024-02-29".into(),
            kind: kind.into(),
        })
        .expect("valid memorable date");
        assert_eq!(normalized.title, "Наша дата");
        assert_eq!(
            normalized.date,
            NaiveDate::from_ymd_opt(2024, 2, 29).unwrap()
        );
        assert_eq!(normalized.kind, expected);
    }

    for date in ["0001-01-01", "9999-12-31"] {
        assert!(normalize_memorable_date(MemorableDateInput {
            title: "Граница".into(),
            date: date.into(),
            kind: "custom".into(),
        })
        .is_ok());
    }
}

#[test]
fn memorable_date_normalization_rejects_non_exact_or_impossible_dates() {
    for date in [
        "",
        "0000-01-01",
        "2023-02-29",
        "2026-00-01",
        "2026-13-01",
        "2026-04-31",
        "2026-2-01",
        "2026-02-1",
        "26-02-01",
        " 2026-02-01",
        "2026-02-01 ",
        "2026-02-01T00:00:00Z",
        "2026/02/01",
        "202a-02-01",
    ] {
        assert!(
            matches!(
                normalize_memorable_date(MemorableDateInput {
                    title: "Дата".into(),
                    date: date.into(),
                    kind: "custom".into(),
                }),
                Err(MemorableDateError::Date)
            ),
            "date={date:?}"
        );
    }
}

#[test]
fn memorable_date_normalization_validates_title_and_kind() {
    let input = |title: String, kind: &str| MemorableDateInput {
        title,
        date: "2026-03-15".into(),
        kind: kind.into(),
    };

    assert!(normalize_memorable_date(input("а".repeat(80), "birthday")).is_ok());
    assert!(matches!(
        normalize_memorable_date(input("а".repeat(81), "birthday")),
        Err(MemorableDateError::Title)
    ));
    assert!(matches!(
        normalize_memorable_date(input(" \n\u{202e} ".into(), "birthday")),
        Err(MemorableDateError::Title)
    ));
    for kind in ["", "Birthday", "birthday ", "holiday"] {
        assert!(matches!(
            normalize_memorable_date(input("Дата".into(), kind)),
            Err(MemorableDateError::Kind)
        ));
    }
}

#[test]
fn points_word_uses_russian_plural_rules() {
    for (points, expected) in [
        (0, "очков"),
        (1, "очко"),
        (2, "очка"),
        (5, "очков"),
        (11, "очков"),
        (12, "очков"),
        (13, "очков"),
        (14, "очков"),
        (21, "очко"),
        (22, "очка"),
        (25, "очков"),
        (111, "очков"),
        (-1, "очко"),
        (-2, "очка"),
        (-5, "очков"),
        (i64::MIN, "очков"),
    ] {
        assert_eq!(points_word(points), expected, "points={points}");
    }
}

#[test]
fn award_once_per_key() {
    let mut db = default_db();
    let now = t0();
    let a = award(&mut db, "p1", "first_task", "Первое дело", "🎉", now);
    assert!(a.is_some());
    assert_eq!(db.achievements.len(), 1);
    assert!(award(&mut db, "p1", "first_task", "Первое дело", "🎉", now).is_none());
    assert_eq!(db.achievements.len(), 1);
    // Другой игрок может получить тот же key.
    assert!(award(&mut db, "p2", "first_task", "Первое дело", "🎉", now).is_some());
}

#[test]
fn iso_week_key_format() {
    let now = t0(); // 2026-03-15 is ISO week 11 of 2026
    let key = iso_week_key(now);
    assert!(key.starts_with("2026-W"), "got {key}");
    assert_eq!(key.len(), 8); // YYYY-Www
}

#[test]
fn week_rollover_init_empty() {
    let mut db = default_db();
    let now = t0();
    assert!(check_week_rollover(&mut db, now));
    assert_eq!(db.week_key, iso_week_key(now));
    assert!(db.seasons.is_empty());
    assert!(!check_week_rollover(&mut db, now));
}

#[test]
fn week_rollover_resets_score_keeps_xp() {
    let mut db = default_db();
    db.week_key = "2026-W10".into();
    db.players[0].score = 40;
    db.players[0].xp = 100;
    db.players[1].score = 10;
    db.players[1].xp = 50;
    let now = t0(); // 2026-W11
    assert!(check_week_rollover(&mut db, now));
    assert_eq!(db.seasons.len(), 1);
    assert_eq!(db.seasons[0].p1_score, 40);
    assert_eq!(db.seasons[0].p2_score, 10);
    assert_eq!(db.seasons[0].winner.as_deref(), Some("p1"));
    assert_eq!(db.players[0].score, 0);
    assert_eq!(db.players[1].score, 0);
    assert_eq!(db.players[0].xp, 100);
    assert_eq!(db.players[1].xp, 50);
    assert!(db
        .achievements
        .iter()
        .any(|a| a.key == "week_winner" && a.player_id == "p1"));
}

#[test]
fn week_rollover_draw_no_winner_ach() {
    let mut db = default_db();
    db.week_key = "2026-W10".into();
    db.players[0].score = 15;
    db.players[1].score = 15;
    assert!(check_week_rollover(&mut db, t0()));
    assert_eq!(db.seasons[0].winner, None);
    assert!(!db.achievements.iter().any(|a| a.key == "week_winner"));
}

#[test]
fn week_rollover_zero_fires_when_no_burns() {
    let mut db = default_db();
    db.week_key = "2026-W10".into();
    db.week_burns = 0;
    db.week_claims = 3;
    db.players[0].score = 20;
    db.players[1].score = 10;
    assert!(check_week_rollover(&mut db, t0()));
    assert!(db
        .achievements
        .iter()
        .any(|a| a.key == "zero_fires" && a.player_id == "p1"));
    assert!(db
        .achievements
        .iter()
        .any(|a| a.key == "zero_fires" && a.player_id == "p2"));
    assert_eq!(db.week_burns, 0);
    assert_eq!(db.week_claims, 0);
}

#[test]
fn week_rollover_no_zero_fires_if_burned() {
    let mut db = default_db();
    db.week_key = "2026-W10".into();
    db.week_burns = 1;
    db.week_claims = 5;
    db.players[0].score = 10;
    assert!(check_week_rollover(&mut db, t0()));
    assert!(!db.achievements.iter().any(|a| a.key == "zero_fires"));
}

#[test]
fn comeback_fields_default() {
    let p = &default_db().players[0];
    assert!(p.last_claim_at.is_none());
    assert!(p.comeback_week_key.is_empty());
}

#[test]
fn push_event_truncates() {
    let mut db = default_db();
    let now = t0();
    for i in 0..40 {
        push_event(&mut db, "new", format!("e{i}"), now);
    }
    assert_eq!(db.events.len(), MAX_EVENTS);
    assert_eq!(db.events.front().unwrap().text, "e39");
}

#[test]
fn sweep_burns_and_penalizes_both() {
    let mut db = default_db();
    db.players[0].score = 100;
    db.players[0].xp = 50;
    db.players[1].score = 1;
    db.players[1].xp = 20;
    db.week_key = iso_week_key(t0());
    let now = t0();
    let deadline = now - Duration::minutes(1);
    let mut task = sample_task(4, now - Duration::hours(2), deadline);
    task.title = "Мусор".into();
    db.tasks.push(task);
    assert!(sweep(&mut db, now));
    let burned = db.tasks.iter().find(|t| t.title == "Мусор").unwrap();
    assert_eq!(burned.status, TaskStatus::Burned);
    assert_eq!(burned.finished_at, Some(deadline));
    // penalty = (4+1)/2 = 2
    assert_eq!(db.players[0].score, 98);
    assert_eq!(db.players[1].score, 0); // clamp
    assert_eq!(db.players[0].xp, 50);
    assert_eq!(db.players[1].xp, 20);
    assert!(db
        .events
        .iter()
        .any(|e| e.kind == "burn" && e.text == "🔥 «Мусор» сгорело: -2 очка обоим"));
}

#[test]
fn sweep_burns_old_week_before_snapshot_and_blocks_zero_fires() {
    let boundary = DateTime::parse_from_rfc3339("2026-03-16T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let now = boundary + Duration::minutes(5);
    let deadline = boundary - Duration::minutes(1);
    let mut db = default_db();
    db.week_key = iso_week_key(deadline);
    db.week_claims = 3;
    db.players[0].score = 10;
    db.players[1].score = 4;
    let mut task = sample_task(4, deadline - Duration::hours(1), deadline);
    task.title = "Воскресное дело".into();
    db.tasks.push(task);

    assert!(sweep(&mut db, now));

    assert_eq!(db.seasons.len(), 1);
    assert_eq!(db.seasons[0].p1_score, 8);
    assert_eq!(db.seasons[0].p2_score, 2);
    assert!(!db.achievements.iter().any(|a| a.key == "zero_fires"));
    assert_eq!(db.week_key, iso_week_key(now));
    assert_eq!(db.week_burns, 0);
    assert_eq!(db.week_claims, 0);
    assert_eq!(db.players[0].score, 0);
    assert_eq!(db.players[1].score, 0);
    let burned = db
        .tasks
        .iter()
        .find(|task| task.title == "Воскресное дело")
        .unwrap();
    assert_eq!(burned.status, TaskStatus::Burned);
    assert_eq!(burned.finished_at, Some(deadline));
    assert!(db.events.iter().any(|event| {
        event.kind == "burn" && event.at == now && event.text.contains("Воскресное дело")
    }));
}

#[test]
fn sweep_burns_current_week_after_old_snapshot() {
    let boundary = DateTime::parse_from_rfc3339("2026-03-16T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let now = boundary + Duration::minutes(5);
    let deadline = boundary + Duration::minutes(2);
    let mut db = default_db();
    db.week_key = iso_week_key(boundary - Duration::minutes(1));
    db.week_claims = 3;
    db.players[0].score = 40;
    db.players[1].score = 10;
    let mut task = sample_task(4, boundary, deadline);
    task.title = "Понедельничное дело".into();
    db.tasks.push(task);

    assert!(sweep(&mut db, now));

    assert_eq!(db.seasons.len(), 1);
    assert_eq!(db.seasons[0].p1_score, 40);
    assert_eq!(db.seasons[0].p2_score, 10);
    assert!(db
        .achievements
        .iter()
        .any(|achievement| achievement.key == "zero_fires"));
    assert_eq!(db.week_key, iso_week_key(now));
    assert_eq!(db.week_burns, 1);
    assert_eq!(db.week_claims, 0);
    let burned = db
        .tasks
        .iter()
        .find(|task| task.title == "Понедельничное дело")
        .unwrap();
    assert_eq!(burned.status, TaskStatus::Burned);
    assert_eq!(burned.finished_at, Some(deadline));
}

#[test]
fn sweep_burns_exact_monday_boundary_after_old_snapshot() {
    let boundary = DateTime::parse_from_rfc3339("2026-03-16T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let mut db = default_db();
    db.week_key = iso_week_key(boundary - Duration::milliseconds(1));
    db.players[0].score = 20;
    db.players[1].score = 10;
    let task = sample_task(4, boundary - Duration::hours(1), boundary);
    let id = task.id;
    db.tasks.push(task);

    assert!(sweep(&mut db, boundary));

    assert_eq!(db.seasons.len(), 1);
    assert_eq!(db.seasons[0].p1_score, 20);
    assert_eq!(db.seasons[0].p2_score, 10);
    let burned = db.tasks.iter().find(|task| task.id == id).unwrap();
    assert_eq!(burned.status, TaskStatus::Burned);
    assert_eq!(burned.finished_at, Some(boundary));
    assert_eq!(db.week_key, iso_week_key(boundary));
    assert_eq!(db.week_burns, 1);
}

#[test]
fn cross_week_burn_schedules_exactly_one_repeat_from_observed_time() {
    let boundary = DateTime::parse_from_rfc3339("2026-03-16T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let now = boundary + Duration::days(2);
    let deadline = boundary - Duration::minutes(1);
    let mut db = default_db();
    db.week_key = iso_week_key(deadline);
    let mut task = sample_task(10, deadline - Duration::hours(6), deadline);
    task.title = "Повтор недели".into();
    task.repeat_hours = Some(24.0);
    task.interval_hours = Some(24.0);
    task.fuse_hours = Some(6.0);
    db.tasks.push(task);

    assert!(sweep(&mut db, now));

    let matching: Vec<_> = db
        .tasks
        .iter()
        .filter(|task| task.title == "Повтор недели")
        .collect();
    assert_eq!(matching.len(), 2);
    assert_eq!(
        matching
            .iter()
            .filter(|task| task.status == TaskStatus::Burned)
            .count(),
        1
    );
    let scheduled = matching
        .iter()
        .find(|task| task.status == TaskStatus::Scheduled)
        .unwrap();
    assert_eq!(scheduled.appear_at, Some(now + Duration::hours(24)));
    assert_eq!(scheduled.created_at, now + Duration::hours(24));
    assert_eq!(scheduled.fuse_hours, Some(6.0));
}

#[test]
fn multiweek_gap_folds_past_burn_into_only_stored_season() {
    let now = t0();
    let deadline = DateTime::parse_from_rfc3339("2026-01-12T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let mut db = default_db();
    db.week_key = "2026-W01".into();
    db.players[0].score = 10;
    db.players[1].score = 10;
    db.tasks
        .push(sample_task(4, deadline - Duration::hours(1), deadline));

    assert!(sweep(&mut db, now));

    assert_eq!(db.seasons.len(), 1);
    assert_eq!(db.seasons[0].week_key, "2026-W01");
    assert_eq!(db.seasons[0].p1_score, 8);
    assert_eq!(db.seasons[0].p2_score, 8);
    assert_eq!(db.week_key, iso_week_key(now));
    assert_eq!(db.week_burns, 0);
}

#[test]
fn sweep_respawns_repeat() {
    let mut db = default_db();
    db.week_key = iso_week_key(t0());
    let now = t0();
    let mut task = sample_task(10, now - Duration::hours(2), now - Duration::seconds(1));
    task.repeat_hours = Some(24.0);
    task.title = "Полив".into();
    db.tasks.push(task);
    assert!(sweep(&mut db, now));
    let scheduled: Vec<_> = db
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Scheduled && t.title == "Полив")
        .collect();
    assert_eq!(scheduled.len(), 1);
    assert_eq!(scheduled[0].appear_at, Some(now + Duration::hours(24)));
    assert!(db.events.iter().any(|e| e.kind == "repeat"));
}

#[test]
fn claim_achievements_first_and_firefighter() {
    let mut db = default_db();
    let now = t0();
    let deadline = now + Duration::seconds(30);
    let mut t = sample_task(10, now - Duration::hours(1), deadline);
    t.status = TaskStatus::Done;
    t.claimed_by = Some("p1".into());
    t.finished_at = Some(now);
    db.tasks.push(t);
    db.players[0].xp = 10;
    let got = check_claim_achievements(&mut db, "p1", now, deadline, 1.0);
    assert!(got.iter().any(|a| a.key == "first_task"));
    assert!(got.iter().any(|a| a.key == "firefighter"));
}

#[test]
fn claim_achievements_combo_master() {
    let mut db = default_db();
    let now = t0();
    let deadline = now + Duration::hours(1);
    let mut t = sample_task(10, now - Duration::minutes(30), deadline);
    t.status = TaskStatus::Done;
    t.claimed_by = Some("p1".into());
    t.finished_at = Some(now);
    db.tasks.push(t);
    let got = check_claim_achievements(&mut db, "p1", now, deadline, 1.5);
    assert!(got.iter().any(|a| a.key == "combo_master"));
}

fn temp_path(name: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!(
        "fam-test-{}-{}-{}",
        name,
        std::process::id(),
        Uuid::new_v4()
    ));
    p
}

#[test]
fn load_missing_returns_default() {
    let path = temp_path("missing.json");
    let _ = std::fs::remove_file(&path);
    let db = load_from(&path);
    assert_eq!(db.players.len(), 2);
    assert!(db.tasks.is_empty());
}

#[test]
fn save_load_roundtrip() {
    let path = temp_path("roundtrip.json");
    let _ = std::fs::remove_file(&path);
    let mut db = default_db();
    db.players[0].score = 42;
    db.players[0].xp = 7;
    db.week_key = "2026-W11".into();
    db.tasks
        .push(sample_task(10, t0(), t0() + Duration::hours(1)));
    db.family_shelf.push(sample_shelf_item("Семейный шаблон"));
    db.memorable_dates.push(sample_memorable_date(
        "День встречи",
        "2020-06-14",
        MemorableDateKind::Meeting,
    ));
    save_to(&path, &db).expect("save");
    assert!(path.exists());
    let tmp = {
        let mut t = path.as_os_str().to_os_string();
        t.push(".tmp");
        PathBuf::from(t)
    };
    assert!(!tmp.exists());
    let loaded = load_from(&path);
    assert_eq!(loaded.players[0].score, 42);
    assert_eq!(loaded.players[0].xp, 7);
    assert_eq!(loaded.week_key, "2026-W11");
    assert_eq!(loaded.tasks.len(), 1);
    assert_eq!(loaded.family_shelf, db.family_shelf);
    assert_eq!(loaded.memorable_dates, db.memorable_dates);
    // Вторая запись создаёт bak.0
    db.players[0].score = 43;
    save_to(&path, &db).expect("save2");
    let bak0 = {
        let mut b = path.as_os_str().to_os_string();
        b.push(".bak.0");
        PathBuf::from(b)
    };
    assert!(bak0.exists());
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&bak0);
}

#[test]
fn save_to_missing_parent_errs() {
    let path = PathBuf::from("/tmp/fam-no-such-dir-xyz/deep/data.json");
    let db = default_db();
    assert!(save_to(&path, &db).is_err());
}

#[test]
fn load_corrupt_backs_up_and_defaults() {
    let path = temp_path("corrupt.json");
    let corrupt = {
        let mut b = path.as_os_str().to_os_string();
        b.push(".corrupt");
        PathBuf::from(b)
    };
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&corrupt);
    std::fs::write(&path, "{not json").unwrap();
    let db = load_from(&path);
    assert_eq!(db.players.len(), 2);
    assert!(corrupt.exists());
    let body = std::fs::read_to_string(&corrupt).unwrap();
    assert_eq!(body, "{not json");
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&corrupt);
}

#[test]
fn load_old_schema_defaults() {
    let path = temp_path("old.json");
    // Без xp / week_key / seasons / achievements
    let json = r#"{
            "players": [
                {"id":"p1","name":"A","avatar":"🦊","score":1},
                {"id":"p2","name":"B","avatar":"🐻‍❄️","score":2}
            ],
            "tasks": [],
            "events": []
        }"#;
    std::fs::write(&path, json).unwrap();
    let db = load_from(&path);
    assert_eq!(db.players[0].xp, 0);
    assert!(db.week_key.is_empty());
    assert!(db.seasons.is_empty());
    assert!(db.achievements.is_empty());
    assert!(db.family_shelf.is_empty());
    assert!(db.memorable_dates.is_empty());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn state_response_exposes_family_shelf_in_stored_order() {
    let mut db = default_db();
    let first = sample_shelf_item("Первый");
    let second = sample_shelf_item("Второй");
    db.family_shelf = vec![first.clone(), second.clone()];

    let response = state_response(&db);

    assert_eq!(response.family_shelf, vec![first, second]);
}

#[test]
fn state_response_exposes_memorable_dates_in_stored_order() {
    let mut db = default_db();
    let first = sample_memorable_date("Годовщина", "2020-07-01", MemorableDateKind::Anniversary);
    let second = sample_memorable_date("День рождения", "1990-11-12", MemorableDateKind::Birthday);
    db.memorable_dates = vec![first.clone(), second.clone()];

    let response = state_response(&db);

    assert_eq!(response.memorable_dates, vec![first, second]);
}

#[test]
fn apply_claim_success_and_errors() {
    let now = Utc::now();
    let mut db = default_db();
    let t = sample_task(10, now - Duration::hours(1), now + Duration::hours(1));
    let id = t.id;
    db.tasks.push(t);

    assert!(matches!(
        apply_claim(&mut db, Uuid::new_v4(), "p1", now),
        Err(ClaimError::NotFound)
    ));
    assert!(matches!(
        apply_claim(&mut db, id, "p9", now),
        Err(ClaimError::UnknownPlayer)
    ));

    let ok = apply_claim(&mut db, id, "p1", now).expect("claim ok");
    assert!(ok.awarded >= 10);
    assert_eq!(ok.combo_count, 1);
    assert_eq!(
        db.tasks.iter().find(|x| x.id == id).unwrap().status,
        TaskStatus::Done
    );
    assert!(db.players[0].score >= ok.total_award);
    assert_eq!(db.week_claims, 1);

    assert!(matches!(
        apply_claim(&mut db, id, "p1", now),
        Err(ClaimError::Taken)
    ));
}

#[test]
fn claim_event_uses_points_plural() {
    let now = t0();
    let mut db = default_db();
    db.week_key = iso_week_key(now);
    let task = sample_task(1, now, now + Duration::hours(1));
    let id = task.id;
    db.tasks.push(task);

    let ok = apply_claim(&mut db, id, "p1", now).expect("claim ok");

    assert_eq!(ok.awarded, 1);
    assert!(db.events.iter().any(|e| {
        e.kind == "done" && e.text == "🦊 Игрок 1: 📌 «Тест» готово, +1 очко"
    }));
}

#[test]
fn apply_claim_burned() {
    let now = Utc::now();
    let mut db = default_db();
    let mut t = sample_task(10, now - Duration::hours(2), now - Duration::hours(1));
    t.status = TaskStatus::Burned;
    let id = t.id;
    db.tasks.push(t);
    assert!(matches!(
        apply_claim(&mut db, id, "p1", now),
        Err(ClaimError::Burned)
    ));
}

#[test]
fn create_open_task_ok_and_bad_title() {
    let now = Utc::now();
    let mut db = default_db();
    let task = create_open_task(
        &mut db,
        TaskTemplateInput {
            title: "  Посуда  ".into(),
            emoji: Some("🍽️".into()),
            base_points: Some(15),
            hours: Some(6.0),
            repeat: Some(false),
            interval_hours: None,
        },
        now,
    )
    .unwrap();
    assert_eq!(task.title, "Посуда");
    assert_eq!(task.base_points, 15);
    assert_eq!(db.tasks.len(), 1);
    assert!(db.events.iter().any(|e| e.kind == "new"));

    let bad = create_open_task(
        &mut db,
        TaskTemplateInput {
            title: "   ".into(),
            emoji: None,
            base_points: None,
            hours: None,
            repeat: None,
            interval_hours: None,
        },
        now,
    );
    assert!(matches!(bad, Err(TaskTemplateError::BadTitle)));
}

#[test]
fn task_template_normalization_preserves_auto_interval_and_clamps() {
    let normalized = normalize_task_template(TaskTemplateInput {
        title: "  Полить цветы  ".into(),
        emoji: Some("".into()),
        base_points: Some(2_000),
        hours: Some(0.0),
        repeat: Some(true),
        interval_hours: None,
    })
    .expect("valid template");

    assert_eq!(normalized.title, "Полить цветы");
    assert_eq!(normalized.emoji, "📌");
    assert_eq!(normalized.base_points, 1_000);
    assert_eq!(normalized.hours, 0.05);
    assert_eq!(normalized.interval_hours, None);
    assert_eq!(normalized.effective_interval_hours(), Some(0.05));

    let mut db = default_db();
    let task = create_open_task(
        &mut db,
        TaskTemplateInput {
            title: "Полить цветы".into(),
            emoji: Some("🪴".into()),
            base_points: Some(10),
            hours: Some(6.0),
            repeat: Some(true),
            interval_hours: None,
        },
        t0(),
    )
    .expect("task");
    assert_eq!(task.fuse_hours, Some(6.0));
    assert_eq!(task.interval_hours, Some(6.0));
    assert_eq!(task.repeat_hours, Some(6.0));
}

#[test]
fn task_template_normalization_clears_non_repeat_interval_and_rejects_non_finite() {
    let not_repeating = normalize_task_template(TaskTemplateInput {
        title: "Разово".into(),
        emoji: None,
        base_points: None,
        hours: None,
        repeat: Some(false),
        interval_hours: Some(48.0),
    })
    .expect("valid template");
    assert_eq!(not_repeating.interval_hours, None);
    assert_eq!(not_repeating.effective_interval_hours(), None);

    for input in [
        TaskTemplateInput {
            title: "Infinity".into(),
            emoji: None,
            base_points: None,
            hours: Some(f64::INFINITY),
            repeat: None,
            interval_hours: None,
        },
        TaskTemplateInput {
            title: "NaN".into(),
            emoji: None,
            base_points: None,
            hours: None,
            repeat: Some(true),
            interval_hours: Some(f64::NAN),
        },
    ] {
        assert!(matches!(
            normalize_task_template(input),
            Err(TaskTemplateError::NonFiniteNumber)
        ));
    }
}

#[test]
fn task_template_title_must_be_between_one_and_eighty_sanitized_chars() {
    let input = |title: String| TaskTemplateInput {
        title,
        emoji: None,
        base_points: None,
        hours: None,
        repeat: None,
        interval_hours: None,
    };

    assert!(normalize_task_template(input("а".repeat(80))).is_ok());
    assert!(matches!(
        normalize_task_template(input("а".repeat(81))),
        Err(TaskTemplateError::BadTitle)
    ));
    assert!(matches!(
        normalize_task_template(input(" \n\u{202e} ".into())),
        Err(TaskTemplateError::BadTitle)
    ));
}
