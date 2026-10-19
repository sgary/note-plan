
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMeeting, useDeleteMeeting, useMoveMeetingToProject, useProjects } from "@/stores";
import { useEditorDocumentSession, useEditorTab, useEditorSaveShortcut, useEditorSaveAndClose, useEditorProjectMove, useEditorAIInclusion } from "@/hooks/editor";
import { useInternalLinkHandler } from "@/hooks";
import { EditorHeader } from "./editor-header";
import { EditorPathBar } from "./editor-path-bar";
import { EditorRenderStates } from "./editor-render-states";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { MetadataToolbar } from "@/components/ui/metadata-toolbar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { getEntityTabId } from "@/lib/tab-identity";
import { useTabStore } from "@/stores/tabs";
import { cn } from "@/lib/utils";
import { pageWidthClasses } from "@/lib/enterprise-ui";
import { EditorConflictDialog } from "./editor-conflict-dialog";
import { isCompanyMeeting } from "@/lib/meeting-scope";

interface MeetingEditorProps {
  meetingId: string;
  workspaceId: string;
  projectId: string;
  onClose: () => void;
}

export function MeetingEditor({ meetingId, workspaceId, projectId, onClose }: MeetingEditorProps) {
  const { t } = useTranslation();
  const tabId = getEntityTabId("meeting", { id: meetingId, workspaceId, projectId });
  const handleInternalLinkClick = useInternalLinkHandler();
  const { data: meeting, isLoading: isLoadingMeeting } = useMeeting(
    workspaceId,
    projectId,
    meetingId,
  );

  const deleteMeeting = useDeleteMeeting();
  const moveMeetingToProject = useMoveMeetingToProject();
  const moveEntityTabToProject = useTabStore((state) => state.moveEntityTabToProject);
  const { data: projects = [] } = useProjects(workspaceId);

  // A company meeting has no project; its location is shown as a static chip instead of
  // a project dropdown, so it can't be "moved" by picking a project.
  const isCompany = !!meeting && isCompanyMeeting(meeting);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showConflict, setShowConflict] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);

  // Shared hooks
  const { aiExclusionState, handleAIInclusionChange } = useEditorAIInclusion(
    meeting?.filePath,
    workspaceId,
    "meeting"
  );

  const {
    content,
    setContent,
    metadata,
    setMetadata,
    restoreEmptyTitle,
    isLoading: isLoadingContent,
    isDirty: contentDirty,
    saveStatus: contentSaveStatus,
    pathChanged,
    newPath,
    fileDeleted,
    acknowledgePathChange,
    acceptPathChange,
    acknowledgeDeleted,
    save,
    retry,
    useExternal: chooseExternal,
    keepDesk,
    cancelConflict,
    discard,
    recover,
    loadError,
    serverVersionMismatch,
    retryLoad,
    recoveryBlocked,
    state: editorState,
  } = useEditorDocumentSession({
    ref: { kind: "meeting", workspaceId, projectId, id: meetingId },
    editorType: "meeting",
    entityId: meetingId,
    sessionKey: tabId,
  });
  const title = typeof metadata.title === "string" ? metadata.title : meeting?.title ?? "";
  const date = typeof metadata.date === "string" ? metadata.date : "";

  useEffect(() => {
    if (contentSaveStatus === "conflict") setShowConflict(true);
  }, [contentSaveStatus]);

  // Shared save hooks
  useEditorSaveShortcut(save);
  useEditorSaveAndClose(tabId, save);

  // Project move
  const { currentProjectId, handleProjectChange } = useEditorProjectMove({
    entity: meeting,
    save,
    acceptPathChange,
    move: moveMeetingToProject.mutateAsync,
    entityLabel: "meeting",
    onMoved: (newProjectId) => moveEntityTabToProject(tabId, newProjectId),
    buildMoveArgs: (id, ws, from, to) => ({ meetingId: id, workspaceId: ws, fromProjectId: from, toProjectId: to }),
  });

  // Defer editor rendering
  useEffect(() => {
    if (meeting && !isLoadingContent && !isEditorReady) {
      const frameId = requestAnimationFrame(() => {
        setIsEditorReady(true);
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [meeting, isLoadingContent, isEditorReady]);

  const handleTitleChange = useCallback((value: string) => setMetadata("title", value), [setMetadata]);
  const handleDateChange = useCallback((value: string) => setMetadata("date", value || null, true), [setMetadata]);

  // Manage tab title and dirty state
  const isDirty = contentDirty;
  useEditorTab(tabId, title, isDirty);

  const saveStatus = contentSaveStatus === "error" ? "error" as const : contentSaveStatus === "saving" ? "saving" as const : "idle" as const;

  const handleDeleteConfirm = useCallback(async () => {
    if (!meeting) return;

    try {
      await deleteMeeting.mutateAsync({
        meetingId: meeting.id,
        workspaceId: meeting.workspaceId,
        projectId: meeting.projectId,
      });
      toast.success(t("toasts.editor.meetingDeleted"));
      onClose();
    } catch {
      toast.error(t("errors.editor.deleteMeetingFailed"));
    }
  }, [meeting, deleteMeeting, onClose, t]);

  // Render states (deleted, moved, loading, not found)
  const renderState = EditorRenderStates({
    fileDeleted,
    pathChanged,
    newPath,
    isLoading: isLoadingMeeting || isLoadingContent || (!!meeting && !isEditorReady),
    entity: meeting,
    entityLabel: "meeting",
    loadError,
    serverVersionMismatch,
    onRetryLoad: retryLoad,
    onClose,
    acknowledgePathChange,
    acknowledgeDeleted,
    isDirty: contentDirty,
    onRecover: recover,
    recoveryBlocked,
    recovering: contentSaveStatus === "saving",
    onDiscard: discard,
  });
  if (renderState) return renderState;

  return (
    <div className="flex flex-col h-full bg-background">
      <EditorPathBar filePath={editorState?.confirmed.filePath ?? meeting?.filePath} />
      <EditorHeader
        title={title}
        onTitleChange={handleTitleChange}
        onTitleBlur={restoreEmptyTitle}
        placeholder={t("editors.meeting.titlePlaceholder")}
        saveStatus={saveStatus}
        onRetry={contentSaveStatus === "error" ? retry : undefined}
        onReview={contentSaveStatus === "conflict" ? () => setShowConflict(true) : undefined}
        onDelete={() => setShowDeleteConfirm(true)}
        authorAI={meeting?.author === "ai"}
        aiIncluded={!aiExclusionState.isExcluded}
        onAIInclusionChange={handleAIInclusionChange}
        isInExcludedFolder={aiExclusionState.isInExcludedFolder}
        excludedFolderPath={aiExclusionState.excludedFolderPath}
      />

      {/* Sticky metadata row */}
      <div className="shrink-0">
        <div className={cn("mx-auto px-6", pageWidthClasses.reading)}>
          <MetadataToolbar
            date={date}
            onDateChange={handleDateChange}
            dateLabel="Date"
            projectId={currentProjectId}
            onProjectChange={isCompany ? undefined : handleProjectChange}
            projectReadOnly={isCompany}
            projectLabel={isCompany ? t("ui.metadataToolbar.companyMeeting") : undefined}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          />
          <div className="h-px bg-border/40 mt-4" />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {/* pt-3 + the editor's own py-1 (4px) = 16px, symmetric with the divider's mt-4 */}
        <div className={cn("mx-auto px-6 pb-6 pt-3", pageWidthClasses.reading)}>
          <RichTextEditor
            value={content}
            onChange={setContent}
            placeholder={t("editors.meeting.contentPlaceholder")}
            minHeight="400px"
            borderless
            onInternalLinkClick={handleInternalLinkClick}
          />
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t("editors.meeting.deleteTitle")}
        description={t("editors.meeting.deleteDescription")}
        confirmLabel={t("common.buttons.delete")}
        variant="destructive"
        onConfirm={handleDeleteConfirm}
      />
      <EditorConflictDialog
        open={showConflict && contentSaveStatus === "conflict"}
        onUseExternal={() => { setShowConflict(false); chooseExternal(); }}
        onKeepDesk={() => { setShowConflict(false); keepDesk(); }}
        onCancel={() => { setShowConflict(false); cancelConflict(); }}
      />
    </div>
  );
}
