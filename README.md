# すぐタスク

iOSのSafariを主対象にした、モバイルファーストのタスク管理Webアプリです。入力欄からすぐ追加でき、タスクを横にスワイプして「未着手 → 進行中 → 完了」に移せます。PCでも使えます。

## 技術選定と理由

| 技術 | 用途 | 選定理由 |
| --- | --- | --- |
| HTML / CSS / JavaScript | 画面と操作 | ビルド待ちや大きなライブラリを避け、iOS Safariで入力までの時間を短くします。依存を減らして保守しやすくします。 |
| Cloudflare Workers | APIと配信 | 静的ファイルとAPIを同一ドメインで配信でき、サーバー管理が不要です。 |
| Cloudflare D1 | タスク保存 | Googleアカウントごとにタスクを分離できるSQLデータベースです。 |
| Cloudflare Workers AI | 文章からのタスク抽出 | AI用の別事業者のAPIキーを持たず、Workersのバインディングから呼べます。 |
| Google OpenID Connect | ログイン | アプリ側でパスワードを保存しません。Googleの署名付きIDトークンを検証し、HttpOnlyセッションCookieを発行します。 |
| PWA | ホーム画面追加 | iOSでアプリのように起動できます。 |

Appleの[Materialsガイド](https://developer.apple.com/design/human-interface-guidelines/materials)に沿い、ガラス表現は入力欄と下部ナビゲーションに使用し、本文のタスクカードは不透明な白にしています。透明度や動きを減らすOS設定にも対応しています。

## 操作

- 入力欄に書いてReturnまたは矢印で即追加。
- タスクを左にスワイプすると次の状態、右にスワイプすると前の状態へ移動。ボタン操作でも移動できます。
- チェックで完了、削除ボタンで削除。
- AI整理に文章を入れると、最大8件のタスク候補を抽出して追加。

## Cloudflare公開準備

1. Node.jsを用意して `npm install`。
2. `npx wrangler login` でCloudflareにログイン。
3. `npx wrangler d1 create sugu-task` を実行し、返された `database_id` を `wrangler.jsonc` に設定。
4. Google Cloud ConsoleでOAuth同意画面とWebアプリのクライアントを作り、承認済みリダイレクトURIに `https://<公開ドメイン>/auth/callback` を登録。
5. `npx wrangler secret put GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`SESSION_SECRET` を設定。`SESSION_SECRET` は32文字以上の乱数。
6. `npm run db:remote`、`npm run deploy`。

ローカルは `.dev.vars.example` を `.dev.vars` にコピーして値を設定し、`npm run db:local`、`npm run dev` で起動できます。GoogleのローカルリダイレクトURIには `http://localhost:8787/auth/callback` を追加します。認証情報をGitに入れないでください。

## 検証

`npm test` で認証の基本的な拒否動作を確認できます。公開後は実際のGoogleログイン、D1への保存、Workers AIの応答をブラウザで確認してください。
