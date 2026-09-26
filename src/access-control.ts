export function parseAllowedUsers(value: string | null | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
}

export function isSenderAllowed(
  senderId: string | null | undefined,
  allowedUsers: ReadonlySet<string>,
): boolean {
  return allowedUsers.size === 0 || (typeof senderId === "string" && allowedUsers.has(senderId));
}
