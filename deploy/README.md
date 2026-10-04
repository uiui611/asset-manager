# Kubernetes デプロイ

マニフェストの正本はこのリポジトリの `deploy/asset-manager.yaml` です。対象は `default` Namespace の Deployment / Service `asset-manager`。1 レプリカ、NodePort 30820 を既存 Nginx が `https://ubuntu.home.arpa/asset-manager/` に公開します。

既存の RustFS `assets` バケット、YugabyteDB `asset_manager` データベース、Secret `asset-manager-credentials`（`DATABASE_URL`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`）を使用します。アプリは PVC を持ちません。DB と S3 の両方をバックアップしてください。Secret の値を Git・文書・ログへ残さないでください。

## 通常の更新

`main` への push で GitHub Actions がフロントエンド・Rust を検証し、UI と API の単一イメージを GHCR へ公開します。Pull Request は検証とイメージのビルドだけを行い、公開・通知は行いません。main での手動実行も利用できます。

公開タグは `ghcr.io/uiui611/asset-manager:main` と `sha-<commit SHA>`。Deployment は `main` と `imagePullPolicy: Always` を使用します。公開後に GitHub OIDC で `https://deploy.mizu-mizu.info/v1/deployments` へ `asset-manager` の更新を通知します。通知は 1 回のみで、失敗を許容し、Pod の更新完了を待ちません。

webhook 受信側には `uiui611/asset-manager`、repository ID `1404298093`、owner ID `19321707`、`main` の `publish-image.yml`、Deployment `default/asset-manager` を登録します。受信側の Kubernetes 認証情報はアプリや GitHub に配布しません。

GHCR パッケージは Public に設定して匿名 pull を許可します。イメージ公開には組み込みの `GITHUB_TOKEN`、通知には短命の OIDC トークンを使用し、GitHub に長命の資格情報を登録しません。

## マニフェストの適用

イメージの更新通知は YAML や Secret 自体の変更を適用しません。マニフェストを変更した場合は、対象 context と差分を確認して適用します。

```powershell
kubectl config current-context
kubectl --context kubernetes-admin@kubernetes -n default apply --dry-run=client -f deploy/asset-manager.yaml
kubectl --context kubernetes-admin@kubernetes -n default apply --dry-run=server -f deploy/asset-manager.yaml
kubectl --context kubernetes-admin@kubernetes -n default diff -f deploy/asset-manager.yaml
kubectl --context kubernetes-admin@kubernetes -n default apply -f deploy/asset-manager.yaml
kubectl --context kubernetes-admin@kubernetes -n default rollout status deployment/asset-manager
```

context 名は環境に合わせて変更します。Windows に diff がない場合は、Ubuntu / cp1 で差分を確認します。DB スキーマ互換性を確認してから更新してください。イメージを戻す場合は、既存の `sha-<commit SHA>` タグを指定してマニフェストを更新できます。

`/asset-manager/healthz` はプロセス生存、`/asset-manager/readyz` は DB 到達を確認します。通常の更新では初期化や素材の削除を行いません。

## 新規環境のみ

以下は復元資料です。既存環境のイメージ更新や GitHub 移行時には実行しません。

- `bootstrap.ps1` は DB、専用ロール、テーブル、基本タグ、Secret を作成します。既存 Secret があると停止します。初期化は冪等ではないため、途中で失敗した場合は作成済みリソースを確認し、必要な続きだけを行います。DB を削除して再実行しません。
- `s3-bootstrap.yaml` は既存 `assets` バケットに限定した資格情報を一時 Job で作成します。既存資格情報がある場合は再適用しません。
- `configure-proxy.py` は Ubuntu `/home/mizu/containers/nginx.conf` に upstream / location を追加します。既存の設定を確認し、Nginx 構文検証後に reload します。

SQL は `backend/schema.sql` を参照してください。既存の RustFS / YugabyteDB の PV と保持方針を引き継ぎます。
