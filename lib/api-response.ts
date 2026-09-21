export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (!contentType.includes("application/json")) {
    throw new Error(response.ok
      ? fallback
      : `CookieMarkets service returned HTTP ${response.status}. Please retry in a moment.`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(fallback);
  }
}
