use tauri::State;

use crate::db::models::{ChildRelationship, FieldMeta, ObjectMeta};
use crate::db::DbState;
use crate::schema::cache::{self, PicklistValue};

#[tauri::command]
pub async fn get_objects(
    state: State<'_, DbState>,
    org_id: String,
) -> Result<Vec<ObjectMeta>, String> {
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
    state: State<'_, DbState>,
    org_id: String,
    object_name: String,
    field_name: String,
) -> Result<Vec<PicklistValue>, String> {
    cache::get_picklist_values(&state.0, &org_id, &object_name, &field_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_schema_cache(
    state: State<'_, DbState>,
    org_id: String,
    object_name: Option<String>,
) -> Result<(), String> {
    cache::refresh_schema_cache(&state.0, &org_id, object_name.as_deref())
        .await
        .map_err(|e| e.to_string())
}
