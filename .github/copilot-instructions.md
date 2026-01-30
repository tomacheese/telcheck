# GitHub Copilot Instructions

## プロジェクト概要
- 目的: Yamaha NVR510 ルーターの発信者確認と通知
- 主な機能:
  - システムログの解析による発着信情報の取得
  - 電話番号の所有者検索（迷惑電話の特定）
  - 各種プラットフォーム（Discord, Slack, LINE, Web Push）への通知
- 対象ユーザー: NVR510 を利用している個人・管理者

## 共通ルール
- 会話は日本語で行う。
- PR とコミットは Conventional Commits に従う。
  - `<type>(<scope>): <description>` 形式
  - `<description>` は日本語で記載
- 日本語と英数字の間には半角スペースを入れる。

## 技術スタック
- 言語: TypeScript
- フレームワーク: Fastify (Web API / Dashboard)
- パッケージマネージャー: pnpm
- 主要ライブラリ: axios, cheerio (番号検索), web-push

## コーディング規約
- フォーマット: Prettier (`.prettierrc.yml`)
- Lint: ESLint (`eslint.config.mjs`)
- 型チェック: TypeScript (`tsconfig.json`)
- 関数やインターフェースには docstring (JSDoc) を日本語で記載する。
- TypeScript の `skipLibCheck` による回避は禁止。

## 開発コマンド
```bash
# 依存関係のインストール
pnpm install

# 開発（ホットリロードあり）
pnpm dev

# 実行
pnpm start

# Lint 実行
pnpm lint

# 自動修正（ESLint, Prettier）
pnpm fix

# JSON Schema 生成
pnpm generate-schema
```

## テスト方針
- 現在、明示的なテストコード（Jest, Vitest 等）は導入されていない。
- コード変更時は `pnpm lint` による型チェックと静的解析を必ず実行する。

## セキュリティ / 機密情報
- 認証情報や API キーを Git にコミットしない。
- ログに機密情報を出力しない。
- 設定ファイル (`data/config.json`) の扱いに注意する。

## ドキュメント更新
- `API.md`: API 仕様の変更時に更新
- `schema/Configuration.json`: 設定項目の変更時に `pnpm generate-schema` で更新
- `README.md`: 機能追加や設定方法の変更時に更新

## リポジトリ固有
- NVR510 のシステムログを解析するロジックは `src/utils/nvr510.ts` に集約されている。
- 通知先の実装は `src/utils/destination.ts` および `src/utils/web-push.ts` を参照。
- ダッシュボードのフロントエンド資産は `src/public` に配置されている。
