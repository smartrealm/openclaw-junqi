use super::collect_stop_failures;
use super::model::{
    take_utf8_ready, validate_id, SnapshotBuffer, MAX_COMPLETED_RUNS, MAX_SNAPSHOT_BYTES,
};
use super::runtime::{consume_completed_run, is_completed_run, remember_completed_run};

#[test]
fn stopping_every_handle_survives_one_that_refuses_to_die() {
    let attempted = std::cell::RefCell::new(Vec::new());
    let failures = collect_stop_failures(vec!["first", "second", "third"], |item| {
        attempted.borrow_mut().push(*item);
        if *item == "first" {
            return Err("no such process".to_string());
        }
        Ok(())
    });

    assert_eq!(attempted.into_inner(), vec!["first", "second", "third"]);
    assert_eq!(failures, vec!["no such process".to_string()]);
}

#[test]
fn stopping_reports_nothing_when_every_handle_yields() {
    let failures = collect_stop_failures(vec![1, 2, 3], |_| Ok(()));
    assert!(failures.is_empty());
}

#[test]
fn ids_reject_empty_control_and_unbounded_values() {
    assert!(validate_id("id", "").is_err());
    assert!(validate_id("id", "bad\nrun").is_err());
    assert!(validate_id("id", &"x".repeat(161)).is_err());
    assert!(validate_id("id", "workbench:pty:one").is_ok());
}

#[test]
fn utf8_decoder_retains_split_multibyte_characters() {
    let mut pending = vec![0xe4, 0xb8];
    assert_eq!(take_utf8_ready(&mut pending), "");
    pending.push(0xad);
    assert_eq!(take_utf8_ready(&mut pending), "中");
    assert!(pending.is_empty());
}

#[test]
fn completed_runs_are_exact_idempotent_and_bounded() {
    for index in 0..MAX_COMPLETED_RUNS + 1 {
        remember_completed_run(&format!("pty-{index}"), &format!("run-{index}"));
    }
    assert!(!is_completed_run("pty-0", "run-0"));
    assert!(is_completed_run("pty-1", "run-1"));
    assert!(!consume_completed_run("pty-1", "wrong-run"));
    assert!(consume_completed_run("pty-1", "run-1"));
    assert!(!is_completed_run("pty-1", "run-1"));
}

#[test]
fn snapshot_is_bounded_and_marks_truncation() {
    let mut snapshot = SnapshotBuffer::new();
    snapshot.push(&vec![b'a'; MAX_SNAPSHOT_BYTES]);
    snapshot.push(b"tail");
    assert_eq!(snapshot.bytes, MAX_SNAPSHOT_BYTES);
    assert!(snapshot.truncated);
    assert!(snapshot.text().ends_with("tail"));
}
