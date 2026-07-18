import type { SystemGuarantee } from "@/domain/types";
import type { RepositorySnapshotRef } from "@/server/repository-intelligence/contracts";

export interface GuaranteeService {
  propose(snapshot: RepositorySnapshotRef): Promise<SystemGuarantee[]>;
}

export const guaranteeServicePlaceholder: GuaranteeService = {
  async propose() {
    throw new Error("System Guarantee proposal is not implemented yet.");
  },
};
