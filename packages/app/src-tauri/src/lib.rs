use fs2::FileExt;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::{fs, io::Write, path::Path};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_fs::FsExt;

pub mod app_config;
pub mod data_root;
#[cfg(target_os = "macos")]
mod drop_view;
mod secrets;

// Flag to track if close has been confirmed by frontend
static CLOSE_CONFIRMED: AtomicBool = AtomicBool::new(false);

/// The few menu-bar labels we author ourselves. Everything else in the menu bar is a
/// `PredefinedMenuItem`, whose text AppKit supplies in the language it resolved for the bundle
/// (`CFBundleLocalizations` ∩ the user's preferred languages — i.e. the SYSTEM language, not
/// the app's own Settings → Language, which only drives the web UI via i18next). These labels
/// therefore follow the system language too, so the bar never reads half translated.
///
/// The app menu (the first one) is the product name and stays untranslated, per Apple's HIG.
struct MenuLabels {
    file: &'static str,
    edit: &'static str,
    window: &'static str,
    save: &'static str,
}

/// Map a BCP-47-ish locale (`zh-Hans-CN`, `de-DE`, `en_US`, …) to our menu labels.
fn menu_labels_for(locale: &str) -> MenuLabels {
    let language = locale
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    match language.as_str() {
        "de" => MenuLabels {
            file: "Ablage",
            edit: "Bearbeiten",
            window: "Fenster",
            save: "Sichern",
        },
        "fr" => MenuLabels {
            file: "Fichier",
            edit: "Édition",
            window: "Fenêtre",
            save: "Enregistrer",
        },
        "zh" => MenuLabels {
            file: "文件",
            edit: "编辑",
            window: "窗口",
            save: "保存",
        },
        _ => MenuLabels {
            file: "File",
            edit: "Edit",
            window: "Window",
            save: "Save",
        },
    }
}

fn menu_labels() -> MenuLabels {
    menu_labels_for(&sys_locale::get_locale().unwrap_or_default())
}

#[cfg(test)]
mod menu_label_tests {
    use super::menu_labels_for;

    #[test]
    fn maps_region_and_script_variants() {
        assert_eq!(menu_labels_for("zh-Hans-CN").save, "保存");
        assert_eq!(menu_labels_for("zh_CN").file, "文件");
        assert_eq!(menu_labels_for("de-DE").edit, "Bearbeiten");
        assert_eq!(menu_labels_for("fr-FR").window, "Fenêtre");
        assert_eq!(menu_labels_for("en-US").file, "File");
    }

    #[test]
    fn falls_back_to_english() {
        assert_eq!(menu_labels_for("").save, "Save");
        assert_eq!(menu_labels_for("sv-SE").edit, "Edit");
    }
}

/// Confirm that the window can be closed (called by frontend after save/discard)
#[tauri::command]
fn confirm_close(window: tauri::Window) {
    CLOSE_CONFIRMED.store(true, Ordering::SeqCst);
    window.close().unwrap_or_else(|e| {
        log::error!("Failed to close window: {}", e);
    });
}

/// Read a user-dropped file as text. The path comes from a Tauri drag-drop
/// event, which implies user consent — no extra fs-scope check needed.
#[tauri::command]
fn read_eml_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Read a user-dropped file as bytes. Paths come from a drag-drop event in the
/// native Cocoa overlay, which the OS already gated by the user's drop gesture.
/// Bypasses the fs plugin's scope so Finder-dropped files anywhere on disk work.
/// Returns `tauri::ipc::Response` so the bytes cross the IPC boundary as a
/// binary ArrayBuffer rather than a JSON number-array (matters for PDFs etc.).
#[tauri::command]
fn read_dropped_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// Delete a temp file that was created from a file-promise drop, after the
/// frontend has parsed it. Paths originate from our own drop_view code under
/// `NSTemporaryDirectory()/desk-drops/`, so missing-file is non-fatal.
#[tauri::command]
fn delete_dropped_file(path: String) -> Result<(), String> {
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Open a file with the system's default application
#[tauri::command]
fn open_file_with_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

/// Reveal a file or folder in the system file manager (Finder on macOS, Explorer on Windows)
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // On Linux, we can only open the parent directory
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(path);
        Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

/// Dynamically expand the file system scope to allow access to a directory.
/// Called by the frontend on startup with the user's configured data path.
#[tauri::command]
fn expand_fs_scope(
    app_handle: tauri::AppHandle,
    ownership: tauri::State<'_, Mutex<Option<DataRootOwnership>>>,
    path: String,
) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    fs::create_dir_all(&p).map_err(|error| {
        format!(
            "Failed to create DeskMD data folder {}: {error}",
            p.display()
        )
    })?;
    let canonical = p.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve DeskMD data folder {}: {error}",
            p.display()
        )
    })?;
    let mut current = ownership
        .lock()
        .map_err(|_| "Data-root ownership state is unavailable".to_string())?;
    let changing_root = match current.as_ref() {
        Some(owner) => owner.canonical_root != canonical,
        None => true,
    };
    let candidate = if changing_root {
        Some(acquire_data_root_ownership(&p)?)
    } else {
        None
    };
    app_handle
        .fs_scope()
        .allow_directory(&p, true)
        .map_err(|e| e.to_string())?;
    app_config::store_data_path(&path)?;
    data_root::set_data_root(p);
    if let Some(candidate) = candidate {
        *current = Some(candidate);
    }
    Ok(())
}

#[tauri::command]
fn release_data_root_ownership(
    ownership: tauri::State<'_, Mutex<Option<DataRootOwnership>>>,
) -> Result<(), String> {
    let mut current = ownership
        .lock()
        .map_err(|_| "Data-root ownership state is unavailable".to_string())?;
    *current = None;
    Ok(())
}

struct DataRootOwnership {
    _file: fs::File,
    canonical_root: std::path::PathBuf,
}

fn acquire_data_root_ownership(root: &Path) -> Result<DataRootOwnership, String> {
    fs::create_dir_all(root).map_err(|error| {
        format!(
            "Failed to create DeskMD data folder {}: {error}",
            root.display()
        )
    })?;
    let canonical_root = root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve DeskMD data folder {}: {error}",
            root.display()
        )
    })?;
    let lock_directory = canonical_root.join(".desk");
    fs::create_dir_all(&lock_directory).map_err(|error| {
        format!(
            "Failed to create DeskMD lock directory {}: {error}",
            lock_directory.display()
        )
    })?;
    let lock_path = lock_directory.join("writer.lock");
    let file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "Failed to open DeskMD writer lock {}: {error}",
                lock_path.display()
            )
        })?;
    file.try_lock_exclusive().map_err(|error| {
        format!(
            "DeskMD data folder is already owned by another process or does not support locking: {}. Stop the other DeskMD instance and try again. ({error})",
            canonical_root.display(),
        )
    })?;
    Ok(DataRootOwnership {
        _file: file,
        canonical_root,
    })
}

/// Canonicalize a path that may not exist yet. Walks up to the nearest existing
/// ancestor, canonicalizes it (resolving symlinks and `..`), then re-appends the
/// missing tail — rejecting any non-`Normal` tail component so `..` cannot escape.
fn lenient_canonicalize(input: &std::path::Path) -> Result<std::path::PathBuf, String> {
    use std::path::{Component, Path};

    // Fast path: the whole path already exists.
    if let Ok(real) = input.canonicalize() {
        return Ok(real);
    }

    // Find the nearest existing ancestor, collecting the missing tail bottom-up.
    let mut existing = input;
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        match existing.parent() {
            Some(parent) => {
                if let Some(name) = existing.file_name() {
                    tail.push(name);
                }
                existing = parent;
                if existing.exists() {
                    break;
                }
            }
            None => {
                return Err(format!("No existing ancestor for: {}", input.display()))
            }
        }
    }

    let mut result = existing
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize ancestor: {e}"))?;

    // Re-append the tail top-down, rejecting traversal components.
    for name in tail.iter().rev() {
        match Path::new(name).components().next() {
            Some(Component::Normal(part)) => result.push(part),
            _ => return Err("Path contains an invalid component".to_string()),
        }
    }
    Ok(result)
}

/// Allow filesystem access to a single path inside the configured data root.
///
/// The runtime fs scope on Unix matches with `require_literal_leading_dot`, so the
/// `dataDir/**` glob from `expand_fs_scope` cannot reach dot-prefixed paths
/// (`.aiignore`, `.view.json`, `.desk/`). This adds a *literal* allow entry, which
/// does match dot components. The frontend calls it just-in-time before touching a
/// hidden path; the data-root containment check is the real security boundary.
#[tauri::command]
fn allow_data_path(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let requested = std::path::PathBuf::from(&path);

    // The target may not exist yet (first write of `.view.json`, `.desk/index/...`).
    let target = lenient_canonicalize(&requested)?;
    let root_canon = lenient_canonicalize(&data_root::get_data_root())?;

    if !target.starts_with(&root_canon) {
        return Err(format!(
            "Path is outside the Desk data root: {}",
            requested.display()
        ));
    }

    // Use the ORIGINAL path: allow_file stores the escaped path plus a
    // canonicalized-parent variant, covering both the symlink and no-symlink cases.
    app_handle
        .fs_scope()
        .allow_file(&requested)
        .map_err(|e| e.to_string())
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum AtomicCreateTextResult {
    Created,
    Exists { current: Option<String> },
}

fn read_optional_text(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to read {}: {error}", path.display())),
    }
}

#[tauri::command]
fn create_text_file_atomically(
    ownership: tauri::State<'_, Mutex<Option<DataRootOwnership>>>,
    path: String,
    content: String,
) -> Result<AtomicCreateTextResult, String> {
    let _owner = lock_owned_data_root(&ownership)?;
    create_text_file_atomically_impl(path, content)
}

fn create_text_file_atomically_impl(
    path: String,
    content: String,
) -> Result<AtomicCreateTextResult, String> {
    let target = atomic_write_target(&path)?;
    let parent = target
        .parent()
        .ok_or_else(|| format!("File has no parent directory: {}", target.display()))?;
    let temporary = prepare_atomic_text_file(&target, &content)?;
    match temporary.persist_noclobber(&target) {
        Ok(_) => {
            sync_parent_directory(parent);
            Ok(AtomicCreateTextResult::Created)
        }
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            Ok(AtomicCreateTextResult::Exists {
                current: read_optional_text(&target)?,
            })
        }
        Err(error) => Err(format!("Failed to atomically create file: {}", error.error)),
    }
}

#[tauri::command]
fn replace_text_file_atomically(
    ownership: tauri::State<'_, Mutex<Option<DataRootOwnership>>>,
    path: String,
    content: String,
) -> Result<(), String> {
    let _owner = lock_owned_data_root(&ownership)?;
    replace_text_file_atomically_impl(path, content)
}

fn replace_text_file_atomically_impl(path: String, content: String) -> Result<(), String> {
    let target = atomic_write_target(&path)?;
    let parent = target
        .parent()
        .ok_or_else(|| format!("File has no parent directory: {}", target.display()))?;
    prepare_atomic_text_file(&target, &content)?
        .persist(&target)
        .map_err(|error| format!("Failed to atomically replace file: {}", error.error))?;
    sync_parent_directory(parent);
    Ok(())
}

fn lock_owned_data_root(
    ownership: &Mutex<Option<DataRootOwnership>>,
) -> Result<std::sync::MutexGuard<'_, Option<DataRootOwnership>>, String> {
    let owner = ownership
        .lock()
        .map_err(|_| "Data-root ownership state is unavailable".to_string())?;
    let Some(active) = owner.as_ref() else {
        return Err("DeskMD does not own the local data folder; writes are disabled".to_string());
    };
    let configured = lenient_canonicalize(&data_root::get_data_root())?;
    if active.canonical_root != configured {
        return Err("DeskMD data-root ownership does not match the configured folder".to_string());
    }
    Ok(owner)
}

fn atomic_write_target(path: &str) -> Result<std::path::PathBuf, String> {
    let requested = std::path::PathBuf::from(path);
    let target = lenient_canonicalize(&requested)?;
    let root = lenient_canonicalize(&data_root::get_data_root())?;
    if !target.starts_with(&root) {
        return Err(format!(
            "Path is outside the Desk data root: {}",
            requested.display()
        ));
    }
    Ok(target)
}

fn prepare_atomic_text_file(
    target: &Path,
    content: &str,
) -> Result<tempfile::NamedTempFile, String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("File has no parent directory: {}", target.display()))?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".deskmd-write-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|error| format!("Failed to create temporary file: {error}"))?;
    if let Ok(metadata) = fs::metadata(target) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|error| format!("Failed to preserve file permissions: {error}"))?;
    }
    temporary
        .write_all(content.as_bytes())
        .map_err(|error| format!("Failed to write temporary file: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Failed to flush temporary file: {error}"))?;
    Ok(temporary)
}

fn sync_parent_directory(parent: &Path) {
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            confirm_close,
            expand_fs_scope,
            release_data_root_ownership,
            allow_data_path,
            create_text_file_atomically,
            replace_text_file_atomically,
            read_eml_file,
            read_dropped_file,
            delete_dropped_file,
            open_file_with_default_app,
            reveal_in_finder,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
        ]);

    builder
        .setup(|app| {
            let initial_root = data_root::resolve_data_root(None);
            data_root::set_data_root(initial_root);
            // Local bootstrap claims the configured root through expand_fs_scope.
            // Native remote mode deliberately never claims the local folder.
            app.manage(Mutex::new(None::<DataRootOwnership>));

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Create custom menu with Save item that forwards to frontend
            let labels = menu_labels();
            let save_item =
                MenuItem::with_id(app, "save", labels.save, true, Some("CmdOrCtrl+S"))?;

            let file_menu = Submenu::with_items(app, labels.file, true, &[&save_item])?;

            let edit_menu = Submenu::with_items(
                app,
                labels.edit,
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            let window_menu = Submenu::with_items(
                app,
                labels.window,
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::fullscreen(app, None)?,
                ],
            )?;

            let menu = Menu::with_items(
                app,
                &[
                    &Submenu::with_items(
                        app,
                        "Desk",
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::services(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, None)?,
                            &PredefinedMenuItem::hide_others(app, None)?,
                            &PredefinedMenuItem::show_all(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::quit(app, None)?,
                        ],
                    )?,
                    &file_menu,
                    &edit_menu,
                    &window_menu,
                ],
            )?;

            app.set_menu(menu)?;

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = drop_view::install(&window) {
                        log::error!("Failed to install email drop view: {}", e);
                    }
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "save" {
                if let Some(window) = app.get_webview_window("main") {
                    window.emit("menu-save", ()).unwrap_or_else(|e| {
                        log::error!("Failed to emit menu-save event: {}", e);
                    });
                }
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // If close was confirmed by frontend, allow it
                if CLOSE_CONFIRMED.load(Ordering::SeqCst) {
                    CLOSE_CONFIRMED.store(false, Ordering::SeqCst);
                    return;
                }

                // Prevent default close behavior
                api.prevent_close();

                // Emit event to frontend to check for unsaved changes
                window
                    .emit("window-close-requested", ())
                    .unwrap_or_else(|e| {
                        log::error!("Failed to emit close-check event: {}", e);
                    });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod atomic_write_tests {
    use super::*;

    static TEST_ROOT_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn atomic_create_does_not_clobber_and_replace_cleans_up() {
        let _guard = TEST_ROOT_LOCK.lock().expect("test root lock");
        let directory = tempfile::tempdir().expect("temp directory");
        data_root::set_data_root(directory.path().to_path_buf());
        let target = directory.path().join("record.md");
        fs::write(&target, "original").expect("seed record");

        let conflict = create_text_file_atomically_impl(
            target.to_string_lossy().into_owned(),
            "wrong".to_string(),
        )
        .expect("conflict result");
        assert!(matches!(
            conflict,
            AtomicCreateTextResult::Exists { current: Some(value) } if value == "original"
        ));
        assert_eq!(
            fs::read_to_string(&target).expect("unchanged record"),
            "original"
        );

        replace_text_file_atomically_impl(
            target.to_string_lossy().into_owned(),
            "saved".to_string(),
        )
        .expect("written result");
        assert_eq!(fs::read_to_string(&target).expect("saved record"), "saved");
        assert_eq!(
            fs::read_dir(directory.path())
                .expect("directory entries")
                .count(),
            1
        );
    }

    #[test]
    fn data_root_ownership_is_exclusive_and_released_on_drop() {
        let _guard = TEST_ROOT_LOCK.lock().expect("test root lock");
        let directory = tempfile::tempdir().expect("temp directory");
        let first = acquire_data_root_ownership(directory.path()).expect("first owner");
        let error = acquire_data_root_ownership(directory.path())
            .err()
            .expect("second owner must fail");
        assert!(error.contains("already owned"));
        drop(first);
        acquire_data_root_ownership(directory.path()).expect("owner after release");
    }

    #[test]
    fn rejected_root_claim_does_not_change_the_active_root() {
        let _guard = TEST_ROOT_LOCK.lock().expect("test root lock");
        let first = tempfile::tempdir().expect("first root");
        let blocked = tempfile::tempdir().expect("blocked root");
        data_root::set_data_root(first.path().to_path_buf());
        let _blocker = acquire_data_root_ownership(blocked.path()).expect("blocking owner");

        assert!(acquire_data_root_ownership(blocked.path()).is_err());
        assert_eq!(data_root::get_data_root(), first.path());
    }
}

