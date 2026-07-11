# GitHub Copilot Code Review Instructions

このファイルは GitHub Copilot のコードレビュー向け。開発手順やコマンドは `CLAUDE.md` を参照し、ここでは重複させない。レビュー時に重点確認する観点と、フラグすべきでない既知パターンのみを記載する。

## プロジェクトの前提

- Yamaha NVR510 ルーターの発着信を解析し、各種プラットフォーム（Discord, Slack, LINE, Web Push）へ通知する TypeScript 製アプリ。個人・少人数運用の private リポジトリ。

## 強制されている規約（逸脱は指摘する）

- フォーマット: Prettier（`.prettierrc.yml`）。整形差分は指摘する。
- Lint: ESLint（`eslint.config.mjs`, `@book000/eslint-config`）。
- 型: `tsc`（`tsconfig.json`）。`skipLibCheck` による型エラー回避は禁止。
- 関数・インターフェースには日本語の JSDoc を付与する。
- コメント・会話は日本語、エラーメッセージは英語。
- 日本語と英数字の間には半角スペースを入れる。
- コミットは Conventional Commits（`<description>` は日本語）。

## レビュー時の重点確認

- エラーハンドリング: 例外を握りつぶしていないか。既存のエラーメッセージが絵文字付きなら、新規メッセージも内容に即した絵文字を先頭に付ける慣習に従っているか。
- 責務分離: 共通ロジックは `src/utils` に置く。`src/web`（Fastify ルーター/API）へロジックを直書きしていないか。
- 型安全性: `any` の濫用や不必要な型アサーションがないか。
- 機密情報: 認証情報・VAPID キー・電話番号などの個人情報がコミットやログに混入していないか。設定は `data/config.json`（`CONFIG_PATH` で上書き可）経由で扱う。
- スキーマ整合: `Configuration` 型を変更したら `pnpm generate-schema` で `schema/Configuration.json` が再生成されているか。
- ドキュメント整合: NVR510 の内部 API を変更したら `API.md` が更新されているか。

## フラグすべきでない既知パターン

- 自動テスト（Jest / Vitest 等）が存在しないこと自体は現状の方針であり、テスト未追加をブロッカーとして指摘しない（検証は Lint と型チェックで行う）。
- 日本語のコメント・コミットメッセージは規約どおりであり、英語化を求めない。
- `API.md` や実装中の NVR510 ダッシュボード用エンドポイントパスは、ルーター側の固定仕様に合わせた意図的なもの。
