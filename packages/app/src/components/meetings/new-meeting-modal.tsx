
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineProgress } from "@/components/ui/inline-progress";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { FormGrid } from "@/components/ui/form-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateField } from "@/components/ui/date-field";
import { useCreateMeeting, useProjects, useCurrentWorkspace, useOpenTab } from "@/stores";
import { toast } from "sonner";
import { useTemplatesStore } from "@/stores/templates";
import { resolveVariables } from "@/lib/templates";
import { todayISO, WORKSPACE_LEVEL_PROJECT_ID } from "@desk/core";
import type { MeetingScope } from "@/lib/meeting-scope";

interface NewMeetingModalProps {
  open: boolean;
  onClose: () => void;
  scope?: MeetingScope;
  defaultProjectId?: string;
}

export function NewMeetingModal({
  open,
  onClose,
  scope = "project",
  defaultProjectId,
}: NewMeetingModalProps) {
  const isCompany = scope === "company";
  const { t } = useTranslation();
  const currentWorkspace = useCurrentWorkspace();
  const createMeeting = useCreateMeeting();
  const { data: projects = [] } = useProjects(currentWorkspace?.id || null);
  const { openMeeting } = useOpenTab();
  const getTemplate = useTemplatesStore((s) => s.getTemplate);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => todayISO());
  const [projectId, setProjectId] = useState(defaultProjectId || "");

  // A dialog stays mounted while closed, so form state would otherwise leak across opens —
  // and across workspace switches, where a kept projectId silently points at another
  // workspace's project (the meeting then lands in projects/<foreign-id>/, inventing a
  // project dir with no project.md). Reset the whole form on open; it is the single reset.
  useEffect(() => {
    if (open) {
      setTitle("");
      setDate(todayISO());
      setProjectId(isCompany ? "" : defaultProjectId || "");
    }
  }, [open, defaultProjectId, isCompany]);

  useEffect(() => {
    if (isCompany) return;
    if (!projectId && projects.length > 0) {
      setProjectId(defaultProjectId || projects[0].id);
    }
  }, [isCompany, projects, projectId, defaultProjectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const effectiveProjectId = isCompany ? WORKSPACE_LEVEL_PROJECT_ID : projectId;
    if (!title.trim() || !currentWorkspace || !effectiveProjectId) return;

    try {
      const templateBody = resolveVariables(
        getTemplate("meeting", currentWorkspace.id),
        {
          title: title.trim(),
          date: date || todayISO(),
          project: isCompany
            ? ""
            : projects.find((p) => p.id === effectiveProjectId)?.name || "",
          workspace: currentWorkspace.name,
        }
      );

      const meeting = await createMeeting.mutateAsync({
        workspaceId: currentWorkspace.id,
        projectId: effectiveProjectId,
        title: title.trim(),
        date: date || undefined,
        templateBody,
      });

      toast.success(t("toasts.meeting.created"));

      onClose();

      // Auto-open in editor tab
      openMeeting({
        id: meeting.id,
        title: meeting.title,
        workspaceId: meeting.workspaceId,
        projectId: meeting.projectId,
      });
    } catch (error) {
      console.error("Failed to create meeting:", error);
      toast.error(t("errors.meeting.createFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("modals.newMeeting.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("modals.newMeeting.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <FormField id="meeting-title" label={t("modals.newMeeting.fields.title")}>
            <Input
              id="meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("modals.newMeeting.placeholders.title")}
              autoFocus
            />
          </FormField>

          <FormGrid>
            {!isCompany && (
              <FormField label={t("modals.newMeeting.fields.project")}>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("modals.newMeeting.placeholders.project")} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}

            <FormField id="meeting-date" label={t("modals.newMeeting.fields.date")}>
              <DateField
                id="meeting-date"
                value={date}
                onChange={setDate}
                clearable={false}
              />
            </FormField>
          </FormGrid>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.buttons.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || (!isCompany && !projectId) || createMeeting.isPending}
            >
              {createMeeting.isPending && (
                <InlineProgress />
              )}
              {t("modals.newMeeting.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
