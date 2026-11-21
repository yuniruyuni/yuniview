# yuniview の設計

yunirun のコンテナに宣言で収集エージェントを付け、サービス横断でログ・メトリクス・トレースを調査するための設計案。ダッシュボードとモニターは利用者が画面で作成できる。初期の配備先は単一 VPS。エージェント、受信・保存、検索、モニター評価、UI はこのリポジトリで実装する。

現行版の中央アプリは評価ワーカーをサーバー内で起動し、PostgreSQL の行ロックで重複評価を防ぐ。以下の yunirun.jsonc 宣言と pod の自動構成は今後の統合案。現行版の起動・操作は [README](../README.md) にまとめている。

## アプリ作者から見た使い方

次は提案する yunirun.jsonc の構文。app の指定は blue と green の両方に適用し、各 workload は個別に指定する。省略した対象にはエージェントを付けない。

```jsonc
{
  "app": {
    "telemetry": {
      "stdout": true,
      "resources": true,
      "otlp": ["traces", "metrics", "logs"]
    }
  },
  "workloads": {
    "cleanup": {
      "schedule": "02:23",
      "telemetry": { "stdout": true, "resources": true }
    }
  }
}
```

stdout は標準出力・標準エラー、resources はコンテナの CPU・メモリ、otlp はアプリが送信する OpenTelemetry データを表す。前二者はアプリのコード変更なしで取得できる。HTTP や DB の個別スパンには、対象ライブラリに対応する自動計装または SDK での計装が必要になる。template のトレース exporter は OTLP/gRPC を明示しているため、初版は gRPC のトレース受信から検証する。metrics・logs の gRPC 受信も同じ agent に実装する。[OTLP 仕様](https://opentelemetry.io/docs/specs/otlp/)

## データの流れ

    post-blue  + 専用 agent  ─┐
    post-green + 専用 agent  ─┼─ バッチ送信 → yuniview server → PostgreSQL
    cleanup    + 実行時 agent ─┘                    ├─ UI・検索・ダッシュボード
                                                  └─ モニター評価・通知

- **yunirun** が対象ごとにアプリと agent を同じ Podman pod に配置する案。pod 内の loopback に agent の OTLP 受信口を用意し、アプリに endpoint と protocol を渡す。各 pod は同じ受信ポートを使える。既存のアプリ用公開ポートは pod に移し、HAProxy からの接続先を維持する。既存のトレース送信設定と競合する場合は明示した telemetry 宣言を優先する。
- **agent** は OTLP を受け、対象コンテナの stdout/stderr と資源サンプルを取り込む。実装候補は pod ごとの専用ディレクトリに Podman のコンテナログを出し、agent に読み取り専用で渡す方式。CPU・メモリは対象 cgroup の値を読む。rootless Podman でのログ追従・ローテーション、cgroup の解決と再作成への追従を最初の技術検証にする。agent にホスト全体の journal、Podman API ソケット、アプリの DB 資格情報を渡さない構成にする。
- **中央サーバー** は Hono の取り込み用 HTTP ルートで agent のバッチを受け、PostgreSQL に確定してから応答する。agent からはホストの専用 Unix ソケットをマウントし、ホスト側で yuniview の HAProxy frontend へ中継する案とする。ソケットは blue/green の入れ替えをまたいで同じ場所に置く。取り込みには対象別の認証を必須にし、外部公開する UI の経路では取り込み URL を遮断する。ホストが対象別の送信資格を発行し、サービス名と系は資格に紐づける。agent は上限付きの永続キューとバッチ ID を持ち、再送を中央で重複排除する。送信遅延・破棄件数も画面に出す。アプリへの応答とデプロイの健全性判定は中央サーバーの可用性から独立させる。
- **実行単位**は service、workload、slot（blue/green）、revision、instance ID で識別する。更新時はデプロイ対象の系に新しい revision と instance ID を割り当てる。短命ジョブには実行ごとの ID を付け、終了時に送信期限を設け、残りは次回配送に引き継ぐ。migration は現行の root 側 podman run 経路にも対応が必要になる。

## 中央でできること

| 機能 | 操作とデータ |
| --- | --- |
| ログ閲覧 | サービス・系・リビジョン・時間帯・本文で検索。構造化ログに trace ID があれば該当トレースへ移動する。stdout と OTLP の両方に同じログを出すアプリは収集元を一方に指定できる |
| APM | サービスと HTTP ルートごとに受信した server span の件数、失敗率、p95 を集計。遅い要求を開いて子スパンの時間軸と関連ログを表示する。ルートはテンプレート名を使用。アプリ間でトレースコンテキストが伝播すれば、同じ trace ID でサービスをまたいで表示する |
| ダッシュボード | データ種別、指標、絞り込み、集計、グループ、時間幅を選び、折れ線・数値・表のパネルとして保存する。同じ時間帯のログやトレースへ移動できる |
| モニター | パネルと同じ検索・集計条件に、閾値、評価窓、最低件数、欠測時の扱い、通知先を追加して保存。例は「post の server span が直近 5 分で 100 件以上あり、そのうち 5xx が 2% を超えたら webhook に通知」。正常・発報・データなしの遷移と復旧を記録する |

APM の件数と分位点は受信したスパンを母集団とし、画面に明示する。全 HTTP 要求を分母にした監視が必要な場合は、サンプリング前の要求カウンタと所要時間ヒストグラムをアプリから送る。振り分け前の 503 は HAProxy 自身を計測対象に加える段階で扱う。

## template に沿ったリポジトリ構成

基準はローカルの template（10e0c89）。client・server・e2e を Bun workspaces として管理し、収集専用の agent を独立した配布単位として加える。

| 場所 | yuniview で担当するもの |
| --- | --- |
| client/ | React・TypeScript・Tailwind によるログ検索、トレース詳細、ダッシュボード編集、モニター管理。ビルドした静的ファイルは server と同じイメージに入れる |
| server/src/presentation/ | Hono が agent のバッチを受信し、tRPC が画面からの検索や編集を受け付ける |
| server/src/usecases/ | バッチの取り込み、トレース検索、パネル保存、モニター評価。template の pre → read → process → write → post → result とトランザクション境界に従う |
| server/src/models/ | ログ、スパン、メトリクス、パネル、モニターの型と判定規則。ダッシュボードとモニターは同じ集計条件を利用する |
| server/src/repositories/ | PostgreSQL からの取得・集計・保存。Model の Spec と capability で検索条件と読み書きを表現する。webhook 送信は外部サービス用 Repository に置く |
| server/src/infra/ | DB 接続、構造化ログ、トレースなどの基盤 |
| schema/、bin/migrate.sh | PostgreSQL の宣言的スキーマと pgschema による適用。trace ID、サービス・時刻、系列・時刻の索引、バッチの重複排除、評価履歴の一意制約を定義する |
| e2e/ | template の Playwright の screens / scenarios 構成で、遅い要求からログへの遷移、ダッシュボード保存、モニター作成を検証する |
| agent/ | sidecar の OTLP 受信、ログ・資源採取、キューと再送。各コンテナに常駐するため Go の小さな独立バイナリを候補とし、待機メモリを実測する |
| docs/architecture.md | 実装開始時に template のサーバー規約を継承し、バッチの境界とモニターの評価・通知手順を追記する |

### 配布と実行

template の Dockerfile、Dockerfile.migration、schema-plan、イメージビルド、deploy-yunirun の流れを使う。中央アプリは yunirun.jsonc で app.database を有効にし、migration でスキーマを適用してから blue/green を更新する。両系は同一 PostgreSQL を参照する。agent は専用イメージとしてビルドし、ホスト側で採用する版を固定する。

モニターの定期評価は専用のスケジュール workload として同じ server のコードを起動する。モニター ID と評価窓で結果を一意にし、状態遷移と通知待ちレコードを同時に確定する。webhook は確定後に送信し、失敗分は再試行する。テレメトリの保持期間、系列数、取り込み量はホストの容量に合わせて設定する。

yuniview はここで示したアプリと agent を配布する。yunirun は telemetry 宣言の検証・pod と agent の生成・更新・後片付けを担当する。yuniruyuni.net は中央アプリの登録、取り込みソケットの中継、UI のアクセス経路を宣言する。

## 最初のリリースまで

1. **収集を実証する。** 代表アプリ一つの blue/green に agent を付け、標準出力と SDK の OTLP を中央へ届ける。片系更新、agent の再起動、中央停止・復帰、短命ジョブの終了を試し、サービス継続とデータの帰属・再送を確認する。agent 一つ当たりの待機メモリと、全対象に付けた場合の負荷を測る。
2. **一件を調査できるようにする。** サービス一覧から遅いルート、具体的なトレース、該当ログまで辿る。リビジョン切替前後で件数と所要時間を比較する。
3. **同じ調査を継続監視にする。** 検索条件をパネルとして保存し、そこからモニターを作成する。既知の入力で発報・復旧・欠測を確認する。監視製品の外部サービスを起動せずこの一連の操作が通ることを初版の受け入れ条件とする。
