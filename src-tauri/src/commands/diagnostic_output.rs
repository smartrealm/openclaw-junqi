const MAX_DIAGNOSTIC_CHARS: usize = 600;
const MAX_PROCESS_DIAGNOSTIC_CHARS: usize = 16 * 1024;
const SENSITIVE_MARKERS: &[&str] = &[
    "api_key",
    "apikey",
    "authorization",
    "credential",
    "password",
    "secret",
    "token",
    "bearer ",
    "x-api-key",
];

const SECRET_PREFIXES: &[&str] = &["sk-", "rk-", "ghp_", "github_pat_", "aiza"];

fn contains_secret_prefixed_token(value: &str) -> bool {
    SECRET_PREFIXES.iter().any(|prefix| {
        value.match_indices(prefix).any(|(offset, _)| {
            let boundary = value[..offset]
                .chars()
                .next_back()
                .map(|character| !character.is_ascii_alphanumeric())
                .unwrap_or(true);
            let token_len = value[offset + prefix.len()..]
                .chars()
                .take_while(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
                })
                .count();
            boundary && token_len >= 16
        })
    })
}

fn sanitize_diagnostic_line_with_limit(line: &str, max_chars: usize) -> String {
    let trimmed = line.trim();
    let lower = trimmed.to_ascii_lowercase();
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
        || contains_secret_prefixed_token(&lower)
    {
        return "[sensitive diagnostic redacted]".to_string();
    }

    let mut value = trimmed.chars().take(max_chars).collect::<String>();
    if trimmed.chars().count() > max_chars {
        value.push_str("...");
    }
    value
}

pub fn sanitize_diagnostic_line(line: &str) -> String {
    sanitize_diagnostic_line_with_limit(line, MAX_DIAGNOSTIC_CHARS)
}

/// Persistent process logs retain substantially more context than the live UI
/// while applying the same credential redaction policy.
pub fn sanitize_process_diagnostic_line(line: &str) -> String {
    sanitize_diagnostic_line_with_limit(line, MAX_PROCESS_DIAGNOSTIC_CHARS)
}

/// Sanitize a multi-line diagnostic payload before it crosses a trust boundary
/// (for example from a local Gateway log into a direct model request). The
/// per-line sanitizer catches named credentials while this helper bounds the
/// complete payload without splitting UTF-8 text.
pub fn sanitize_diagnostic_text(value: &str, max_chars: usize) -> String {
    let mut sanitized = String::new();
    for line in value.lines() {
        let line = sanitize_diagnostic_line(line);
        if line.is_empty() {
            continue;
        }
        let separator = usize::from(!sanitized.is_empty());
        if sanitized.chars().count() + separator >= max_chars {
            break;
        }
        if !sanitized.is_empty() {
            sanitized.push('\n');
        }
        let remaining = max_chars.saturating_sub(sanitized.chars().count());
        let line_len = line.chars().count();
        sanitized.extend(line.chars().take(remaining));
        if line_len > remaining {
            sanitized.push_str("...");
            break;
        }
    }
    sanitized
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

    #[test]
    fn redacts_bare_secret_prefixes_before_external_diagnostics() {
        assert_eq!(
            sanitize_diagnostic_line("request failed: sk-secret-value-123456789"),
            "[sensitive diagnostic redacted]"
        );
    }

    #[test]
    fn does_not_treat_an_ordinary_word_as_a_secret_prefix() {
        assert_eq!(
            sanitize_diagnostic_line("disk-space check failed"),
            "disk-space check failed"
        );
    }

    #[test]
    fn multi_line_sanitizer_bounds_and_redacts_each_line() {
        let text = sanitize_diagnostic_text("ready\napi_key=secret\n".repeat(80).as_str(), 120);
        assert!(text.contains("ready"));
        assert!(text.contains("[sensitive diagnostic redacted]"));
        assert!(text.chars().count() <= 123);
    }

    #[test]
    fn persistent_process_lines_keep_more_context_without_leaking_secrets() {
        let long_line = "x".repeat(2_000);
        assert_eq!(sanitize_process_diagnostic_line(&long_line), long_line);
        assert_eq!(
            sanitize_process_diagnostic_line("Authorization: Bearer abc"),
            "[sensitive diagnostic redacted]"
        );
    }
}
