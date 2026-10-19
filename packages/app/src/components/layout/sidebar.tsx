/**
 * Sidebar - enterprise navigation contract.
 */

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Settings,
  CheckSquare,
  Building2,
  Calendar,
  CalendarDays,
  Home,
  FileText,
  FolderKanban,
  Search,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentWorkspace } from "@/stores/workspaces";
import { useTasks } from "@/stores/tasks";
import { useWorkspaceDocsShell } from "@/stores/content";
import { useMeetings } from "@/stores/meetings";
import { countTreeFiles } from "@/lib/tree-count";
import { useProjectSummaries } from "@/stores/projects";
import { useProjectSelectionStore } from "@/stores/project-selection";
import { isActiveStatus } from "@/lib/task-status";
import { isCompanyMeeting } from "@/lib/meeting-scope";
import { SectionLabel } from "@/components/patterns";
import { WorkspaceSelector } from "./workspace-selector";
import { useTabStore } from "@/stores/tabs";
import { openCommandPalette } from "@/components/command-palette";
import { SidebarNavRow } from "./sidebar-nav-row";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { isMacOS } from "@desk/core";
import { getSearchShortcutLabel } from "@/lib/search-presentation";

interface SidebarProps {
  width: number;
  isCollapsed: boolean;
  isDragging?: boolean;
}

/** Sidebar shows the most recent few; "All projects" covers the rest. */
const SIDEBAR_PROJECT_CAP = 8;

function Divider() {
  return <div className="h-px bg-sidebar-border/60 my-2 mx-2" />;
}

export function Sidebar({ width, isCollapsed, isDragging }: SidebarProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const currentWorkspace = useCurrentWorkspace();
  const { today } = useMinuteClock();
  const workspaceId = currentWorkspace?.id || null;

  const { data: tasks = [] } = useTasks(workspaceId);
  const { data: overviewTree = [] } = useWorkspaceDocsShell(workspaceId);
  const { data: meetings = [] } = useMeetings(workspaceId);
  const { data: projects = [] } = useProjectSummaries(workspaceId, today);

  const activeTaskCount = tasks.filter((t) => isActiveStatus(t.status)).length;
  const totalFiles = useMemo(() => countTreeFiles(overviewTree), [overviewTree]);
  const companyMeetingCount = meetings.filter(isCompanyMeeting).length;
  const projectMeetingCount = meetings.length - companyMeetingCount;
  const projectCount = projects.length;

  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const switchToDesk = useCallback(() => setActiveTab("desk"), [setActiveTab]);

  const selectedProjectId = useProjectSelectionStore((s) => s.selectedProjectId);
  const setSelectedProject = useProjectSelectionStore((s) => s.setSelectedProject);

  // Active projects only, most recently touched first, capped — "All projects"
  // covers the rest. Project summaries include task, document, and meeting activity.
  const sidebarProjects = useMemo(() => {
    return projects
      .filter((p) => p.status === "active")
      .sort((a, b) => {
        const ta = a.lastActivityAt ?? "";
        const tb = b.lastActivityAt ?? "";
        if (ta !== tb) return tb.localeCompare(ta);
        return a.name.localeCompare(b.name);
      })
      .slice(0, SIDEBAR_PROJECT_CAP);
  }, [projects]);

  const collapsed = isCollapsed;

  return (
    <aside
      data-app-chrome
      className={cn(
        "flex flex-col h-full min-h-0 bg-sidebar",
        !isDragging && "transition-[width] duration-200"
      )}
      style={{ width: `${width}px` }}
    >
      <ScrollArea className="flex-1 min-h-0">
        <nav className="px-2 py-2 space-y-1">
          <SidebarNavRow
            label={t("nav.sidebar.search")}
            icon={Search}
            collapsed={collapsed}
            role="global"
            shortcut={getSearchShortcutLabel(isMacOS())}
            onClick={openCommandPalette}
          />
          <SidebarNavRow to="/" label={t("nav.sidebar.dashboard")} icon={Home} active={pathname === "/"} collapsed={collapsed} role="global" onClick={switchToDesk} />
          <SidebarNavRow to="/planner" label={t("nav.sidebar.planner")} icon={CalendarDays} active={pathname === "/planner"} collapsed={collapsed} role="global" onClick={switchToDesk} />

          <Divider />

          {!collapsed && (
            <SectionLabel className="px-2.5 pb-0.5 text-[11px] tracking-wider text-sidebar-foreground/45">
              {t("nav.sidebar.workspaceViews")}
            </SectionLabel>
          )}

          <div className="space-y-0.5">
            <SidebarNavRow to="/tasks" label={t("nav.sidebar.tasks")} icon={CheckSquare} active={pathname === "/tasks"} collapsed={collapsed} role="global" count={activeTaskCount} onClick={switchToDesk} />
            <SidebarNavRow to="/docs" label={t("nav.sidebar.docs")} icon={FileText} active={pathname === "/docs"} collapsed={collapsed} role="global" count={totalFiles} onClick={switchToDesk} />
            <SidebarNavRow to="/company-meetings" label={t("nav.sidebar.companyMeetings")} icon={Building2} active={pathname === "/company-meetings"} collapsed={collapsed} role="global" count={companyMeetingCount} onClick={switchToDesk} />
            <SidebarNavRow to="/meetings" label={t("nav.sidebar.meetings")} icon={Calendar} active={pathname === "/meetings"} collapsed={collapsed} role="global" count={projectMeetingCount} onClick={switchToDesk} />
          </div>

          <Divider />

          {/* Collapsed: the PROJECTS section can't render, so a single icon row
              keeps the browse view (and every project) reachable. */}
          {collapsed && (
            <SidebarNavRow
              to="/projects"
              label={t("nav.sidebar.projectsSection")}
              icon={FolderKanban}
              active={pathname.startsWith("/projects")}
              collapsed
              role="global"
              onClick={() => {
                setSelectedProject(null);
                switchToDesk();
              }}
            />
          )}

          {!collapsed && (
            <div>
              <SectionLabel className="px-2.5 pb-0.5 text-[11px] tracking-wider text-sidebar-foreground/45">
                {t("nav.sidebar.projectsSection")}
              </SectionLabel>

              <div className="space-y-0.5">
                <SidebarNavRow
                  to="/projects"
                  label={t("nav.sidebar.allProjects")}
                  icon={FolderKanban}
                  count={projectCount}
                  active={pathname.startsWith("/projects") && !selectedProjectId}
                  onClick={() => {
                    setSelectedProject(null);
                    switchToDesk();
                  }}
                />
                {sidebarProjects.map((project) => (
                  <SidebarNavRow
                    key={project.id}
                    to="/projects"
                    role="project"
                    label={project.name}
                    active={pathname.startsWith("/projects") && selectedProjectId === project.id}
                    onClick={() => {
                      setSelectedProject(project.id);
                      switchToDesk();
                    }}
                  />
                ))}
              </div>

              <Divider />
            </div>
          )}
        </nav>
      </ScrollArea>

      <div className="shrink-0 px-2 pb-1 pt-1.5 border-t border-sidebar-border/60 space-y-0.5">
        <SidebarNavRow to="/settings" label={t("nav.sidebar.settings")} icon={Settings} active={pathname === "/settings"} collapsed={collapsed} role="global" onClick={switchToDesk} />
      </div>

      <WorkspaceSelector isCollapsed={collapsed} />
    </aside>
  );
}
