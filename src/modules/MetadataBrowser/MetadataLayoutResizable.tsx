import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { MetadataTree } from "./MetadataTree";
import { PackageXmlPanel } from "./PackageXmlPanel";
import { RetrievePanel } from "./RetrievePanel";

const STORAGE_LEFT = "sf-devkit.metadataLayout.leftPx";
const STORAGE_RIGHT = "sf-devkit.metadataLayout.rightPx";
const DEFAULT_LEFT = 300;
const DEFAULT_RIGHT = 320;
const MIN_LEFT = 180;
const MIN_RIGHT = 220;
const MIN_CENTER = 200;
const RESIZER_W = 6;

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function clampPair(left: number, right: number, containerWidth: number): { l: number; r: number } {
  const reserved = RESIZER_W * 2;
  const maxL = containerWidth - reserved - MIN_CENTER - right;
  const maxR = containerWidth - reserved - MIN_CENTER - left;
  const l = Math.min(Math.max(left, MIN_LEFT), Math.max(maxL, MIN_LEFT));
  const r = Math.min(Math.max(right, MIN_RIGHT), Math.max(maxR, MIN_RIGHT));
  return { l, r };
}

export function MetadataLayoutResizable() {
  const { t } = useTranslation();
  const layoutRef = useRef<HTMLDivElement>(null);
  const [leftW, setLeftW] = useState(() => readStored(STORAGE_LEFT, DEFAULT_LEFT));
  const [rightW, setRightW] = useState(() => readStored(STORAGE_RIGHT, DEFAULT_RIGHT));
  const [dragging, setDragging] = useState<1 | 2 | null>(null);
  const latestRef = useRef({ l: leftW, r: rightW });
  latestRef.current = { l: leftW, r: rightW };

  const splitterAria = t("metadataBrowser.layout.splitterAria");

  const startDrag = (which: 1 | 2, e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = layoutRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startL = latestRef.current.l;
    const startR = latestRef.current.r;
    setDragging(which);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const cw = el.getBoundingClientRect().width;
      const dx = ev.clientX - startX;
      let nextL = startL;
      let nextR = startR;
      if (which === 1) nextL = startL + dx;
      else nextR = startR - dx;
      const { l, r } = clampPair(nextL, nextR, cw);
      latestRef.current = { l, r };
      setLeftW(l);
      setRightW(r);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      setDragging(null);
      const { l, r } = latestRef.current;
      try {
        localStorage.setItem(STORAGE_LEFT, String(Math.round(l)));
        localStorage.setItem(STORAGE_RIGHT, String(Math.round(r)));
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    const onResize = () => {
      const el = layoutRef.current;
      if (!el) return;
      const cw = el.getBoundingClientRect().width;
      const { l, r } = clampPair(latestRef.current.l, latestRef.current.r, cw);
      if (l !== latestRef.current.l || r !== latestRef.current.r) {
        latestRef.current = { l, r };
        setLeftW(l);
        setRightW(r);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div ref={layoutRef} className="metadata-layout">
      <div className="metadata-layout-pane metadata-layout-pane-left" style={{ flex: `0 0 ${leftW}px`, width: leftW }}>
        <MetadataTree />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={splitterAria}
        title={splitterAria}
        className={`metadata-layout-resizer${dragging === 1 ? " dragging" : ""}`}
        onMouseDown={(e) => startDrag(1, e)}
      />
      <div className="metadata-layout-pane metadata-layout-pane-center">
        <PackageXmlPanel />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={splitterAria}
        title={splitterAria}
        className={`metadata-layout-resizer${dragging === 2 ? " dragging" : ""}`}
        onMouseDown={(e) => startDrag(2, e)}
      />
      <div className="metadata-layout-pane metadata-layout-pane-right" style={{ flex: `0 0 ${rightW}px`, width: rightW }}>
        <RetrievePanel />
      </div>
    </div>
  );
}
