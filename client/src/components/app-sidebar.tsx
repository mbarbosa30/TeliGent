import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { LayoutDashboard, BookOpen, Settings, Activity, Bot, Shield, LogOut, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { BotConfig } from "@shared/schema";
import type { AuthUser } from "@/hooks/use-auth";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Setup Guide", url: "/setup", icon: Sparkles },
  { title: "Knowledge Base", url: "/knowledge", icon: BookOpen },
  { title: "Activity Log", url: "/activity", icon: Activity },
  { title: "Reports", url: "/reports", icon: Shield },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { data: config } = useQuery<BotConfig>({ queryKey: ["/api/config"] });
  const { user, logout } = useAuth();

  const hasToken = config?.botToken && config.botToken.trim();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold truncate" data-testid="text-bot-name">
              {config?.botName || "ContextBot"}
            </span>
            <div className="flex items-center gap-1.5">
              <div className={`h-1.5 w-1.5 rounded-full ${hasToken && config?.isActive ? "bg-green-500" : "bg-muted-foreground/40"}`} />
              <span className="text-xs text-muted-foreground">
                {!hasToken ? "No token set" : config?.isActive ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild data-active={isActive}>
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 space-y-3">
        {user && (
          <div className="flex items-center gap-2">
            {user.profileImageUrl ? (
              <img src={user.profileImageUrl} alt="" className="h-7 w-7 rounded-full" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                {(user.firstName || user.email || "U")[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" data-testid="text-user-name">
                {user.firstName ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}` : user.email || "User"}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => logout()} data-testid="button-logout">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-xs">v2.0</Badge>
          <span>ContextBot</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
