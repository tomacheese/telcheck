import { Logger } from '@book000/node-utils'
import { IDestination } from './config'
import { DeliveryState } from './delivery-state'
import { getDestination } from './destination'

/** 宛先の送信インターフェース */
interface ISender {
  send(message: string): Promise<void>
}

/**
 * 宛先ごとに通知を送信する。
 *
 * すでに送信に成功した宛先は送信せず、未送信の宛先のみに送る。
 * 成功した宛先はその都度永続化するため、一部の宛先が失敗しても
 * 次回の再試行で成功済みの宛先に重複通知しない。
 * 1 つでも失敗した場合は、すべての結果を記録したうえでエラーを投げる。
 *
 * @param eventKey イベントキー
 * @param destinationConfigs 宛先設定
 * @param message 送信するメッセージ
 * @param createSender 宛先設定から送信オブジェクトを生成する関数 (テスト用に差し替え可能)
 */
export async function deliver(
  eventKey: string,
  destinationConfigs: IDestination[],
  message: string,
  createSender: (destination: IDestination) => ISender = getDestination
): Promise<void> {
  const logger = Logger.configure('deliver')
  const delivered = new Set(DeliveryState.getDelivered(eventKey))
  const pending = destinationConfigs
    .map((config) => ({ config, id: DeliveryState.getDestinationId(config) }))
    .filter(({ id }) => !delivered.has(id))

  const results = await Promise.allSettled(
    pending.map(async ({ config, id }) => {
      await createSender(config).send(message)
      DeliveryState.markDelivered(eventKey, id)
    })
  )

  const failures: { name: string; reason: unknown }[] = []
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      failures.push({
        name: pending[index].config.name,
        reason: result.reason as unknown,
      })
    }
  }
  for (const failure of failures) {
    logger.error(
      `❌ Failed to send to ${failure.name}`,
      failure.reason as Error
    )
  }
  if (failures.length > 0) {
    throw new Error(
      `Failed to send to ${failures.length}/${pending.length} destinations: ${failures.map((f) => f.name).join(', ')}`
    )
  }
}
