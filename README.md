# yuniview

コンテナのログ・メトリクス・分散トレースを一か所で調査するセルフホスト型アプリです。独立した Go agent が収集し、Bun/Hono と PostgreSQL が取り込み・検索・モニター評価を担当します。React の画面と API は同じサーバーから配信します。

## 起動

```sh
docker compose up -d --build
```

http://localhost:3000 を開きます。初回はサービスが空なので、[agent の手順](agent/README.md) に沿って送信元を登録し、計測対象からデータを送ります。既存の Compose 環境では起動時の migration がスキーマを適用し、中央サーバーが過去のバッチを順次索引化します。PostgreSQL のデータは named volume に残ります。

本番の管理画面 https://yuniview.yuniruyuni.net は Cloudflare Tunnel 経由で公開し、Cloudflare Access の Owner ポリシーで指定した Google アカウントに許可します。アプリは画面と操作 API の両方で Access の署名、発行元、有効期限、アプリ固有の Audience を検証します。本番の環境変数は yunirun.jsonc にあります。手元の Compose は loopback 上で開発用の `YUNIVIEW_ADMIN_AUTH=local` を使います。

agent の送信先は、手元ではポート 3001、本番の同一ホストでは `/run/yuniview-ingest/http.sock` です。取り込みには送信元ごとの資格が必要です。

## 画面

| 画面 | 操作 |
| --- | --- |
| サービス一覧 | 最終受信、受信した server span の件数・失敗・p95 を比較。グラフ上の点から同じ時間帯のログへ移動 |
| ログ | サービス・系・revision・期間・本文で絞り込み、属性と関連トレースを表示 |
| APM | ルートごとの件数・失敗・p95 を確認。遅い要求からサービスをまたぐスパンのタイムラインと関連ログを表示 |
| メトリクス | OTLP データポイント、CPU 累積使用時間、メモリの時系列と個々のサンプルを表示 |
| ダッシュボード | 指標と比較軸を選び、実データをプレビューして保存。折れ線・数値・表・ピボット表に対応。カードのタイトルから再編集でき、調査画面の検索条件も取り込めます |
| モニター | ダッシュボードのパネルから作成、または条件を直接入力。閾値、最低件数、欠測時の扱いを設定し、状態・履歴・通知結果を表示 |

APM の件数・失敗率・p95 の母集団は受信した server span です。全スパンは APM の一覧から開けます。メトリクスは受信した値の単位と累積・差分などの属性を保持します。ヒストグラムは件数・合計・最小・最大、summary は送信された分位値も表示できます。

## Coding Agent から設定する

本番の Streamable HTTP MCP エンドポイントは `https://yuniview.yuniruyuni.net/mcp` です。管理画面と同じ Cloudflare Access の Owner セッションを使います。ローカル Compose の接続先は `http://127.0.0.1:3000/mcp` です。

Codex CLI では、次の設定を `~/.codex/config.toml` に追加します。

```toml
[mcp_servers.yuniview]
url = "https://yuniview.yuniruyuni.net/mcp"
env_http_headers = { "cf-access-token" = "YUNIVIEW_ACCESS_TOKEN" }
```

管理者の端末で次のコマンドを実行し、ブラウザーで Owner アカウントにログインします。トークンは環境変数からヘッダーに渡されます。セッションが切れたら同じ手順で再接続します。

```sh
cloudflared access login https://yuniview.yuniruyuni.net >/dev/null &&
YUNIVIEW_ACCESS_TOKEN="$(cloudflared access token --app=https://yuniview.yuniruyuni.net)" codex
```

たとえば「web の直近60分のメモリ使用量をプレビューし、blue・green 別のダッシュボードとして保存して」と依頼できます。サービス名や指標名は `list_telemetry`、既存設定と版は `list_configuration`、集計の試行は `preview_panel` で取得します。`save_dashboard` と `save_monitor` には完全な定義と `expectedVersion` を渡します。新規作成時は新しい UUID と null を使い、更新時は取得した版を指定します。競合時は設定を読み直し、変更を反映してください。

ダッシュボードで「編集モード」を押すと、表示中のグラフや表のタイトルをつかみ、その場で配置順を変えられます。「全幅」でカードを1行に広げ、「設定」で個別のワークシートに移動します。「＋ パネル追加」をドラッグするとその位置に挿入できます。行と列には複数のフィールドを配置できます。たとえば行にサービス・スロット、列にワークロード・指標名を置くと、その順に階層化した表になります。棚内のフィールドはドラッグまたは Alt＋左右矢印で並べ替えられます。サービスやスロット、受信済みのログ・スパン・メトリクス属性を置いて集計でき、メトリクスを同じ棚に追加すると指標名で比較できます。候補に重ねてプレビューし、離して下書きに反映します。Esc でドラッグを取り消し、「配置に戻る」で編集内容を下書きに反映し、配置画面の「保存」でダッシュボードを更新します。

ワークシートの行・列には属性、時刻、指標を配置できます。表示形式「自動」では、指標の反対側に時刻（1秒〜1日）を置くと折れ線、カテゴリを置くと棒グラフになります。系列に複数の属性を置くと、観測した組み合わせごとに描画します。CPU 使用率はコンテナごとの CPU 累積時間の差分から計算し、1コアを100%とします。

「表示形式 → 積み上げ面」では、同じ単位の全系列を時刻またはカテゴリごとに積み上げます。各帯にポインタを合わせると系列の値と観測合計が表示されます。観測していない区間は空白です。以前に保存したスロット合計は従来の集計条件で表示できます。


[Cloudflare Access の CLI 認証](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/) · [Codex の MCP 設定](https://developers.openai.com/codex/mcp/)

## モニターと保持期間

中央サーバーが毎分、直前に完了した分までの指定窓を評価します。グループを指定したモニターは、最低件数を満たす系列のうち閾値を超えたものがあれば発報します。該当系列がゼロなら欠測の設定に従います。状態変化は PostgreSQL に保存され、複数サーバーの評価は行ロックで調整されます。

- `MONITOR_WEBHOOK_URL` を設定して中央サーバーを起動すると、モニター単位で Webhook 通知を選択できます。通知には状態、時刻、値、イベント ID が入り、送信失敗時は再試行します。受信側は Idempotency-Key で重複排除できます。
- `TELEMETRY_RETENTION_DAYS` は受信日を基準にした保持日数です。1〜3650 を指定すると古いバッチと索引を段階的に削除します。既定の 0 は自動削除を無効にします。

## 開発・検証

client、server、e2e は template 由来の Bun workspaces です。共有する画面モデルは shared、スキーマは schema、収集プロセスは agent にあります。

```sh
bun install --frozen-lockfile
bun run check:type
bun run check:lint
bun run check:test
bun run build
(cd e2e && bun x playwright install chromium)
bin/test-console.sh
bin/test-agent.sh
```

統合テストは一時 PostgreSQL コンテナを起動します。console のテストはビルド済みアプリを Chromium で操作し、トレースとログの関連付け、保存済みダッシュボード、モニターの発報・復旧・欠測、Webhook 配送を検証します。

[サーバーのアーキテクチャ](docs/architecture.md) · [プロダクト設計と今後の yunirun 統合](docs/product-design.md)

ダッシュボードで「ユニーク数」を選び、集計対象を「日次集合」、集合名を `visit.account` または `visit.browser` にすると、日付（JST）×サービスの利用者数を表示できます。別の集合も同じ形式で扱えます。ログやスパンでは属性キーを指定して重複を除けます。ログインアプリは検証済みのアカウント、公開アプリはその日の同一ブラウザを1件とします。ブラウザデータを消した場合や別端末を使った場合は別件です。agent は Unix ソケットで受けた ID を、スロット間で共有するサービス専用鍵・日付・種別で HMAC 化してから配送します。中央はスロットや再送をまたいで重複を除き、30日を過ぎた記録を削除します。再配置時には `deploy/yunirun/attach` のアプリ名に `:browser` または `:account` を指定します。

日次集合は、日付とサービス内でのみ比較可能な匿名識別子向けです。認証済みの agent ingest に `signal: "daily_set"`、`payload: {"day":"2026-11-22","field":"cart.active","digest":"…"}` を送ると、集合名がフィールド候補に現れます。`digest` には64桁の小文字16進ダイジェストを指定します。空文字は計測済みの0件を記録します。期間全体で同一 ID を数える場合は、ログ・スパンの属性を対象に「ユニーク数」を選び、表示を「数値」に設定します。
