//! Minimal UTC timestamp type.
//!
//! The core never reads a clock. Callers pass `now` explicitly so decisions are
//! deterministic and reproducible (native, edge, and browser all agree).

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// Seconds since the Unix epoch (UTC). Serialized as RFC 3339 (`2026-09-18T20:00:00Z`);
/// deserializes from either an RFC 3339 string or an integer number of seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Timestamp(pub i64);

impl Timestamp {
    pub fn from_unix_seconds(secs: i64) -> Self {
        Timestamp(secs)
    }

    pub fn unix_seconds(self) -> i64 {
        self.0
    }

    /// Seconds elapsed from `earlier` to `self` (negative if `earlier` is in the future).
    pub fn seconds_since(self, earlier: Timestamp) -> i64 {
        self.0 - earlier.0
    }

    /// Parses `YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)`. Fractional seconds are truncated.
    pub fn parse_rfc3339(input: &str) -> Result<Self, String> {
        let s = input.trim();
        let err = || format!("invalid RFC 3339 timestamp: {input:?}");
        let bytes = s.as_bytes();
        if bytes.len() < 20 {
            return Err(err());
        }
        let num = |range: std::ops::Range<usize>| -> Result<i64, String> {
            s.get(range)
                .filter(|part| part.bytes().all(|b| b.is_ascii_digit()))
                .and_then(|part| part.parse::<i64>().ok())
                .ok_or_else(err)
        };
        if bytes[4] != b'-' || bytes[7] != b'-' || !matches!(bytes[10], b'T' | b't' | b' ') {
            return Err(err());
        }
        if bytes[13] != b':' || bytes[16] != b':' {
            return Err(err());
        }
        let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
        let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
        if !(1..=12).contains(&month)
            || !(1..=days_in_month(year, month)).contains(&day)
            || hour > 23
            || minute > 59
            || second > 60
        {
            return Err(err());
        }

        let mut rest = &s[19..];
        if let Some(frac) = rest.strip_prefix('.') {
            let digits = frac.bytes().take_while(|b| b.is_ascii_digit()).count();
            if digits == 0 {
                return Err(err());
            }
            rest = &frac[digits..];
        }
        let offset_secs = match rest {
            "Z" | "z" => 0,
            _ if rest.len() == 6
                && matches!(rest.as_bytes()[0], b'+' | b'-')
                && rest.as_bytes()[3] == b':' =>
            {
                let h: i64 = rest[1..3].parse().map_err(|_| err())?;
                let m: i64 = rest[4..6].parse().map_err(|_| err())?;
                let sign = if rest.starts_with('-') { -1 } else { 1 };
                sign * (h * 3600 + m * 60)
            }
            _ => return Err(err()),
        };

        let days = days_from_civil(year, month, day);
        Ok(Timestamp(
            days * 86_400 + hour * 3600 + minute * 60 + second - offset_secs,
        ))
    }

    pub fn to_rfc3339(self) -> String {
        let days = self.0.div_euclid(86_400);
        let secs = self.0.rem_euclid(86_400);
        let (y, m, d) = civil_from_days(days);
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            y,
            m,
            d,
            secs / 3600,
            (secs % 3600) / 60,
            secs % 60
        )
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_rfc3339())
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_rfc3339())
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl de::Visitor<'_> for Visitor {
            type Value = Timestamp;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("an RFC 3339 timestamp string or unix seconds")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Timestamp, E> {
                Timestamp::parse_rfc3339(v).map_err(E::custom)
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Timestamp, E> {
                Ok(Timestamp(v))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Timestamp, E> {
                i64::try_from(v)
                    .map(Timestamp)
                    .map_err(|_| E::custom("timestamp out of range"))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Timestamp, E> {
                if v.is_finite() {
                    Ok(Timestamp(v.floor() as i64))
                } else {
                    Err(E::custom("timestamp must be finite"))
                }
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(year) => 29,
        _ => 28,
    }
}

// Howard Hinnant's civil calendar algorithms (proleptic Gregorian).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if m <= 2 {
            yoe + era * 400 + 1
        } else {
            yoe + era * 400
        },
        m,
        d,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_rfc3339() {
        let ts = Timestamp::parse_rfc3339("2026-09-18T20:00:00Z").unwrap();
        assert_eq!(ts.unix_seconds(), 1_789_761_600);
        assert_eq!(ts.to_rfc3339(), "2026-09-18T20:00:00Z");
    }

    #[test]
    fn applies_offsets_and_ignores_fraction() {
        let a = Timestamp::parse_rfc3339("2026-09-18T22:00:00.750+02:00").unwrap();
        let b = Timestamp::parse_rfc3339("2026-09-18T20:00:00Z").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn rejects_garbage() {
        assert!(Timestamp::parse_rfc3339("2026-02-30T00:00:00Z").is_err());
        assert!(Timestamp::parse_rfc3339("yesterday").is_err());
        assert!(Timestamp::parse_rfc3339("2026-09-18T20:00:00").is_err());
    }

    #[test]
    fn handles_pre_epoch_dates() {
        let ts = Timestamp::parse_rfc3339("1969-12-31T23:59:59Z").unwrap();
        assert_eq!(ts.unix_seconds(), -1);
        assert_eq!(ts.to_rfc3339(), "1969-12-31T23:59:59Z");
    }
}
