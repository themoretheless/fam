//! Текст: sanitize и человекочитаемые интервалы.
use chrono::{DateTime, Utc};

/// Убирает control/bidi, обрезает по графемам (char count как приближение).
pub(crate) fn sanitize_text(s: &str, max_chars: usize) -> String {
    let cleaned: String = s
        .chars()
        .filter(|c| {
            let u = *c as u32;
            // C0/C1, zero-width, bidi
            if u < 0x20 || (0x7f..=0x9f).contains(&u) {
                return false;
            }
            !matches!(
                u,
                0x200b..=0x200f | 0x202a..=0x202e | 0x2066..=0x2069 | 0xfeff
            )
        })
        .collect();
    cleaned
        .chars()
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Правильная русская форма слова «очко» для заданного количества.
pub(crate) fn points_word(points: i64) -> &'static str {
    let points = points.unsigned_abs();
    let last_digit = points % 10;
    let last_two_digits = points % 100;

    if last_digit == 1 && last_two_digits != 11 {
        "очко"
    } else if (2..=4).contains(&last_digit) && !(12..=14).contains(&last_two_digits) {
        "очка"
    } else {
        "очков"
    }
}

/// DRY: human interval for repeat events.
pub(crate) fn format_wait_label(from: DateTime<Utc>, to: DateTime<Utc>) -> String {
    let h = (to - from).num_minutes().max(0);
    if h >= 60 {
        format!("через {}ч", (h as f64 / 60.0).ceil() as i64)
    } else {
        format!("через {h}м")
    }
}
