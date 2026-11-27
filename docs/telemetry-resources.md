# resource 属性を別の表に置く設計

OTLP の resource 属性 (`host.name`、`process.*`、`telemetry.sdk.*` など) を、
`telemetry_events` の各行から `telemetry_resources` という表へ移す。
2026-11 のログ・スパンの量の調査で見つかった削減候補のひとつ。2026-11-28 に実装した。

---

## resource とは何か

ここでいう resource は、**バッチ内のイベントの共通部分を計算したものではない。** 送り手の OTel SDK が「このデータはどのプロセスから来たか」として付ける OTLP の Resource を、そのまま使う。

```
バッチ (= 1 回の Export)
└ resourceSpans[]            ← ここに resource (host.name, process.*, service.name, …)
   └ scopeSpans[]
      └ spans[]              ← 各スパンの属性 (http.route, http.method, …)
```

- バッチ内の全スパンがたまたま同じ値 (例: 全部 `http.method: GET`) を持っていても、スパンの属性は各行に残す。
  - 共通部分を計算すると、バッチの切れ目で中身が変わる。同じプロセスなのに鍵がばらばらになる。
  - スパン 1 本のバッチでは、属性の全部が移ってしまう。
- 1 バッチに `resourceSpans` が複数あれば、resource も複数になる。
- 送り元の識別 (service / workload / instance / slot / revision) は agent が封筒に付けるもので、resource とは別物。これまでどおり行の列に残す。
- stdout と agent の cgroup の採取には Resource が無い。

## なぜ

- OTLP の payload では、resource は `resourceSpans` / `resourceLogs` / `resourceMetrics` ごとに 1 回しか書かれていない。
- ところが `server/src/models/event/decode.ts` が展開のたびに `attrs: { resource, ... }` として全行に写している。
- 本番 (2026-11-27) では、スパン 1 行の平均 822 B のうち 511 B が `attrs.resource` だった。スパンのデータ量の約 6 割が、同じ内容の繰り返しになっている。
- 同じ resource はプロセスが生きている間ずっと変わらない。実体は、コンテナが作り直されるたびに 1 つ増える程度しかない。

## 目標

- `telemetry_events` の各行からは resource の中身を消し、16 バイトの参照だけを持たせる。
- 画面と API の見え方は変えない。トレースのスパン詳細には、これまでどおり `attrs.resource` が出る。
- agent は変えない。

## やらないこと

- **resource 属性で絞る・まとめる機能。** 今も、入れ子のオブジェクトである `attrs.resource` は属性の一覧 (`attribute_keys`) にも、絞り込み (`attrs->>key`) にも出てこない。今回もそのままにする。足すときは「将来の拡張」の節を参照。
- **scope (計装ライブラリの名前など) の保存。** 今も保存していない。
- **`telemetry_batches.payload` の重複の解消。** 別の削減候補として扱う。payload の中には resource が残るが、それで構わない。
- **agent でのバッチのまとめ方の変更。** これも別の候補。

## 表

`schema/tables/console.sql` に足す。

```sql
-- resource 属性の実体。同じ中身は 1 行だけ。行からは digest で参照する。
CREATE TABLE telemetry_resources (
  digest bytea PRIMARY KEY,       -- 中身の SHA-256 の先頭 16 バイト
  attrs json NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON telemetry_resources TO yuniview_app;

-- telemetry_events に 1 列足す。resource の無い行 (stdout、agent の resources) は NULL。
--   resource bytea
```

- **digest を鍵にする理由**:
  - 連番だと、書き込みのたびに `INSERT ... RETURNING` で番号を引く往復が要る。digest ならアプリ側で決まり、往復が要らない。
  - インスタンスやバッチをまたいでも、同じ中身は同じ鍵になる。
  - 16 バイトあれば衝突は実用上起きない。
- **NULL を許す理由**: stdout や cgroup の採取の行には resource が無い。NULL は行の大きさを増やさない。
- **外部キーは張らない。**
  - 書き込みは同じトランザクションで resource を先に入れるので、参照先が無い状態にはならない。
  - 外部キーを張ると、resource を消すときに `telemetry_events(resource)` の索引が要る。3 GB 超の表に索引を足すほどの価値はない。
- **`telemetry_events(resource)` に索引は作らない。** 今回は resource で探す問い合わせが無い。
- **列を足すのは安全。** 既定値無しで NULL を許す `ADD COLUMN` は、表を書き直さずにすぐ終わる。pgschema の宣言に足すだけでよい。古いアプリの INSERT は列名を明示しているので、移行が先に走っても壊れない。

### digest の作り方

- resource の属性 (`attrs(r.resource.attributes)` の結果) を、キーを辞書順に並べた JSON にする。その SHA-256 の先頭 16 バイトを使う。
- 属性が空 (`{}`) の resource は NULL にし、表には入れない。
- 作り方は model に置く。repository や SQL で作らない。同じ中身から必ず同じ鍵になることを、単体テストで確かめる。

## 書き込み

1. **`decode.ts`**
   - 行の `attrs` から `resource` を外し、代わりに `resource: <digest> | null` を返す。
   - 同じ `resourceSpans` などの中の行は、同じ digest を持つ。
   - metrics では、今は `attrs` の中で `resource` が属性の後ろに置かれている。外すだけで、ほかの並びは変えない。
2. **`Batch.index` (`models/batch/index.ts`)**
   - `fields` と同じように、`resources: { digest, attrs }[]` をバッチに持たせる。同じ digest は 1 つにまとめる。
3. **`batches.upsert` (`repositories/batch/postgres/upsert.ts`)**
   - events の前に、次を流す。1 バッチの resource はほぼ 1 つなので、1 文で足りる。
     ```sql
     INSERT INTO telemetry_resources(digest,attrs)
     SELECT * FROM json_to_recordset(...) ON CONFLICT DO NOTHING
     ```
   - events の INSERT に `resource` 列を足す。JSON から `bytea` にするので、digest は 16 進の文字列で渡し、SQL の中で `decode(...,'hex')` する。
4. **ingest と `indexPending` は変えない。** どちらも `Batch.index` → `batches.upsert` を通るので、自然に新しい形になる。

## 読み出し

画面や API が受け取る `Event` の形 (`shared/console.ts` の `attrs: Record<string, unknown>`) は変えない。SQL の中で元の形に戻す。

- **`repositories/event/postgres/common.ts` の `eventColumns` と `list.ts`**
  - `LEFT JOIN telemetry_resources r ON r.digest = telemetry_events.resource` する。
  - `attrs` は次のように組み立てる。
    ```sql
    CASE WHEN r.attrs IS NULL THEN telemetry_events.attrs
         ELSE (telemetry_events.attrs::jsonb || jsonb_build_object('resource', r.attrs::jsonb))::json END AS attrs
    ```
  - 古い行 (列が NULL で、`attrs.resource` を自分で持っている行) はそのまま返る。
  - `list.ts` は行のロックを受け付けない (渡されたら例外)。行は追加されるだけで、アプリには UPDATE の権限も無いので、ロックは元から意味が無かった。結合したまま `FOR UPDATE` すると resource の表まで対象になる。
- **集計 (`repositories/cell/postgres/common.ts`、`field-sql.ts`) は変えない。**
  - 属性は `attrs->>key` で最上位だけを読む。`attribute_keys` も入れ子のオブジェクトを除いている。そのため、resource が `attrs` から消えても結果は変わらない。
- **クライアントは変えない。**
  - 行の詳細 (`Explore.tsx` の `RowDetail`) は、もともとオブジェクトの属性を表示していない。
  - トレースのスパン詳細 (`Explore.tsx` の `<pre>{JSON.stringify(span.attrs)}</pre>`) は、上の組み立てで今と同じ内容が出る。

## 既存の行

**書き換えない。** 新しく届いた行からだけ新しい形にする。

- 本番の `telemetry_events` は約 3.7 GB ある。全行を UPDATE すると、一時的に表がほぼ倍になる。PostgreSQL の UPDATE は行を書き直すためで、空いた領域を OS に返すには `VACUUM FULL` (表のロックが要る) も必要になる。
- 読み出しは古い形も新しい形も扱えるので、混ざっていても困らない。
- 保持期間 (`TELEMETRY_RETENTION_DAYS`) を決めれば、古い行はそのうち消える。決めるまでは古い行がそのまま残る。

## resource の後始末

- **消さない。** 1 つ数百バイトで、増えるのはコンテナを作り直したときだけ (1 日に数十件)。1 年でも数 MB にとどまる。
- 保持期間で行を消したとき、どの行からも参照されない resource が残る。数が少ないので気にしない。要るようになったら、`expire` の中で「`first_seen` が保持期間より古く、参照する行が無いもの」を消す処理を足す。そのときは `telemetry_events(resource)` に部分索引が要る。

## 見込み

| | いま | 移した後 |
|---|---:|---:|
| スパン 1 行 | 822 B | 約 330 B (resource の 511 B が参照の 17 B になる) |
| yuniview のスパン、1 日 | 約 225 MB | 約 90 MB |

- 本番では、OTLP を送っているのは yuniview だけなので、効くのは yuniview のスパンとログ。ほかのアプリが OTel SDK を入れたときにも、そのまま効く。
- ワーカーの定期処理のスパンを減らす件 (実行するものがあったときだけ残す) と合わせると、yuniview のスパンは 1 日数 MB になる見込み。

## テスト

- **`decode` の単体テスト**
  - スパン・ログ・メトリクスの行の `attrs` に `resource` が無いこと。
  - `resource` に digest が入ること。
  - 同じ resource の行は同じ digest になること。
  - resource が無いとき、空のときは NULL になること。
- **digest の単体テスト**
  - 属性の順番が違っても、同じ中身なら同じ digest になること。
  - 中身が違えば違う digest になること。
- **`batches.upsert` の結合テスト (DB あり)**
  - 同じ resource のバッチを 2 回入れても、`telemetry_resources` は 1 行であること。
- **`events.list` の結合テスト**
  - 新しい形の行が、`attrs.resource` 付きで返ること。
  - `resource` が NULL で `attrs.resource` を自分で持つ古い形の行も、同じ形で返ること。
- **e2e (`e2e/console/live.ts`)**
  - すでに `resourceSpans` 付きのトレースを送っている。そのトレースのスパン詳細に `resource` の中身が出ることを確かめる。

## 手順

1. 表と列を `schema/tables/console.sql` に足す (pgschema が `CREATE TABLE` と `ADD COLUMN` を出すことを `bin/migrate.sh` の plan で確かめる)。
2. digest の関数と、`decode` / `Batch.index` の変更。単体テスト。
3. `batches.upsert` の変更。結合テスト。
4. `eventColumns` / `list.ts` の変更。結合テストと e2e。
5. デプロイ後、本番で次の 3 つを確かめる。
   - `telemetry_resources` の行数がインスタンスの数くらいであること。
   - 新しい行の `pg_column_size` が下がっていること。
   - スパン詳細の表示が変わっていないこと。

## 将来の拡張: resource 属性で絞る・まとめる

要るようになったら、次のようにする。

- Field に `{ type: "resource", key }` を足し、`field-sql.ts` で次のように読む。
  ```sql
  (SELECT attrs->>key FROM telemetry_resources WHERE digest = telemetry_events.resource)
  ```
  resource は数十行しかないので、相関副問い合わせでも安い。
- 属性の一覧には、`telemetry_resources` のキーを `resource.` を付けて加える。
- 古い行 (`attrs.resource` を自分で持つ行) も対象にするなら、`coalesce` で両方を見る。
