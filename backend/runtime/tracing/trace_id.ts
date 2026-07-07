/** ULID 风格的时间排序随机 ID（不引入外部依赖的简化版） */
export function generateTraceId(): string {
  const timestamp = Date.now().toString(36).padStart(10, "0");
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join("");
  return timestamp + random;
}

export function generateRunId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
