import Link from "next/link";
import { ArrowRight, ImageIcon, Clapperboard, Sparkles } from "lucide-react";
import { TopNav } from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MODELS } from "@/lib/catalog";

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <TopNav variant="marketing" />

      {/* Hero */}
      <section className="aurora-bg relative overflow-hidden">
        <div className="mx-auto grid max-w-screen-2xl gap-16 px-6 py-24 md:grid-cols-[1.1fr_0.9fr] md:py-32">
          <div className="flex flex-col justify-center">
            <Badge variant="brand" className="mb-6 w-fit">
              <Sparkles className="size-3" />
              <span>Lumen v1 · 创作者预览</span>
            </Badge>
            <h1 className="font-display text-5xl leading-[1.05] tracking-tight md:text-7xl">
              把想象
              <span className="bg-gradient-to-br from-brand-300 via-brand-500 to-aurora-400 bg-clip-text text-transparent">
                {" "}点亮
              </span>
              。
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              一句话生成图像，一张图延展成视频。Lumen 把多家主流模型聚合到同一个工作台，
              让创作者只用关心想法，不用关心管线。
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button variant="brand" size="xl" asChild>
                <Link href="/register">
                  开始创作
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button variant="outline" size="xl" asChild>
                <Link href="/login">已有账号 · 登录</Link>
              </Button>
            </div>
            <div className="mt-12 grid max-w-md grid-cols-3 gap-8">
              <Stat label="聚合模型" value={`${MODELS.length}+`} />
              <Stat label="平均生成" value="< 6s" />
              <Stat label="并行任务" value="无上限" />
            </div>
          </div>

          <div className="relative hidden md:block">
            <CollageVisual />
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="border-t border-border/60 bg-surface-1">
        <div className="mx-auto max-w-screen-2xl px-6 py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-brand-500">能力 · Capabilities</p>
            <h2 className="mt-3 font-display text-4xl leading-tight tracking-tight md:text-5xl">
              两条最常用的创作路径，原生融合在一处。
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <CapabilityCard
              icon={<ImageIcon className="size-5" />}
              title="文生图"
              copy="一段提示词，一组高保真图像。可指定尺寸、风格、批量数与负向词，每一次生成都进入你的私人作品库。"
              gradient="from-brand-300/20 via-brand-500/10 to-transparent"
              cta="进入文生图"
              href="/app/text-to-image"
            />
            <CapabilityCard
              icon={<Clapperboard className="size-5" />}
              title="图生视频"
              copy="挑一张静帧，附上一段镜头描述，生成短视频。可控时长、分辨率与运镜方向，从图像走向运动。"
              gradient="from-aurora-300/20 via-aurora-400/10 to-transparent"
              cta="进入图生视频"
              href="/app/image-to-video"
            />
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="border-t border-border/60">
        <div className="mx-auto max-w-screen-2xl px-6 py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-brand-500">工作流 · Workflow</p>
            <h2 className="mt-3 font-display text-4xl leading-tight tracking-tight md:text-5xl">
              三步从想法到成品。
            </h2>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
            <WorkflowStep
              n="01"
              title="写下想法"
              copy="一段中文或英文描述，越具体越准。可以引用风格、镜头、光线、构图。"
            />
            <WorkflowStep
              n="02"
              title="挑选模型"
              copy="不同模型擅长不同风格。Lumen 同时显示估时与估算消耗，让你按场景选择。"
            />
            <WorkflowStep
              n="03"
              title="迭代与延展"
              copy="对结果不满意？编辑提示词重跑。满意？直接把图喂给视频模型，延展成动态。"
            />
          </div>
        </div>
      </section>

      {/* Models */}
      <section id="models" className="border-t border-border/60 bg-surface-1">
        <div className="mx-auto max-w-screen-2xl px-6 py-24">
          <div className="mb-14 max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-brand-500">模型 · Models</p>
            <h2 className="mt-3 font-display text-4xl leading-tight tracking-tight md:text-5xl">
              一个工作台，多家最强生成模型。
            </h2>
            <p className="mt-4 text-muted-foreground">
              先内置占位适配，后续逐一接入真实接口。所有调用走同一份计量与历史，不同模型在同一画面对比。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {MODELS.map((m) => (
              <div
                key={m.id}
                className="grain group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-400/40"
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400/20 to-aurora-400/20 text-brand-400">
                    {m.kind === "image" ? <ImageIcon className="size-4" /> : <Clapperboard className="size-4" />}
                  </div>
                  {m.badge && <Badge variant={m.badge === "premium" ? "warning" : "brand"}>{m.badge}</Badge>}
                </div>
                <div className="mt-3 text-sm font-medium">{m.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{m.vendor}</div>
                <div className="mt-3 line-clamp-2 text-xs text-muted-foreground/80">{m.description}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border/60">
        <div className="mx-auto max-w-screen-2xl px-6 py-24">
          <div className="mb-12 max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-brand-500">常见问题 · FAQ</p>
            <h2 className="mt-3 font-display text-4xl leading-tight tracking-tight">几个一开始想问的事。</h2>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
            {FAQS.map((f) => (
              <div key={f.q} className="bg-card p-8">
                <div className="text-base font-medium">{f.q}</div>
                <div className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 bg-surface-1">
        <div className="mx-auto max-w-screen-2xl px-6 py-24 text-center">
          <h2 className="mx-auto max-w-2xl font-display text-4xl leading-tight tracking-tight md:text-5xl">
            用一段文字，开始今天的第一束光。
          </h2>
          <div className="mt-10 flex justify-center gap-3">
            <Button variant="brand" size="xl" asChild>
              <Link href="/register">免费注册 · 等待管理员通过</Link>
            </Button>
            <Button variant="outline" size="xl" asChild>
              <Link href="/login">登录</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex max-w-screen-2xl flex-col items-center gap-4 px-6 text-center text-xs text-muted-foreground md:flex-row md:justify-between md:text-left">
          <div>© {new Date().getFullYear()} Lumen Studio · 本地演示版本</div>
          <div className="flex items-center gap-4">
            <span>v1.0.0-preview</span>
            <span>由 Next.js 16 / React 19 驱动</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-2xl tracking-tight">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function CapabilityCard({
  icon, title, copy, gradient, cta, href,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
  gradient: string;
  cta: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-border bg-card p-8 transition-all hover:border-brand-400/40"
    >
      <div className={`pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br ${gradient}`} />
      <div className="flex size-10 items-center justify-center rounded-xl bg-secondary text-brand-400">
        {icon}
      </div>
      <div className="mt-6 font-display text-2xl tracking-tight">{title}</div>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{copy}</p>
      <div className="mt-8 flex items-center gap-1.5 text-sm font-medium text-brand-500 transition-transform group-hover:translate-x-1">
        {cta} <ArrowRight className="size-4" />
      </div>
    </Link>
  );
}

function WorkflowStep({ n, title, copy }: { n: string; title: string; copy: string }) {
  return (
    <div className="bg-card p-10">
      <div className="font-mono text-xs uppercase tracking-widest text-brand-500">{n}</div>
      <div className="mt-4 font-display text-xl tracking-tight">{title}</div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy}</p>
    </div>
  );
}

const FAQS = [
  {
    q: "需要付费吗？",
    a: "本版本是本地演示，所有调用走 Mock 实现，不会真正消耗任何模型额度。接入真实后端时再启用计费。",
  },
  {
    q: "注册后能立刻使用吗？",
    a: "需要管理员审核通过。这一步是为了在团队/课堂/工作室场景下控制访问范围。审核通过后即可登录创作。",
  },
  {
    q: "我的作品保存在哪里？",
    a: "演示阶段保存在浏览器本地（localStorage）。接入真实后端后会切换到对象存储 + 数据库，作品可跨设备同步。",
  },
  {
    q: "能切换主题吗？",
    a: "支持深色 / 浅色双主题，会跟随系统设置，也能在导航栏一键切换。",
  },
];

function CollageVisual() {
  return (
    <div className="relative h-[460px] w-full">
      <Tile className="absolute left-0 top-6 h-64 w-48 rotate-[-6deg]" hue1={30} hue2={50} hue3={200} />
      <Tile className="absolute left-32 top-32 h-72 w-56 rotate-[3deg]" hue1={195} hue2={210} hue3={45} />
      <Tile className="absolute right-4 top-0 h-56 w-44 rotate-[8deg]" hue1={280} hue2={320} hue3={40} />
      <Tile className="absolute right-12 bottom-2 h-64 w-52 rotate-[-3deg]" hue1={20} hue2={40} hue3={210} />
      <div className="absolute bottom-12 left-2 max-w-[220px] rounded-xl border border-border bg-popover p-3 shadow-lg">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Prompt</div>
        <div className="mt-1 font-display text-sm leading-snug">
          “雨后东京街头，霓虹倒影在水洼里，35mm 胶片质感”
        </div>
      </div>
    </div>
  );
}

function Tile({
  className, hue1, hue2, hue3,
}: { className?: string; hue1: number; hue2: number; hue3: number }) {
  const id = `tile-${hue1}-${hue2}-${hue3}`;
  return (
    <div className={`overflow-hidden rounded-2xl border border-border shadow-2xl ${className}`}>
      <svg viewBox="0 0 200 280" className="h-full w-full">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${hue1} 70% 18%)`} />
            <stop offset="55%" stopColor={`hsl(${hue2} 60% 30%)`} />
            <stop offset="100%" stopColor={`hsl(${hue3} 70% 14%)`} />
          </linearGradient>
          <filter id={`b-${id}`}><feGaussianBlur stdDeviation="22" /></filter>
        </defs>
        <rect width="200" height="280" fill={`url(#${id})`} />
        <g filter={`url(#b-${id})`} opacity="0.85">
          <ellipse cx="60" cy="80" rx="80" ry="70" fill={`hsl(${hue3} 80% 60%)`} opacity="0.5" />
          <ellipse cx="160" cy="200" rx="90" ry="80" fill={`hsl(${hue1} 85% 55%)`} opacity="0.55" />
          <ellipse cx="120" cy="140" rx="60" ry="50" fill={`hsl(${hue2} 80% 65%)`} opacity="0.4" />
        </g>
      </svg>
    </div>
  );
}
