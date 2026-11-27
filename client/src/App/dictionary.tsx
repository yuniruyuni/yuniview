import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Agg,
  aggNames,
  type Dictionary,
  type FieldInfo,
  type FieldMeta,
  fieldName,
} from "../../../shared/console";
import { rpc, useQuery } from "../api";

type Editing = { key: string } | null;
const Context = createContext<{
  dict: Dictionary;
  ready: boolean;
  edit: (key: string) => void;
}>({ dict: {}, ready: false, edit() {} });

/** The field dictionary: names, units and uses of every field. */
export function useDictionary() {
  return useContext(Context).dict;
}
/** Opens the editor for what people say about a field. */
export function useFieldEditor() {
  return useContext(Context).edit;
}

export function DictionaryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [version, refresh] = useState(0);
  const [editing, edit] = useState<Editing>(null);
  const fields = useQuery<FieldInfo[]>("fields", undefined, version);
  const dict = useMemo(
    () => Object.fromEntries((fields.data ?? []).map((f) => [f.key, f])),
    [fields.data],
  );
  const value = useMemo(
    () => ({
      dict,
      ready: !!fields.data,
      edit: (key: string) => edit({ key }),
    }),
    [dict, fields.data],
  );
  return (
    <Context.Provider value={value}>
      {children}
      {editing && (
        <FieldEditor
          info={dict[editing.key]}
          fieldKey={editing.key}
          dict={dict}
          close={(saved) => {
            edit(null);
            if (saved) refresh((n) => n + 1);
          }}
        />
      )}
    </Context.Provider>
  );
}

const kinds: [string, string][] = [
  ["", "指定なし"],
  ["gauge", "瞬間値（そのまま読む）"],
  ["counter", "累積値（増加率で読む）"],
];
const aggChoices = (
  ["avg", "sum", "min", "max", "p50", "p95", "p99", "rate"] as Agg[]
).map((a): [string, string] => [a, aggNames[a]]);

/** Edits what people say about a field; an empty part shows the sender's. */
export function FieldEditor({
  info,
  fieldKey,
  dict,
  close,
}: {
  info?: FieldInfo;
  fieldKey: string;
  dict: Dictionary;
  close: (saved: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const person: FieldMeta = info?.user ?? {};
  const sender: FieldMeta = info?.sender ?? {};
  const [draft, change] = useState<FieldMeta>(person);
  const [error, fail] = useState("");
  const [busy, working] = useState(false);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const text = (k: "label" | "description" | "unit" | "display") =>
    draft[k] ?? "";
  async function save() {
    working(true);
    fail("");
    try {
      const patch: Record<string, string | null> = {};
      for (const k of [
        "label",
        "description",
        "unit",
        "display",
        "kind",
        "agg",
      ] as const)
        patch[k] = (draft[k] as string | undefined) || null;
      await rpc("saveField", { key: fieldKey, ...patch }, true);
      close(true);
    } catch (e) {
      fail((e as Error).message);
      working(false);
    }
  }
  const hint = (k: keyof FieldMeta) =>
    sender[k] ? `送信元: ${String(sender[k])}` : "送信元の指定なし";
  return (
    <dialog
      ref={ref}
      className="field-editor"
      aria-label={`${fieldName(dict, fieldKey)} の名前と単位`}
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>{fieldName(dict, fieldKey)}</h3>
        <p className="field-key">
          <code>{fieldKey}</code>
        </p>
        <label>
          表示名
          <input
            value={text("label")}
            placeholder={sender.label ?? fieldName({}, fieldKey)}
            onChange={(e) => change({ ...draft, label: e.target.value })}
          />
          <small>{hint("label")}</small>
        </label>
        <label>
          説明
          <textarea
            rows={3}
            value={text("description")}
            placeholder={sender.description ?? ""}
            onChange={(e) => change({ ...draft, description: e.target.value })}
          />
          <small>{hint("description")}</small>
        </label>
        <div className="field-editor-row">
          <label>
            単位
            <input
              value={text("unit")}
              placeholder={sender.unit ?? ""}
              onChange={(e) => change({ ...draft, unit: e.target.value })}
            />
            <small>{hint("unit")}</small>
          </label>
          <label>
            表示する単位
            <input
              value={text("display")}
              placeholder={sender.display ?? ""}
              onChange={(e) => change({ ...draft, display: e.target.value })}
            />
            <small>{hint("display")}</small>
          </label>
        </div>
        <div className="field-editor-row">
          <label>
            数値の種類
            <select
              value={draft.kind ?? ""}
              onChange={(e) =>
                change({
                  ...draft,
                  kind: (e.target.value || undefined) as FieldMeta["kind"],
                })
              }
            >
              {kinds.map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
            <small>{hint("kind")}</small>
          </label>
          <label>
            既定の集計
            <select
              value={draft.agg ?? ""}
              onChange={(e) =>
                change({
                  ...draft,
                  agg: (e.target.value || undefined) as Agg | undefined,
                })
              }
            >
              <option value="">指定なし</option>
              {aggChoices.map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
            <small>{hint("agg")}</small>
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="tools">
          <button type="submit" className="primary" disabled={busy}>
            保存
          </button>
          <button type="button" onClick={() => close(false)}>
            キャンセル
          </button>
        </div>
      </form>
    </dialog>
  );
}
