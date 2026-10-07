export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  return headers[name.toLowerCase()] as string | undefined;
}
