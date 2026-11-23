# telcheck

[NVR510](https://network.yamaha.com/products/routers/nvr510/index) の発信者確認と通知を行います。

## Features

- システムログを解析し、着信・発信の情報を取得します。
  - どの電話番号へ着信したかなど、詳細な情報が取得できます。
- 電話の発着信があった場合、その電話番号が誰のものかを調べます。
  - 迷惑電話の着信時にすぐ把握できます。
- 通知先として、Discord Webhook、Discord Bot、Slack Incoming Webhook、Web Push API をサポートします。
  - 対応しているブラウザであれば、[Push API](https://developer.mozilla.org/ja/docs/Web/API/Push_API) を用いてプラットフォームの障害に影響されることなく、PC・スマートフォンなどで即座に通知を受け取れます。
  - LINE Notify は 2025-03-31 に提供が終了したため利用できません。設定に `line-notify` の宛先が残っていると起動時にエラーになるので、該当の宛先を削除するか、Discord・Slack・Web Push のいずれかへ移行してください。
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

## 保存ファイルの復旧

確認済み状態の `checked.json` が既に破損している場合、自動的に初期化せずエラーとして扱います。アプリを停止し、破損したファイルを別の場所に保管した上で、正常なバックアップを元のパスへ復元してください。バックアップがない場合は、通知履歴が失われ、初回処理時に検出した通話は通知されないことを確認してからファイルを移動し、アプリを再起動してください。パスは `CHECKED_PATH` で変更できます。

確認済み状態、Web Push の鍵と購読情報は、保存先と同じディレクトリ内で一時ファイルを書き込んでから置き換えます。保存先のディレクトリに書き込み権限が必要です。ファイル単体の bind mount などで置換できない場合はディレクトリをマウントしてください。強制終了後に残った、対象ファイル名で始まる隠し一時ディレクトリは、アプリを停止してから削除できます。

## License

The license for this project is [MIT License](LICENSE).