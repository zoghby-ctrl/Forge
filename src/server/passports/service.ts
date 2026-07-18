import type { ChangePassport } from "@/domain/types";

export interface PassportService {
  recordDecision(passportId: string, actorId: string, action: "approve" | "override"): Promise<ChangePassport>;
}

export const passportServicePlaceholder: PassportService = {
  async recordDecision() {
    throw new Error("Passport decision recording is not implemented yet.");
  },
};
