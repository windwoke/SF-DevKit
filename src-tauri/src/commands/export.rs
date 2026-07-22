use rfd::FileDialog;

use crate::cli::runner::SuppressConsole;

#[tauri::command]
pub fn save_export_file(default_name: String, content: String) -> Result<(), String> {
    let Some(path) = FileDialog::new().set_file_name(&default_name).save_file() else {
        return Err("cancelled".to_string());
    };
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_in_editor(content: String, default_name: String) -> Result<String, String> {
    let mut path = std::env::temp_dir();
    path.push(&default_name);
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;

    let file_path = path.to_string_lossy().to_string();
    // macOS: open with default text editor
    let status = tokio::process::Command::new("open")
        .suppress_console()
        .arg("-t")
        .arg(&file_path)
        .status()
        .await
        .map_err(|e| format!("Failed to spawn open: {}", e))?;

    if status.success() {
        Ok(file_path)
    } else {
        Err(format!(
            "Failed to open: exit code {}",
            status.code().unwrap_or(-1)
        ))
    }
}
