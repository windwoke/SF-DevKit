use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MetadataTypeMeta {
    pub xml_name: String,
    pub directory_name: Option<String>,
    pub suffix: Option<String>,
    pub in_folder: bool,
    pub group_name: String,
    /// 顶层类型为 `None`；来自 `childXmlNames` 的为父类型 `xmlName`（如 CustomObject → CustomField）。
    pub parent_xml_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComponentMeta {
    pub full_name: String,
    pub file_name: Option<String>,
    pub last_modified: Option<String>,
    pub created_by_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionItem {
    pub metadata_type: String,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetrieveResult {
    pub success: bool,
    pub output_path: String,
    pub duration_ms: u64,
    pub component_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetrieveEvent {
    pub event_type: String,
    pub data: String,
}
