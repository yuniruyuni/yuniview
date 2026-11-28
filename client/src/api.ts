import { useEffect, useState } from "react";
export async function rpc<T>(
  name: string,
  input?: unknown,
  write = false,
  signal?: AbortSignal,
): Promise<T> {
  const url =
    "/api/trpc/" +
    name +
    (write || input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify(input))}`);
  const res = await fetch(url, {
    method: write ? "POST" : "GET",
    signal,
    cache: "no-store",
    ...(write
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      : {}),
  });
  const json = await res.json();
  if (!res.ok || json.error)
    throw Error(json.error?.message ?? "取得できませんでした");
  return json.result.data;
}
export function useQuery<T>(name: string, input: unknown, version = 0) {
  const key = JSON.stringify(input);
  const [state, set] = useState<{ data?: T; error?: string; key: string }>({
    key: "",
  });
  const requestKey = JSON.stringify([name, key, version]);
  useEffect(() => {
    const abort = new AbortController();
    rpc<T>(
      name,
      key === undefined ? undefined : JSON.parse(key),
      false,
      abort.signal,
    )
      .then((data) => set({ data, key: requestKey }))
      .catch((e) => {
        if (!abort.signal.aborted) set({ error: e.message, key: requestKey });
      });
    return () => abort.abort();
  }, [name, key, requestKey]);
  return state.key === requestKey ? state : { key: requestKey };
}
export const number = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
/** A count rounded to two significant digits, as 280,000 for 276,348. */
export const about = (n: number) =>
  n.toLocaleString("ja-JP", { maximumSignificantDigits: 2 });
export const clock = (s: string) =>
  new Date(s).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export function Feedback({ error }: { error?: string }) {
  return error ?? "読み込み中…";
}
