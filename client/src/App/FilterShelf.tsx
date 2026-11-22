import { useEffect, useRef, useState } from "react";
import {
  type FieldCondition,
  type FilterField,
  type FilterOptions,
  isTimeField,
  type Panel,
  shelfName,
} from "../../../shared/console";
import { Feedback, useQuery } from "../api";

function inputValue(n: number | undefined, type: string) {
  if (n === undefined) return "";
  if (type === "number") return String(n);
  const d = new Date(n);
  if (type === "date") return d.toISOString().slice(0, 10);
  return new Date(n - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
function Range({
  condition,
  type,
  options,
  change,
}: {
  condition: FieldCondition;
  type: string;
  options: FilterOptions;
  change: (c: FieldCondition) => void;
}) {
  const [min, setMin] = useState(inputValue(condition.min, type)),
    [max, setMax] = useState(inputValue(condition.max, type));
  const parse = (s: string) =>
    !s ? undefined : type === "number" ? Number(s) : Date.parse(s);
  const lower = parse(min),
    upper = parse(max);
  const invalid =
    (lower !== undefined && !Number.isFinite(lower)) ||
    (upper !== undefined && !Number.isFinite(upper)) ||
    (lower !== undefined && upper !== undefined && lower > upper);
  return (
    <div className="filter-range">
      <label>
        下限
        <input
          type={type}
          step={
            type === "number"
              ? "any"
              : type === "datetime-local"
                ? 1
                : undefined
          }
          placeholder={inputValue(options.min ?? undefined, type)}
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
      </label>
      <label>
        上限
        <input
          type={type}
          step={
            type === "number"
              ? "any"
              : type === "datetime-local"
                ? 1
                : undefined
          }
          placeholder={inputValue(options.max ?? undefined, type)}
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={invalid}
        onClick={() =>
          change({ field: condition.field, min: lower, max: upper })
        }
      >
        範囲を適用
      </button>
      {invalid && <small>下限は上限以下にしてください。</small>}
    </div>
  );
}
function ConditionEditor({
  condition,
  panel,
  end,
  change,
}: {
  condition: FieldCondition;
  panel: Panel;
  end: string;
  change: (c: FieldCondition) => void;
}) {
  const [search, find] = useState("");
  const field = condition.field;
  const { data, error } = useQuery<FilterOptions>("worksheetFilterOptions", {
    panel: {
      ...panel,
      title: "候補",
      conditions: panel.conditions?.filter((c) => c.field !== field),
    },
    field,
    end,
    search,
  });
  const temporal = isTimeField(field) || field === "day";
  const hasRange = condition.min !== undefined || condition.max !== undefined;
  const [mode, setMode] = useState<"range" | "values" | undefined>();
  const range =
    temporal ||
    (mode
      ? mode === "range"
      : hasRange || (!!data?.numeric && !condition.values));
  return (
    <>
      {!temporal && (data?.numeric || hasRange) && (
        <label>
          条件の種類
          <select
            value={range ? "range" : "values"}
            onChange={(e) => {
              const next = e.target.value === "range" ? "range" : "values";
              setMode(next);
              change({ field });
            }}
          >
            <option value="range">範囲</option>
            <option value="values">値を選択</option>
          </select>
        </label>
      )}
      {!temporal && !range && (
        <label>
          候補を検索
          <input
            type="search"
            value={search}
            onChange={(e) => find(e.target.value)}
          />
        </label>
      )}
      {!data ? (
        <p role="status">
          <Feedback error={error} />
        </p>
      ) : range ? (
        <Range
          key={JSON.stringify([condition.min, condition.max])}
          type={
            field === "day" ? "date" : temporal ? "datetime-local" : "number"
          }
          condition={condition}
          options={data}
          change={change}
        />
      ) : (
        <div className="filter-values">
          {Array.from(
            new Set([...(condition.values ?? []), ...data.values]),
          ).map((v) => (
            <label key={v}>
              <input
                type="checkbox"
                checked={condition.values?.includes(v) ?? false}
                onChange={(e) => {
                  const values = e.target.checked
                    ? [...(condition.values ?? []), v]
                    : condition.values?.filter((s) => s !== v);
                  change({
                    field,
                    values: values?.length ? values : undefined,
                  });
                }}
              />
              {v || "（空文字）"}
            </label>
          ))}
          {!data.values.length && <small>一致する候補がありません。</small>}
          {data.more && (
            <small>さらに候補があります。検索で絞り込めます。</small>
          )}
        </div>
      )}
      <button type="button" onClick={() => change({ field })}>
        条件をクリア
      </button>
    </>
  );
}
export function FilterShelf({
  panel,
  end,
  items,
  fields,
  open,
  setOpen,
  add,
  change,
  remove,
  ready,
  hover,
}: {
  panel: Panel;
  end: string;
  items: FieldCondition[];
  fields: [FilterField, string][];
  open?: FilterField;
  setOpen: (field?: FilterField) => void;
  add: (field: FilterField) => void;
  change: (c: FieldCondition) => void;
  remove: (f: FilterField) => void;
  ready: boolean;
  hover: boolean;
}) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open)
      current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open]);
  const active = items.find((c) => c.field === open);
  return (
    <section
      className="filter-shelf"
      data-drop="filter"
      data-ready={ready || undefined}
      data-preview={hover || undefined}
      aria-label="フィルター"
    >
      <label>
        フィルター
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value as FilterField);
          }}
        >
          <option value="">属性を追加</option>
          {fields.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <div className="filter-chips">
        {items.map((c) => (
          <span key={c.field} className="shelf-chip">
            <button
              type="button"
              ref={open === c.field ? current : undefined}
              aria-expanded={open === c.field}
              onClick={() => setOpen(open === c.field ? undefined : c.field)}
            >
              {shelfName(c.field)} ·{" "}
              {c.values?.join("、") ??
                (c.min !== undefined || c.max !== undefined
                  ? [
                      inputValue(
                        c.min,
                        c.field === "day"
                          ? "date"
                          : isTimeField(c.field)
                            ? "datetime-local"
                            : "number",
                      ),
                      inputValue(
                        c.max,
                        c.field === "day"
                          ? "date"
                          : isTimeField(c.field)
                            ? "datetime-local"
                            : "number",
                      ),
                    ].join(" ～ ")
                  : "すべて")}
            </button>
            <button
              type="button"
              aria-label={shelfName(c.field) + " のフィルターを外す"}
              onClick={() => remove(c.field)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {active && (
        <section
          className="filter-editor"
          aria-label={shelfName(active.field) + " の条件"}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(undefined);
          }}
        >
          <div className="options-heading">
            <strong>{shelfName(active.field)}</strong>
            <button type="button" onClick={() => setOpen(undefined)}>
              閉じる
            </button>
          </div>
          <ConditionEditor
            key={active.field}
            condition={active}
            panel={panel}
            end={end}
            change={change}
          />
        </section>
      )}
    </section>
  );
}
