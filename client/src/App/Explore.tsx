import { useState } from "react";
import {
  blankPanel,
  type DataKind,
  dataKinds,
  type EventRow,
  type FieldCondition,
  type FilterField,
  fieldName,
  initialValue,
  isAttribute,
  type Overview,
  type Panel,
  type RouteRow,
  shelfName,
  type TopValue,
} from "../../../shared/console";
import { clock, Feedback, number, useQuery } from "../api";
import { useQueryFields } from "./ConditionBar";
import { useDictionary, useFieldEditor } from "./dictionary";
import { PanelView } from "./Panels";
import { palette } from "./SeriesStyle";

type EventCursor = Record<"at" | "source" | "batchId" | "ordinal", string>;
interface EventPage {
  items: EventRow[];
  hasMore: boolean;
  nextCursor?: EventCursor;
}
export type RowData = Exclude<DataKind, "daily">;
export const rowData: RowData[] = ["request", "span", "log", "event", "metric"];

/** A column of the row table: a stored column or an attribute. */
type Column = "at" | "source" | "name" | "body" | "value" | "failed" | string;
const defaultColumns: Record<RowData, Column[]> = {
  request: ["at", "source", "name", "value", "failed"],
  span: ["at", "source", "body", "value", "failed"],
  log: ["at", "source", "name", "body"],
  event: ["at", "source", "name", "value"],
  metric: ["at", "source", "name", "value"],
};
const columnNames: Record<string, Record<RowData, string> | string> = {
  at: "時刻",
  source: "サービス",
  name: {
    request: "ルート",
    span: "ルート",
    log: "レベル",
    event: "イベント",
    metric: "メトリクス",
  },
  body: {
    request: "名前",
    span: "名前",
    log: "本文",
    event: "本文",
    metric: "",
  },
  value: {
    request: "所要時間",
    span: "所要時間",
    log: "値",
    event: "回数",
    metric: "値",
  },
  failed: "失敗",
};
function columnName(
  dict: ReturnType<typeof useDictionary>,
  data: RowData,
  c: Column,
) {
  const n = columnNames[c];
  if (n === undefined) return fieldName(dict, c);
  return typeof n === "string" ? n : n[data];
}
function cell(row: EventRow, c: Column): string {
  switch (c) {
    case "at":
      return clock(row.at);
    case "source":
      return row.source;
    case "name":
      return row.name;
    case "body":
      return row.body;
    case "value":
      return row.value === null ? "" : `${number(row.value)} ${row.unit}`;
    case "failed":
      return row.failed ? "失敗" : "";
    default: {
      const v = row.attrs[c.slice(5)];
      return v === undefined
        ? ""
        : typeof v === "string"
          ? v
          : JSON.stringify(v);
    }
  }
}

/** Adds a value to a field's condition, or removes it when already there. */
export function toggleValue(
  conditions: FieldCondition[],
  field: FilterField,
  value: string,
): FieldCondition[] {
  const current = conditions.find((c) => c.field === field);
  const values = current?.values ?? [];
  const next = values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
  const rest = conditions.filter((c) => c.field !== field);
  return next.length ? [...rest, { field, values: next }] : rest;
}

function TopValues({
  data,
  conditions,
  minutes,
  end,
  field,
  pick,
}: {
  data: RowData;
  conditions: FieldCondition[];
  minutes: number;
  end: string;
  field: Exclude<FilterField, "text">;
  pick: (value: string) => void;
}) {
  const { data: values, error } = useQuery<TopValue[]>("topValues", {
    query: { data, conditions, minutes },
    field,
    end,
  });
  if (!values)
    return (
      <p className="top-values-status">
        <Feedback error={error} />
      </p>
    );
  const max = Math.max(1, ...values.map((v) => v.count));
  const chosen = conditions.find((c) => c.field === field)?.values ?? [];
  return (
    <ul className="top-values">
      {values.map((v) => (
        <li key={v.value}>
          <button
            type="button"
            aria-pressed={chosen.includes(v.value)}
            title="押すとこの値で絞り込み、もう一度押すと外す"
            onClick={() => pick(v.value)}
          >
            <span className="top-value">{v.value || "（空）"}</span>
            <span className="top-count">{number(v.count)}</span>
            <i style={{ width: `${(100 * v.count) / max}%` }} />
          </button>
        </li>
      ))}
      {!values.length && <li className="empty">値がありません</li>}
    </ul>
  );
}

function RowsChunk({
  data,
  conditions,
  minutes,
  end,
  after,
  columns,
  last,
  more,
  selected,
  select,
}: {
  data: RowData;
  conditions: FieldCondition[];
  minutes: number;
  end: string;
  after?: EventCursor;
  columns: Column[];
  last: boolean;
  more: (cursor: EventCursor) => void;
  selected?: string;
  select: (row: EventRow) => void;
}) {
  const { data: page, error } = useQuery<EventPage>("events", {
    data,
    conditions,
    minutes,
    end,
    after,
  });
  if (!page)
    return (
      <tr>
        <td colSpan={columns.length}>
          <Feedback error={error} />
        </td>
      </tr>
    );
  return (
    <>
      {page.items.map((row) => (
        <tr
          key={row.id}
          className={row.failed ? "failed-row" : undefined}
          aria-selected={selected === row.id}
          onClick={() => select(row)}
        >
          {columns.map((c) => (
            <td key={c} className={`col-${c.replace(/\W/g, "-")}`}>
              {cell(row, c)}
            </td>
          ))}
        </tr>
      ))}
      {last && !page.items.length && !after && (
        <tr>
          <td colSpan={columns.length} className="empty">
            この期間と条件に一致する行はありません。
          </td>
        </tr>
      )}
      {last && page.hasMore && page.nextCursor && (
        <tr>
          <td colSpan={columns.length}>
            <button
              type="button"
              onClick={() => page.nextCursor && more(page.nextCursor)}
            >
              さらに表示
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

function RowDetail({
  row,
  narrow,
  close,
  showTrace,
  around,
}: {
  row: EventRow;
  narrow: (field: FilterField, value: string) => void;
  close: () => void;
  showTrace: (id: string) => void;
  around: (row: EventRow) => void;
}) {
  const dict = useDictionary();
  const editField = useFieldEditor();
  const fixed: [FilterField, string][] = [
    ["source", row.source],
    ["slot", row.slot],
    ["revision", row.revision],
    ["instance", row.instance],
    ["workload", row.workload],
  ];
  const attrs = Object.entries(row.attrs).filter(
    ([, v]) => typeof v !== "object" || v === null,
  );
  return (
    <aside className="row-detail" aria-label="行の詳細">
      <div className="row-detail-head">
        <strong>{clock(row.at)}</strong>
        <button type="button" onClick={close} aria-label="詳細を閉じる">
          ×
        </button>
      </div>
      {row.body && <pre className="row-body">{row.body}</pre>}
      <p>
        {row.name}
        {row.value !== null && ` · ${number(row.value)} ${row.unit}`}
        {row.failed && " · 失敗"}
      </p>
      <div className="tools">
        {row.trace && (
          <button type="button" onClick={() => showTrace(row.trace)}>
            トレースを開く
          </button>
        )}
        <button type="button" onClick={() => around(row)}>
          前後のログ
        </button>
      </div>
      <table className="row-fields">
        <tbody>
          {[
            ...fixed,
            ...attrs.map(([k, v]): [FilterField, string] => [
              `attr:${k}`,
              String(v),
            ]),
          ].map(([field, value]) => (
            <tr key={field}>
              <th>
                <button
                  type="button"
                  className="field-name"
                  title="名前と単位を設定"
                  onClick={() => editField(field)}
                >
                  {shelfName(field as Exclude<FilterField, "text">, dict)}
                </button>
              </th>
              <td>
                <button
                  type="button"
                  className="field-value"
                  title="この値で絞り込む"
                  onClick={() => narrow(field, value)}
                >
                  {value || "（空）"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

/** Rows of one kind of data, the fields that divide them and their counts. */
export function Explore({
  data,
  conditions,
  minutes,
  end,
  meta,
  columns: extraColumns,
  setData,
  setConditions,
  setColumns,
  setRange,
  rangeHref,
  showTrace,
  toPanel,
}: {
  data: RowData;
  conditions: FieldCondition[];
  minutes: number;
  end: string;
  meta: Overview;
  columns: string[];
  setData: (data: RowData) => void;
  setConditions: (c: FieldCondition[]) => void;
  setColumns: (c: string[]) => void;
  setRange: (minutes: number, end: string) => void;
  /** A link to the same view over a narrower window. */
  rangeHref: (minutes: number, end: string) => string;
  showTrace: (id: string) => void;
  toPanel: (p: Panel) => void;
}) {
  const dict = useDictionary();
  const editField = useFieldEditor();
  const [cursors, setCursors] = useState<(EventCursor | undefined)[]>([
    undefined,
  ]);
  const [opened, open] = useState<string>();
  const [row, select] = useState<EventRow>();
  const queryKey = JSON.stringify([data, conditions, minutes, end]);
  const [shownKey, remember] = useState(queryKey);
  if (shownKey !== queryKey) {
    remember(queryKey);
    setCursors([undefined]);
    select(undefined);
  }
  const fields = useQueryFields(data, conditions, end, minutes).filter(
    ([k]) => k !== "text" && !k.startsWith("time:"),
  );
  const columns: Column[] = [
    ...defaultColumns[data],
    ...extraColumns.filter((c) => isAttribute(c)),
  ];
  const histogram: Panel = {
    ...blankPanel,
    title: "件数の推移",
    data,
    values: [{ agg: "count", of: [] }],
    conditions,
    minutes,
    group: "all",
    display: "chart",
  };
  return (
    <div className="explore">
      <aside className="explore-fields" aria-label="フィールド">
        <fieldset className="data-tabs" aria-label="データ">
          {rowData.map((d) => (
            <button
              type="button"
              key={d}
              aria-pressed={data === d}
              onClick={() => setData(d)}
            >
              {dataKinds[d]}
            </button>
          ))}
        </fieldset>
        <h4>フィールド</h4>
        <ul>
          {fields.map(([k, label]) => (
            <li key={k}>
              <div className="explore-field">
                <button
                  type="button"
                  aria-expanded={opened === k}
                  onClick={() => open(opened === k ? undefined : k)}
                  title={dict[k]?.description}
                >
                  {label}
                </button>
                <button
                  type="button"
                  className="field-edit"
                  aria-label={`${label} の名前と単位を設定`}
                  title="名前と単位を設定"
                  onClick={() => editField(k)}
                >
                  ✎
                </button>
              </div>
              {opened === k && (
                <TopValues
                  data={data}
                  conditions={conditions}
                  minutes={minutes}
                  end={end}
                  field={k as Exclude<FilterField, "text">}
                  pick={(value) =>
                    setConditions(toggleValue(conditions, k, value))
                  }
                />
              )}
            </li>
          ))}
        </ul>
      </aside>
      <div className="explore-main">
        <PanelView
          panel={histogram}
          end={end}
          heading="件数の推移"
          choose={(p) => {
            const width = Math.max(1, Math.ceil((minutes * 60) / 40));
            return rangeHref(
              Math.max(1, Math.ceil(width / 60)),
              new Date(Date.parse(p.bucket) + width * 1000).toISOString(),
            );
          }}
          actions={
            <button
              type="button"
              className="primary"
              onClick={() =>
                toPanel({
                  ...blankPanel,
                  title: dataKinds[data],
                  data,
                  values: [initialValue(dict, data, meta)],
                  conditions,
                  minutes,
                })
              }
            >
              パネルにする
            </button>
          }
        />
        <div className="explore-rows">
          <div className="card scroll">
            <table className="rows">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>
                      {columnName(dict, data, c)}
                      {isAttribute(c) && (
                        <button
                          type="button"
                          className="column-remove"
                          aria-label={`${columnName(dict, data, c)} の列を外す`}
                          onClick={() =>
                            setColumns(extraColumns.filter((x) => x !== c))
                          }
                        >
                          ×
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cursors.map((after, i) => (
                  <RowsChunk
                    key={JSON.stringify(after ?? null)}
                    data={data}
                    conditions={conditions}
                    minutes={minutes}
                    end={end}
                    after={after}
                    columns={columns}
                    last={i === cursors.length - 1}
                    more={(c) => setCursors([...cursors, c])}
                    selected={row?.id}
                    select={select}
                  />
                ))}
              </tbody>
            </table>
            <label className="add-column">
              列を追加
              <select
                value=""
                onChange={(e) =>
                  e.target.value &&
                  setColumns([...extraColumns, e.target.value])
                }
              >
                <option value="">属性を選ぶ</option>
                {fields
                  .filter(([k]) => isAttribute(k) && !columns.includes(k))
                  .map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {row && (
            <RowDetail
              row={row}
              close={() => select(undefined)}
              showTrace={showTrace}
              narrow={(field, value) =>
                setConditions(toggleValue(conditions, field, value))
              }
              around={(r) => {
                const at = Date.parse(r.at);
                setData("log");
                setConditions([{ field: "instance", values: [r.instance] }]);
                setRange(2, new Date(at + 60000).toISOString());
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** One trace across services: its spans in time and the logs around them. */
export function Trace({ id }: { id: string }) {
  const { data: page, error } = useQuery<EventPage>("trace", id);
  const [chosen, choose] = useState<string>();
  const list = page?.items ?? [];
  const spans = list.filter((r) => r.kind === "span");
  const start = Math.min(...spans.map((r) => Date.parse(r.at)));
  const finish = Math.max(
    ...spans.map((r) => Date.parse(r.at) + (r.value ?? 0)),
  );
  const instances = [...new Set(spans.map((r) => r.instance))];
  const nearby = useQuery<EventPage>("events", {
    data: "log",
    conditions: [
      { field: "instance", values: instances.length ? instances : [""] },
    ],
    minutes: Math.max(1, Math.ceil((finish - start + 60000) / 60000)),
    end: new Date(
      (Number.isFinite(finish) ? finish : Date.now()) + 30000,
    ).toISOString(),
  });
  if (!page)
    return (
      <p>
        <Feedback error={error} />
      </p>
    );
  const traced = list.filter((r) => r.kind === "log");
  const duration = Math.max(1, finish - start);
  const parents = new Map(spans.map((r) => [r.span, r.parent]));
  const services = [...new Set(spans.map((r) => r.source))];
  const color = (s: string) => palette[services.indexOf(s) % palette.length];
  function depth(r: EventRow) {
    let parent = r.parent;
    const seen = new Set<string>();
    while (
      parent &&
      parents.has(parent) &&
      !seen.has(parent) &&
      seen.size < 12
    ) {
      seen.add(parent);
      parent = parents.get(parent) ?? "";
    }
    return seen.size;
  }
  const span = spans.find((r) => r.id === chosen);
  const around = (nearby.data?.items ?? []).filter(
    (r) => !traced.some((t) => t.id === r.id),
  );
  return (
    <div className="trace">
      <h3>スパンのタイムライン</h3>
      <p>
        <code>{id}</code> · {spans.length} スパン · {number(duration)} ms
      </p>
      <div className="legend">
        {services.map((s) => (
          <span key={s} style={{ borderLeftColor: color(s) }}>
            {s}
          </span>
        ))}
      </div>
      <div className="trace-body">
        <div className="card waterfall">
          {spans.map((r) => (
            <button
              type="button"
              key={r.id}
              className={r.failed ? "span-row failed" : "span-row"}
              aria-pressed={chosen === r.id}
              onClick={() => choose(chosen === r.id ? undefined : r.id)}
            >
              <span
                className="span-name"
                style={{ paddingLeft: depth(r) * 14 }}
              >
                {r.source} · {r.body}
              </span>
              <span className="track">
                <i
                  style={{
                    left: `${(100 * (Date.parse(r.at) - start)) / duration}%`,
                    width: `${Math.max(0.4, (100 * (r.value ?? 0)) / duration)}%`,
                    background: color(r.source),
                  }}
                />
              </span>
              <b>{number(r.value)} ms</b>
            </button>
          ))}
          {!spans.length && <p>スパンはありません。</p>}
        </div>
        {span && (
          <aside className="row-detail" aria-label="スパンの詳細">
            <div className="row-detail-head">
              <strong>{span.body}</strong>
              <button
                type="button"
                aria-label="詳細を閉じる"
                onClick={() => choose(undefined)}
              >
                ×
              </button>
            </div>
            <p>
              {span.source} · {clock(span.at)} · {number(span.value)} ms
              {span.failed && " · 失敗"}
            </p>
            <pre>{JSON.stringify(span.attrs, null, 2)}</pre>
            <small>
              span {span.span} / parent {span.parent || "root"}
            </small>
          </aside>
        )}
      </div>
      <h3>同じトレースのログ ({traced.length})</h3>
      <div className="card">
        {traced.map((r) => (
          <p key={r.id}>
            <small>
              {clock(r.at)} · {r.source}
            </small>{" "}
            {r.body}
          </p>
        ))}
        {!traced.length && <p>trace ID の付いたログはありません。</p>}
      </div>
      <h3>同じインスタンスの前後のログ ({around.length})</h3>
      <div className="card">
        {around.map((r) => (
          <p key={r.id}>
            <small>
              {clock(r.at)} · {r.source} · {r.instance}
            </small>{" "}
            {r.body}
          </p>
        ))}
        {!around.length && <p>この時間帯のログはありません。</p>}
      </div>
      {page.hasMore && <p>先頭 2,000 件を表示しています。</p>}
    </div>
  );
}

/** Server spans per service and route, with the slowest request of each. */
export function Routes({
  conditions,
  minutes,
  end,
  showTrace,
  narrow,
}: {
  conditions: FieldCondition[];
  minutes: number;
  end: string;
  showTrace: (id: string) => void;
  narrow?: (route: string) => void;
}) {
  const routeResult = useQuery<RouteRow[]>("routes", {
    minutes,
    conditions,
    end,
  });
  return (
    <div className="card scroll">
      <table>
        <thead>
          <tr>
            {[
              "サービス",
              "ルート",
              "件数",
              "失敗数",
              "p95",
              "最も遅い要求",
            ].map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {routeResult.data?.map((r) => (
            <tr key={r.source + r.name}>
              <td>{r.source}</td>
              <td>
                {narrow ? (
                  <button type="button" onClick={() => narrow(r.name)}>
                    {r.name}
                  </button>
                ) : (
                  r.name
                )}
              </td>
              <td>{number(r.requests)}</td>
              <td>{number(r.errors)}</td>
              <td>{number(r.p95)} ms</td>
              <td>
                {r.trace && (
                  <button type="button" onClick={() => showTrace(r.trace)}>
                    トレースを開く
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!routeResult.data ? (
        <p>
          <Feedback error={routeResult.error} />
        </p>
      ) : (
        !routeResult.data.length && (
          <p className="empty">この期間に受信したリクエストはありません。</p>
        )
      )}
    </div>
  );
}
