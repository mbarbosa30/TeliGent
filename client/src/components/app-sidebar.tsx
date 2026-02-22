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
import { LayoutDashboard, BookOpen, Settings, Activity, Bot, Shield, LogOut, Sparkles, Plus, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useBot } from "@/hooks/use-bot";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  const { user, logout } = useAuth();
  const { bots, selectedBot, selectedBotId, selectBot } = useBot();
  const { toast } = useToast();

  const createBotMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bots", { botName: `Bot ${bots.length + 1}` });
      return res.json();
    },
    onSuccess: (newBot: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      selectBot(newBot.id);
      toast({ title: "Bot created", description: "New bot has been added." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create bot.", variant: "destructive" });
    },
  });

  const hasToken = selectedBot?.botToken && selectedBot.botToken.trim();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full text-left hover:bg-muted/50 transition-colors p-1 -m-1" data-testid="button-bot-switcher">
              <div className="flex h-9 w-9 items-center justify-center bg-foreground shrink-0">
                <Bot className="h-5 w-5 text-background" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold truncate" data-testid="text-bot-name">
                  {selectedBot?.botName || "No bot selected"}
                </span>
                <div className="flex items-center gap-1.5">
                  <div className={`h-1.5 w-1.5 ${hasToken && selectedBot?.isActive ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                  <span className="text-xs text-muted-foreground">
                    {!selectedBot ? "Create a bot" : !hasToken ? "No token set" : selectedBot?.isActive ? "Online" : "Offline"}
                  </span>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {bots.map((bot) => (
              <DropdownMenuItem
                key={bot.id}
                onClick={() => selectBot(bot.id)}
                className={bot.id === selectedBotId ? "bg-muted" : ""}
                data-testid={`menu-bot-${bot.id}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className={`h-1.5 w-1.5 shrink-0 ${bot.botToken?.trim() && bot.isActive ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                  <span className="truncate">{bot.botName}</span>
                </div>
                {bot.id === selectedBotId && (
                  <Badge variant="secondary" className="text-xs ml-auto shrink-0">Active</Badge>
                )}
              </DropdownMenuItem>
            ))}
            {bots.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => createBotMutation.mutate()}
              disabled={createBotMutation.isPending}
              data-testid="button-create-bot"
            >
              <Plus className="h-4 w-4 mr-2" />
              {createBotMutation.isPending ? "Creating..." : "Add new bot"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">Navigation</SidebarGroupLabel>
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
              <img src={user.profileImageUrl} alt="" className="h-7 w-7" />
            ) : (
              <div className="h-7 w-7 bg-muted flex items-center justify-center text-xs font-medium">
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
          <Badge variant="secondary" className="text-xs font-mono">v2.0</Badge>
          <span>TeliGent</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
