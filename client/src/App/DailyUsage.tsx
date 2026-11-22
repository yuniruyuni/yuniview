import { Feedback, useQuery } from "../api";

type Row = { day: string; source: string; kind: string; users: number };
export function DailyUsage({ version }: { version: number }) {
  const { data, error } = useQuery<Row[]>("dailyUsage", undefined, version);
  if (!data) return <Feedback error={error} />;
  const columns = [
    ...new Map(data.map((row) => [row.source + "/" + row.kind, row])).values(),
  ].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.source.localeCompare(b.source),
  );
  const values = new Map(
    data.map((row) => [`${row.day}/${row.source}/${row.kind}`, row.users]),
  );
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const days = Array.from({ length: 30 }, (_, i) =>
    new Date(Date.parse(today) - i * 86400000).toISOString().slice(0, 10),
  );
  return (
    <section>
      <p>
        日本時間の直近30日間。アカウントはログイン単位、ブラウザは同じ端末のブラウザ単位で、blue・green
        を合わせて日ごとに数えます。— は未計測です。
      </p>
      {columns.length === 0 ? (
        <p>まだ計測データがありません。</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>日付（JST）</th>
                {columns.map((c) => (
                  <th key={c.source + c.kind}>
                    {c.source}
                    <br />
                    {c.kind === "account" ? "アカウント" : "ブラウザ"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day}>
                  <th>{day}</th>
                  {columns.map((c) => (
                    <td key={c.source + c.kind}>
                      {values.get(`${day}/${c.source}/${c.kind}`) ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
