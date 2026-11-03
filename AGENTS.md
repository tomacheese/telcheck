# AGENTS.md

AI エージェント (Claude Code, GitHub Copilot など) 向けの共通ルール。

## 言語ルール

- 会話・成果物 (コミットの description、PR / Issue のタイトル・本文・レビューコメント、コード内コメント、JSDoc、ドキュメント) は日本語で書く。
- 例外: エラーメッセージは英語。`package.json` は英語。UI の文言・引用・技術的な識別子・外部由来のテキスト (NVR510 のログ例など)・生成ファイルはそのまま。
- 日本語と英数字の間には半角スペースを入れる。
- 1 つの文の途中で手動改行しない。
- Git の履歴は書き換えない。

## プロジェクト概要

Yamaha NVR510 ルーターのシステムログを解析して発着信を検知し、電話番号の持ち主を調べて Discord / Slack / LINE Notify / Web Push へ通知する TypeScript 製アプリ。Docker で動作する。

- `src/main.ts`: エントリーポイント
- `src/utils/nvr510.ts`: NVR510 のログ取得・解析
- `src/utils/search-number.ts`: 電話番号の検索
- `src/utils/destination.ts`: 通知先ごとの送信
- `src/utils/delivery*.ts`: 配送状態の管理と永続化
- `src/utils/web-push.ts`: Web Push (VAPID キーが必要)
- `src/web/`: Fastify による Web サーバー・API
- `src/public/`: ダッシュボードのフロントエンド
- `schema/Configuration.json`: 設定ファイル (`data/config.json`、`CONFIG_PATH` で変更可) の JSON Schema
- `API.md`: NVR510 の内部 API メモ

## 開発コマンド

pnpm 専用。

```bash
pnpm install
pnpm dev              # tsx watch で起動
pnpm start            # tsx で起動
pnpm lint             # prettier / eslint / tsc
pnpm fix              # prettier / eslint の自動修正
pnpm test             # node:test (src/**/*.test.ts)
pnpm generate-schema  # schema/Configuration.json を再生成
```

## 規約

- コミットは Conventional Commits (type は英語、description は日本語)、ブランチは Conventional Branch (`feat/`, `fix/` など)。
- 関数・インターフェースには日本語の JSDoc を付ける。コメントは「なぜ」を書き、コードを読めば分かる内容は書かない。
- `skipLibCheck` は使わない。
- 共通ロジックは `src/utils` に置き、`src/web` に直接書かない。
- 既存のエラーメッセージに絵文字がある場合は、新規メッセージにも内容に即した絵文字を先頭に付ける。
- テストは新規依存を増やさず `node:test` で書く。
- `Configuration` 型を変更したら `pnpm generate-schema` を実行する。NVR510 の内部 API を使う処理を変えたら `API.md` を更新する。
- Renovate が作成した PR には追加コミットしない。

## セキュリティ

- API キー、認証情報、VAPID キー、電話番号などの個人情報をコミットしない。ログにも出力しない。
- 設定は `data/config.json` または環境変数経由で受け取り、ソースにハードコードしない。
- NVR510 へのログイン・ログ取得はルーターへの負荷を考慮して実装されているため、むやみに頻度を上げない。
