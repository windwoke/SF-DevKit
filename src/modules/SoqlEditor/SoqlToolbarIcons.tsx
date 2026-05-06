const stroke = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** 排版 / 格式化 */
export function IconFormat() {
  return (
    <svg {...stroke} aria-hidden>
      <path d="M4 7h6M4 12h4M4 17h8" />
      <path d="M14 7h6M12 12h8M10 17h10" />
    </svg>
  );
}

/** 复制 */
export function IconCopy() {
  return (
    <svg {...stroke} aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/** 刷新缓存 */
export function IconRefresh() {
  return (
    <svg {...stroke} aria-hidden>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

/** 导出 / 下载 */
export function IconExport() {
  return (
    <svg {...stroke} aria-hidden>
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 21h16" />
    </svg>
  );
}

/** 执行查询 */
export function IconRun() {
  return (
    <svg {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </svg>
  );
}
