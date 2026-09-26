export function parseAllowedUsers(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
}

export function isSenderAllowed(senderId, allowedUsers) {
  return allowedUsers.size === 0 || allowedUsers.has(senderId);
}
