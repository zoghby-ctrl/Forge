export function safeNextPath(value: string | null | undefined, fallback = "/?stage=oauth") {
  if (
    !value
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || value.includes("\r")
    || value.includes("\n")
  ) {
    return fallback;
  }

  return value;
}
