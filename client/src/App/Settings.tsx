import { useState } from "react";
import { aggNames, type FieldInfo } from "../../../shared/console";
import { useDictionary, useFieldEditor } from "./dictionary";

const kinds = { gauge: "瞬間値", counter: "累積値" };
function origin(f: FieldInfo, k: keyof FieldInfo["sender"]) {
  if (f.user[k] !== undefined) return "利用者";
  if (f.sender[k] !== undefined) return "送信元";
  return "";
}

/** The field dictionary: what every field is called and how it is read. */
export function Settings() {
  const dict = useDictionary();
  const edit = useFieldEditor();
  const [search, find] = useState("");
  const fields = Object.values(dict).filter((f) =>
    (f.key + f.label + (f.description ?? ""))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="settings" aria-label="フィールド辞書">
      <div className="section-head">
        <h3>フィールド辞書</h3>
        <p>
          送信元が付けた名前・単位を既定にし、ここで上書きできます。上書きした値は送信元より優先されます。
        </p>
      </div>
      <label className="search">
        検索
        <input
          type="search"
          value={search}
          placeholder="キー・名前・説明"
          onChange={(e) => find(e.target.value)}
        />
      </label>
      <div className="card scroll">
        <table className="dictionary">
          <thead>
            <tr>
              {[
                "キー",
                "表示名",
                "説明",
                "単位",
                "表示単位",
                "種類",
                "既定の集計",
                "",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.key}>
                <td>
                  <code>{f.key}</code>
                </td>
                <td>
                  {f.label}
                  <small>{origin(f, "label")}</small>
                </td>
                <td className="description">{f.description}</td>
                <td>{f.unit}</td>
                <td>{f.display}</td>
                <td>{f.kind ? kinds[f.kind] : ""}</td>
                <td>{f.agg ? aggNames[f.agg] : ""}</td>
                <td>
                  <button
                    type="button"
                    aria-label={`${f.label} を編集`}
                    onClick={() => edit(f.key)}
                  >
                    編集
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!fields.length && (
          <p className="empty">該当するフィールドはありません。</p>
        )}
      </div>
    </section>
  );
}
