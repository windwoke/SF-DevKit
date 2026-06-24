# SF DevKit AI Framework And Tool Calling Design

## Background

SF DevKit is a Tauri desktop application for Salesforce developers. The current architecture has a clear and useful boundary:

- Frontend features are implemented as React modules.
- Backend capabilities are exposed as Tauri commands.
- Salesforce access goes through the `sf` CLI.
- Schema, metadata, retrieve history, and related state are cached in SQLite.

The AI feature should preserve this boundary. The model should not directly access Salesforce, execute shell commands, or mutate local files. Instead, it should translate natural language into structured intent, call approved local tools, and return a preview or plan that the user can confirm.

## Goals

- Add a reusable AI framework that can support multiple product features.
- Support natural language to SOQL generation.
- Support natural language to metadata component selection.
- Support local project change discovery, such as "find all components I modified".
- Keep all Salesforce operations inside existing Rust/Tauri and `sf` CLI flows.
- Make AI actions inspectable and confirmable before executing side-effecting operations.
- Allow OpenAI-compatible providers through configurable base URL, API key, and model.

## Non-Goals

- Do not build a general autonomous agent that can run arbitrary commands.
- Do not let the model call the `sf` CLI directly.
- Do not automatically run generated SOQL, retrieve metadata, deploy metadata, or open external tools without user confirmation.
- Do not introduce a heavy agent framework before the app has concrete AI workflows.
- Do not replace existing Monaco completion, metadata browser, retrieve, deploy, or diff flows.

## Recommended Product Shape

The first version should expose AI inside existing modules instead of starting with a global chat assistant.

### SOQL Editor

Add a compact natural language input near the editor toolbar:

- User enters: "query opportunities created in the last 30 days with amount over 100000".
- AI generates SOQL.
- The query is inserted into the editor.
- The user reviews and manually runs it.

### Metadata Browser

Add an AI selection input near the metadata tree or package XML panel:

- User enters: "find Apex classes and Flows modified by me recently".
- AI returns `MetadataSelectionItem[]`.
- The UI highlights selected components and previews the generated `package.xml`.
- The user confirms before retrieve.

### Deployer

Later versions can add AI deploy assistance:

- Explain deploy errors.
- Suggest test classes.
- Build a validation plan.
- Compare local changes with target org through the existing diff flow.

## Architecture

```mermaid
flowchart LR
  UI["React AI entry points"] --> Tauri["Tauri command: ai_assist"]
  Tauri --> Orchestrator["AI Orchestrator"]
  Orchestrator --> Client["OpenAI-compatible client"]
  Orchestrator --> Router["Tool Router"]
  Router --> Schema["Schema cache"]
  Router --> Metadata["Metadata cache"]
  Router --> Git["Local project scan"]
  Router --> Existing["Existing Tauri services / sf CLI flows"]
  Existing --> Preview["Preview or confirmed action"]
```

## Backend Module Layout

Add a new Rust module:

```text
src-tauri/src/ai/
  mod.rs
  config.rs
  client.rs
  orchestrator.rs
  prompts.rs
  tool_router.rs
  tools.rs
  types.rs
```

### `config.rs`

Responsibilities:

- Load AI provider settings.
- Store base URL, API key, model, timeout, and enablement.
- Avoid logging secrets.

Suggested settings:

```ts
interface AiSettings {
  enabled: boolean;
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}
```

### `client.rs`

Responsibilities:

- Send requests to an OpenAI-compatible Responses or Chat Completions endpoint.
- Support tool/function calling.
- Parse model tool calls and final responses.
- Normalize provider errors into user-friendly messages.

### `orchestrator.rs`

Responsibilities:

- Accept `AiAssistRequest`.
- Build system prompt and context.
- Register available tools based on the requested workflow.
- Run the model/tool loop.
- Enforce max iterations.
- Return a structured `AiAssistResponse`.

The orchestrator is intentionally thin. It should not contain Salesforce business logic. It delegates business operations to the tool router.

### `tools.rs`

Responsibilities:

- Define tool schemas.
- Keep tool descriptions short and strict.
- Classify each tool as read-only or side-effecting.

### `tool_router.rs`

Responsibilities:

- Validate tool arguments.
- Execute allowed tools.
- Convert internal results into compact JSON for the model.
- Block unsafe or unknown tools.

### `prompts.rs`

Responsibilities:

- Define system prompts for each workflow.
- Make safety rules explicit.
- Require structured output.
- Tell the model to ask for clarification when required fields are missing.

## Tauri Commands

Add these commands:

```rust
#[tauri::command]
pub async fn ai_assist(request: AiAssistRequest) -> Result<AiAssistResponse, String>;

#[tauri::command]
pub async fn get_ai_settings() -> Result<AiSettingsPublic, String>;

#[tauri::command]
pub async fn save_ai_settings(settings: AiSettingsInput) -> Result<(), String>;

#[tauri::command]
pub async fn test_ai_connection() -> Result<(), String>;
```

`AiSettingsPublic` must not return the raw API key. It can return whether a key is configured.

## Frontend Module Layout

Add shared AI frontend code:

```text
src/modules/AiAssistant/
  AiPromptInput.tsx
  AiResultPreview.tsx
  intentTypes.ts
  useAiAssist.ts
```

Add settings to:

```text
src/store/settings.ts
src/components/Layout/Sidebar.tsx
```

Add module-specific entry points:

```text
src/modules/SoqlEditor/AiSoqlPrompt.tsx
src/modules/MetadataBrowser/AiMetadataPrompt.tsx
```

## Request And Response Types

```ts
type AiWorkflow = "soql" | "metadata_selection" | "local_changes" | "deploy_help";

interface AiAssistRequest {
  workflow: AiWorkflow;
  orgId: string | null;
  text: string;
  context?: Record<string, unknown>;
}

type AiAssistResponse =
  | AiSoqlResponse
  | AiMetadataSelectionResponse
  | AiClarificationResponse
  | AiErrorResponse;

interface AiSoqlResponse {
  kind: "soql";
  query: string;
  explanation: string;
  warnings: string[];
}

interface AiMetadataSelectionResponse {
  kind: "metadata_selection";
  selections: MetadataSelectionItem[];
  explanation: string;
  warnings: string[];
  packageXmlPreview?: string;
}

interface AiClarificationResponse {
  kind: "clarification";
  question: string;
  suggestions: string[];
}

interface AiErrorResponse {
  kind: "error";
  message: string;
  recoverable: boolean;
}
```

## Tool Calling Model

The model receives a list of approved tools. It may request tool calls. The application executes the requested tools locally and returns the results to the model. The model then either asks for another tool call or returns a final structured answer.

The app must enforce these rules:

- Unknown tools are rejected.
- Invalid arguments are rejected.
- Tool calls have a max iteration count.
- Side-effecting tools are not available during draft generation.
- Tool output is compact and does not include secrets.
- Final output must match one of the supported response schemas.

## Initial Tool Set

### `get_current_org`

Read-only.

Returns current org id, alias, username, org type, and linked project path if configured.

### `search_schema_objects`

Read-only.

Arguments:

```json
{ "keyword": "opportunity" }
```

Returns likely Salesforce objects from schema cache.

### `get_object_fields`

Read-only.

Arguments:

```json
{ "objectName": "Opportunity" }
```

Returns compact field metadata:

- API name
- label
- type
- relationship name
- picklist values when small enough

### `validate_soql_shape`

Read-only.

Arguments:

```json
{ "query": "SELECT Id FROM Account LIMIT 10" }
```

Performs lightweight local validation:

- Has `SELECT`.
- Has `FROM`.
- Referenced object exists when schema is available.
- Referenced top-level fields exist when schema is available.

This is not a replacement for Salesforce query validation.

### `search_metadata_types`

Read-only.

Arguments:

```json
{ "keyword": "flow" }
```

Returns matching metadata types from metadata cache.

### `search_metadata_components`

Read-only.

Arguments:

```json
{
  "metadataType": "Flow",
  "keyword": "order",
  "modifiedBy": "current_user",
  "modifiedWithinDays": 30
}
```

Returns matching components from metadata cache. If cache is stale or missing, the result should say so rather than silently retrieving.

### `scan_local_git_changes`

Read-only.

Arguments:

```json
{ "projectPath": "/path/to/project" }
```

Runs local git inspection for modified, added, deleted, and renamed files in the linked project path.

The result should include:

- status
- path
- inferred metadata type
- inferred member name
- confidence

### `map_paths_to_metadata_components`

Read-only.

Arguments:

```json
{
  "paths": [
    "force-app/main/default/classes/AccountService.cls",
    "force-app/main/default/flows/Order_After_Save.flow-meta.xml"
  ]
}
```

Maps Salesforce DX source paths to metadata selections.

### `build_package_xml_preview`

Read-only.

Arguments:

```json
{
  "selections": [
    { "metadata_type": "ApexClass", "members": ["AccountService"] }
  ],
  "apiVersion": "62.0"
}
```

Returns generated package XML using existing package XML logic.

## Side-Effecting Tools

These should not be directly callable in the first version:

- `run_soql_query`
- `retrieve_metadata`
- `retrieve_for_diff`
- `deploy_metadata`
- `quick_deploy`
- `open_diff_tool`
- `logout_org`

Instead, AI returns a preview and the UI uses existing user-confirmed actions.

## SOQL Workflow

```mermaid
sequenceDiagram
  participant User
  participant UI
  participant AI as AI Orchestrator
  participant Tools

  User->>UI: Natural language query
  UI->>AI: ai_assist(workflow="soql")
  AI->>Tools: search_schema_objects
  Tools-->>AI: candidate objects
  AI->>Tools: get_object_fields
  Tools-->>AI: compact fields
  AI->>Tools: validate_soql_shape
  Tools-->>AI: validation result
  AI-->>UI: AiSoqlResponse
  UI-->>User: Insert query into editor
```

## Metadata Selection Workflow

```mermaid
sequenceDiagram
  participant User
  participant UI
  participant AI as AI Orchestrator
  participant Tools

  User->>UI: "Find all components I modified"
  UI->>AI: ai_assist(workflow="metadata_selection")
  AI->>Tools: get_current_org
  Tools-->>AI: linked project path
  AI->>Tools: scan_local_git_changes
  Tools-->>AI: changed source paths
  AI->>Tools: map_paths_to_metadata_components
  Tools-->>AI: MetadataSelectionItem[]
  AI->>Tools: build_package_xml_preview
  Tools-->>AI: package.xml
  AI-->>UI: AiMetadataSelectionResponse
  UI-->>User: Preview selections and package.xml
```

## Prompt Strategy

Use separate system prompts per workflow.

### Shared Rules

- You are assisting inside SF DevKit.
- Use tools for schema, metadata, and local project facts.
- Do not invent Salesforce object names, field names, or metadata components when tools provide relevant data.
- If required context is missing, return a clarification response.
- Do not ask the user to run shell commands.
- Do not claim that an action was executed unless the tool result confirms it.
- Return only the required structured response.

### SOQL Rules

- Generate readable SOQL.
- Include a conservative `LIMIT` unless the user explicitly requests all rows.
- Prefer fields that exist in schema context.
- Use Salesforce date literals when appropriate.
- For ambiguous labels, choose the most likely object and include a warning.

### Metadata Rules

- Prefer local git changes when the user says "my changes" or "modified locally".
- Prefer metadata cache when the user says "in org", "recently modified", or "modified by me".
- Include warnings when cache is stale, linked project path is missing, or mapping confidence is low.

## Context Management

Do not send full schema or full metadata cache to the model.

Use retrieval-style narrowing:

1. Send user text and workflow.
2. Let the model call search tools.
3. Return only top candidates.
4. Let the model request details for selected candidates.
5. Return compact details.

For SOQL:

- Object search returns at most 10 objects.
- Field details return at most 200 fields.
- Picklist values are capped.

For metadata:

- Type search returns at most 20 types.
- Component search returns at most 100 components.
- Git scan can return all changed paths, but summaries should be compact.

## Security And Safety

- API keys are stored in app settings and never logged.
- AI requests should redact access tokens, org auth internals, and local secret files.
- The model cannot execute shell commands.
- The model cannot directly run Tauri commands.
- Side-effecting operations require explicit user confirmation.
- Generated SOQL is inserted into the editor instead of automatically executed.
- Generated metadata selections are previewed before retrieve or deploy.
- Tool calls should be audited in logs for debugging, excluding secrets.

## Error Handling

The UI should handle:

- AI disabled.
- Missing API key.
- Invalid base URL.
- Provider timeout.
- Provider returns malformed tool call.
- Tool call arguments fail validation.
- Schema cache missing.
- Metadata cache stale or missing.
- Linked project path missing.
- Git repository unavailable.

When the model cannot complete the request safely, return `AiClarificationResponse` or `AiErrorResponse`.

## Testing Strategy

### Rust Unit Tests

- Tool argument validation.
- Path to metadata component mapping.
- SOQL shape validation.
- Package XML preview generation.
- Orchestrator handling of malformed model responses.

### Frontend Unit Tests

- AI response rendering.
- Insert generated SOQL into editor.
- Apply metadata selections to browser state.
- Settings validation.

### Integration Tests

- Mock AI client returns tool calls.
- Orchestrator executes local tools in order.
- Final response is parsed and returned to frontend.

### Manual Verification

- Configure AI provider.
- Generate simple Account query.
- Generate Opportunity query using date filters.
- Find local changed Apex class.
- Find local changed Flow.
- Preview package XML from AI-generated selections.

## Phased Implementation

### Phase 1: Framework Skeleton

- Add settings for AI provider.
- Add Rust AI module.
- Add `ai_assist` command.
- Add OpenAI-compatible client.
- Add tool router with read-only tool support.
- Add mockable AI client for tests.

### Phase 2: SOQL Generation

- Add SOQL prompt input.
- Add schema search and field tools.
- Add SOQL structured response.
- Insert generated query into existing SOQL editor.

### Phase 3: Metadata Selection

- Add metadata prompt input.
- Add metadata type/component search tools.
- Add local git scan and path mapping tools.
- Preview selections and package XML.

### Phase 4: Deploy And Diff Assistance

- Explain deploy errors.
- Suggest test classes from changed Apex classes.
- Build diff plans.
- Keep deploy and diff actions behind existing confirmation UI.

## Open Questions

- Should API keys be stored in persisted Zustand settings, Tauri secure storage, or a local encrypted file?
- Should the app support multiple provider profiles or only one active provider?
- Should local git change detection include untracked files by default?
- Should "modified by me" use Salesforce metadata `created_by_name` / `last_modified`, local git author, or current org username?
- Should generated SOQL default to `LIMIT 200`, `LIMIT 500`, or no limit when the user asks for exports?

## Recommendation

Build a thin AI Orchestrator inside the Rust backend and expose module-specific AI entry points in the frontend. Start with two workflows: natural language to SOQL and natural language to metadata selection. Keep all actions preview-first and user-confirmed. Avoid a heavy agent framework until the app needs cross-module autonomous workflows.

