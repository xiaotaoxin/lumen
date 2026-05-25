"use client";

import * as React from "react";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

const DirectorStageEditor = dynamic(
  () => import("@/components/director/director-stage-editor").then((m) => m.DirectorStageEditor),
  { ssr: false, loading: () => <FullScreenLoader /> },
);

function FullScreenLoader() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black text-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" />
      载入导演台…
    </div>
  );
}

export default function DirectorStagePage() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const back = search.get("back") ?? "/app/canvas";

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <DirectorStageEditor docId={params.id} backHref={back} />
    </div>
  );
}
