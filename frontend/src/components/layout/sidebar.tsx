"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  History,
  SlidersHorizontal,
  Activity,
  BarChart3,
  BookOpen,
  ShoppingCart,
  Receipt,
  Wallet,
  MessageSquare,
  GitCompare,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/evals", label: "Evaluations", icon: History, children: [
    { href: "/evals/compare", label: "Compare", icon: GitCompare },
  ]},
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/executions", label: "Executions", icon: Receipt },
  { href: "/model-stats", label: "Model Stats", icon: BarChart3 },
  { href: "/weights", label: "Weights", icon: SlidersHorizontal },
  { href: "/orders", label: "Orders", icon: ShoppingCart },
  { href: "/account", label: "Account", icon: Wallet },
  { href: "/collab", label: "Collaboration", icon: MessageSquare },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <Activity className="h-5 w-5 text-emerald-400" />
        <span className="font-mono text-sm font-semibold tracking-tight">
          eval<span className="text-emerald-400">engine</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {NAV_ITEMS.map((item) => {
          const { href, label, icon: Icon } = item;
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <div key={href}>
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
              {"children" in item && item.children && (
                <div className="ml-4 mt-1 space-y-1">
                  {item.children.map((child) => {
                    const childActive = pathname.startsWith(child.href);
                    const ChildIcon = child.icon;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                          childActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        )}
                      >
                        <ChildIcon className="h-3.5 w-3.5" />
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <p className="font-mono text-[10px] text-muted-foreground">
          market-data-bridge v3
        </p>
      </div>
    </aside>
  );
}
