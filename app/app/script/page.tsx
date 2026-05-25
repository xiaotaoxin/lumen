"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Upload, Loader2, Sparkles, Check, ArrowRight, Users2, Camera, Package, Film, User, MapPin, Box } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PipelineGuide } from "@/components/workspace/pipeline-guide";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await import("@/lib/api/client")).getToken();
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers as Record<string, string> || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `请求失败 (${res.status})`);
  }
  return res.json();
}

interface CharItem { name: string; description: string; tags: string[]; }
interface SceneItem { name: string; description: string; timeOfDay: string; tags: string[]; }
interface PropItem { name: string; description: string; tags: string[]; }
interface ShotItem { sceneName: string; shotSize: string; cameraAngle: string; cameraMovement: string; dialogue: string; speaker: string; description: string; }
interface Analysis { title: string; characters: CharItem[]; scenes: SceneItem[]; props: PropItem[]; shots: ShotItem[]; }

const EXAMPLE_SCRIPT = `# 月光下的约定

## 第一幕

深夜，古老的钟楼敲响十二下。月光透过彩色玻璃窗洒在石板地面上，映出斑斓的光影。

小夜裹紧深蓝色的斗篷，悄无声息地穿过长廊。她的黑发在月光下泛着银光，紫色的眼眸警惕地扫视四周。手里紧握着一把刻满符文的白银匕首。

"你终于来了。"一个低沉的男声从阴影中传来。

钟楼守护者从石柱后走出。他身形高大，披着暗红色的长袍，银白色的短发凌乱地垂在额前。右眼有一道旧伤疤。

"把钥匙交出来。"小夜举起匕首，声音冰冷，"我知道是你偷走的。"

守护者轻笑一声，从怀中取出一枚发光的月长石："你在找这个？可惜，我不能给你。打开那扇门的代价，你付不起。"
`;

export default function ScriptPage() {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [applied, setApplied] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) { toast.error("文件最大 500KB"); return; }
    const content = await file.text();
    setText(content);
    toast.success(`已加载：${file.name}`);
  };

  const analyze = async () => {
    if (!text.trim() || analyzing) return;
    setAnalyzing(true); setError("");
    try {
      const result = await apiFetch<Analysis>("/script/analyze", { method: "POST", body: JSON.stringify({ text: text.trim() }) });
      setAnalysis(result);
      toast.success(`分析完成：${result.characters.length} 角色 · ${result.shots.length} 镜头`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const apply = async () => {
    if (!analysis || applying) return;
    setApplying(true);
    try {
      const result = await apiFetch<Record<string, string[]>>("/script/apply", {
        method: "POST",
        body: JSON.stringify(analysis),
      });
      const subCount = result.subjects?.length || 0;
      const shotCount = result.storyboardFrames?.length || 0;
      setApplied(true);
      toast.success(`已创建 ${subCount} 个素材 + ${shotCount} 个分镜帧`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PipelineGuide />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-8">
          <div className="mb-8">
            <h1 className="font-display text-3xl tracking-tight">剧本分析</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              上传小说或剧本，AI 自动提取角色、场景、道具，拆分为分镜镜头。
            </p>
          </div>

          {/* Input area */}
          {!analysis && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:border-brand-400/30">
                  <Upload className="size-4 text-muted-foreground" />
                  上传 TXT
                  <input type="file" accept=".txt,.md" className="hidden" onChange={handleFile} />
                </label>
                <button
                  onClick={() => setText(EXAMPLE_SCRIPT)}
                  className="text-sm text-brand-500 hover:underline"
                >
                  试试示例剧本
                </button>
              </div>

              <Textarea
                placeholder="在此粘贴或直接输入剧本内容…&#10;支持小说、剧本、故事大纲。AI 会自动分析角色、场景、分镜。"
                value={text}
                onChange={e => setText(e.target.value)}
                className="min-h-48 text-sm font-mono leading-relaxed resize-y"
              />

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button variant="brand" size="lg" onClick={analyze} disabled={!text.trim() || analyzing} className="w-full">
                {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {analyzing ? "AI 正在分析剧本…" : "开始分析"}
              </Button>
            </div>
          )}

          {/* Analysis results */}
          {analysis && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              {/* Title */}
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl tracking-tight">{analysis.title}</h2>
                <Button variant="brand" onClick={apply} disabled={applying || applied}>
                  {applying ? <Loader2 className="size-4 animate-spin" /> : applied ? <Check className="size-4" /> : <Sparkles className="size-4" />}
                  {applied ? "已创建" : applying ? "创建中…" : "一键创建素材和分镜"}
                </Button>
              </div>

              {/* Characters */}
              <Section title="角色" icon={User} count={analysis.characters.length} color="text-amber-500">
                <div className="grid gap-3 sm:grid-cols-2">
                  {analysis.characters.map((ch, i) => (
                    <div key={i} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{ch.name}</span>
                        {ch.tags?.map(t => <Badge key={t} variant="muted" className="text-[10px]">{t}</Badge>)}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-3">{ch.description}</p>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Scenes */}
              <Section title="场景" icon={MapPin} count={analysis.scenes.length} color="text-emerald-500">
                <div className="grid gap-3 sm:grid-cols-2">
                  {analysis.scenes.map((sc, i) => (
                    <div key={i} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{sc.name}</span>
                        <Badge variant="muted" className="text-[10px]">{sc.timeOfDay}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{sc.description}</p>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Props */}
              {analysis.props.length > 0 && (
                <Section title="道具" icon={Box} count={analysis.props.length} color="text-purple-500">
                  <div className="flex flex-wrap gap-2">
                    {analysis.props.map((pr, i) => (
                      <Badge key={i} variant="outline" className="px-3 py-1.5 text-xs">
                        {pr.name}: {pr.description.slice(0, 40)}…
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}

              {/* Shots */}
              <Section title="分镜镜头" icon={Film} count={analysis.shots.length} color="text-brand-500">
                <div className="space-y-2">
                  {analysis.shots.map((shot, i) => (
                    <div key={i} className="flex gap-3 rounded-lg border border-border bg-card p-3">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 text-xs font-medium">
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed">{shot.description}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge variant="muted" className="text-[10px]">{shot.shotSize}</Badge>
                          <Badge variant="muted" className="text-[10px]">{shot.cameraAngle}</Badge>
                          <Badge variant="muted" className="text-[10px]">{shot.cameraMovement}</Badge>
                          {shot.sceneName && <Badge variant="outline" className="text-[10px]">📍{shot.sceneName}</Badge>}
                          {shot.speaker && <Badge variant="outline" className="text-[10px]">🗣{shot.speaker}</Badge>}
                        </div>
                        {shot.dialogue && (
                          <p className="mt-1 text-xs italic text-muted-foreground">"{shot.dialogue}"</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Next steps */}
              {applied && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-brand-400/30 bg-brand-500/5 p-6 text-center">
                  <Check className="size-8 text-brand-500 mx-auto mb-2" />
                  <p className="font-medium">素材和分镜已创建！</p>
                  <p className="mt-1 text-sm text-muted-foreground">去素材库和分镜页查看，然后生成角色图和分镜图</p>
                  <div className="mt-4 flex gap-3 justify-center">
                    <Button variant="outline" onClick={() => router.push("/app/subjects")}><Users2 className="size-4" /> 素材库</Button>
                    <Button variant="brand" onClick={() => router.push("/app/storyboards")}><Film className="size-4" /> 分镜编辑器</Button>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, count, color, children }: {
  title: string; icon: React.ComponentType<{ className?: string }>; count: number; color: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn("size-4", color)} />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="muted" className="text-[10px]">{count}</Badge>
      </div>
      {children}
    </div>
  );
}
