export interface RepositorySnapshotRef {
  projectId: string;
  commitSha: string;
  defaultBranch: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "imports" | "calls" | "tests" | "protects";
}
