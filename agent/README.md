# yuniview agent

Go 製の Linux sidecar。OTLP/gRPC の traces・metrics・logs、コンテナの標準出力ログ、cgroup v2 の CPU・メモリを中央の PostgreSQL に配送する。agent と中央の間は HTTP または Unix ソケットを使う。yunirun を使わず単体で起動できる。

## 最初の起動

リポジトリ直下で中央サーバーを起動し、開発用サービス demo の blue 系に送信資格を発行する。次のコマンドは新しいローカル資格情報を作るためのもので、生成ファイルは Git の対象外に置く。

```sh
docker compose up -d --build
state_dir=$(mktemp -d)
umask 077
openssl rand -hex 32 | tr -d '\n' > "$state_dir/token"
digest=$(sha256sum "$state_dir/token" | cut -d' ' -f1)
docker compose exec -T postgres psql -U yuniview -d yuniview -v ON_ERROR_STOP=1 -v digest="$digest" <<'SQL'
INSERT INTO sources(id) VALUES ('demo') ON CONFLICT DO NOTHING;
INSERT INTO agent_credentials (token_sha256, source_id, workload, slot)
VALUES (:'digest', 'demo', 'app', 'blue');
SQL
(cd agent && go build -o "$state_dir/yuniview-agent" .)
"$state_dir/yuniview-agent" -service demo -workload app -slot blue \
  -instance local-1 -endpoint http://127.0.0.1:3000/api/agent/v1/batches \
  -token-file "$state_dir/token" -state "$state_dir/queue"
```

計装済みのアプリから OTLP/gRPC を 127.0.0.1:4317 へ送る。アプリと agent を同じ pod に置けば両者が loopback を共有できる。一般的な SDK の設定は OTEL_EXPORTER_OTLP_PROTOCOL=grpc、OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317。受信は平文の pod 内通信を想定する。中央へのホスト間通信には HTTPS を使用する。登録済みの資格を取り消すときは agent_credentials の該当行を削除する。

保存確認は中央の DB で行う。

```sh
docker compose exec postgres psql -U yuniview -c \
  "SELECT signal, instance, received_at FROM telemetry_batches ORDER BY received_at DESC LIMIT 10"
```

## 入力と配送

| 引数 | 動作 |
| --- | --- |
| -otlp traces,metrics,logs | 有効にした gRPC サービスだけを登録。空文字で受信を停止。gzip 対応、受信要求の展開後上限は 4 MiB |
| -log-file PATH | 対象のログファイルを初回は先頭から読み、行の配列を配送する。コンテナランタイムが記録した時刻やストリーム名は行内に保持する。64 KiB を超える行は分割する |
| -cgroup DIR | 対象コンテナの cgroup v2 ディレクトリで cpu.stat の usage_usec（累積）と memory.current（バイト）を読む。-sample-interval の既定は 10 秒 |
| -state DIR | 読み取り位置・未送信バッチの永続領域。送信資格のスコープごとにディレクトリを用意する。キューに入った時点の instance と revision を再送時にも保持する |
| -queue-bytes N | 未送信ペイロードの合計上限。既定 64 MiB。bbolt ファイルは再利用可能なページと管理領域を含むため、ファイルサイズはこの値を超えることがある |
| -socket PATH | 中央の HTTP 接続にホスト側 Unix ソケットを使用する。-endpoint には HTTP URL と取り込みパスを指定する |
| -shutdown-timeout D | 終了時の最終配送時間。既定 3 秒。配送できなかったバッチはディスクに残り、同じ state で再起動すると再送する |

OTLP の成功応答はキューへの永続化後に返す。満杯なら UNAVAILABLE を返し、ログの読取位置は進めない。資源サンプルは次回の採取時に再開し、欠測分の補間は行わない。agent 稼働中は rename によるログローテーション時に旧ファイルを読み切って新ファイルへ移る。停止中にローテーション・削除された旧ファイルの未読分は復元できない。ログファイルは親ディレクトリごと読み取り専用でマウントする。

中央の POST /api/agent/v1/batches は Bearer 資格を service・workload・slot と照合し、source_id と batch_id で再送を重複排除して 204 を返す。agent は 204 の後にバッチを削除する。OTLP の payload は Protobuf JSON で、bytes 型の ID は base64、64 ビット整数は文字列として保存する。配送失敗は標準エラーに記録し、最長 30 秒の間隔で再試行する。

## コンテナ・テスト

```sh
docker build -t yuniview-agent:local agent
docker run --rm yuniview-agent:local -help
(cd agent && go test -race ./...)
bun install --frozen-lockfile
bin/test-agent.sh
```

イメージは UID/GID 65532 で起動する。起動側で永続領域に書き込み権限、資格情報と対象のログ・cgroup に読み取り権限を付ける。agent-vX.Y.Z タグ用の GitHub Actions が検証成功後に ghcr.io/yuniruyuni/yuniview-agent:X.Y.Z をビルド・配布する。

統合テストは一時 PostgreSQL、実サーバー、agent に実際の gRPC を送信する。5 種の入力、中央停止中に受けたデータの再起動後の配送、資格の拒否と重複排除を検証する。
