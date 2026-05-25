import { CanvasRouter } from "@/components/canvas/canvas-router";

export default async function CanvasEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="h-full w-full">
      <CanvasRouter canvasId={id} />
    </div>
  );
}
