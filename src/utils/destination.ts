import axios from 'axios'
import {
  IDestination,
  isDestinationDiscordBot,
  isDestinationDiscordWebhook,
  isDestinationLINENotify,
  isDestinationSlack,
  isDestinationWebPush,
} from './config'
import { WebPush } from './web-push'

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
    const response = await axios.post(this.url, { content: message })
    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`Discord webhook failed (${response.status})`)
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
    const response = await axios.post(
      `https://discord.com/api/channels/${this.channelId}/messages`,
      { content: message },
      {
        headers: {
          Authorization: `Bot ${this.token}`,
        },
        validateStatus: () => true,
      }
    )
    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`Discord webhook failed (${response.status})`)
    }
  }
}

class SlackDestination extends BaseDestination {
  constructor(private readonly url: string) {
    super()
  }

  public async send(message: string): Promise<void> {
    const response = await axios.post(
      this.url,
      { text: message },
      {
        validateStatus: () => true,
      }
    )
    if (response.status !== 200) {
      throw new Error(`Slack webhook failed (${response.status})`)
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
    const response = await axios.post(
      'https://notify-api.line.me/api/notify',
      parameters,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      }
    )
    if (response.status !== 200) {
      throw new Error(`LINE Notify failed (${response.status})`)
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
