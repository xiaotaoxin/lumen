"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { CanvasEditor } from "./canvas-editor";
import { FreeformCanvasEditor } from "./freeform-canvas-editor";
import * as canvasesApi from "@/lib/api/canvases";
import type { CanvasKind } from "@/lib/types";

/**
 * Loads the canvas doc once on mount to determine which editor to mount.
 * Each editor is responsible for its own subsequent loading & saving.
 */
export function CanvasRouter({ canvasId }: { canvasId: string }) {
  const [kind, setKind] = React.useState<CanvasKind | null>(null);
  const [missing, setMissing] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    canvasesApi.get(canvasId).then((d) => {
      if (cancelled) return;
      if (!d) { setMissing(true); return; }
      setKind(d.kind);
    });
    return () => { cancelled = true; };
  }, [canvasId]);

  if (missing) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        画布不存在或已删除
      </div>
    );
  }
  if (!kind) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />载入画布…
      </div>
    );
  }
  if (kind === "freeform") return <FreeformCanvasEditor canvasId={canvasId} />;
  return <CanvasEditor canvasId={canvasId} />;
}
