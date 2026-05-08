import type { ModuleId } from "../../store/ui";

const stroke = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.65,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Org / 云 */
export function IconOrgNav() {
  return (
    <svg {...stroke} aria-hidden>
      <path d="M7 18h11a4 4 0 0 0 0-8h-.5A5.5 5.5 0 0 0 7 9a4 4 0 0 0-4 4 4 4 0 0 0 4 5z" />
    </svg>
  );
}

/** SOQL / 查询编辑器 */
export function IconSoqlNav() {
  return (
    <svg {...stroke} aria-hidden>
      <path d="M8 5h12M8 12h8M8 19h12" />
      <path d="M4 5h.01M4 12h.01M4 19h.01" />
    </svg>
  );
}

/** Metadata / 分层结构 */
export function IconMetadataNav() {
  return (
    <svg {...stroke} aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M6.5 10v3.5H14" />
    </svg>
  );
}

export function IconApexNav() {
  return (
    <svg {...stroke} aria-hidden>
      <path d="M11 3L4 14h6l-1 7 8-12h-6l1-6z" />
    </svg>
  );
}

export function IconDeployNav() {
  return (
    <svg {...stroke} aria-hidden>
      <path d="M12 4v9" />
      <path d="M8.5 9.5L12 13l3.5-3.5" />
      <rect x="4" y="16" width="16" height="4" rx="1.5" />
    </svg>
  );
}

export function IconLogNav() {
  return (
    <svg {...stroke} aria-hidden>
      <path d="M5 5h14v14H5z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}

/** 设置 */
export function IconSettingsNav() {
  return (
    <svg {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

export function SidebarModuleIcon({ id }: { id: ModuleId }) {
  if (id === "orgs") return <IconOrgNav />;
  if (id === "soql") return <IconSoqlNav />;
  if (id === "metadata") return <IconMetadataNav />;
  if (id === "apex") return <IconApexNav />;
  if (id === "deployer") return <IconDeployNav />;
  return <IconLogNav />;
}
