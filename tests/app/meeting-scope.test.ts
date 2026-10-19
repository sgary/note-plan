import { describe, expect, it } from "vitest";
import {
  filterMeetingsByScope,
  isCompanyMeeting,
} from "../../packages/app/src/lib/meeting-scope";

function meeting(id: string, projectId: string) {
  return { id, projectId, workspaceId: "w", filePath: `/x/${id}.md`, title: id, content: "" };
}

describe("meeting scope", () => {
  const company = meeting("c", "_workspace");
  const project = meeting("p", "proj-1");
  const unassigned = meeting("u", "_unassigned");

  it("treats only the workspace-level marker as a company meeting", () => {
    expect(isCompanyMeeting(company)).toBe(true);
    expect(isCompanyMeeting(project)).toBe(false);
    expect(isCompanyMeeting(unassigned)).toBe(false);
  });

  it("splits meetings into non-overlapping project and company scopes", () => {
    const all = [company, project, unassigned];
    expect(filterMeetingsByScope(all, "company").map((m) => m.id)).toEqual(["c"]);
    expect(filterMeetingsByScope(all, "project").map((m) => m.id)).toEqual(["p", "u"]);
  });
});
