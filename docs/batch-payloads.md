# バッチの元データを使い切り、期間を過ぎたら捨てる設計

`telemetry_batches.payload` (agent から届いた元データ) について、次の 2 つを行う。

1. 元データにしか無い有益な情報を、行に移す。また、残っている間は画面と MCP から読めるようにする。
2. 行に展開した後は、受信から 7 日で捨てる。

2026-11 のログ・スパンの量の調査で見つかった削減候補のひとつ。2026-11-28 に設計し、実装した。

---

## なぜ

- 届いたバッチは、`payload` に元の JSON のまま保存される。同じ内容が `telemetry_events` の行にも展開されるので、二重に持っている。
- 保持期間のルールで行を消しても、バッチは「中の行が全部消えたとき」しか消えない。
  - トレースのバッチには、ワーカーのスパン (ルールで消える) とリクエストのスパン (無期限) が混ざる。そのため、ほぼすべてのバッチが残り続ける。
  - 本番 (2026-11-28) では、トレースのバッチの payload は 1 時間に約 840 kB、1 日に約 20 MB ある。ルールを入れた後に増え続ける量 (1 日約 30 MB) の 3 分の 2 を占める。
- 展開を終えた payload を読む処理は、今は無い。
  - 読むのは、まだ展開していないバッチ (`indexed = false`) を展開する `indexPending` だけ。本番では、展開していないバッチは 0 件。
  - 画面・API・MCP は、どれも `telemetry_events` だけを読む。`telemetry_batches` から読むのは、件数の集計 (`batches` の集計) と、同じバッチの二重受信の判定。どちらも payload を使わない。
- つまり今の payload は、「誰も読まないが、捨てると取り戻せない」データになっている。読めるようにしたうえで、期間を区切る。

## 元データにしか無いもの

`decode.ts` が行に移していないもの。2026-11-26〜28 の本番のトレース (スパン約 266 万本) で、実際に入っていたかを調べた。

| 項目 | 内容 | 本番での実績 |
|---|---|---|
| scope | 計装ライブラリの名前と版 | `app`、`http`、`better-auth 1.7.20` の 3 種 |
| スパンの kind | SERVER / INTERNAL / CLIENT など | 全スパン。`entry` の判定にだけ使っている |
| `status.message` | 失敗の説明 | 0 件。失敗 61 本はすべて code だけ |
| スパンの events | 例外 (`exception.type`、`exception.message`、`exception.stacktrace`) など | 0 件 |
| links | 別のトレースへの参照 | 0 件 |
| ヒストグラムのバケット | 区間ごとの件数 | メトリクスを OTLP で送る送り手が今は無い |
| `traceState`、`flags` | 伝播の付帯情報 | flags のみ。調べる用途は無い |

- yuniview 自身の計装は、例外を載せない方針になっている (`infra/tracing` の `traced`)。DB ドライバの例外に、クエリや行の値が入ることがあるため。
- そのため、今すぐ役に立つのは scope と kind だけ。events・links・`status.message` は、OTel SDK を入れた別のアプリが送り始めたときに効く。今のうちに受け口を作っておく。

## 目標

- **行に移す**: scope、kind、`status.message`、スパンの events を、新しく届いた行から持たせる。
- **元データを読めるようにする**: payload が残っている間 (7 日)、行の詳細とトレースから、その行の元の JSON を開ける。MCP からも読める。
- **期間で捨てる**: 展開済みのバッチの payload を、受信から 7 日で NULL にする。期間は設定で変えられる。
- バッチの行そのもの (送り元、受信時刻、二重受信の判定に使う鍵) は残す。行が消えるのは、これまでどおり中の行が全部消えたとき。
- agent は変えない。

## やらないこと

- **既存の行に、新しく移す項目を埋めること。** 新しく届いた行からだけにする。必要なら、payload が残っている 7 日分だけは展開し直せる (後述)。
- **links とヒストグラムのバケットを行に移すこと。** 今は送り手がいない。送り手が出たときに、元データを読めることで足りるかを見て決める。
- **バッチの行を消すこと。** 二重受信の判定 (`batches.count`) と、`telemetry_events` からの外部キーに要る。
- **payload の圧縮。** PostgreSQL の TOAST がすでに圧縮している。
- **`VACUUM FULL`。** 空いた領域は再利用に回すだけにする。

---

## 1. 行に移す

`decode.ts` のスパンの展開を変える。表は変えない。

- **scope、kind、`status.message`**
  - `attrs` に、OpenTelemetry の規約の名前で足す。
    - scope は `otel.scope.name` と `otel.scope.version`。
    - kind は `span.kind`。値は `server` / `internal` / `client` / `producer` / `consumer` の小文字にする。
    - `status.message` は `otel.status_description`。
  - `attrs` の最上位の文字列なので、絞り込み・集計・属性の一覧に、そのまま出てくる。例: `attr:span.kind = client` で外部への呼び出しだけを見る。
  - 送り手が同じ名前の属性を付けていたら、送り手の値を優先する。
  - 値が空なら足さない。行の大きさは 1 本あたり数十バイト増える。
- **スパンの events**
  - 1 件ごとに `kind = 'log'` の行にする。
    - `at` は event の時刻、`name` は event の名前、`trace` / `span` は親のスパンのもの。
    - `body` は `exception.message` があればそれ、無ければ event の名前。
    - `attrs` は event の属性。`exception.stacktrace` もここに入る。
    - `resource` は親のスパンと同じ。
  - `failed` は、event の名前が `exception` なら true。
  - ログの行にする理由:
    - トレースの表示 (`getTrace`) は、同じトレース ID のログを時刻順に並べる。そのため、例外が、それを起こしたスパンの位置に出る。
    - ログの検索で、例外を横断して探せる。
    - 保持期間のルールも、ログとして同じように書ける。
- **既存の画面への影響**
  - 行の詳細は、文字列の属性を一覧に出しているので、足した属性も出る。
  - トレースの表示には、例外の行が加わる。今は events を送る送り手がいないので、見た目は変わらない。

## 2. 元データを読めるようにする

### どこまで返すか

バッチ全体ではなく、**その行の元になった部分**を返す。トレースのバッチは 1 分ぶんをまとめるので、最大 4 MB ある。全体を返すと、画面でも MCP でも扱いにくい。

| シグナル | 返すもの |
|---|---|
| traces | そのスパンの JSON と、属する resource と scope |
| logs (OTLP) | その logRecord と、resource と scope |
| metrics (OTLP) | その dataPoint と、metric の名前・単位・種類、resource と scope |
| stdout | その 1 行 (`{at, line}` か文字列) |
| resources | その採取 1 件 |

- `decode` が行を出すときに、元にした部分を `raw` として一緒に返す。`raw` は保存しない。
- 行の `ordinal` は `decode` が出した順番なので、`decode(batch)` の `ordinal` 番目の `raw` が、その行の元データになる。
- ほかの方法で探すと、`decode` と同じ順番の数え方をもう一度書くことになる。それよりも `decode` を 1 回走らせるほうがずれない。1 バッチは最大 4 MB なので、1 回の表示で走らせても重くない。
- `decode` の中身が変わっても、順番の数え方を変えないかぎり、古い行と元データの対応は崩れない。数え方が変わる変更 (たとえば events の行を足すこと) では、古いバッチの `ordinal` がずれる。そのため、新しく出す行は、そのバッチの既存の行の後ろに並べる。
  - events の行は、全スパンを出し終えてから出す。

### 使う場所

- **usecase `getRaw(source, batchId, ordinal)`**
  - バッチを 1 件読み、`decode` の `ordinal` 番目の `raw` を返す。
  - payload が捨てられていれば、`{ expired: true, receivedAt }` を返す。
  - 該当する行が無ければ、NOT_FOUND を返す。
- **tRPC `rawRow`** と **MCP `get_raw_row`**
  - 入力は、`search_telemetry` や `get_trace` が返す行の `source`、`batchId`、`ordinal`。
  - MCP の説明には、行に移していない情報 (スパンの events、links など) を見るときに使う、と書く。
- **画面**
  - 行の詳細と、トレースのスパン詳細に「元データ」の開閉を足す。開いたときだけ読みに行き、整形した JSON を `<pre>` で出す。
  - 7 日を過ぎた行では、開閉の代わりに「元データは 7 日で削除されます (受信: 11/21 10:00)」と出す。
  - 中身が多いときに備えて、表示は高さを決めてスクロールさせる。

## 3. 期間で捨てる

### 表

`schema/tables/agent.sql` と `schema/tables/console.sql` を変える。

```sql
-- agent.sql: payload を NULL にできるようにする
payload json,          -- 展開から決まった期間を過ぎると NULL

-- console.sql
GRANT UPDATE (indexed, payload) ON telemetry_batches TO yuniview_app;
-- 捨てる対象を古い順に探す。捨てた行は索引から外れるので、毎回先頭から読み直さずに済む。
CREATE INDEX batches_payload_received_at ON telemetry_batches(received_at) WHERE payload IS NOT NULL;
```

- **列を NULL にする理由 (別の表に移さない理由)**
  - 別の表に分けると、移行のときに既存の約 200 MB の payload を写す必要がある。pgschema の宣言だけでは表せない。
  - `DROP NOT NULL` は表を書き直さずにすぐ終わる。古いアプリの INSERT は payload を必ず入れるので、移行が先に走っても壊れない。
- **NULL にする UPDATE の重さ**
  - トレースの payload は平均 2.4 kB で、多くは TOAST に置かれている。UPDATE すると、TOAST の塊が消えて、表の側の短い行が書き直される。
  - どちらも autovacuum が回収し、新しい行の書き込みに再利用される。
- **部分索引** は、payload を持つ行の分 (7 日分のバッチ、約 20 万行) だけになる。

### 処理

1. **`Batch` (`models/batch`)**
   - `payload` の型を `... | null` にする。
   - spec `PayloadBefore(at, count)` を足す。意味は「展開済みで、payload を持ち、受信が `at` より前のバッチのうち、古い順に `count` 件」。
2. **`batches.dropPayloads(spec)` (`repositories/batch/postgres`)**
   ```sql
   UPDATE telemetry_batches SET payload = NULL
   WHERE (source_id, batch_id) IN (
     SELECT source_id, batch_id FROM telemetry_batches
     WHERE payload IS NOT NULL AND indexed AND received_at < $1
     ORDER BY received_at LIMIT $2 FOR UPDATE SKIP LOCKED)
   ```
   - 消した件数を返す。
3. **`expire` (`usecases/telemetry/expire.ts`)**
   - 毎分 1 回 (今の `expiryMs`) 走る処理に、`dropPayloads` を 1 段 (1000 件) 足す。
   - 1 日に届くバッチは約 3 万件で、1 分 1000 件なら追いつく。
   - 最初は既存の約 107 万件のうち、7 日より古い分を片付ける。その大半は、CPU・メモリのルールでバッチごと消える resources のバッチになる。
4. **期間の設定**
   - 環境変数 `TELEMETRY_PAYLOAD_DAYS` (0〜3650、既定 7) で決める。0 は「捨てない」。
   - `TELEMETRY_RETENTION_DAYS` と同じく、`startWorker` で検証する。
   - 保持期間のルールの画面には載せない。ルールは行を対象にしているが、こちらはバッチの元データが対象で、意味が違う。
   - 保持期間のルールの画面に、「元データは受信から 7 日で削除」と 1 行だけ書く。行の保持と取り違えないようにするため。

### 読み出しへの影響

- **`decode` / `Batch.index`**: payload が NULL なら行を出さない。NULL になるのは展開済みのバッチだけなので、ふだんは通らない。
- **`indexPending`**: 展開していないバッチは捨てる対象から外れているので、変えない。
- **二重受信の判定・件数の集計**: payload を読まないので、変えない。

## 展開し直し

新しく移す項目を、既存の行にも持たせたくなったときのために、手段だけ決めておく。今回は作らない。

- payload が残っている 7 日分のバッチだけが対象になる。
- バッチの行を `indexed = false` に戻せば、`indexPending` が同じバッチを展開し直す。ただし、今の `batches.upsert` は、行の INSERT が主キーの衝突で失敗する。そのため、先にそのバッチの行を消す手順が要る。
- 本当に要るようになったら、管理用のスクリプトとして足す。

## 見込み

| | いま | 変えた後 |
|---|---:|---:|
| トレースの payload が増える量 | 1 日約 20 MB (無期限) | 7 日分の約 140 MB で頭打ち |
| 既存の payload | 約 200 MB | 7 日分だけになる |
| ルール後に増え続ける量 (全体) | 1 日約 30 MB | 1 日数 MB (リクエストのスパンと、アプリのログ) |
| 行に足す属性 | — | スパン 1 本あたり数十バイト |

- バッチの行と索引 (1 行あたり約 200 B) は残る。トレースのバッチは 1 日約 2,800 件なので、1 年でも約 200 MB にとどまる。
- 表のファイルは縮まない。消えた分は、新しい書き込みで埋まっていく。

## テスト

- **`decode` の単体テスト**
  - スパンの `attrs` に、scope・kind・`status.message` が入ること。
  - 送り手の同名の属性が優先されること。空の値は足さないこと。
  - events がログの行になること。trace / span / 時刻 / body / failed を確かめる。
  - events の行が、全スパンの後ろに並ぶこと。
  - `raw` が、行ごとに元の部分を指していること。
- **`getRaw` の単体テスト**
  - `ordinal` からスパン、logRecord、dataPoint、stdout の 1 行、採取 1 件を正しく返すこと。
  - payload が NULL のとき、`expired` を返すこと。
  - 無い `ordinal` のとき、NOT_FOUND を返すこと。
- **`dropPayloads` の結合テスト (DB あり)**
  - 期間より古い展開済みのバッチだけが NULL になること。
  - 展開していないバッチと、期間内のバッチは残ること。
  - 件数の上限を守ること。
- **e2e**
  - `e2e/console/live.ts`: events 付きのスパンを送る。トレースに例外の行が出ること、スパン詳細から元データを開けることを確かめる。
  - `e2e/console/mcp.ts`: `get_raw_row` を確かめる。
  - `bin/test-console.sh`: 古い受信時刻のバッチを入れておき、worker が走った後に payload が NULL になることを確かめる。その行で「元データは削除されました」の表示になることも確かめる。
- **二重受信**: payload を捨てたバッチと同じ ID が届いても、受け付けて何もしないこと。

## 手順

1. **行に移す。** `decode` の変更と単体テスト。表は変わらないので、単独で出せる。
2. **元データを読めるようにする。** `raw`、`getRaw`、tRPC・MCP・画面。この段階ではまだ捨てないので、全期間の元データが読める。
3. **期間で捨てる。**
   - 列と索引と権限を変える。`bin/migrate.sh` の plan で、`DROP NOT NULL` と `CREATE INDEX` だけが出ることを確かめる。
   - model、repository、`expire` の変更と、それぞれのテスト。
4. デプロイ後、本番で次の 4 つを確かめる。
   - 新しいスパンに `span.kind` と `otel.scope.name` が入ること。
   - 元データが開けること。
   - `payload IS NOT NULL` のバッチが 7 日分まで減ること。
   - `UPDATE` の 1 回あたりの時間と、autovacuum が `telemetry_batches` を回収していること。
