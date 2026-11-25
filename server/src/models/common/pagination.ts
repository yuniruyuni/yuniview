export interface Sort<T extends string> {
  keys: readonly T[];
  order: "asc" | "desc";
}

/**
 * Row locking for reads inside a writing usecase. `update` waits for other
 * writers, `skip_locked` leaves rows that another worker already claimed.
 */
export type Lock = "update" | "skip_locked";

export interface Cursor<T extends string> {
  limit: number;
  after?: Record<T, string>;
  sort?: Sort<T>;
  lock?: Lock;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: Record<string, string>;
}
