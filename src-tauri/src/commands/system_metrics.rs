// System metrics background thread — Nezha-style state stream.
// Collects CPU/memory/disk/network every second, emits via Tauri events.
use std::thread;
use sysinfo::{Disks, Networks, System};
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
pub struct SystemMetrics {
    pub cpu: f32,
    pub cpu_count: usize,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
    pub net_up_speed: u64,
    pub net_down_speed: u64,
    pub uptime: u64,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    pub platform: String,
    pub platform_version: String,
    pub arch: String,
}

pub fn start_metrics_stream(app_handle: AppHandle) {
    thread::spawn(move || {
        let mut sys = System::new_all();
        let cpu_count = sys.cpus().len();

        let platform = System::name().unwrap_or_else(|| "unknown".into());
        let platform_version = System::os_version().unwrap_or_else(|| "unknown".into());
        let arch = std::env::consts::ARCH.to_string();

        let networks = Networks::new_with_refreshed_list();
        let mut prev_net_up: u64 = 0;
        let mut prev_net_down: u64 = 0;
        for (_, data) in networks.iter() {
            prev_net_up += data.total_transmitted();
            prev_net_down += data.total_received();
        }

        loop {
            thread::sleep(std::time::Duration::from_secs(1));
            sys.refresh_cpu_all();
            sys.refresh_memory();

            let cpu: f32 = sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / cpu_count as f32;

            let mem_used = sys.used_memory();
            let mem_total = sys.total_memory();

            let disks = Disks::new_with_refreshed_list();
            let mut disk_used: u64 = 0;
            let mut disk_total: u64 = 0;
            for disk in disks.list() {
                disk_used += disk.total_space() - disk.available_space();
                disk_total += disk.total_space();
            }

            let networks = Networks::new_with_refreshed_list();
            let mut net_up: u64 = 0;
            let mut net_down: u64 = 0;
            for (_, data) in networks.iter() {
                net_up += data.total_transmitted();
                net_down += data.total_received();
            }
            let net_up_speed = net_up.saturating_sub(prev_net_up);
            let net_down_speed = net_down.saturating_sub(prev_net_down);
            prev_net_up = net_up;
            prev_net_down = net_down;

            let load = System::load_average();
            let uptime = System::uptime();

            let _ = app_handle.emit(
                "system-metrics",
                SystemMetrics {
                    cpu: (cpu * 10.0).round() / 10.0,
                    cpu_count,
                    mem_used,
                    mem_total,
                    disk_used,
                    disk_total,
                    net_up_speed,
                    net_down_speed,
                    uptime,
                    load1: load.one,
                    load5: load.five,
                    load15: load.fifteen,
                    platform: platform.clone(),
                    platform_version: platform_version.clone(),
                    arch: arch.clone(),
                },
            );
        }
    });
}
