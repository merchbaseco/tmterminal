export function trpcErrorCode(error: unknown) {
  if (!(error && typeof error === "object" && "data" in error && error.data)) {
    return null;
  }
  const { data } = error;
  if (!(typeof data === "object" && "code" in data)) {
    return null;
  }
  return typeof data.code === "string" ? data.code : null;
}
