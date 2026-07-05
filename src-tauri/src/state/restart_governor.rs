//! Gateway restart rate-limiter.
//!
//! Prevents rapid-fire restarts by enforcing a simple cooldown between
//! consecutive restarts. Kept simple intentionally — no circuit breakers,
//! no sliding-window budgets, no exponential back-off. Before porting,
//! JunQi had 10-min circuit-breaker lockouts that silently dropped
//! legitimate config changes. The simplicity here is a *lesson learned*.
//!
//! See: JunQi electron/gateway/restart-governor.ts (94 lines, TS)

use std::time::Instant;

const DEFAULT_COOLDOWN_MS: u32 = 2_500;

pub struct RestartGovernor {
    cooldown_ms: u32,
    last_restart_at: Option<Instant>,
    suppressed_total: u64,
    executed_total: u64,
}

#[derive(Debug)]
pub enum RestartDecision {
    Allow,
    CooldownActive { retry_after_ms: u64 },
}

impl RestartGovernor {
    pub fn new(cooldown_ms: Option<u32>) -> Self {
        Self {
            cooldown_ms: cooldown_ms.unwrap_or(DEFAULT_COOLDOWN_MS),
            last_restart_at: None,
            suppressed_total: 0,
            executed_total: 0,
        }
    }

    pub fn decide(&self, now: Instant) -> RestartDecision {
        if let Some(last) = self.last_restart_at {
            let since_last = now.duration_since(last).as_millis() as u64;
            if since_last < self.cooldown_ms as u64 {
                return RestartDecision::CooldownActive {
                    retry_after_ms: self.cooldown_ms as u64 - since_last,
                };
            }
        }
        RestartDecision::Allow
    }

    pub fn record_executed(&mut self, now: Instant) {
        self.executed_total = self.executed_total.saturating_add(1);
        self.last_restart_at = Some(now);
    }

    pub fn counters(&self) -> (u64, u64) {
        (self.executed_total, self.suppressed_total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_call_always_allows() {
        let g = RestartGovernor::new(None);
        assert!(matches!(g.decide(Instant::now()), RestartDecision::Allow));
    }

    #[test]
    fn blocks_within_cooldown_window() {
        let mut g = RestartGovernor::new(Some(500));
        let t0 = Instant::now();
        g.record_executed(t0);
        // Immediately after record → blocked.
        assert!(matches!(
            g.decide(Instant::now()),
            RestartDecision::CooldownActive { .. }
        ));
    }

    #[test]
    fn allows_after_cooldown_expires() {
        let mut g = RestartGovernor::new(Some(100));
        let t0 = Instant::now();
        g.record_executed(t0);
        let t1 = t0 + std::time::Duration::from_millis(101);
        assert!(matches!(g.decide(t1), RestartDecision::Allow));
    }

    #[test]
    fn counters_increment() {
        let mut g = RestartGovernor::new(Some(100));
        g.record_executed(Instant::now());
        // suppress 一次
        let _ = g.decide(Instant::now());
        let (exec, _supp) = g.counters();
        assert_eq!(exec, 1);
    }

    #[test]
    fn saturated_counter_no_overflow() {
        let mut g = RestartGovernor::new(None);
        // Fill to 1000 — no overflow
        for _ in 0..1000 {
            g.record_executed(Instant::now());
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        let (exec, _supp) = g.counters();
        assert_eq!(exec, 1000);
    }
}