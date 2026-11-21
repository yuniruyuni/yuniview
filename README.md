# yuniview

セルフホスト型のテレメトリ収集・可視化ツール。独立した agent が対象コンテナのデータを集め、中央アプリでログ検索、APM、ダッシュボード、モニターを提供する計画です。

## 開発

現時点で起動できるのは中央アプリの基盤です。React の画面、Hono の /health、PostgreSQL のスキーマ適用を含みます。ローカルでの起動はリポジトリ直下で実行します。

```sh
docker compose up --build
```

ブラウザーで http://localhost:3000 を開きます。開発用 PostgreSQL のデータは Compose volume に保存されます。

```sh
bun install --frozen-lockfile
bun run check:type
bun run check:lint
bun run check:test
bun run build
```

## 構成

- client、server、e2e は template 由来の Bun workspaces です。サーバー側の規約は [アーキテクチャ](docs/architecture.md) にあります。
- schema と bin/migrate.sh が PostgreSQL の宣言と適用を担当します。
- [agent の統合仕様案](agent/README.md) はコンテナランタイムをまたぐ配布・設定の境界を定めます。
- [機能と yunirun 統合の設計案](docs/product-design.md) に実装予定をまとめています。agent と取り込み・分析機能は開発予定です。

yuniview のビルド・起動・リリースはこのリポジトリで完結させます。yunirun は後続リリースで agent を標準で組み込めるようにし、各アプリの宣言に応じて起動する方針です。
