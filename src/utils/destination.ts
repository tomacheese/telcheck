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

  public async send(
    message: string,
    progress: Set<string> = new Set<string>()
  ): Promise<void> {
    if (!message.includes('\n')) {
      return
    }

    const rawTitle = message.split('\n', 1)[0]
    const rawBody = message.slice(rawTitle.length + 1)
    const title = rawTitle
      .replaceAll('☎ ', '')
      .replaceAll('**', '')
      .replaceAll('`', '')
      .trim()
    const body = rawBody.replaceAll('**', '').replaceAll('`', '').trim()

    const webPush = WebPush.getInstance()
    await webPush.sendNotifications(this.destinationName, title, body, progress)
  }
}

/** 空文字などの極端に短い値で置換するとメッセージ全体が壊れるため、これ未満の値は伏せない */
const MIN_SECRET_LENGTH = 8

/**
 * ログに出力してよい形にエラーメッセージを整える
 *
 * `fetch()` の URL 解析エラーは、メッセージに元の URL 全体を含む。
 * Webhook URL には秘密値が入っているため、そのままログに出力しない。
 * 宛先設定の文字列値 (Webhook URL・トークンなど) を伏せ字にした上で、
 * 残った URL 形式の文字列も伏せ字にする。
 *
 * @param error 捕捉したエラー
 * @param config エラーが発生した宛先の設定
 * @returns 機密値を除いたエラーメッセージ
 */
export function sanitizeErrorMessage(
  error: unknown,
  config: IDestination
): string {
  let message = error instanceof Error ? error.message : String(error)

  const secrets = Object.entries(config)
    .filter(
      ([key, value]) =>
        !['name', 'type', 'condition'].includes(key) &&
        typeof value === 'string' &&
        value.length >= MIN_SECRET_LENGTH
    )
    .map(([, value]) => value as string)
    // 長い値から置換し、他の値を含む値が部分的に残らないようにする
    .toSorted((a, b) => b.length - a.length)
  for (const secret of secrets) {
    message = message.replaceAll(secret, '[REDACTED]')
  }

  return message.replaceAll(/https?:\/\/\S+/gi, '[REDACTED_URL]')
}

/**
 * 送信に失敗したときに、機密値を除いたメッセージのエラーに置き換える宛先
 *
 * 呼び出し元が `Error` をそのままログに出力しても、Webhook URL やトークンが
 * 漏れないようにする。元のエラーは `cause` に引き継がない。
 */
class SafeErrorDestination extends BaseDestination {
  constructor(
    private readonly inner: {
      send(message: string, progress?: Set<string>): Promise<void>
    },
    private readonly config: IDestination
  ) {
    super()
  }

  /**
   * メッセージを送信する。失敗した場合は、機密値を除いたメッセージのエラーを投げる
   *
   * @param message 送信するメッセージ
   * @param progress 宛先内で送信済みの項目を記録する Set
   */
  public async send(
    message: string,
    progress: Set<string> = new Set<string>()
  ): Promise<void> {
    try {
      await this.inner.send(message, progress)
    } catch (error) {
      throw new Error(sanitizeErrorMessage(error, this.config))
    }
  }
}

/**
 * 宛先の設定から、エラーのサニタイズ前の宛先を生成する
 *
 * @param destination 宛先の設定
 * @returns 宛先
 */
function createDestination(destination: IDestination): BaseDestination {
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

/**
 * 宛先の設定から宛先を生成する
 *
 * 送信に失敗した場合、機密値を除いたメッセージのエラーを投げる。
 *
 * @param destination 宛先の設定
 * @returns 宛先
 */
export function getDestination(destination: IDestination): BaseDestination {
  return new SafeErrorDestination(createDestination(destination), destination)
}
