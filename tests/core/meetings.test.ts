import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDeskService,
  WORKSPACE_LEVEL_PROJECT_ID,
  type DeskService,
} from "@desk/core";
import {
  getStorage,
  InMemoryStorageProvider,
  resetDeskRuntime,
  setDataRootResolver,
  setStorage,
} from "@desk/core/host";

describe("workspace-level (company) meetings", () => {
  let service: DeskService;

  beforeEach(async () => {
    resetDeskRuntime();
    setStorage(new InMemoryStorageProvider());
    setDataRootResolver(async () => "~/DeskMD");
    service = getDeskService();
    await service.createWorkspace({ id: "acme", name: "Acme", color: "#123456", home: true });
  });

  afterEach(() => resetDeskRuntime());

  it("stores a company meeting outside the projects tree, incl. in getMeetings", async () => {
    const project = await service.createProject({ workspaceId: "acme", name: "Website" });
    const companyMeeting = await service.createMeeting({
      workspaceId: "acme",
      projectId: WORKSPACE_LEVEL_PROJECT_ID,
      title: "Weekly exec review",
      date: "2099-01-01",
    });
    const projectMeeting = await service.createMeeting({
      workspaceId: "acme",
      projectId: project.id,
      title: "Kickoff",
      date: "2099-01-02",
    });

    expect(companyMeeting.projectId).toBe(WORKSPACE_LEVEL_PROJECT_ID);
    expect(companyMeeting.filePath).toContain("/meetings/");
    expect(companyMeeting.filePath).not.toContain("/projects/");

    const all = await service.getMeetings("acme");
    expect(all.map((m) => m.id).sort()).toEqual([companyMeeting.id, projectMeeting.id].sort());

    const companyOnly = await service.getMeetingsByProject("acme", WORKSPACE_LEVEL_PROJECT_ID);
    expect(companyOnly.map((m) => m.id)).toEqual([companyMeeting.id]);
  });

  it("lists company meetings even when the workspace has no projects", async () => {
    const companyMeeting = await service.createMeeting({
      workspaceId: "acme",
      projectId: WORKSPACE_LEVEL_PROJECT_ID,
      title: "Board sync",
      date: "2099-01-03",
    });

    const all = await service.getMeetings("acme");
    expect(all.map((m) => m.id)).toEqual([companyMeeting.id]);

    const storage = getStorage();
    expect(await storage.exists("~/DeskMD/workspaces/acme/projects/_workspace")).toBe(false);
    expect(await storage.exists("~/DeskMD/workspaces/acme/meetings")).toBe(true);
  });

  it("surfaces company meetings in workspace-wide feeds (dashboard, search)", async () => {
    const companyMeeting = await service.createMeeting({
      workspaceId: "acme",
      projectId: WORKSPACE_LEVEL_PROJECT_ID,
      title: "Exec review",
      date: "2099-01-05",
    });

    const overview = await service.getDashboardOverview({ today: "2099-01-06", recentLimit: 20 });
    expect(overview.recentWork.map((item) => item.id)).toContain(companyMeeting.id);

    const items = await service.getSearchItems();
    expect(items.some((item) => item.type === "meeting" && item.id === companyMeeting.id)).toBe(
      true,
    );
  });

  it("excludes company meetings from project-scoped counts", async () => {
    const project = await service.createProject({ workspaceId: "acme", name: "Website" });
    await service.createMeeting({
      workspaceId: "acme",
      projectId: project.id,
      title: "Kickoff",
      date: "2099-01-07",
    });
    await service.createMeeting({
      workspaceId: "acme",
      projectId: WORKSPACE_LEVEL_PROJECT_ID,
      title: "Exec review",
      date: "2099-01-08",
    });

    const summaries = await service.getProjectSummaries("acme", { today: "2099-01-09" });
    expect(summaries.find((s) => s.id === project.id)?.meetingCount).toBe(1);
  });

  it("moves a meeting between the company scope and a project", async () => {
    const project = await service.createProject({ workspaceId: "acme", name: "Website" });
    const companyMeeting = await service.createMeeting({
      workspaceId: "acme",
      projectId: WORKSPACE_LEVEL_PROJECT_ID,
      title: "Exec review",
      date: "2099-01-10",
    });

    const moved = await service.moveMeetingToProject(
      companyMeeting.id,
      "acme",
      WORKSPACE_LEVEL_PROJECT_ID,
      project.id,
    );
    expect(moved?.projectId).toBe(project.id);
    expect(moved?.filePath).toContain("/projects/");

    const back = await service.moveMeetingToProject(
      companyMeeting.id,
      "acme",
      project.id,
      WORKSPACE_LEVEL_PROJECT_ID,
    );
    expect(back?.projectId).toBe(WORKSPACE_LEVEL_PROJECT_ID);
    expect(back?.filePath).not.toContain("/projects/");
  });

  it("keeps a company and a project meeting with the same title as separate files", async () => {
    const project = await service.createProject({ workspaceId: "acme", name: "Website" });
    const companyMeeting = await service.createMeeting({
      workspaceId: "acme",
      projectId: WORKSPACE_LEVEL_PROJECT_ID,
      title: "Sync",
      date: "2099-01-04",
    });
    const projectMeeting = await service.createMeeting({
      workspaceId: "acme",
      projectId: project.id,
      title: "Sync",
      date: "2099-01-04",
    });

    expect(companyMeeting.filePath).not.toBe(projectMeeting.filePath);
    const all = await service.getMeetings("acme");
    expect(all).toHaveLength(2);
  });
});
