use serde::Serialize;
use tauri::State;

use crate::db::models::{ChildRelationship, FieldMeta, ObjectMeta};
use crate::db::DbState;
use crate::schema::cache;

#[derive(Debug, Clone, Serialize)]
pub struct PicklistValue {
    pub label: String,
    pub value: String,
    pub active: bool,
}

#[tauri::command]
pub async fn get_objects(state: State<'_, DbState>, org_id: String) -> Result<Vec<ObjectMeta>, String> {
    cache::get_objects(&state.0, &org_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_fields(
    state: State<'_, DbState>,
    org_id: String,
    object_name: String,
) -> Result<Vec<FieldMeta>, String> {
    cache::get_fields(&state.0, &org_id, &object_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_child_relationships(
    state: State<'_, DbState>,
    org_id: String,
    object_name: String,
) -> Result<Vec<ChildRelationship>, String> {
    cache::get_child_relationships(&state.0, &org_id, &object_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_picklist_values(
    _state: State<'_, DbState>,
    _org_id: String,
    _object_name: String,
    _field_name: String,
) -> Result<Vec<PicklistValue>, String> {
    Ok(vec![])
}
