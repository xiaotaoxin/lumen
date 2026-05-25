"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import * as authApi from "@/lib/api/auth";
import { LumenApiError } from "@/lib/api";

const schema = z
  .object({
    username: z.string().min(1, "请输入账号").max(24, "账号不超过 24 个字符"),
    password: z.string().min(6, "密码至少 6 个字符").max(64, "密码不超过 64 个字符"),
    confirm: z.string().min(6, "请再次输入密码"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "两次输入的密码不一致",
    path: ["confirm"],
  });

type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingUsername, setPendingUsername] = React.useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "", confirm: "" },
  });

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    try {
      await authApi.register(values.username, values.password);
      setPendingUsername(values.username);
      toast.success("注册申请已提交，等待管理员通过");
    } catch (e) {
      if (e instanceof LumenApiError) toast.error(e.message);
      else toast.error("提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="aurora-bg flex min-h-full flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/"><Logo /></Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card/95 p-10 shadow-xl backdrop-blur-sm">
          {pendingUsername ? (
            <PendingState username={pendingUsername} />
          ) : (
            <>
              <div className="mb-8">
                <h1 className="font-display text-3xl tracking-tight">创建账号</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  提交后由管理员审核，通过后即可登录。
                </p>
              </div>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <Field label="账号" id="username" error={form.formState.errors.username?.message}>
                  <Input id="username" autoComplete="username" placeholder="不超过 24 个字符" {...form.register("username")} />
                </Field>
                <Field label="密码" id="password" error={form.formState.errors.password?.message}>
                  <Input id="password" type="password" autoComplete="new-password" placeholder="至少 6 位" {...form.register("password")} />
                </Field>
                <Field label="再次输入密码" id="confirm" error={form.formState.errors.confirm?.message}>
                  <Input id="confirm" type="password" autoComplete="new-password" placeholder="再次输入" {...form.register("confirm")} />
                </Field>
                <Button variant="brand" size="lg" className="w-full" type="submit" disabled={submitting}>
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  提交申请
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
                <span>已经有账号？</span>
                <Link href="/login" className="text-brand-500 hover:underline">前往登录</Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({
  label, id, error, children,
}: { label: string; id: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PendingState({ username }: { username: string }) {
  const [status, setStatus] = React.useState<"pending" | "approved" | "rejected" | "not_found">("pending");
  const [checking, setChecking] = React.useState(false);

  const refresh = React.useCallback(() => {
    setChecking(true);
    authApi.applicationStatus(username).then((s) => {
      setStatus(s);
      setChecking(false);
    });
  }, [username]);

  React.useEffect(() => {
    let cancelled = false;
    authApi.applicationStatus(username).then((s) => {
      if (cancelled) return;
      setStatus(s);
    });
    return () => { cancelled = true; };
  }, [username]);

  if (status === "approved") {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
        <h2 className="mt-6 font-display text-2xl tracking-tight">审核通过</h2>
        <p className="mt-2 text-sm text-muted-foreground">现在可以使用账号 <span className="font-mono">{username}</span> 登录了。</p>
        <Button variant="brand" size="lg" className="mt-8 w-full" asChild>
          <Link href="/login">前往登录</Link>
        </Button>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="text-center">
        <h2 className="font-display text-2xl tracking-tight">未通过审核</h2>
        <p className="mt-2 text-sm text-muted-foreground">如有疑问可联系管理员，或更换账号重新申请。</p>
        <Button variant="outline" size="lg" className="mt-8 w-full" asChild>
          <Link href="/register">重新申请</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <Clock className="mx-auto size-12 text-brand-500" />
      <h2 className="mt-6 font-display text-2xl tracking-tight">等待管理员审核</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        账号 <span className="font-mono text-foreground">{username}</span> 的申请已提交。
        管理员通过后，你就可以登录使用 Lumen 全部功能。
      </p>
      <Button variant="outline" className="mt-8 w-full" onClick={refresh} disabled={checking}>
        {checking && <Loader2 className="size-4 animate-spin" />}
        检查审核状态
      </Button>
      <Link href="/" className="mt-3 block text-xs text-muted-foreground hover:text-foreground">返回首页</Link>
    </div>
  );
}
