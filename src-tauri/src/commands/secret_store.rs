//! 操作系统凭据库适配器。
//!
//! Gateway 设备凭据只能写入系统凭据库。适配器不提供明文文件回退，也不向 WebView
//! 暴露通用密钥读写命令。

fn credential_entry(service: &str, account_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account_id)
        .map_err(|error| format!("open system credential store: {error}"))
}

/// 支持的平台构建均包含系统凭据库后端；具体可用性由每次操作的结果确定。
pub(crate) fn system_credential_store_available() -> bool {
    true
}

pub(crate) async fn store_system_credential(
    service: &str,
    account_id: &str,
    _label: &str,
    value: &str,
) -> Result<(), String> {
    let service = service.to_string();
    let account_id = account_id.to_string();
    let value = value.to_string();
    tokio::task::spawn_blocking(move || {
        credential_entry(&service, &account_id)?
            .set_password(&value)
            .map_err(|error| format!("store credential in system vault: {error}"))
    })
    .await
    .map_err(|error| format!("credential store task failed: {error}"))?
}

pub(crate) async fn get_system_credential(
    service: &str,
    account_id: &str,
) -> Result<Option<String>, String> {
    let service = service.to_string();
    let account_id = account_id.to_string();
    tokio::task::spawn_blocking(move || {
        match credential_entry(&service, &account_id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("read credential from system vault: {error}")),
        }
    })
    .await
    .map_err(|error| format!("credential read task failed: {error}"))?
}

pub(crate) async fn delete_system_credential(
    service: &str,
    account_id: &str,
) -> Result<(), String> {
    let service = service.to_string();
    let account_id = account_id.to_string();
    tokio::task::spawn_blocking(move || {
        match credential_entry(&service, &account_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("delete credential from system vault: {error}")),
        }
    })
    .await
    .map_err(|error| format!("credential delete task failed: {error}"))?
}
