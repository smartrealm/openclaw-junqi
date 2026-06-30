use std::sync::Mutex;
use tokio::process::Child;

pub struct GatewayProcess {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
    /// True while a real `openclaw gateway restart` is in progress.
    /// While set, `gateway_status` reports `running: true` (so the frontend
    /// status poller does not see the service flap down→up and trigger a
    /// competing `start_gateway`), and `start_gateway` refuses to spawn.
    pub restarting: Mutex<bool>,
}

impl GatewayProcess {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(51789),
            restarting: Mutex::new(false),
        }
    }
}
