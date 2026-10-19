import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useCurrentWorkspace, useMeetings, useOpenTab, useWorkspaces } from "@/stores";
import { useOpenFromQuery } from "@/hooks";
import { useSecondarySidebar } from "@/hooks/use-secondary-sidebar";
import { StatePanel } from "@/components/ui/state-panel";
import { MeetingsTreePane } from "@/components/meetings";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { filterMeetingsByScope, type MeetingScope } from "@/lib/meeting-scope";

/**
 * Shared page body for the two meetings routes: project meetings (/meetings) and
 * company meetings (/company-meetings). `scope` decides which meetings are listed;
 * everything else (empty state, secondary sidebar slot) is identical.
 */
export function MeetingsScopePage({ scope }: { scope: MeetingScope }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const currentWorkspace = useCurrentWorkspace();
  const currentWorkspaceId = currentWorkspace?.id || null;
  const { isLoading: workspacesLoading } = useWorkspaces();
  const { data: meetings = [], isLoading: meetingsLoading } = useMeetings(currentWorkspaceId);
  const { openMeeting } = useOpenTab();

  const scopedMeetings = useMemo(
    () => filterMeetingsByScope(meetings, scope),
    [meetings, scope],
  );

  useOpenFromQuery(meetings, openMeeting, pathname);

  // Capture ?project= once (e.g. from a project overview quick-link), then clear it.
  // Only meaningful for the project scope; the company scope ignores the seed below.
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialProjectFilter, setInitialProjectFilter] = useState(
    () => searchParams.get("project") || undefined,
  );
  useEffect(() => {
    if (searchParams.has("project")) {
      searchParams.delete("project");
      setSearchParams(searchParams, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The deep-linked filter belongs to the workspace it was opened in: drop it on a real
  // workspace switch, or the keyed pane below re-initializes with a foreign project.
  // null → id is query hydration (cold deep-link load), not a switch — the init survives it.
  const prevWorkspaceRef = useRef(currentWorkspaceId);
  useEffect(() => {
    const prev = prevWorkspaceRef.current;
    prevWorkspaceRef.current = currentWorkspaceId;
    if (prev === null || prev === currentWorkspaceId) return;
    setInitialProjectFilter(undefined);
  }, [currentWorkspaceId]);

  // Register the meetings tree as the secondary sidebar slot for this route.
  const pane = useMemo(
    () =>
      currentWorkspaceId ? (
        // Keyed by workspace: the pane's UI state (project filter, search, sort) is chosen
        // within one workspace and must not survive into another — a kept project filter
        // would silently filter by (and default new meetings to) a foreign project.
        <MeetingsTreePane
          key={currentWorkspaceId}
          workspaceId={currentWorkspaceId}
          scope={scope}
          initialProjectFilter={scope === "project" ? initialProjectFilter : undefined}
        />
      ) : null,
    [currentWorkspaceId, scope, initialProjectFilter],
  );
  useSecondarySidebar(pathname, pane);

  if (workspacesLoading || meetingsLoading) {
    return <LoadingSkeleton variant="page" />;
  }

  if (!currentWorkspaceId) {
    return (
      <div className="flex flex-col h-full">
        <StatePanel
          variant="empty"
          display="inline"
          title={t("pages.meetings.selectWorkspaceTitle")}
          description={t("pages.meetings.selectWorkspaceDescription")}
          className="h-full"
        />
      </div>
    );
  }

  // Main pane: empty state. Opening a meeting switches to a meeting tab,
  // and `TabContent` renders the editor here instead.
  return (
    <div className="flex flex-col h-full">
      <StatePanel
        variant="empty"
        display="inline"
        icon={Calendar}
        title={scopedMeetings.length === 0 ? t("pages.meetings.noMeetingsTitle") : t("pages.meetings.selectMeetingTitle")}
        description={
          scopedMeetings.length === 0
            ? t("pages.meetings.noMeetingsDescription")
            : t("pages.meetings.selectMeetingDescription")
        }
        className="h-full"
      />
    </div>
  );
}
