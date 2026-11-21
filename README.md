# yuniview

コンテナのログ・メトリクス・分散トレースを一か所で調査するセルフホスト型アプリです。独立した Go agent が収集し、Bun/Hono と PostgreSQL が取り込み・検索・モニター評価を担当します。React の画面と API は同じサーバーから配信します。

## 起動

```sh
docker compose up -d --build
```

http://localhost:3000 を開きます。初回はサービスが空なので、[agent の手順](agent/README.md) に沿って送信元を登録し、計測対象からデータを送ります。既存の Compose 環境では起動時の migration がスキーマを適用し、中央サーバーが過去のバッチを順次索引化します。PostgreSQL のデータは named volume に残ります。

UI と操作 API は同じ運用者向けの権限で動きます。Compose の公開先は loopback です。別ホストからは SSH 転送、または運用者認証を設定したリバースプロキシを通してアクセスしてください。agent の取り込み口は独立した送信資格を検証します。

## 画面

| 画面 | 操作 |
| --- | --- |
| サービス一覧 | 最終受信、受信した server span の件数・失敗・p95 を比較。グラフ上の点から同じ時間帯のログへ移動 |
| ログ | サービス・系・revision・期間・本文で絞り込み、属性と関連トレースを表示 |
| APM | ルートごとの件数・失敗・p95 を確認。遅い要求からサービスをまたぐスパンのタイムラインと関連ログを表示 |
| メトリクス | OTLP データポイント、CPU 累積使用時間、メモリの時系列と個々のサンプルを表示 |
| ダッシュボード | 検索条件、集計、グループ、時間幅を指定したパネルを組み合わせて保存。折れ線・数値・表に対応 |
| モニター | ダッシュボードのパネルから作成、または条件を直接入力。閾値、最低件数、欠測時の扱いを設定し、状態・履歴・通知結果を表示 |

APM の件数・失敗率・p95 の母集団は受信した server span です。全スパンは APM の一覧から開けます。メトリクスは受信した値の単位と累積・差分などの属性を保持します。ヒストグラムは件数・合計・最小・最大、summary は送信された分位値も表示できます。

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
