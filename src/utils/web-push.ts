import { Logger } from '@book000/node-utils'
import fs from 'node:fs'
import webpush from 'web-push'

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
      (s) => s.endpoint === subscription.endpoint
    )
    if (index === -1) {
      return false
    }
    subscriptions.splice(index, 1)
    this.saveSubscriptions(subscriptions)
    return true
  }

  public getSubscriptions(): Subscription[] {
    const subscriptionsPath =
      process.env.WEB_PUSH_SUBSCRIPTIONS_PATH ?? 'data/subscriptions.json'
    if (!fs.existsSync(subscriptionsPath)) {
      return []
    }
    return JSON.parse(
      fs.readFileSync(subscriptionsPath, 'utf8')
    ) as Subscription[]
  }

  private saveSubscriptions(subscriptions: Subscription[]): void {
    const subscriptionsPath =
      process.env.WEB_PUSH_SUBSCRIPTIONS_PATH ?? 'data/subscriptions.json'
    fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2))
  }

  public async sendNotification(
    subscription: Subscription,
    payload: string
  ): Promise<number> {
    const logger = Logger.configure('WebPush.sendNotification')
    const response = await webpush
      .sendNotification(subscription, payload, {
        vapidDetails: {
          subject: `mailto:${process.env.WEB_PUSH_EMAIL}`,
          publicKey: this.vapidPublicKey,
          privateKey: this.vapidPrivateKey,
        },
      })
      .catch((error: unknown) => {
        logger.error('Error sending notification', error as Error)
      })

    if (!response) {
      return 500
    }

    return response.statusCode
  }

  public async sendNotifications(
    destinationName: string,
    title: string,
    body: string
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

    logger.info(
      `Sending notification to ${destinationSubscriptions.length} subscriptions...`
    )
    const promises = destinationSubscriptions.map((subscription) => {
      return this.sendNotification(subscription, payload)
    })

    const results = await Promise.all(promises)
    logger.info(
      `Successfully sent notification to ${
        results.filter((r) => r === 201).length
      } subscriptions!`
    )
    if (results.some((r) => r !== 201)) {
      logger.warn(
        `Failed to send notification to ${
          results.filter((r) => r !== 201).length
        } subscriptions.`
      )
    }
  }
}
