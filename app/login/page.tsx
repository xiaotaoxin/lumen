"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuthStore } from "@/lib/store/auth-store";
import * as authApi from "@/lib/api/auth";
import { LumenApiError } from "@/lib/api";

const schema = z.object({
  username: z.string().min(1, "请输入账号"),
  password: z.string().min(1, "请输入密码"),
});

type Values = z.infer<typeof schema>;

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-full items-center justify-center text-sm text-muted-foreground">载入中…</div>}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);
  const [submitting, setSubmitting] = React.useState(false);
  const next = search.get("next") || "/app/text-to-image";

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    try {
      const session = await authApi.login(values.username, values.password);
      setUser(session);
      router.replace(session.role === "admin" ? "/admin/registrations" : next);
    } catch (e) {
      if (e instanceof LumenApiError) {
        toast.error(e.message);
      } else {
        toast.error("登录失败，请重试");
      }
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
          <div className="mb-8">
            <h1 className="font-display text-3xl tracking-tight">欢迎回来</h1>
            <p className="mt-2 text-sm text-muted-foreground">登录后继续你的创作。</p>
          </div>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">账号</Label>
              <Input id="username" autoComplete="username" placeholder="请输入账号" {...form.register("username")} />
              {form.formState.errors.username && (
                <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>
            <Button variant="brand" size="lg" className="w-full" type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              登录
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <span>没有账号？</span>
            <Link href="/register" className="text-brand-500 hover:underline">立即注册</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
