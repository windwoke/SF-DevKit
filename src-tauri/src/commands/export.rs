use rfd::FileDialog;

#[tauri::command]
pub fn save_export_file(default_name: String, content: String) -> Result<(), String> {
    let Some(path) = FileDialog::new().set_file_name(&default_name).save_file() else {
        return Err("cancelled".to_string());
    };
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}
