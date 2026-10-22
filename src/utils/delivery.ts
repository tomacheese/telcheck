import { Logger } from '@book000/node-utils'

/** 通知の送信先 */
export interface DeliverableDestination {
  /**
   * メッセージを送信する
   * @param message 送信するメッセージ
   * @param progress 宛先内で送信済みの項目 (Web Push の購読 endpoint など) を記録する Set。
   *   同じ通話・同じ宛先への再送時に同じ Set が渡される。宛先内の一部だけが失敗した場合に、
   *   送信済みの項目へ重複して送らないために使う。不要な宛先は無視してよい
   */
  send(message: string, progress: Set<string>): Promise<void>
}

/** 1 つの通話に対する配送状態 */
interface DeliveryState {
  /** 宛先に送信したメッセージ。再送時も同じ内容を使う */
  message: string
  /** 送信に成功した宛先の index (その通話に対する宛先配列の index) */
  delivered: Set<number>
  /** 宛先 index ごとの、宛先内の送信済み項目。通話の状態と同じ寿命で破棄される */
  progress: Map<number, Set<string>>
}

/**
 * 通話ごと・宛先ごとの配送状態を保持し、未配送の宛先にだけ送信する
 *
 * いずれかの宛先への送信に失敗した場合は例外を投げる。呼び出し元はその通話を
 * 確認済みにせず、次回の呼び出しで再試行することで、一時的な失敗による通知の
 * 欠落を防ぐ。状態はプロセス内メモリのみで保持する。
 */
export class DeliveryTracker {
  private readonly states = new Map<string, DeliveryState>()

  /**
   * 今回の処理対象に含まれない通話の配送状態を破棄する
   * @param activeKeys 今回の処理対象の通話キー
   */
  public prune(activeKeys: ReadonlySet<string>): void {
    for (const key of this.states.keys()) {
      if (!activeKeys.has(key)) {
        this.states.delete(key)
      }
    }
  }

  /**
   * 未配送の宛先へ送信する
   * @param key 通話キー
   * @param destinations 宛先 (同じ通話に対して常に同じ並びで渡すこと)
   * @param createMessage メッセージを生成する関数。配送状態が無い場合にのみ呼ばれる
   * @throws 送信に失敗した宛先が 1 つ以上ある場合
   */
  public async deliver(
    key: string,
    destinations: readonly DeliverableDestination[],
    createMessage: () => Promise<string>
  ): Promise<void> {
    const logger = Logger.configure('DeliveryTracker.deliver')
    let state = this.states.get(key)
    if (!state) {
      state = {
        message: await createMessage(),
        delivered: new Set(),
        progress: new Map(),
      }
      this.states.set(key, state)
    }
    const current = state

    const pending = destinations
      .map((destination, index) => ({ destination, index }))
      .filter(({ index }) => !current.delivered.has(index))
    const results = await Promise.allSettled(
      pending.map(({ destination, index }) => {
        let progress = current.progress.get(index)
        if (!progress) {
          progress = new Set()
          current.progress.set(index, progress)
        }
        return destination.send(current.message, progress)
      })
    )

    const failures: string[] = []
    for (const [position, result] of results.entries()) {
      const { index } = pending[position]
      if (result.status === 'fulfilled') {
        current.delivered.add(index)
        continue
      }
      logger.error(
        `Failed to send to destination #${index}, will retry`,
        result.reason as Error
      )
      failures.push(`#${index}`)
    }

    if (failures.length > 0) {
      throw new Error(
        `Failed to deliver to ${failures.length} destinations (${failures.join(', ')})`
      )
    }
    this.states.delete(key)
  }
}
