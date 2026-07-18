import type { ChangePassport, SystemGuarantee } from "@/domain/types";

export interface GuaranteeRepository {
  listForProject(projectId: string): Promise<SystemGuarantee[]>;
}

export interface PassportRepository {
  findById(passportId: string): Promise<ChangePassport | null>;
  save(passport: ChangePassport): Promise<void>;
}
