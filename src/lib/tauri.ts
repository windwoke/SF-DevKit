import { invoke } from "@tauri-apps/api/core";
import type { OrgAuth } from "../store/org";

export type LoginDomain = "production" | "sandbox";
export type RetrieveOutputMode = "extract" | "zip";

export interface MetadataTypeMeta {
  xml_name: string;
  directory_name: string | null;
  suffix: string | null;
  in_folder: boolean;
  group_name: string;
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

export const tauriApi = {
  syncOrgs: () => invoke<OrgAuth[]>("sync_orgs"),
  listOrgs: () => invoke<OrgAuth[]>("list_orgs"),
  setDefaultOrg: (username: string) => invoke<void>("set_default_org", { username }),
  logoutOrg: (username: string) => invoke<void>("logout_org", { username }),
  /** Web OAuth only; call `syncOrgs` afterward to refresh the local list. */
  loginOrg: (payload: { alias?: string; loginDomain: LoginDomain }) =>
    invoke<void>("login_org", {
      alias: payload.alias?.trim() || null,
      login_domain: payload.loginDomain,
    }),
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
    selections: MetadataSelectionItem[];
    outputDir: string;
    outputMode: RetrieveOutputMode;
    apiVersion: string;
    eventId: string;
  }) =>
    invoke<RetrieveResult>("retrieve_metadata", payload),
  cancelRetrieve: (eventId: string) => invoke<void>("cancel_retrieve", { eventId }),
  revealInFinder: (path: string) => invoke<void>("reveal_in_finder", { path }),
  refreshSchemaCache: (payload: { orgId: string; objectName?: string | null }) =>
    invoke<void>("refresh_schema_cache", {
      orgId: payload.orgId,
      objectName: payload.objectName ?? null,
    }),
};
