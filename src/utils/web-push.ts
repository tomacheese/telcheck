import { Logger } from '@book000/node-utils'
import fs from 'node:fs'
import webpush, { WebPushError } from 'web-push'

interface IWebPushKey {
  vapid: {
    publicKey: string
    privateKey: string
  }
}

export interface Subscription {
  destinationName: string
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

/** 送信結果の分類 */
type DeliverResult =
  | { kind: 'sent' | 'expired'; statusCode: number }
  | { kind: 'transient' | 'permanent'; statusCode?: number }

/**
 * 再送すれば成功し得る HTTP ステータスコードか判定する
 * @param statusCode HTTP ステータスコード
 * @returns 5xx・429・408 の場合 true
 */
function isTransientStatusCode(statusCode: number): boolean {
  return statusCode >= 500 || statusCode === 429 || statusCode === 408
}

/**
 * 通信起因 (接続断・タイムアウト・名前解決失敗など) のエラーか判定する
 *
 * Node.js のネットワークエラーは `ECONNRESET` や `EHOSTUNREACH` のように `E` で始まる
 * `code` を持つ (undici は `UND_ERR_*`)。`ERR_*` は Node.js の引数検証エラー、
 * `code` を持たない Error は web-push の入力検証エラー (VAPID 設定不備など) のため、
 * 再送しても成功しない失敗として扱う。
 * @param error 捕捉したエラー
 * @returns 通信起因のエラーの場合 true
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true
  }
  const candidates = [error, (error as { cause?: unknown }).cause]
  return candidates.some((candidate) => {
    const code = (candidate as { code?: unknown } | undefined)?.code
    return (
      typeof code === 'string' &&
      (code.startsWith('UND_ERR_') ||
        (code.startsWith('E') && !code.startsWith('ERR_')))
    )
  })
}

export class WebPush {
  private static instance: WebPush | null = null

  public readonly vapidPublicKey: string
  private readonly vapidPrivateKey: string

  private constructor() {
    const keyPath = process.env.WEB_PUSH_KEY_PATH ?? 'data/web-push-key.json'
    if (!fs.existsSync(keyPath)) {
      const vapidKeys = webpush.generateVAPIDKeys()
      fs.writeFileSync(
        keyPath,
        JSON.stringify(
          {
            vapid: vapidKeys,
          },
          null,
          2
        )
      )
    }

    const keys: IWebPushKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
    this.vapidPublicKey = keys.vapid.publicKey
    this.vapidPrivateKey = keys.vapid.privateKey
  }

  public static getInstance(): WebPush {
    WebPush.instance ??= new WebPush()
    return WebPush.instance
  }

  public getBase64PublicKey(): string {
    return this.vapidPublicKey
  }

  public getVapidPrivateKey(): string {
    return this.vapidPrivateKey
  }

  public addSubscription(subscription: Subscription): void {
    const subscriptions = this.getSubscriptions()
    const index = subscriptions.findIndex(
      (s) =>
        s.destinationName === subscription.destinationName &&
        s.endpoint === subscription.endpoint
    )
    if (index !== -1) {
      subscriptions.splice(index, 1)
    }
    subscriptions.push(subscription)
    this.saveSubscriptions(subscriptions)
  }

  public removeSubscription(subscription: Subscription): boolean {
    const subscriptions = this.getSubscriptions()
    const index = subscriptions.findIndex(
      (s) =>
        s.destinationName === subscription.destinationName &&
        s.endpoint === subscription.endpoint
    )
    if (index === -1) {
      return false
    }
    subscriptions.splice(index, 1)
    this.saveSubscriptions(subscriptions)
    return true
  }

  /**
   * 指定した endpoint を持つ購読情報をすべて削除する
   *
   * 同一 endpoint が複数の destinationName で購読されている場合があるため、
   * 購読が失効した際は destinationName を問わず一括で除去する。
   * @param endpoint 削除対象の購読 endpoint
   */
  private removeSubscriptionsByEndpoint(endpoint: string): void {
    const subscriptions = this.getSubscriptions()
    const remaining = subscriptions.filter((s) => s.endpoint !== endpoint)
    if (remaining.length === subscriptions.length) {
      return
    }
    this.saveSubscriptions(remaining)
  }

  public getSubscriptions(): Subscription[] {
    const subscriptionsPath =
      process.env.WEB_PUSH_SUBSCRIPTIONS_PATH ?? 'data/subscriptions.json'
    return fs.existsSync(subscriptionsPath)
      ? (JSON.parse(
          fs.readFileSync(subscriptionsPath, 'utf8')
        ) as Subscription[])
      : []
  }

  private saveSubscriptions(subscriptions: Subscription[]): void {
    const subscriptionsPath =
      process.env.WEB_PUSH_SUBSCRIPTIONS_PATH ?? 'data/subscriptions.json'
    fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2))
  }

  /**
   * 1 件の購読へ送信し、結果を分類して返す
   *
   * - sent: 送信成功 (2xx)
   * - expired: 購読の失効 (404・410)。購読情報を削除する
   * - transient: 再送すれば成功し得る一時的な失敗 (5xx・429・408・通信エラー)
   * - permanent: 再送しても成功しない失敗 (その他の 4xx・入力検証エラー等)
   * @param subscription 送信先の購読情報
   * @param payload 送信するペイロード
   * @returns 分類結果と、判明している場合は HTTP ステータスコード
   */
  private async deliver(
    subscription: Subscription,
    payload: string
  ): Promise<DeliverResult> {
    const logger = Logger.configure('WebPush.deliver')
    try {
      const result = await webpush.sendNotification(subscription, payload, {
        vapidDetails: {
          subject: `mailto:${process.env.WEB_PUSH_EMAIL}`,
          publicKey: this.vapidPublicKey,
          privateKey: this.vapidPrivateKey,
        },
      })
      // web-push は 2xx 以外のレスポンスを WebPushError として reject する
      return { kind: 'sent', statusCode: result.statusCode }
    } catch (error: unknown) {
      if (error instanceof WebPushError) {
        // 404・410 は購読が失効していることを示す想定内のレスポンスのため、
        // エラー扱いにせず購読情報を削除して以後の送信対象から除外する
        if (error.statusCode === 404 || error.statusCode === 410) {
          logger.warn(
            `Subscription is no longer valid, removing: ${new URL(subscription.endpoint).origin} (${subscription.destinationName})`
          )
          this.removeSubscriptionsByEndpoint(subscription.endpoint)
          return { kind: 'expired', statusCode: error.statusCode }
        }
        logger.error('Error sending notification', error)
        return {
          kind: isTransientStatusCode(error.statusCode)
            ? 'transient'
            : 'permanent',
          statusCode: error.statusCode,
        }
      }
      logger.error('Error sending notification', error as Error)
      return { kind: isNetworkError(error) ? 'transient' : 'permanent' }
    }
  }

  /**
   * 1 件の購読へ送信する (購読 API 向け)
   *
   * 失敗しても例外は投げず、失効は 404・410、その他の失敗は 500 を返す。
   * @param subscription 送信先の購読情報
   * @param payload 送信するペイロード
   * @returns HTTP ステータスコード
   */
  public async sendNotification(
    subscription: Subscription,
    payload: string
  ): Promise<number> {
    const result = await this.deliver(subscription, payload)
    return result.kind === 'sent' || result.kind === 'expired'
      ? result.statusCode
      : 500
  }

  /**
   * 宛先に紐づく全購読へ通知を送信する
   *
   * 一時的に失敗した購読が 1 件でもあれば reject する。
   * @param destinationName 宛先名
   * @param title 通知タイトル
   * @param body 通知本文
   * @param delivered 送信済みの購読 endpoint。指定した場合、含まれる購読は送信対象から除外し、
   *   今回送信が完了した購読 (失敗しても再送しないものを含む) を追加する。
   *   再送時に成功済みの購読へ重複して送らないために、呼び出し元が通話ごとに保持して渡す
   */
  public async sendNotifications(
    destinationName: string,
    title: string,
    body: string,
    delivered = new Set<string>()
  ): Promise<void> {
    const logger = Logger.configure('WebPush.sendNotifications')
    const subscriptions = this.getSubscriptions()
    const destinationSubscriptions = subscriptions.filter(
      (s) => s.destinationName === destinationName
    )
    if (destinationSubscriptions.length === 0) {
      return
    }

    // 電話番号は半角カッコ内にある
    const regex = /\((\d+)\)/
    const callNumberMatch = regex.exec(title)
    const callNumber = callNumberMatch ? callNumberMatch[1] : undefined

    const payload = JSON.stringify({
      title,
      body,
      data: {
        url: `https://google.com/search?q=${callNumber}`,
      },
    })

    const targets = destinationSubscriptions.filter(
      (s) => !delivered.has(s.endpoint)
    )

    logger.info(`Sending notification to ${targets.length} subscriptions...`)
    const results = await Promise.all(
      targets.map((subscription) => this.deliver(subscription, payload))
    )
    const counts = { sent: 0, expired: 0, transient: 0, permanent: 0 }
    for (const [index, result] of results.entries()) {
      counts[result.kind]++
      if (result.kind !== 'transient') {
        delivered.add(targets[index].endpoint)
      }
    }
    logger.info(
      `Successfully sent notification to ${counts.sent} subscriptions!`
    )
    // 404・410 は失効購読として deliver 側で既に処理済みのため、失敗数には含めない
    if (counts.permanent > 0) {
      logger.warn(
        `Failed to send notification to ${counts.permanent} subscriptions (not retried).`
      )
    }

    // 一時的な失敗は呼び出し元へ伝え、通知済みとして扱われないようにする
    if (counts.transient > 0) {
      throw new Error(
        `Failed to send web push notification to ${counts.transient} subscriptions (${destinationName})`
      )
    }
  }
}
