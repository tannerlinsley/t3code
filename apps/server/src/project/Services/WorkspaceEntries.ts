import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectSearchEntriesInput, ProjectSearchEntriesResult } from "@t3tools/contracts";

export class WorkspaceEntriesError extends Schema.TaggedErrorClass<WorkspaceEntriesError>()(
  "WorkspaceEntriesError",
  {
    cwd: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface WorkspaceEntriesShape {
  readonly search: (
    input: ProjectSearchEntriesInput,
  ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceEntriesError>;
  readonly invalidate: (cwd: string) => Effect.Effect<void>;
}

export class WorkspaceEntries extends ServiceMap.Service<WorkspaceEntries, WorkspaceEntriesShape>()(
  "t3/project/Services/WorkspaceEntries",
) {}
