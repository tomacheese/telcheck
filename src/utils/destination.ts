import {
  IDestination,
  isDestinationDiscordBot,
  isDestinationDiscordWebhook,
  isDestinationLINENotify,
  isDestinationSlack,
  isDestinationWebPush,
} from './config'
import { WebPush } from './web-push'

// HTTP Keep-Alive を有効化したフェッチラッパー
const fetchWithKeepAlive = async (url: string, options: RequestInit = {}) => {
  return await fetch(url, { ...options, keepalive: true })
}

class BaseDestination {
  public send(message: string): Promise<void> {
    throw new Error(
      `Not implemented: ${this.constructor.name}.send() ${message}`
    )
  }
}

class DiscordWebhookDestination extends BaseDestination {
  constructor(private readonly url: string) {
    super()
  }

  public async send(message: string): Promise<void> {
    const res = await fetchWithKeepAlive(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    })
    if (!res.ok && res.status !== 204) {
      throw new Error(`Discord webhook failed (${res.status})`)
    }
  }
}

class DiscordBotDestination extends BaseDestination {
  constructor(
    private readonly token: string,
    private readonly channelId: string
  ) {
    super()
  }

  public async send(message: string): Promise<void> {
    const res = await fetchWithKeepAlive(
      `https://discord.com/api/channels/${this.channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${this.token}`,
        },
        body: JSON.stringify({ content: message }),
      }
    )
    if (!res.ok && res.status !== 204) {
      throw new Error(`Discord bot message failed (${res.status})`)
    }
  }
}

class SlackDestination extends BaseDestination {
  constructor(private readonly url: string) {
    super()
  }

  public async send(message: string): Promise<void> {
    const res = await fetchWithKeepAlive(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
    if (!res.ok) {
      throw new Error(`Slack webhook failed (${res.status})`)
    }
  }
}

class LINENotifyDestination extends BaseDestination {
  constructor(private readonly token: string) {
    super()
  }

  public async send(message: string): Promise<void> {
    const parameters = new URLSearchParams()
    parameters.append('message', message)
    const res = await fetchWithKeepAlive(
      'https://notify-api.line.me/api/notify',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        body: parameters,
      }
    )
    if (!res.ok) {
      throw new Error(`LINE Notify failed (${res.status})`)
    }
  }
}

class WebPushDestination extends BaseDestination {
  constructor(private readonly destinationName: string) {
    super()
  }

  public async send(message: string): Promise<void> {
    if (!message.includes('\n')) {
      return
    }

    const rawTitle = message.split('\n')[0]
    const rawBody = message.split('\n').slice(1).join('\n')
    const title = rawTitle
      .replaceAll('☎ ', '')
      .replaceAll('**', '')
      .replaceAll('`', '')
      .trim()
    const body = rawBody.replaceAll('**', '').replaceAll('`', '').trim()

    const webPush = WebPush.getInstance()
    await webPush.sendNotifications(this.destinationName, title, body)
  }
}

export function getDestination(destination: IDestination): BaseDestination {
  if (isDestinationDiscordWebhook(destination)) {
    return new DiscordWebhookDestination(destination.webhook_url)
  }
  if (isDestinationDiscordBot(destination)) {
    return new DiscordBotDestination(destination.token, destination.channel_id)
  }
  if (isDestinationSlack(destination)) {
    return new SlackDestination(destination.webhook_url)
  }
  if (isDestinationLINENotify(destination)) {
    return new LINENotifyDestination(destination.token)
  }
  if (isDestinationWebPush(destination)) {
    return new WebPushDestination(destination.name)
  }
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  throw new Error(`Unknown destination: ${destination}`)
}
