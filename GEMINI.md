# GEMINI.md

## 目的
Gemini CLI 向けのコンテキストと作業方針を定義する。

## 出力スタイル
- 言語: 日本語
- トーン: プロフェッショナルかつ簡潔
- 形式: Markdown

## 共通ルール
- 会話は日本語で行う。
- コミットメッセージは Conventional Commits に従い、`<description>` は日本語で記載する。
- 日本語と英数字の間には半角スペースを挿入する。

## プロジェクト概要
- 目的: Yamaha NVR510 ルーターの発信者確認と通知
- 主な機能:
  - NVR510 ログ解析
  - 電話番号所有者検索
  - 多様なプラットフォームへの通知（Discord, Slack, LINE, Web Push）

## コーディング規約
- 言語: TypeScript
- コメント: 日本語
- エラーメッセージ: 英語
- フォーマット: Prettier
- 命名規則: プロジェクトの既存コード（camelCase 等）に従う

## 開発コマンド
```bash
# インストール
pnpm install

# 開発
pnpm dev

# ビルド・実行
pnpm start

# Lint 実行
pnpm lint

# 自動修正
pnpm fix
```

## 注意事項
- 認証情報のコミット禁止。
- ログへの機密情報出力禁止。
- 既存のアーキテクチャやコーディングパターンの尊重。
- `skipLibCheck` の使用禁止。

## リポジトリ固有
- `src/utils/nvr510.ts` の解析ロジックがこのプロジェクトの核心である。
- 設定ファイルは `data/config.json` に配置され、スキーマ駆動で管理されている。
