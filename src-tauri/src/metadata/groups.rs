pub fn get_type_group(xml_name: &str) -> &'static str {
    match xml_name {
        "ApexClass" | "ApexTrigger" | "ApexPage" | "ApexComponent" | "StaticResource" => "Code",
        "LightningComponentBundle" | "AuraDefinitionBundle" | "LightningMessageChannel" => "Lightning",
        "CustomObject"
        | "CustomField"
        | "CustomMetadata"
        | "CustomSettings"
        | "ValidationRule"
        | "RecordType"
        | "BusinessProcess"
        | "CompactLayout"
        | "FieldSet"
        | "Index"
        | "SharingReason"
        | "WebLink" => "Data model",
        "Flow"
        | "FlowDefinition"
        | "WorkflowRule"
        | "WorkflowAlert"
        | "WorkflowFieldUpdate"
        | "ProcessBuilder" => "Automation",
        "FlexiPage"
        | "Layout"
        | "CustomTab"
        | "CustomApplication"
        | "CustomLabel"
        | "ListView"
        | "HomePageLayout"
        | "CustomPageWebLink"
        | "AppMenu" => "UI & layout",
        "PermissionSet"
        | "PermissionSetGroup"
        | "Profile"
        | "Role"
        | "SharingRules"
        | "SharingCriteriaRule"
        | "MutingPermissionSet"
        | "UserCriteria" => "Security",
        "ConnectedApp"
        | "NamedCredential"
        | "ExternalCredential"
        | "RemoteSiteSetting"
        | "CspTrustedSite"
        | "Certificate"
        | "AuthProvider" => "Integration",
        "Report" | "Dashboard" | "ReportType" => "Reports",
        "ExperienceBundle" | "Network" | "SiteDotCom" | "CustomSite" | "NavigationMenu" => {
            "Experience"
        }
        _ => "Other",
    }
}

