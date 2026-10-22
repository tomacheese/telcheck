import crypto from 'node:crypto'
import fs from 'node:fs'
import { IDestination, PATH } from './config'

interface IDeliveryState {
  /** 配信中のイベントを一意に識別するキー */
  eventKey: string
  /** 送信に成功した宛先 ID の一覧 */
  delivered: string[]
}

/**
 * イベントごとの宛先別配信状態を永続化するクラス。
 *
 * 複数宛先のうち一部だけが失敗した場合に、送信済みの宛先へ再送しないために使う。
 * 通話は古い順に 1 件ずつ処理されるため、保持する状態は処理中の 1 イベント分のみ。
 */
export class DeliveryState {
  /**
   * イベントを一意に識別するキーを生成する。
   *
   * @param date 通話日付
   * @param time 通話時刻
   * @param parts 日時以外でイベントを区別する値
   * @returns イベントキー
   */
  public static getEventKey(
    date: string,
    time: string,
    ...parts: string[]
  ): string {
    return [date, time, ...parts].join('|')
  }

  /**
   * 宛先を一意に識別する ID を生成する。
   * 認証情報を平文で保存しないよう、設定内容のハッシュを用いる。
   * 条件 (condition) は ID に含めない。
   *
   * @param destination 宛先設定
   * @returns 宛先 ID
   */
  public static getDestinationId(destination: IDestination): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { condition, ...rest } = destination
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(rest))
      .digest('hex')
  }

  /**
   * 指定イベントで送信済みの宛先 ID の一覧を取得する。
   *
   * @param eventKey イベントキー
   * @returns 送信済みの宛先 ID。別イベントの状態しかなければ空配列
   */
  public static getDelivered(eventKey: string): string[] {
    const state = DeliveryState.load()
    return state?.eventKey === eventKey ? state.delivered : []
  }

  /**
   * 宛先への送信成功を記録する。
   *
   * @param eventKey イベントキー
   * @param destinationId 送信に成功した宛先 ID
   */
  public static markDelivered(eventKey: string, destinationId: string): void {
    const delivered = DeliveryState.getDelivered(eventKey)
    if (delivered.includes(destinationId)) {
      return
    }
    DeliveryState.save({
      eventKey,
      delivered: [...delivered, destinationId],
    })
  }

  /**
   * 配信状態を破棄する。イベントの配信が完了したときに呼ぶ。
   */
  public static clear(): void {
    if (fs.existsSync(PATH.DELIVERED_FILE)) {
      fs.rmSync(PATH.DELIVERED_FILE)
    }
  }

  private static load(): IDeliveryState | undefined {
    if (!fs.existsSync(PATH.DELIVERED_FILE)) {
      return
    }
    try {
      const json = fs.readFileSync(PATH.DELIVERED_FILE).toString()
      return JSON.parse(json) as IDeliveryState
    } catch {
      // 破損している場合は状態なしとして扱う (重複通知よりも通知欠落を避ける)
      return
    }
  }

  private static save(state: IDeliveryState): void {
    fs.writeFileSync(PATH.DELIVERED_FILE, JSON.stringify(state))
  }
}
