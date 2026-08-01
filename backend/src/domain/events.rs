//! Лента событий.
use crate::models::*;
use chrono::{DateTime, Utc};
use uuid::Uuid;

pub(crate) fn push_event(db: &mut Db, kind: &str, text: String, at: DateTime<Utc>) {
    db.events.push_front(Event {
        id: Uuid::new_v4(),
        kind: kind.into(),
        text,
        at,
        reactions: vec![],
    });
    db.events.truncate(MAX_EVENTS);
}
