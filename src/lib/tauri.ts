import { invoke } from "@tauri-apps/api/core";
import type { OrgAuth } from "../store/org";

export type LoginDomain = "production" | "sandbox" | "alibaba";
export type RetrieveOutputMode = "extract" | "zip";

export interface MetadataTypeMeta {
  xml_name: string;
  directory_name: string | null;
  suffix: string | null;
  in_folder: boolean;
  group_name: string;
  /** 子类型时为其父类型的 xmlName（如 CustomObject）；顶层为 null */
  parent_xml_name: string | null;
}

export interface MetadataComponentMeta {
  full_name: string;
  file_name: string | null;
  last_modified: string | null;
  created_by_name: string | null;
}

export interface MetadataSelectionItem {
  metadata_type: string;
  members: string[];
}

export interface RetrieveResult {
  success: boolean;
  output_path: string;
  duration_ms: number;
  component_count: number;
}

export interface DeployResult {
  success: boolean;
  deploy_id: string | null;
  error_count: number;
  component_count: number;
  duration_ms: number;
  errors: Array<{
    file_name: string;
    line_number: number | null;
    column_number: number | null;
    message: string;
    error_type: string;
  }>;
}

export interface DeployHistoryRecord {
  id: number;
  org_id: string;
  working_dir: string;
  mode: string;
  test_level: string;
  success: boolean;
  deploy_id: string | null;
  component_count: number;
  error_count: number;
  duration_ms: number | null;
  errors_json: string;
  executed_at: string | null;
}

export interface QuickDeployRecord {
  deploy_id: string;
  org_id: string;
  working_dir: string;
  component_count: number;
  expires_at: string;
  used: boolean;
  created_at: string | null;
}

export interface ApexClassMeta {
  id: string;
  name: string;
}

export const tauriApi = {
  syncOrgs: () => invoke<OrgAuth[]>("sync_orgs"),
  listOrgs: () => invoke<OrgAuth[]>("list_orgs"),
  setDefaultOrg: (username: string) => invoke<void>("set_default_org", { username }),
  logoutOrg: (username: string) => invoke<void>("logout_org", { username }),
  /** Web OAuth only; call `syncOrgs` afterward to refresh the local list. */
  loginOrg: (payload: {
    alias?: string;
    loginDomain: LoginDomain;
    instanceUrl?: string;
    consumerKey?: string;
    consumerSecret?: string;
    port?: number;
  }) =>
    invoke<void>("login_org", {
      alias: payload.alias?.trim() || null,
      loginDomain: payload.loginDomain,
      instanceUrl: payload.instanceUrl?.trim() || null,
      consumerKey: payload.consumerKey?.trim() || null,
      consumerSecret: payload.consumerSecret?.trim() || null,
      port: payload.port ?? null,
    }),
  cancelLogin: () => invoke<void>("cancel_login"),
  openOrg: (username: string) => invoke<void>("open_org", { username }),
  pickProjectDirectory: () => invoke<string | null>("pick_project_directory"),
  setOrgLinkedProjectPath: (orgId: string, path: string | null) =>
    invoke<void>("set_org_linked_project_path", { orgId, path }),
  openOrgLinkedProjectInIde: (orgId: string) =>
    invoke<void>("open_org_linked_project_in_ide", { orgId }),
  listMetadataTypes: (payload: { orgId: string; forceRefresh?: boolean }) =>
    invoke<MetadataTypeMeta[]>("list_metadata_types", {
      orgId: payload.orgId,
      forceRefresh: payload.forceRefresh ?? false,
    }),
  listMetadataComponents: (payload: { orgId: string; metadataType: string; forceRefresh?: boolean }) =>
    invoke<MetadataComponentMeta[]>("list_metadata_components", {
      orgId: payload.orgId,
      metadataType: payload.metadataType,
      forceRefresh: payload.forceRefresh ?? false,
    }),
  retrieveMetadata: (payload: {
    orgId: string;
    orgAlias: string;
    selections: MetadataSelectionItem[];
    outputDir: string;
    outputMode: RetrieveOutputMode;
    apiVersion: string;
    eventId: string;
  }) =>
    invoke<RetrieveResult>("retrieve_metadata", {
      orgId: payload.orgId,
      orgAlias: payload.orgAlias,
      selections: payload.selections,
      outputDir: payload.outputDir,
      outputMode: payload.outputMode,
      apiVersion: payload.apiVersion,
      eventId: payload.eventId,
    }),
  cancelRetrieve: (eventId: string) => invoke<void>("cancel_retrieve", { eventId }),
  revealInFinder: (path: string) => invoke<void>("reveal_in_finder", { path }),
  refreshSchemaCache: (payload: { orgId: string; objectName?: string | null }) =>
    invoke<void>("refresh_schema_cache", {
      orgId: payload.orgId,
      objectName: payload.objectName ?? null,
    }),

  // Deployer
  deployMetadata: (payload: {
    orgId: string;
    workingDir: string;
    mode: string;
    testLevel: string;
    testClasses: string[];
    eventId: string;
  }) =>
    invoke<DeployResult>("deploy_metadata", {
      options: {
        orgId: payload.orgId,
        workingDir: payload.workingDir,
        mode: payload.mode,
        testLevel: payload.testLevel,
        testClasses: payload.testClasses,
        eventId: payload.eventId,
      },
    }),
  cancelDeploy: (eventId: string) => invoke<void>("cancel_deploy", { eventId }),
  quickDeploy: (payload: { orgId: string; deployId: string; eventId: string }) =>
    invoke<DeployResult>("quick_deploy", {
      orgId: payload.orgId,
      deployId: payload.deployId,
      eventId: payload.eventId,
    }),
  listDeployHistory: (payload: { orgId: string; limit?: number }) =>
    invoke<DeployHistoryRecord[]>("list_deploy_history", {
      orgId: payload.orgId,
      limit: payload.limit ?? 20,
    }),
  listQuickDeploys: (orgId: string) =>
    invoke<QuickDeployRecord[]>("list_quick_deploys", { orgId }),
  retrieveForDiff: (payload: { orgId: string; workingDir: string; eventId: string }) =>
    invoke<string>("retrieve_for_diff", {
      orgId: payload.orgId,
      workingDir: payload.workingDir,
      eventId: payload.eventId,
    }),
  openDiffTool: (command: string) => invoke<void>("open_diff_tool", { command }),
  searchApexTestClasses: (payload: { orgId: string; keyword: string }) =>
    invoke<ApexClassMeta[]>("search_apex_test_classes", {
      orgId: payload.orgId,
      keyword: payload.keyword,
    }),
  checkPackageXml: (workingDir: string) =>
    invoke<boolean>("check_package_xml", { workingDir }),
};
