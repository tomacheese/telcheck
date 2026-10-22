import { Logger } from '@book000/node-utils'
import {
  DeliveryStore,
  PersistedDeliveries,
  PersistedDelivery,
  hash,
} from './delivery-store'

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
  /** 宛先に送信したメッセージ。再送時も同じ内容を使う。未配送の宛先が無い場合は生成しない */
  message: string | undefined
  /** 送信に成功した宛先の index (その通話に対する宛先配列の index) */
  delivered: Set<number>
  /** 宛先 index ごとの、宛先内の送信済み項目。通話の状態と同じ寿命で破棄される */
  progress: Map<number, Set<string>>
  /** 宛先 index ごとの宛先キー。永続化しない場合は undefined */
  destinationKeys: readonly string[] | undefined
}

/**
 * 通話ごと・宛先ごとの配送状態を保持し、未配送の宛先にだけ送信する
 *
 * いずれかの宛先への送信に失敗した場合は例外を投げる。呼び出し元はその通話を
 * 確認済みにせず、次回の呼び出しで再試行することで、一時的な失敗による通知の
 * 欠落を防ぐ。
 *
 * ストアを渡した場合は、配送状態 (送信に成功した宛先と宛先内の送信済み項目) を
 * 永続化し、プロセスの再起動後も送信に成功済みの宛先へ重複して送らない。
 * ストアを渡さない場合は、プロセス内メモリのみで保持する。
 * 永続化に失敗しても送信自体は失敗させず、ログに出力して続行する。
 */
export class DeliveryTracker {
  private readonly states = new Map<string, DeliveryState>()
  /** ストアから読み込んだ、まだこのプロセスで処理していない通話の配送状態 */
  private restored: PersistedDeliveries | undefined

  /**
   * @param store 配送状態の保存先。省略した場合は永続化しない
   */
  constructor(private readonly store?: DeliveryStore) {}

  /**
   * 今回の処理対象に含まれない通話の配送状態を破棄する
   * @param activeKeys 今回の処理対象の通話キー
   */
  public prune(activeKeys: ReadonlySet<string>): void {
    let changed = false
    for (const key of this.states.keys()) {
      if (activeKeys.has(key)) {
        continue
      }

      this.states.delete(key)
      changed = true
    }

    const restored = this.getRestored()
    const activeHashes = new Set([...activeKeys].map((key) => hash(key)))
    for (const hashedKey of Object.keys(restored)) {
      if (activeHashes.has(hashedKey)) {
        continue
      }

      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete restored[hashedKey]
      changed = true
    }

    if (changed) {
      this.persist()
    }
  }

  /**
   * 未配送の宛先へ送信する
   * @param key 通話キー
   * @param destinations 宛先 (同じ通話に対して常に同じ並びで渡すこと)
   * @param createMessage メッセージを生成する関数。配送状態が無い場合にのみ呼ばれる
   * @param destinationKeys 宛先ごとの宛先キー (`destinations` と同じ並び)。
   *   ストアを使う場合に、配送状態を宛先に対応付けて永続化するために指定する
   * @throws 送信に失敗した宛先が 1 つ以上ある場合
   */
  public async deliver(
    key: string,
    destinations: readonly DeliverableDestination[],
    createMessage: () => Promise<string>,
    destinationKeys?: readonly string[]
  ): Promise<void> {
    const logger = Logger.configure('DeliveryTracker.deliver')
    let state = this.states.get(key)
    if (!state) {
      state = {
        message: undefined,
        delivered: new Set(),
        progress: new Map(),
        destinationKeys,
      }
      // 保存済みの状態を先に反映し、未配送の宛先が残っている場合にだけメッセージを生成する
      this.restore(key, state)
    }
    const current = state

    const pending = destinations
      .map((destination, index) => ({ destination, index }))
      .filter(({ index }) => !current.delivered.has(index))
    // メッセージの生成に失敗しても、復元した配送状態を失わないよう、先に登録する
    this.states.set(key, current)
    const message =
      pending.length > 0 ? (current.message ??= await createMessage()) : ''

    const results = await Promise.allSettled(
      pending.map(async ({ destination, index }) => {
        let progress = current.progress.get(index)
        if (!progress) {
          progress = new Set()
          current.progress.set(index, progress)
        }
        await destination.send(message, progress)
        // 他の宛先を待っている間に再起動されても記録が失われないよう、成功した時点で永続化する
        current.delivered.add(index)
        this.persist()
      })
    )

    const failures: string[] = []
    for (const [position, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        continue
      }
      const { index } = pending[position]
      logger.error(
        `Failed to send to destination #${index}, will retry`,
        result.reason as Error
      )
      failures.push(`#${index}`)
    }

    if (failures.length > 0) {
      // 失敗した宛先の、宛先内の送信済み項目 (Web Push の購読など) も永続化する
      this.persist()
      throw new Error(
        `Failed to deliver to ${failures.length} destinations (${failures.join(', ')})`
      )
    }
    this.states.delete(key)
    this.keepCompleted(key, current)
    this.persist()
  }

  /**
   * ストアから読み込んだ配送状態を返す。初回のみストアから読み込む
   * @returns まだこのプロセスで処理していない通話の配送状態
   */
  private getRestored(): PersistedDeliveries {
    this.restored ??= this.store ? this.store.load() : {}
    return this.restored
  }

  /**
   * ストアに保存済みの配送状態があれば、通話の状態に反映する
   * @param key 通話キー
   * @param state 反映先の通話の状態
   */
  private restore(key: string, state: DeliveryState): void {
    const { destinationKeys } = state
    if (!destinationKeys) {
      return
    }
    const restored = this.getRestored()
    const hashedKey = hash(key)
    const entry = restored[hashedKey] as PersistedDeliveries[string] | undefined
    if (!entry) {
      return
    }
    // 状態はこの通話の状態として管理するため、読み込み済みの一覧からは取り除く
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete restored[hashedKey]

    for (const [index, destinationKey] of destinationKeys.entries()) {
      if (entry.delivered.includes(destinationKey)) {
        state.delivered.add(index)
      }
      const items = entry.progress[destinationKey] as string[] | undefined
      if (items && items.length > 0) {
        state.progress.set(index, new Set(items))
      }
    }
  }

  /**
   * 全宛先への送信が完了した通話の配送状態を、永続化用に保持する
   *
   * 通話が確認済みになる前に失敗・再起動しても、送信済みの宛先へ再送しないよう、
   * 通話が処理対象から外れて `prune` されるまで残す。ストアを使わない場合は何もしない。
   * @param key 通話キー
   * @param state 完了した通話の状態
   */
  private keepCompleted(key: string, state: DeliveryState): void {
    const { destinationKeys } = state
    if (!destinationKeys || !this.store) {
      return
    }
    this.getRestored()[hash(key)] = this.serialize(state, destinationKeys)
  }

  /**
   * 通話の配送状態を保存用の形式に変換する
   * @param state 通話の状態
   * @param destinationKeys 宛先ごとの宛先キー
   * @returns 保存用の配送状態
   */
  private serialize(
    state: DeliveryState,
    destinationKeys: readonly string[]
  ): PersistedDelivery {
    const progress: Record<string, string[]> = {}
    for (const [index, items] of state.progress) {
      if (items.size > 0 && index < destinationKeys.length) {
        progress[destinationKeys[index]] = [...items]
      }
    }
    return {
      delivered: [...state.delivered]
        .filter((index) => index < destinationKeys.length)
        .map((index) => destinationKeys[index]),
      progress,
    }
  }

  /**
   * 現在の配送状態をストアに保存する。失敗してもログに出力するだけで例外は投げない
   */
  private persist(): void {
    if (!this.store) {
      return
    }
    const deliveries: PersistedDeliveries = { ...this.getRestored() }
    for (const [key, state] of this.states) {
      const { destinationKeys } = state
      if (!destinationKeys) {
        continue
      }
      deliveries[hash(key)] = this.serialize(state, destinationKeys)
    }

    try {
      this.store.save(deliveries)
    } catch (error) {
      const logger = Logger.configure('DeliveryTracker.persist')
      logger.error(
        'Failed to persist delivery state, duplicates may occur after restart',
        error as Error
      )
    }
  }
}
