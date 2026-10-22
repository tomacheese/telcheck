import { createHash } from 'node:crypto'
import { IDestination } from './config'

/**
 * 通話ごとの配信状態を保持するストア。`Checked` が実装する。
 */
export interface DeliveryStore {
  /** 指定した通話について、送信に成功済みの宛先キーの一覧を取得する */
  getDelivered(date: string, time: string): string[]
  /** 指定した通話について、宛先への送信に成功したことを記録する */
  markDelivered(date: string, time: string, key: string): void
  /** 通話を処理済みにし、配信状態を破棄する */
  complete(date: string, time: string): void
}

/**
 * 通知を送信できる宛先
 */
export interface Sendable {
  send(message: string): Promise<void>
}

interface DeliveryLogger {
  info(message: string): void
  error(message: string): void
}

export interface DeliverCallOptions {
  /** 初回起動かどうか。初回起動では送信せず、処理済みにするだけ */
  isFirst: boolean
  /** 通話の日付 */
  date: string
  /** 通話の時刻 */
  time: string
  /** 条件に一致した宛先の設定 */
  destinationConfigs: IDestination[]
  /** 宛先の設定から宛先を生成する関数 */
  createDestination: (config: IDestination) => Sendable
  /** 送信するメッセージ */
  message: string
  store: DeliveryStore
  logger: DeliveryLogger
}

/**
 * キーをソートした正規化済みの JSON 文字列を返す
 *
 * @param value 正規化する値
 * @returns 正規化済みの JSON 文字列
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * 宛先ごとの配信状態を識別するキーを生成する
 *
 * 宛先の設定全体のハッシュを用いる。Webhook URL やトークンなどの機密値を
 * ファイルに平文で保存しないため。完全に同一の設定が複数ある場合は、
 * 出現順の番号を付けて区別する。
 *
 * @param configs 宛先の設定一覧
 * @returns 設定一覧と同じ順序の宛先キー
 */
export function getDestinationKeys(configs: IDestination[]): string[] {
  const occurrences = new Map<string, number>()
  return configs.map((config) => {
    const hash = createHash('sha256').update(canonicalize(config)).digest('hex')
    const occurrence = occurrences.get(hash) ?? 0
    occurrences.set(hash, occurrence + 1)
    return `${hash}#${occurrence}`
  })
}

/**
 * ログに出力してよい形にエラーメッセージを整える
 *
 * `fetch()` の URL 解析エラーなどは、メッセージに元の URL 全体 (Webhook の秘密値を含む)
 * を含むため、そのままログに出力しない。宛先設定の文字列値 (Webhook URL・トークンなど) を
 * 伏せ字にした上で、残った URL 形式の文字列も伏せ字にする。
 *
 * @param error 捕捉したエラー
 * @param config エラーが発生した宛先の設定
 * @returns 機密値を除いたエラーメッセージ
 */
function getSafeErrorMessage(error: unknown, config: IDestination): string {
  let message = error instanceof Error ? error.message : String(error)

  const secrets = Object.entries(config)
    .filter(
      ([key, value]) =>
        !['name', 'type', 'condition'].includes(key) &&
        typeof value === 'string' &&
        value.length > 0
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
 * 1 件の通話を、まだ送信に成功していない宛先にだけ配信する
 *
 * 全宛先への送信に成功した場合のみ、通話を処理済みにする。
 * 一部の宛先が失敗した場合は、成功した宛先を記録した上で例外を投げる。
 * 再試行時には、記録済みの宛先を除いて配信する。
 *
 * @param options 配信のオプション
 * @throws 1 件でも送信または記録に失敗した宛先がある場合
 */
export async function deliverCall(options: DeliverCallOptions): Promise<void> {
  const {
    isFirst,
    date,
    time,
    destinationConfigs,
    createDestination,
    message,
    store,
    logger,
  } = options

  if (isFirst || destinationConfigs.length === 0) {
    store.complete(date, time)
    return
  }

  const delivered = new Set(store.getDelivered(date, time))
  const keys = getDestinationKeys(destinationConfigs)
  const targets = destinationConfigs
    .map((config, index) => ({ config, key: keys[index] }))
    .filter(({ config, key }) => {
      if (delivered.has(key)) {
        logger.info(
          `⏭️ Skip already delivered destination: ${config.name} (${config.type})`
        )
        return false
      }
      return true
    })

  const results = await Promise.allSettled(
    targets.map(async ({ config, key }) => {
      try {
        await createDestination(config).send(message)
      } catch (error) {
        logger.error(
          `❌ Failed to send to destination: ${config.name} (${config.type}): ${getSafeErrorMessage(error, config)}`
        )
        throw error
      }
      try {
        store.markDelivered(date, time, key)
      } catch (error) {
        logger.error(
          `❌ Failed to record delivery for destination: ${config.name} (${config.type}): ${getSafeErrorMessage(error, config)}`
        )
        throw error
      }
    })
  )

  const failedCount = results.filter((r) => r.status === 'rejected').length
  if (failedCount > 0) {
    throw new Error(
      `Failed to deliver to ${failedCount} of ${targets.length} destinations`
    )
  }

  store.complete(date, time)
}
