import { z } from "zod";

export const magicLinkSchema = z.object({
  email: z.string().trim().email(),
  next: z.string().optional(),
});

export type MagicLinkState = {
  status: "idle" | "sent" | "error";
  message?: string;
};

export const initialMagicLinkState: MagicLinkState = { status: "idle" };
