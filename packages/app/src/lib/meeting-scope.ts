import { WORKSPACE_LEVEL_PROJECT_ID } from "@desk/core";

/** Which of the two meetings lists a meeting belongs to. */
export type MeetingScope = "project" | "company";

/** A meeting with no project: stored at <workspace>/meetings/. */
export function isCompanyMeeting(meeting: { projectId: string }): boolean {
  return meeting.projectId === WORKSPACE_LEVEL_PROJECT_ID;
}

/** The two scopes are disjoint — a meeting appears in exactly one list. */
export function filterMeetingsByScope<T extends { projectId: string }>(
  meetings: T[],
  scope: MeetingScope,
): T[] {
  return meetings.filter((meeting) =>
    scope === "company" ? isCompanyMeeting(meeting) : !isCompanyMeeting(meeting),
  );
}
