# GitHub Copilot 指示ファイル

## プロジェクト概要

このプロジェクトは `telcheck` という名前の TypeScript/Node.js アプリケーションです。NVR510
ルーターの着信・発信情報を監視し、電話番号の確認と通知を行うシステムです。

### 技術スタック

- **言語**: TypeScript
- **ランタイム**: Node.js
- **パッケージマネージャー**: pnpm
- **Web フレームワーク**: Fastify
- **リンター**: ESLint (@book000/eslint-config)
- **フォーマッター**: Prettier
- **コンテナ**: Docker
- **通知サービス**: Discord、Slack、LINE Notify、Web Push API

## コミュニケーション言語ルール

**すべてのコミュニケーションは日本語で行ってください。**

### 必須要件

- **Issue タイトル・本文**: 日本語で記述
- **PR タイトル・本文**: 日本語で記述（Conventional Commits の仕様に従う）
- **コミットメッセージ**: 日本語で記述（Conventional Commits の仕様に従う）
- **レビューコメント**: 日本語で記述
- **コード内コメント**: 日本語で記述

### フォーマット規則

- 英数字と日本語の間には、半角スペースを入れる
- すべての見出しとその本文の間には、空白行を入れる

## Conventional Commits 仕様（日本語版）

### フォーマット

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Type 一覧

- `feat`: 新機能追加
- `fix`: バグ修正
- `docs`: ドキュメント変更
- `style`: コードフォーマット変更
- `refactor`: リファクタリング
- `test`: テスト追加・修正
- `chore`: その他の変更

### 例（コミット）

```text
feat(notification): Discord Webhook 通知機能を追加

Discord Webhook を使用した通知機能を実装しました。
設定ファイルで Webhook URL を指定することで、
電話の着信・発信時に Discord チャンネルに通知が送信されます。

Closes #123
```

## コード規約

### TypeScript

- 型安全性を重視し、`any` 型の使用は避ける
- 関数には適切な型注釈を付ける
- インターフェースとタイプエイリアスを適切に使い分ける

### コメント

- 複雑なロジックには日本語でコメントを追加
- 関数の目的や引数の説明を JSDoc 形式で記述
- TODO コメントには日付と担当者を明記

### 例（実装）

```typescript
/**
 * 電話番号の詳細情報を検索する
 * @param phoneNumber 検索対象の電話番号
 * @returns 電話番号の詳細情報、見つからない場合は null
 */
async function searchPhoneNumber(
  phoneNumber: string
): Promise<PhoneDetail | null> {
  // Google 検索 API を使用して
  // 電話番号を検索
  const searchResult = await googleSearch(phoneNumber)

  // TODO: 2024-01-15 より効率的な検索アルゴリズムの実装を検討
  // (Tomachi)
  return parseSearchResult(searchResult)
}
```

## 開発環境

### 必要なツール

- Node.js (バージョンは `.node-version` を参照)
- pnpm
- Docker (本番環境用)

### セットアップ

```bash
# 依存関係のインストール
pnpm install

# 開発サーバーの起動
pnpm dev

# リントの実行
pnpm lint

# フォーマットの修正
pnpm fix
```

## テストとリント

### リント

- ESLint と Prettier を使用したコード品質の維持
- TypeScript の型チェックも含む
- すべてのコミット前にリントを実行する

### コマンド

```bash
# リントチェック
pnpm lint

# 自動修正
pnpm fix

# TypeScript 型チェック
pnpm lint:tsc
```

## ファイル構成

```text
src/
├── main.ts              # アプリケーションのエントリポイント
├── utils/               # ユーティリティ関数
│   ├── config.ts        # 設定ファイルの読み込み
│   ├── nvr510.ts        # NVR510 との通信
│   ├── search-number.ts # 電話番号検索
│   └── destination.ts   # 通知先管理
├── web/                 # Web サーバー関連
└── public/              # 静的ファイル
```

## 通知機能

### サポートする通知サービス

- Discord Webhook
- Discord Bot
- Slack Incoming Webhook
- LINE Notify
- Web Push API

### 設定

設定ファイル `data/config.json` で通知先を設定します。JSON Schema は `schema/Configuration.json`
を参照してください。

## Docker

### ビルド

```bash
docker build -t telcheck .
```

### 実行

```bash
docker-compose up -d
```

## ドキュメント

- `README.md`: プロジェクトの概要と使用方法
- `API.md`: API の仕様
- `schema/Configuration.json`: 設定ファイルの JSON Schema

### ドキュメントの更新

機能追加や変更時には、関連するドキュメントも必ず更新してください。特に：

- API の変更時は `API.md` を更新
- 設定項目の変更時は JSON Schema を更新
- 新機能追加時は `README.md` の Features セクションを更新

## 注意事項

- システムログの解析が主要機能のため、ログパターンの変更には注意が必要
- 通知機能はリアルタイム性が重要なため、パフォーマンスを考慮した実装を心がける
- 個人情報（電話番号）を扱うため、セキュリティに十分配慮する
- Docker での動作を前提としているため、環境依存の実装は避ける
