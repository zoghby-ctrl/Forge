import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getGitHubServerEnvironment } from "@/server/github/env";

const encryptionVersion = "v1";

function encryptionKey() {
  return Buffer.from(getGitHubServerEnvironment().GITHUB_TOKEN_ENCRYPTION_KEY, "base64");
}

export function hashGitHubOAuthState(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function signGitHubOAuthCookie(value: string) {
  return createHmac("sha256", encryptionKey()).update(value).digest("base64url");
}

export function encryptGitHubSecret(value: string, additionalAuthenticatedData: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(additionalAuthenticatedData));

  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    encryptionVersion,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptGitHubSecret(envelope: string, additionalAuthenticatedData: string) {
  const [version, ivValue, tagValue, ciphertextValue, ...rest] = envelope.split(".");

  if (
    version !== encryptionVersion
    || !ivValue
    || !tagValue
    || !ciphertextValue
    || rest.length > 0
  ) {
    throw new Error("GitHub credential encryption envelope is invalid.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAAD(Buffer.from(additionalAuthenticatedData));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("GitHub credential encryption envelope could not be decrypted.");
  }
}
