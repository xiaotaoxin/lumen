import { TopNav } from "@/components/layout/top-nav";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AuthGuard } from "@/components/layout/auth-guard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard requireAdmin>
      <div className="flex h-full flex-col">
        <TopNav variant="app" />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar kind="admin" />
          <main className="flex-1 overflow-y-auto bg-background">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
