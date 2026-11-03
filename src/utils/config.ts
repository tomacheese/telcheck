/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import fs from 'node:fs'
import { SyslogCall } from './nvr510'

export const PATH = {
  CONFIG_FILE: process.env.CONFIG_PATH ?? 'data/config.json',
  CHECKED_FILE: process.env.CHECKED_PATH ?? 'data/checked.json',
  DELIVERY_FILE: process.env.DELIVERY_PATH ?? 'data/delivery.json',
  PHONES_FILE: process.env.PHONES_PATH ?? 'data/phones.tsv',
}

interface DestinationDiscordWebhook {
  type: 'discord-webhook'
  /** Discord Webhook URL */
  webhook_url: string
}

interface DestinationDiscordBot {
  type: 'discord-bot'
  /** Discord Bot のトークン */
  token: string
  /** 通知先の Discord チャンネル ID */
  channel_id: string
}

interface DestinationSlack {
  type: 'slack'
  /** Slack Incoming Webhook URL */
  webhook_url: string
}

interface DestinationLINENotify {
  type: 'line-notify'
  /** LINE Notify のトークン */
  token: string
}

interface DestinationWebPush {
  type: 'web-push'
}

export interface CallDetail {
  direction: SyslogCall['direction']
  selfNumber: string
  callerNumber: string
  status: SyslogCall['status']
}

type Conditions = {
  [key in keyof CallDetail]: string | undefined
}

export type IDestination = (
  | DestinationDiscordWebhook
  | DestinationDiscordBot
  | DestinationSlack
  | DestinationLINENotify
  | DestinationWebPush
) & {
  /** 宛先名 */
  name: string
  /** この宛先へ通知する条件 (正規表現) */
  condition: Conditions
}

interface Self {
  /** 自分の電話番号の名前 */
  name: string
  /** この名前に該当する条件 (正規表現) */
  condition: Conditions
}

export interface Configuration {
  destinations: IDestination[]
  selfs: Self[]
  router: {
    /** ルーターの IP アドレス */
    ip: string
    /** ルーターのユーザー名 */
    username: string
    /** ルーターのパスワード */
    password: string
  }
  google_search?: {
    /** Google Custom Search の API キー */
    key: string
    /** Google Custom Search の検索エンジン ID (CX) */
    cx: string
  }
  web?: {
    /** Web サーバーの認証設定 */
    auth: {
      /** Web サーバーの認証ユーザー名 */
      username: string
      /** Web サーバーの認証パスワード */
      password: string
    }
  }
}

export const isDestinationDiscordWebhook = (
  destination: any
): destination is DestinationDiscordWebhook => {
  return destination.type === 'discord-webhook' && !!destination.webhook_url
}

export const isDestinationDiscordBot = (
  destination: any
): destination is DestinationDiscordBot => {
  return (
    destination.type === 'discord-bot' &&
    !!destination.token &&
    !!destination.channel_id
  )
}

export const isDestinationSlack = (
  destination: any
): destination is DestinationSlack => {
  return destination.type === 'slack' && !!destination.webhook_url
}

export const isDestinationLINENotify = (
  destination: any
): destination is DestinationLINENotify => {
  return destination.type === 'line-notify' && !!destination.token
}

export const isDestinationWebPush = (
  destination: any
): destination is DestinationWebPush => {
  return destination.type === 'web-push'
}

function checkConfig(config: any): Record<string, boolean> {
  const results = {
    'config is object': typeof config === 'object',
    'destinations is exists': !!config.destinations,
    'destinations is array':
      !!config.destinations && Array.isArray(config.destinations),
    'destinations is not empty':
      !!config.destinations && config.destinations.length > 0,
    'destinations is valid':
      !!config.destinations &&
      config.destinations.every((destination: any) => {
        return (
          isDestinationDiscordWebhook(destination) ||
          isDestinationDiscordBot(destination) ||
          isDestinationSlack(destination) ||
          isDestinationLINENotify(destination) ||
          isDestinationWebPush(destination)
        )
      }),
    'selfs is exists': !!config.selfs,
    'selfs is array': !!config.selfs && Array.isArray(config.selfs),
    'selfs is not empty': !!config.selfs && config.selfs.length > 0,
    'selfs is valid':
      !!config.selfs &&
      config.selfs.every((self: any) => {
        return (
          typeof self.name === 'string' && typeof self.condition === 'object'
        )
      }),
    'router is exists': !!config.router,
    'router is object': !!config.router && typeof config.router === 'object',
    'router.ip is exists': !!config.router?.ip,
    'router.ip is string':
      !!config.router?.ip && typeof config.router.ip === 'string',
    'router.username is not undefined': config.router?.username !== undefined,
    'router.password is not undefined': config.router?.password !== undefined,
  }
  return results
}

const isConfig = (config: any): config is Configuration => {
  return Object.values(checkConfig(config)).every(Boolean)
}

export function loadConfig(): Configuration {
  if (!fs.existsSync(PATH.CONFIG_FILE)) {
    throw new Error('Config file not found')
  }
  const config = JSON.parse(fs.readFileSync(PATH.CONFIG_FILE, 'utf8'))
  if (!isConfig(config)) {
    const checks = checkConfig(config)
    throw new Error(`Invalid config: ${JSON.stringify(checks, null, 2)}`)
  }
  return config
}
