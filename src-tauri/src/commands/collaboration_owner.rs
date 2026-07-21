use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::ffi::{CString, OsStr};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(unix)]
use std::path::Component;
use std::path::{Path, PathBuf};

const OWNER_PREFIX: &str = "junqi-desktop:";
const MAX_OWNER_BYTES: usize = 142;
const MAX_OWNER_FILE_BYTES: u64 = 256;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationMaintenanceOwnerParams {
    #[serde(default)]
    legacy_owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationMaintenanceOwner {
    owner: String,
    created: bool,
    adopted_legacy: bool,
}

fn owner_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join(".config")
        })
        .join("com.junqi.junqidesktop")
        .join("collaboration-maintenance-owner-v1")
}

fn validate_owner(value: &str) -> Result<String, String> {
    if value != value.trim() || value.len() > MAX_OWNER_BYTES {
        return Err("Collaboration maintenance owner is malformed".to_string());
    }
    let suffix = value
        .strip_prefix(OWNER_PREFIX)
        .ok_or_else(|| "Collaboration maintenance owner has an invalid prefix".to_string())?;
    if suffix.is_empty()
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Collaboration maintenance owner has invalid characters".to_string());
    }
    Ok(value.to_string())
}

#[cfg(not(unix))]
fn read_owner(path: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect collaboration maintenance owner: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_OWNER_FILE_BYTES {
        return Err(
            "Collaboration maintenance owner path is not a bounded regular file".to_string(),
        );
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("Failed to open collaboration maintenance owner: {error}"))?;
    let opened = file
        .metadata()
        .map_err(|error| format!("Failed to verify collaboration maintenance owner: {error}"))?;
    if !opened.is_file() || opened.len() > MAX_OWNER_FILE_BYTES {
        return Err("Collaboration maintenance owner changed while opening".to_string());
    }
    let mut raw = String::new();
    file.take(MAX_OWNER_FILE_BYTES + 1)
        .read_to_string(&mut raw)
        .map_err(|error| format!("Failed to read collaboration maintenance owner: {error}"))?;
    if raw.len() as u64 > MAX_OWNER_FILE_BYTES {
        return Err("Collaboration maintenance owner file is too large".to_string());
    }
    validate_owner(&raw)
}

#[cfg(not(unix))]
fn sync_parent(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Failed to sync collaboration owner directory: {error}"))?;
    }
    Ok(())
}

#[cfg(unix)]
fn descriptor_component(name: &OsStr, label: &str) -> Result<CString, String> {
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(component)) if component == name)
        || components.next().is_some()
    {
        return Err(format!("{label} contains an unsafe path component"));
    }
    CString::new(name.as_bytes()).map_err(|_| format!("{label} contains a NUL byte"))
}

#[cfg(unix)]
fn openat_file(
    directory: &File,
    name: &OsStr,
    flags: libc::c_int,
    mode: libc::mode_t,
    label: &str,
) -> Result<File, std::io::Error> {
    let name = descriptor_component(name, label)
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    // SAFETY: `directory` is a live descriptor, `name` is a single NUL-terminated component,
    // and a successful descriptor is transferred immediately into `File`.
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            flags,
            mode as libc::c_uint,
        )
    };
    if descriptor < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: `openat` returned a new descriptor owned by this call.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn normalize_system_path_prefix(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Ok(path.to_path_buf());
    }

    // macOS exposes `/var` and `/tmp` as symlinks into `/private`. Resolve only that
    // OS-owned prefix; application-controlled components remain protected by O_NOFOLLOW.
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let mut components = path.components();
        let _ = components.next();
        if let Some(Component::Normal(first)) = components.next() {
            let first_path = Path::new("/").join(first);
            if let Ok(metadata) = fs::symlink_metadata(&first_path) {
                if metadata.file_type().is_symlink() {
                    let canonical_first = fs::canonicalize(&first_path).map_err(|error| {
                        format!("Failed to resolve the operating-system path prefix: {error}")
                    })?;
                    if canonical_first.parent() != Some(Path::new("/private")) {
                        return Err(
                            "Owner path contains an application-controlled symbolic-link root"
                                .to_string(),
                        );
                    }
                    let mut normalized = canonical_first;
                    for component in components {
                        normalized.push(component.as_os_str());
                    }
                    return Ok(normalized);
                }
            }
        }
    }

    Ok(path.to_path_buf())
}

#[cfg(unix)]
struct OwnerDirectory {
    file: File,
}

#[cfg(unix)]
impl OwnerDirectory {
    fn open_parent(path: &Path, create: bool) -> Result<Self, String> {
        let path = normalize_system_path_prefix(path)?;
        let mut directory = if path.is_absolute() {
            OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
                .open("/")
                .map_err(|error| format!("Failed to open the filesystem root: {error}"))?
        } else {
            OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
                .open(".")
                .map_err(|error| format!("Failed to open the current directory: {error}"))?
        };

        for component in path.components() {
            let Component::Normal(name) = component else {
                if matches!(component, Component::RootDir | Component::CurDir) {
                    continue;
                }
                return Err("Owner path contains an unsafe directory component".to_string());
            };
            let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
            let next = match openat_file(&directory, name, flags, 0, "owner directory") {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                    let name_c = descriptor_component(name, "owner directory")?;
                    // SAFETY: the parent descriptor and single component are validated above;
                    // mkdirat never follows the final component.
                    let created = unsafe {
                        libc::mkdirat(
                            directory.as_raw_fd(),
                            name_c.as_ptr(),
                            0o700 as libc::mode_t,
                        )
                    };
                    if created < 0 {
                        let create_error = std::io::Error::last_os_error();
                        if create_error.kind() != std::io::ErrorKind::AlreadyExists {
                            return Err(format!(
                                "Failed to create collaboration owner directory: {create_error}"
                            ));
                        }
                    }
                    openat_file(&directory, name, flags, 0, "owner directory").map_err(|error| {
                        format!("Failed to securely open collaboration owner directory: {error}")
                    })?
                }
                Err(error) => {
                    return Err(format!(
                        "Failed to securely open owner directory component {:?}; it may be missing, non-directory, or symbolic link: {error}",
                        name.to_string_lossy()
                    ));
                }
            };
            directory = next;
        }

        Ok(Self { file: directory })
    }

    fn open_regular_file(&self, name: &OsStr, label: &str) -> Result<File, std::io::Error> {
        let flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        let file = openat_file(&self.file, name, flags, 0, label)?;
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{label} is not a regular file"),
            ));
        }
        Ok(file)
    }

    fn create_regular_file(&self, name: &OsStr, label: &str) -> Result<File, std::io::Error> {
        let flags =
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        openat_file(&self.file, name, flags, 0o600 as libc::mode_t, label)
    }

    fn unlink_file_if_present(&self, name: &OsStr, label: &str) -> Result<(), String> {
        let name = descriptor_component(name, label)?;
        // SAFETY: the directory descriptor and component are valid. unlinkat does not follow
        // symbolic links and only removes an entry directly beneath this pinned directory.
        if unsafe { libc::unlinkat(self.file.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("Failed to remove {label}: {error}"));
            }
        }
        Ok(())
    }

    fn link_if_absent(
        &self,
        source: &OsStr,
        destination: &OsStr,
        label: &str,
    ) -> Result<(), std::io::Error> {
        let source = descriptor_component(source, label)
            .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
        let destination = descriptor_component(destination, label)
            .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
        // SAFETY: both names are validated single components beneath the same live directory.
        let result = unsafe {
            libc::linkat(
                self.file.as_raw_fd(),
                source.as_ptr(),
                self.file.as_raw_fd(),
                destination.as_ptr(),
                0,
            )
        };
        if result < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }

    fn sync(&self) -> Result<(), String> {
        self.file
            .sync_all()
            .map_err(|error| format!("Failed to sync collaboration owner directory: {error}"))
    }
}

#[cfg(unix)]
fn read_owner_at(directory: &OwnerDirectory, name: &OsStr) -> Result<Option<String>, String> {
    let file = match directory.open_regular_file(name, "collaboration maintenance owner") {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Failed to open collaboration maintenance owner: {error}"
            ));
        }
    };
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to verify collaboration maintenance owner: {error}"))?;
    if metadata.len() > MAX_OWNER_FILE_BYTES {
        return Err(
            "Collaboration maintenance owner path is not a bounded regular file".to_string(),
        );
    }
    let mut raw = String::new();
    file.take(MAX_OWNER_FILE_BYTES + 1)
        .read_to_string(&mut raw)
        .map_err(|error| format!("Failed to read collaboration maintenance owner: {error}"))?;
    if raw.len() as u64 > MAX_OWNER_FILE_BYTES {
        return Err("Collaboration maintenance owner file is too large".to_string());
    }
    validate_owner(&raw).map(Some)
}

#[cfg(unix)]
fn load_or_create_owner_unix(
    path: &Path,
    legacy_owner: Option<&str>,
) -> Result<CollaborationMaintenanceOwner, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Collaboration maintenance owner path has no parent".to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "Collaboration maintenance owner path has no file name".to_string())?;
    let directory = OwnerDirectory::open_parent(parent, true)?;

    if let Some(owner) = read_owner_at(&directory, name)? {
        return Ok(CollaborationMaintenanceOwner {
            owner,
            created: false,
            adopted_legacy: false,
        });
    }

    let adopted_legacy = legacy_owner.and_then(|value| validate_owner(value).ok());
    let owner = adopted_legacy
        .clone()
        .unwrap_or_else(|| format!("{OWNER_PREFIX}{}", uuid::Uuid::new_v4()));
    let temporary_name = format!(
        ".collaboration-maintenance-owner-{}-{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    );
    let temporary = OsStr::new(&temporary_name);
    let mut file = directory
        .create_regular_file(temporary, "temporary collaboration maintenance owner")
        .map_err(|error| format!("Failed to create collaboration maintenance owner: {error}"))?;
    if let Err(error) = file
        .write_all(owner.as_bytes())
        .and_then(|_| file.sync_all())
    {
        drop(file);
        let _ = directory
            .unlink_file_if_present(temporary, "temporary collaboration maintenance owner");
        return Err(format!(
            "Failed to persist collaboration maintenance owner: {error}"
        ));
    }
    drop(file);

    match directory.link_if_absent(temporary, name, "collaboration maintenance owner") {
        Ok(()) => {
            directory
                .unlink_file_if_present(temporary, "temporary collaboration maintenance owner")?;
            directory.sync()?;
            Ok(CollaborationMaintenanceOwner {
                owner,
                created: true,
                adopted_legacy: adopted_legacy.is_some(),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            directory
                .unlink_file_if_present(temporary, "temporary collaboration maintenance owner")?;
            let owner = read_owner_at(&directory, name)?.ok_or_else(|| {
                "Collaboration maintenance owner disappeared after concurrent creation".to_string()
            })?;
            Ok(CollaborationMaintenanceOwner {
                owner,
                created: false,
                adopted_legacy: false,
            })
        }
        Err(error) => {
            let _ = directory
                .unlink_file_if_present(temporary, "temporary collaboration maintenance owner");
            Err(format!(
                "Failed to atomically activate collaboration maintenance owner: {error}"
            ))
        }
    }
}

fn load_or_create_owner_at(
    path: &Path,
    legacy_owner: Option<&str>,
) -> Result<CollaborationMaintenanceOwner, String> {
    #[cfg(unix)]
    {
        load_or_create_owner_unix(path, legacy_owner)
    }

    #[cfg(not(unix))]
    {
        match read_owner(path) {
            Ok(owner) => {
                return Ok(CollaborationMaintenanceOwner {
                    owner,
                    created: false,
                    adopted_legacy: false,
                });
            }
            Err(error) if path.exists() => return Err(error),
            Err(_) => {}
        }

        let parent = path
            .parent()
            .ok_or_else(|| "Collaboration maintenance owner path has no parent".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create collaboration owner directory: {error}"))?;
        let parent_metadata = fs::symlink_metadata(parent)
            .map_err(|error| format!("Failed to inspect collaboration owner directory: {error}"))?;
        if !parent_metadata.file_type().is_dir() || parent_metadata.file_type().is_symlink() {
            return Err(
                "Collaboration maintenance owner directory is not a real directory".to_string(),
            );
        }

        let adopted_legacy = legacy_owner.and_then(|value| validate_owner(value).ok());
        let owner = adopted_legacy
            .clone()
            .unwrap_or_else(|| format!("{OWNER_PREFIX}{}", uuid::Uuid::new_v4()));
        let temporary = parent.join(format!(
            ".collaboration-maintenance-owner-{}-{}.tmp",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|error| {
            format!("Failed to create collaboration maintenance owner: {error}")
        })?;
        if let Err(error) = file
            .write_all(owner.as_bytes())
            .and_then(|_| file.sync_all())
        {
            let _ = fs::remove_file(&temporary);
            return Err(format!(
                "Failed to persist collaboration maintenance owner: {error}"
            ));
        }
        drop(file);

        match fs::hard_link(&temporary, path) {
            Ok(()) => {
                let _ = fs::remove_file(&temporary);
                sync_parent(parent)?;
                Ok(CollaborationMaintenanceOwner {
                    owner,
                    created: true,
                    adopted_legacy: adopted_legacy.is_some(),
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let _ = fs::remove_file(&temporary);
                Ok(CollaborationMaintenanceOwner {
                    owner: read_owner(path)?,
                    created: false,
                    adopted_legacy: false,
                })
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                Err(format!(
                    "Failed to atomically activate collaboration maintenance owner: {error}"
                ))
            }
        }
    }
}

#[tauri::command]
pub fn get_collaboration_maintenance_owner(
    params: CollaborationMaintenanceOwnerParams,
) -> Result<CollaborationMaintenanceOwner, String> {
    load_or_create_owner_at(&owner_path(), params.legacy_owner.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-collaboration-owner-test-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn adopts_legacy_owner_once_and_reuses_the_durable_value() {
        let root = test_root();
        let path = root.join("owner");
        let legacy = "junqi-desktop:legacy-owner-1";

        let created = load_or_create_owner_at(&path, Some(legacy)).unwrap();
        assert_eq!(created.owner, legacy);
        assert!(created.created);
        assert!(created.adopted_legacy);

        let reused = load_or_create_owner_at(&path, Some("junqi-desktop:other-owner")).unwrap();
        assert_eq!(reused.owner, legacy);
        assert!(!reused.created);
        assert!(!reused.adopted_legacy);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_corrupt_owner_state_instead_of_rotating_identity() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let path = root.join("owner");
        fs::write(&path, "not-an-owner").unwrap();

        assert!(load_or_create_owner_at(&path, None).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not-an-owner");

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symbolic_link_owner_file() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target");
        fs::write(&target, "junqi-desktop:outside-owner").unwrap();
        let path = root.join("owner");
        symlink(&target, &path).unwrap();

        assert!(load_or_create_owner_at(&path, None).is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symbolic_link_in_the_owner_parent_chain() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        let outside = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let linked_parent = root.join("linked-parent");
        symlink(&outside, &linked_parent).unwrap();

        let result = load_or_create_owner_at(&linked_parent.join("owner"), None);

        assert!(result.is_err());
        assert!(!outside.join("owner").exists());

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn concurrent_first_creation_converges_on_one_durable_owner() {
        use std::collections::HashSet;
        use std::sync::{Arc, Barrier};

        const WRITERS: usize = 12;
        let root = test_root();
        let path = root.join("owner");
        let barrier = Arc::new(Barrier::new(WRITERS));
        let mut handles = Vec::with_capacity(WRITERS);

        for index in 0..WRITERS {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                let legacy_owner = format!("junqi-desktop:concurrent-owner-{index}");
                barrier.wait();
                load_or_create_owner_at(&path, Some(&legacy_owner))
            }));
        }

        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap().unwrap())
            .collect::<Vec<_>>();
        let owners = results
            .iter()
            .map(|result| result.owner.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(owners.len(), 1);
        assert_eq!(results.iter().filter(|result| result.created).count(), 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), results[0].owner);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);

        let _ = fs::remove_dir_all(root);
    }
}
