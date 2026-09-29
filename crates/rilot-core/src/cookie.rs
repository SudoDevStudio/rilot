//! Per-session policy overrides carried in a cookie.
//!
//! A site can let a visitor choose how its own pages are routed — speed for the
//! checkout, clean power for the catalogue — and keep that choice in a cookie.
//! Every adapter then reads the same cookie and honours it, because the parsing
//! *and* the pattern matching happen here, in the engine, not in each adapter.
//!
//! The format is one `pattern:policy` pair per route, comma separated:
//!
//! ```text
//! rilot_policy=/products/*:carbon,/reports/*:latency
//! ```
//!
//! Patterns are matched exactly like routing rules: an exact path beats a
//! wildcard, a longer literal prefix beats a shorter one, and ties go to the
//! first entry. Anything unparseable is skipped rather than rejected, because a
//! cookie is attacker-controlled input and a malformed one must not break
//! routing.

use crate::config::{match_specificity, Policy};

/// One entry of the cookie: which paths it covers, and the policy chosen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyOverride {
    pub pattern: String,
    pub policy: Policy,
}

/// The longest a cookie we will look at may be.
///
/// Browsers cap a cookie at about 4 KB; this is a cheap guard against a huge
/// value arriving from somewhere else.
const MAX_LEN: usize = 4096;

/// Parses the value of the policy cookie, skipping anything malformed.
pub fn parse(value: &str) -> Vec<PolicyOverride> {
    if value.len() > MAX_LEN {
        return Vec::new();
    }
    value
        .split(',')
        .filter_map(|entry| {
            let (pattern, policy) = entry.trim().rsplit_once(':')?;
            let pattern = pattern.trim();
            if !pattern.starts_with('/') {
                return None;
            }
            Some(PolicyOverride {
                pattern: pattern.to_string(),
                policy: Policy::parse(policy.trim())?,
            })
        })
        .collect()
}

/// The policy a cookie asks for on `path`, or `None` if no entry matches.
///
/// Uses the same specificity order as routing rules, so a cookie behaves the
/// way a reader of the config would expect.
pub fn policy_for_path(value: &str, path: &str) -> Option<Policy> {
    let mut best: Option<((bool, usize), Policy)> = None;
    for entry in parse(value) {
        if let Some(spec) = match_specificity(&entry.pattern, path) {
            if best.is_none_or(|(b, _)| spec > b) {
                best = Some((spec, entry.policy));
            }
        }
    }
    best.map(|(_, policy)| policy)
}

/// Finds the policy cookie in a `Cookie:` header, if it is there.
///
/// `name` is the cookie name, e.g. `rilot_policy`. Values are returned
/// percent-decoded, because a pattern contains `/` and `*` which a browser is
/// free to encode.
pub fn from_header(header: &str, name: &str) -> Option<String> {
    header
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| key.trim() == name)
        .map(|(_, value)| percent_decode(value.trim()))
}

/// Decodes `%XX` escapes. An invalid escape is left as written.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = core::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_entry_it_understands() {
        let parsed = parse("/products/*:carbon, /reports/*:latency,/:balanced");
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].pattern, "/products/*");
        assert_eq!(parsed[0].policy, Policy::Carbon);
        assert_eq!(parsed[2].policy, Policy::Balanced);
    }

    #[test]
    fn skips_junk_instead_of_failing() {
        // No colon, unknown policy, relative pattern, empty entry.
        let parsed = parse("garbage,/x:teleport,products/*:carbon,,/ok:latency");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].pattern, "/ok");
    }

    #[test]
    fn ignores_an_absurdly_long_value() {
        let long = format!("/a:carbon,{}", "x".repeat(MAX_LEN));
        assert!(parse(&long).is_empty());
    }

    #[test]
    fn matches_with_rule_specificity() {
        let cookie = "/*:balanced,/products/*:carbon,/products/bottle:latency";
        assert_eq!(
            policy_for_path(cookie, "/products/bottle"),
            Some(Policy::Latency)
        );
        assert_eq!(
            policy_for_path(cookie, "/products/tote"),
            Some(Policy::Carbon)
        );
        // A wildcard prefix also covers the bare path, like a routing rule.
        assert_eq!(policy_for_path(cookie, "/products"), Some(Policy::Carbon));
        assert_eq!(policy_for_path(cookie, "/cart"), Some(Policy::Balanced));
    }

    #[test]
    fn no_match_means_no_override() {
        assert_eq!(policy_for_path("/products/*:carbon", "/cart"), None);
        assert_eq!(policy_for_path("", "/"), None);
    }

    #[test]
    fn reads_the_named_cookie_out_of_a_header() {
        let header = "sid=abc; rilot_policy=%2Fproducts%2F*%3Acarbon; other=1";
        assert_eq!(
            from_header(header, "rilot_policy").as_deref(),
            Some("/products/*:carbon")
        );
        assert_eq!(from_header(header, "missing"), None);
        assert_eq!(from_header("sid=abc", "rilot_policy"), None);
    }

    #[test]
    fn leaves_a_broken_escape_alone() {
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("a%zzb"), "a%zzb");
    }
}
