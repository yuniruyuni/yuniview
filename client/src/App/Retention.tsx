import { useState } from "react";
import {
  dataKinds,
  type RetentionRule,
  type RetentionRuleView,
  type RowKind,
  shelfName,
} from "../../../shared/console";
import { Feedback, number, rpc, useQuery } from "../api";
import { ConditionBar } from "./ConditionBar";
import { useDictionary } from "./dictionary";
import { rowData } from "./Explore";

const units = { minutes: 1, hours: 60, days: 1440 } as const;
type Unit = keyof typeof units | "forever";
const unitNames: Record<Unit, string> = {
  minutes: "分",
  hours: "時間",
  days: "日",
  forever: "無期限",
};
const presets: [string, number | null][] = [
  ["1時間", 60],
  ["1日", 1440],
  ["1週間", 7 * 1440],
  ["30日", 30 * 1440],
  ["無期限", null],
];

/** How long, in the largest unit that divides it. */
export function period(keep: number | null) {
  if (keep === null) return "無期限";
  if (keep % 1440 === 0)
    return keep % 10080 === 0 && keep < 30 * 1440
      ? `${keep / 10080}週間`
      : `${keep / 1440}日`;
  if (keep % 60 === 0) return `${keep / 60}時間`;
  return `${keep}分`;
}
function split(keep: number | null): [number, Unit] {
  if (keep === null) return [1, "forever"];
  if (keep % 1440 === 0) return [keep / 1440, "days"];
  if (keep % 60 === 0) return [keep / 60, "hours"];
  return [keep, "minutes"];
}

function blankRule(): RetentionRule {
  return {
    id: crypto.randomUUID(),
    title: "",
    data: "log",
    keep: 1440,
  };
}

/** Which rows the rule picks out, in a line. */
function useTarget() {
  const dict = useDictionary();
  return (r: RetentionRule) =>
    [
      r.data ? dataKinds[r.data] : "すべての種類",
      r.names?.length ? `名前: ${r.names.join(", ")}` : "",
      ...(r.conditions ?? []).map((c) => {
        const name = shelfName(c.field, dict);
        if (c.contains !== undefined) return `${name} に「${c.contains}」`;
        if (c.values) return `${name}: ${c.values.join(", ")}`;
        return `${name}: ${c.min ?? ""}〜${c.max ?? ""}`;
      }),
    ]
      .filter(Boolean)
      .join(" · ");
}

function RuleEditor({
  initial,
  end,
  close,
}: {
  initial: RetentionRule;
  end: string;
  close: (saved: boolean) => void;
}) {
  const [rule, setRule] = useState(initial);
  const [names, setNames] = useState(initial.names?.join(", ") ?? "");
  const [error, fail] = useState("");
  const [amount, unit] = split(rule.keep);
  const preview = useQuery<number>("previewRetentionRule", {
    ...rule,
    title: rule.title.trim() || "新しいルール",
  });
  const change = (patch: Partial<RetentionRule>) =>
    setRule((r) => ({ ...r, ...patch }));
  function keep(n: number, u: Unit) {
    change({
      keep: u === "forever" ? null : Math.max(1, Math.round(n || 1)) * units[u],
    });
  }
  async function save() {
    if (!rule.title.trim()) return fail("名前を入力してください");
    try {
      await rpc("saveRetentionRule", rule, true);
      close(true);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  return (
    <section className="retention-editor editor" aria-label="保持ルールの編集">
      <div className="section-head">
        <h3>
          {initial.title ? `「${initial.title}」を編集` : "保持ルールを作成"}
        </h3>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="retention-fields">
        <label>
          名前
          <input
            value={rule.title}
            placeholder="例: コンテナの CPU とメモリ"
            onChange={(e) => change({ title: e.target.value })}
          />
        </label>
        <label>
          データの種類
          <select
            value={rule.data ?? ""}
            onChange={(e) =>
              change({
                data: (e.target.value || undefined) as RowKind | undefined,
              })
            }
          >
            <option value="">すべての種類</option>
            {rowData.map((k) => (
              <option key={k} value={k}>
                {dataKinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          名前が一致（カンマ区切り、空なら問わない）
          <input
            value={names}
            placeholder="例: cpu.usage, memory.current"
            onChange={(e) => {
              setNames(e.target.value);
              const list = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              change({ names: list.length ? [...new Set(list)] : undefined });
            }}
          />
        </label>
        <fieldset className="retention-keep">
          <legend>保持期間</legend>
          <div className="retention-presets">
            {presets.map(([label, minutes]) => (
              <button
                type="button"
                key={label}
                aria-pressed={rule.keep === minutes}
                onClick={() => change({ keep: minutes })}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="inline">
            {unit !== "forever" && (
              <input
                type="number"
                min={1}
                aria-label="保持期間の長さ"
                value={amount}
                onChange={(e) => keep(Number(e.target.value), unit)}
              />
            )}
            <select
              aria-label="保持期間の単位"
              value={unit}
              onChange={(e) => keep(amount, e.target.value as Unit)}
            >
              {Object.entries(unitNames).map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      </div>
      <div className="retention-conditions">
        <span>条件</span>
        <ConditionBar
          data={rule.data ?? "log"}
          conditions={rule.conditions ?? []}
          minutes={1440}
          end={end}
          change={(conditions) =>
            change({ conditions: conditions.length ? conditions : undefined })
          }
        />
      </div>
      <p className="retention-preview" aria-live="polite">
        {preview.data !== undefined
          ? `このルールが決める行: 1日あたり約 ${number(preview.data)} 行（直近 24 時間）`
          : preview.error
            ? preview.error
            : "数えています…"}
      </p>
      <div className="retention-actions">
        <button type="button" className="primary" onClick={save}>
          保存
        </button>
        <button type="button" onClick={() => close(false)}>
          キャンセル
        </button>
      </div>
    </section>
  );
}

/** Rules for how long rows of each kind are kept. */
export function Retention({ end }: { end: string }) {
  const [revision, refresh] = useState(0);
  const result = useQuery<RetentionRuleView[]>(
    "retentionRules",
    undefined,
    revision,
  );
  const [editing, edit] = useState<RetentionRule | null>(null);
  const [error, fail] = useState("");
  const target = useTarget();
  if (editing)
    return (
      <RuleEditor
        key={editing.id}
        initial={editing}
        end={end}
        close={(saved) => {
          edit(null);
          if (saved) refresh((n) => n + 1);
        }}
      />
    );
  const views = result.data;
  async function write(name: string, input: unknown) {
    try {
      await rpc(name, input, true);
      refresh((n) => n + 1);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  function move(index: number, by: number) {
    if (!views) return;
    const ids = views.map((v) => v.rule.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id as string);
    write("reorderRetentionRules", { ids });
  }
  return (
    <section className="retention" aria-label="保持期間">
      <div className="section-head">
        <h3>ルール</h3>
        <button
          type="button"
          className="primary"
          onClick={() => edit(blankRule())}
        >
          ルールを追加
        </button>
      </div>
      <p className="retention-note">
        行は上のルールから順に照らし合わせ、最初に当てはまったルールの期間だけ残します。どのルールにも当てはまらない行は無期限に残ります。
        ルールの追加・変更・並べ替えは、すでに保存されている行にも適用されます（期間を過ぎた行は数分のうちに消えます）。
        行とは別に、届いた元データ（行の詳細の「元データを見る」で開けるもの）は、受信から既定で
        7 日たつと消えます。
      </p>
      {error && <p role="alert">{error}</p>}
      {!views ? (
        <p>
          <Feedback error={result.error} />
        </p>
      ) : (
        <div className="card scroll">
          <table className="retention-rules">
            <thead>
              <tr>
                {["順", "ルール", "対象", "保持期間", "1日あたり", "操作"].map(
                  (h) => (
                    <th key={h}>{h}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {views.map((v, i) => (
                <tr key={v.rule.id}>
                  <td>{i + 1}</td>
                  <th>{v.rule.title}</th>
                  <td className="retention-target">{target(v.rule)}</td>
                  <td>{period(v.rule.keep)}</td>
                  <td>約 {number(v.perDay)} 行</td>
                  <td className="retention-row-actions">
                    <button
                      type="button"
                      aria-label={`${v.rule.title} を上へ`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`${v.rule.title} を下へ`}
                      disabled={i === views.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => edit(structuredClone(v.rule))}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(`「${v.rule.title}」を削除しますか？`)
                        )
                          write("removeRetentionRule", { id: v.rule.id });
                      }}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="retention-default">
                <td />
                <th>既定</th>
                <td className="retention-target">
                  どのルールにも当てはまらない行
                </td>
                <td>無期限</td>
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
