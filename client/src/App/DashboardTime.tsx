import { useId, useRef, useState } from "react";

function localDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
export function DashboardTime({
  minutes,
  end,
  fixed,
  change,
  quick,
}: {
  minutes: number;
  end: string;
  fixed: boolean;
  change: (minutes: number, end?: string) => void;
  /** Shows the common ranges as buttons beside the picker. */
  quick?: boolean;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const [from, start] = useState("");
  const [to, finish] = useState("");
  const [month, setMonth] = useState(new Date());
  const [selectingEnd, selectEnd] = useState(false);
  const year = month.getFullYear(),
    monthIndex = month.getMonth();
  const offset = new Date(year, monthIndex, 1).getDay();
  const count = new Date(year, monthIndex + 1, 0).getDate();
  function pick(day: string) {
    if (selectingEnd) {
      start(day < from ? day : from);
      finish(day < from ? from : day);
    } else {
      start(day);
      finish(day);
    }
    selectEnd(!selectingEnd);
  }
  const first = new Date(from + "T00:00:00");
  const last = new Date(to + "T00:00:00");
  last.setDate(last.getDate() + 1);
  const duration = (last.getTime() - first.getTime()) / 60000;
  const fromLabel = localDate(new Date(Date.parse(end) - minutes * 60000 + 1)),
    toLabel = localDate(new Date(end));
  function apply(n: number, stamp?: string) {
    change(n, stamp);
    pop.current?.hidePopover();
  }
  const describe = (n: number) =>
    n % 1440 === 0
      ? n / 1440 + "日"
      : n % 60 === 0
        ? n / 60 + "時間"
        : n + "分";
  const common = [15, 60, 360, 1440, 10080];
  const custom = fixed || !common.includes(minutes);
  return (
    <div className="dashboard-time">
      {quick && (
        <fieldset className="time-segments" aria-label="よく使う期間">
          {common.map((n) => (
            <button
              type="button"
              key={n}
              aria-pressed={!fixed && minutes === n}
              onClick={() => change(n)}
            >
              {describe(n)}
            </button>
          ))}
        </fieldset>
      )}
      <button
        type="button"
        className={quick && !custom ? "time-more" : undefined}
        popoverTarget={id}
        aria-label="ダッシュボードの期間"
        onClick={() => {
          start(fromLabel);
          finish(toLabel);
          setMonth(new Date(end));
          selectEnd(false);
        }}
      >
        {quick && !custom
          ? "期間を指定"
          : fixed
            ? fromLabel + " ～ " + toLabel
            : "直近" + describe(minutes)}{" "}
        ▾
      </button>
      <div
        popover="auto"
        id={id}
        ref={pop}
        className="time-picker"
        role="dialog"
        aria-label="ダッシュボードの期間"
      >
        <strong>ダッシュボードの期間</strong>
        <div className="time-presets">
          {[5, 15, 60, 360, 1440, 10080, 43200].map((n) => (
            <button
              type="button"
              key={n}
              aria-pressed={!fixed && minutes === n}
              onClick={() => apply(n)}
            >
              直近{describe(n)}
            </button>
          ))}
        </div>
        <div className="calendar-head">
          <button
            type="button"
            aria-label="前の月"
            onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}
          >
            ‹
          </button>
          <strong aria-live="polite">
            {year}年{monthIndex + 1}月
          </strong>
          <button
            type="button"
            aria-label="次の月"
            onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}
          >
            ›
          </button>
        </div>
        <div className="range-calendar">
          {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
            <small key={d}>{d}</small>
          ))}
          {Array.from({ length: count }, (_, i) => {
            const day = localDate(new Date(year, monthIndex, i + 1));
            return (
              <button
                key={day}
                type="button"
                aria-label={day}
                aria-pressed={day >= from && day <= to}
                data-edge={day === from || day === to || undefined}
                style={i === 0 ? { gridColumnStart: offset + 1 } : undefined}
                onClick={() => pick(day)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <small aria-live="polite">
          {selectingEnd ? "終了日を選択" : "開始日を選択"}
        </small>
        <label>
          開始日
          <input
            type="date"
            value={from}
            onChange={(e) => start(e.target.value)}
          />
        </label>
        <label>
          終了日
          <input
            type="date"
            value={to}
            onChange={(e) => finish(e.target.value)}
          />
        </label>
        <small>
          {Intl.DateTimeFormat().resolvedOptions().timeZone} ·
          両端の日付を含む（最大30日）
        </small>
        <button
          type="button"
          className="primary"
          disabled={!(duration > 0 && duration <= 43200)}
          onClick={() =>
            apply(duration, new Date(last.getTime() - 1).toISOString())
          }
        >
          範囲を適用
        </button>
      </div>
    </div>
  );
}
