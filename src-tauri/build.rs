fn main() {
    let defaults_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/config/runtime-defaults.json");
    println!("cargo:rerun-if-changed={}", defaults_path.display());

    let raw = std::fs::read_to_string(&defaults_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", defaults_path.display()));
    let defaults: serde_json::Value = serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("invalid {}: {error}", defaults_path.display()));
    let gateway = defaults
        .get("gateway")
        .unwrap_or_else(|| panic!("{} must define gateway", defaults_path.display()));
    let host = gateway
        .get("host")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| value.parse::<std::net::Ipv4Addr>().ok())
        .filter(std::net::Ipv4Addr::is_loopback)
        .unwrap_or_else(|| {
            panic!(
                "{} gateway.host must be an IPv4 loopback address",
                defaults_path.display()
            )
        });
    let port = gateway
        .get("port")
        .and_then(serde_json::Value::as_u64)
        .filter(|value| (1..=u16::MAX as u64).contains(value))
        .unwrap_or_else(|| {
            panic!(
                "{} gateway.port must be an integer from 1 to 65535",
                defaults_path.display()
            )
        });
    let _validated_endpoint = (host, port);

    tauri_build::build()
}
