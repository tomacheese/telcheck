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
  private static instance: any

  public readonly vapidPublicKey: string
  private readonly vapidPrivateKey: string

  private constructor() {
    const keyPath = process.env.WEB_PUSH_KEY_PATH || 'data/web-push-key.json'
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
    if (!WebPush.instance) {
      WebPush.instance = new WebPush()
    }
    return WebPush.instance
  }

  public getBase64PublicKey(): string {
    return this.vapidPublicKey
  }

  public getVapidPrivateKey(): string {
    return this.vapidPrivateKey
  }

  public async addSubscription(subscription: Subscription): Promise<void> {
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

  public async removeSubscription(
    subscription: Subscription
  ): Promise<boolean> {
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
      process.env.WEB_PUSH_SUBSCRIPTIONS_PATH || 'data/subscriptions.json'
    if (!fs.existsSync(subscriptionsPath)) {
      return []
    }
    return JSON.parse(fs.readFileSync(subscriptionsPath, 'utf8'))
  }

  private saveSubscriptions(subscriptions: Subscription[]): void {
    const subscriptionsPath =
      process.env.WEB_PUSH_SUBSCRIPTIONS_PATH || 'data/subscriptions.json'
    fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2))
  }

  public async sendNotification(
    subscription: Subscription,
    payload: string
  ): Promise<number> {
    const response = await webpush.sendNotification(subscription, payload, {
      vapidDetails: {
        subject: 'mailto:' + process.env.WEB_PUSH_EMAIL,
        publicKey: this.vapidPublicKey,
        privateKey: this.vapidPrivateKey,
      },
    })
    return response.statusCode
  }

  public async sendNotifications(
    destinationName: string,
    title: string,
    body: string
  ): Promise<void> {
    const subscriptions = this.getSubscriptions()
    const destinationSubscriptions = subscriptions.filter(
      (s) => s.destinationName === destinationName
    )
    if (destinationSubscriptions.length === 0) {
      return
    }

    const payload = JSON.stringify({
      title,
      body,
    })

    const promises = destinationSubscriptions.map((subscription) => {
      return this.sendNotification(subscription, payload)
    })
    await Promise.all(promises)
  }
}
