const MAX_DIAGNOSTIC_CHARS: usize = 600;
const SENSITIVE_MARKERS: &[&str] = &[
    "api_key",
    "apikey",
    "authorization",
    "credential",
    "password",
    "secret",
    "token",
];

pub fn sanitize_diagnostic_line(line: &str) -> String {
    let trimmed = line.trim();
    let lower = trimmed.to_ascii_lowercase();
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return "[sensitive diagnostic redacted]".to_string();
    }

    let mut value = trimmed
        .chars()
        .take(MAX_DIAGNOSTIC_CHARS)
        .collect::<String>();
    if trimmed.chars().count() > MAX_DIAGNOSTIC_CHARS {
        value.push_str("...");
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_credentials_case_insensitively() {
        assert_eq!(
            sanitize_diagnostic_line("Authorization: Bearer abc"),
            "[sensitive diagnostic redacted]"
        );
    }

    #[test]
    fn bounds_unicode_output_by_characters() {
        let sanitized = sanitize_diagnostic_line(&"界".repeat(700));
        assert_eq!(sanitized.chars().count(), MAX_DIAGNOSTIC_CHARS + 3);
        assert!(sanitized.ends_with("..."));
    }
}
