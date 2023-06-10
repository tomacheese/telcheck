# telcheck

[NVR510](https://network.yamaha.com/products/routers/nvr510/index) の発信者確認と通知を行います。

## Features

- システムログを解析し、着信・発信の情報を取得します。
  - どの電話番号へ着信したかなど、詳細な情報が取得できます。
- 電話の発着信があった場合、その電話番号が誰のものかを調べます。
  - 迷惑電話の着信時にすぐ把握できます。
- 通知先として、Discord Webhook、Discord Bot、Slack Incoming Webhook、LINE Notify、Web Push API をサポートします。
  - 対応しているブラウザであれば、[Push API](https://developer.mozilla.org/ja/docs/Web/API/Push_API) を用いてプラットフォームの障害に影響されることなく、PC・スマートフォンなどで即座に通知を受け取れます。
- ダッシュボード上で通信しているエンドポイントを利用してデータを取得します。
  - システムログがログイン情報で埋め尽くされることはありません。
- Docker 上で動作します。

## Configuration

デフォルトでは、`data/config.json` が使用されます。環境変数 `CONFIG_PATH` を用いて設定ファイルのパスを変更することができます。

設定ファイルの JSON Schema はこちらから閲覧できます:
[schema/Configuration.json](schema/Configuration.json)

```json
{
  "$schema": "https://raw.githubusercontent.com/tomacheese/telcheck/master/schema/Configuration.json"
}
```

## License

The license for this project is [MIT License](LICENSE).