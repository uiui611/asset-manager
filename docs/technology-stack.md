# 技術スタック 0.2

2026-10-17。現行構成は[アーキテクチャ](kubernetes-architecture.md)を参照。

| 領域           | 採用技術                                       | 役割                                                   |
| -------------- | ---------------------------------------------- | ------------------------------------------------------ |
| UI             | Lit / TypeScript                               | 素材一覧とエディター                                   |
| 画像・音声     | Canvas / Web Worker / Web Audio / jsfxr        | ブラウザ内で処理、PNG/WAV生成                          |
| ブラウザ状態   | メモリ内の配列・Map・上限付きキャッシュ        | 一覧・タグ・操作状態・サムネイル・編集履歴             |
| API / 静的配信 | Rust / Axum / Tokio / tower-http               | 単一プロセス                                           |
| 本体ストレージ | 既存RustFS assets                              | フラットなUUIDキー、S3 API                             |
| メタデータ     | 既存YugabyteDB / 新規asset_manager DB          | 名前・タグ・version管理                                |
| DB接続         | tokio-postgres / deadpool-postgres             | 最大4接続、SQLを明示                                   |
| S3接続         | object_store                                   | SDK署名、ストリーム・multipart、自動再試行なし         |
| 配布           | GitHub Actions / GHCR / Kubernetes / 既存Nginx | main イメージ公開、OIDC webhook 更新、HTTPS / NodePort |
| 開発           | Bun / Vite / Biome                             | 既存フロントエンド基盤を維持                           |
| 検証           | Vitest / Playwright / cargo test               | ドメイン・画面・Rust API                               |

Google Identity ServicesとGoogle Drive APIを実行経路から除去。Google向けCSP許可も削除。ブラウザとAPIは同一オリジンのためCORS設定は不要。S3の公開URLや認証キーはブラウザへ渡さない。

IndexedDBとDexieを実行経路から除去し、旧ブラウザDBは開かず保持する。一覧は起動時と明示更新時にAPIから取得する。ファイル送信は失敗を通知し、ユーザーの明示操作でだけ再試行する。未完了処理の次回起動時の復旧・実行は行わない。画面移動・ページ離脱時は実行中の要求と待機処理を取り消し、`beforeunload` では確認通知だけを行う。

常駐するアプリコンテナは1つ。Bun/Nodeを本番サーバーとして動かさない。画像変換サービス・メッセージキュー・サーバー側サムネイル保存は導入しない。
