> 旧Google Drive版の記録です。2026-09-22以降の仕様は [Kubernetes版](kubernetes-architecture.md) を参照してください。

# Google OAuth クライアント ID の設定

このアプリにはWebアプリケーション用のOAuthクライアントIDが必要です。Googleアカウントを持っているだけではアプリからDrive APIを呼び出せません。

1. [Google Cloud Console](https://console.cloud.google.com/) を開き、プロジェクト選択 → 新しいプロジェクトから `Asset Manager` などの名前で作成します。
2. 対象プロジェクトで「APIとサービス」→「ライブラリ」→ **Google Drive API** →「有効にする」。
3. 「Google Auth Platform」の初期設定を開始し、アプリ名と連絡先を入力します。個人Gmailアカウントの場合、対象は「外部」を選びます。
4. 「対象」で公開状態を「テスト」にし、テストユーザーに自分のGoogleメールアドレスを追加します。
5. 「データアクセス」で `https://www.googleapis.com/auth/drive` を追加します。このアプリは設計書どおり個人利用を前提に、Drive全体へアクセスできるスコープを要求します。アプリが一覧表示するのは管理プロパティが付いたファイルだけです。
6. 「クライアント」→「クライアントを作成」→アプリケーションの種類「ウェブ アプリケーション」。
7. 承認済みのJavaScript生成元に次を登録します。パスや末尾のスラッシュは付けません。

   ```text
   http://localhost
   http://localhost:5173
   ```

8. ブラウザでは `http://localhost:5173` を使用してください。`127.0.0.1`で開く場合は `http://127.0.0.1:5173` も追加します。Viteプレビューの4173番や本番URLを使う場合は、それぞれの生成元を追加します。
9. リダイレクトURIは設定不要です。このアプリはGISのポップアップ式トークンモデルを使います。
10. 作成された **クライアントID**（末尾が `.apps.googleusercontent.com`）をコピーします。クライアントシークレットの共有・設定は不要です。
11. アプリの「設定・データ管理」→「OAuthクライアントID」へ貼り付け、「設定を保存」→「Google Drive に接続」を押します。
12. 自分のアカウントを選び、Driveアクセスを許可してください。接続後に `2D Game Asset Manager` フォルダが作られます。

## うまく接続できない場合

- `origin_mismatch`: ブラウザのアドレスと承認済み生成元のスキーム・ホスト・ポートが一致しているか確認します。
- `access_denied`: 対象Googleアカウントをテストユーザーに追加したか、Driveアクセスを許可したか確認します。
- ポップアップが開かない: このアプリのポップアップを許可します。
- APIが無効: OAuthクライアントを作成したプロジェクトでDrive APIを有効にします。
- 再接続を要求される: アクセストークンは短命で、ページ再読み込みでも失われます。「Google Drive に接続」を押し直します。
- 「異なるGoogleアカウント」: 同じアカウントで接続するか、マニフェストを書き出した後にローカルデータを消去してから切り替えます。

アプリを一般公開する設定やOAuthの審査申請は、この個人用構成には含めません。

公式資料:
- [クライアント ID の取得](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
- [GISトークンモデル](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Driveアップロード](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
