import React, { useState } from "react";
import {
  Truck,
  Building2,
  Users,
  ShieldCheck,
  Landmark,
  Receipt,
  FileCheck2,
  FileBadge,
  Gavel,
  SlidersHorizontal,
  Bell,
  Search,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { VehiclesPage } from "./components/VehiclesPage";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeNav, setActiveNav] = useState("Vehicles");

  const navItems = [
    { title: "Dashboard", icon: ShieldCheck },
    { title: "Companies", icon: Building2 },
    { title: "Profile", icon: Building2 },
    { title: "Contacts", icon: Users },
    { title: "Vehicles", icon: Truck },
    { title: "Authorities", icon: Landmark },
    { title: "Insurance", icon: ShieldCheck },
    { title: "Tax Filing", icon: Receipt },
    { title: "Citations", icon: Gavel },
    { title: "Settings", icon: SlidersHorizontal },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground font-sans antialiased">
      {/* Left Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-16"
        } transition-all duration-200 ease-in-out border-r border-border bg-card flex flex-col shrink-0 select-none`}
      >
        {/* Sidebar Header */}
        <div className="flex h-14 items-center justify-between px-3 border-b border-border">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm shadow-sm">
              TES
            </div>
            {sidebarOpen && (
              <div className="flex flex-col truncate">
                <span className="font-bold text-sm leading-tight tracking-tight">TES Portal</span>
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">Fleet Compliance</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex size-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Toggle sidebar"
          >
            {sidebarOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>

        {/* Sidebar Navigation Items */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {sidebarOpen ? "Fleet Management" : "•••"}
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.title;

            return (
              <button
                key={item.title}
                type="button"
                onClick={() => setActiveNav(item.title)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-bold shadow-xs border-l-2 border-primary rounded-l-none"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                title={item.title}
              >
                <Icon className={`size-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                {sidebarOpen && <span className="truncate">{item.title}</span>}
              </button>
            );
          })}
        </div>

        {/* Sidebar User Footer */}
        <div className="p-3 border-t border-border bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary font-bold text-xs">
              MB
            </div>
            {sidebarOpen && (
              <div className="flex flex-col truncate text-xs">
                <span className="font-semibold truncate">Mehboob B.</span>
                <span className="text-[10px] text-muted-foreground">Safety Director</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Site Header */}
        <header className="h-14 border-b border-border bg-card/80 backdrop-blur px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>TES Fleet</span>
            <ChevronRight className="size-3.5" />
            <span>Vehicles & Equipment</span>
            <ChevronRight className="size-3.5" />
            <span className="font-semibold text-foreground">Fleet Master Register</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <Search className="size-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Global portal lookup..."
                className="h-8 w-60 rounded-lg border border-border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
              />
            </div>
            <button
              type="button"
              className="relative flex size-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground"
              title="Notifications"
            >
              <Bell className="size-4" />
              <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" />
            </button>
          </div>
        </header>

        {/* Workspace Canvas */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
          <VehiclesPage />
        </main>
      </div>
    </div>
  );
}
