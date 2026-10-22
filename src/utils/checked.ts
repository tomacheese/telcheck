import fs from 'node:fs'
import path from 'node:path'
import { PATH } from './config'

/**
 * 配信中の通話に関する配信状態
 */
interface IPending {
  /** 配信中の通話の日時 (ISO 8601) */
  datetime: string
  /** この通話について送信に成功した宛先キーの一覧 */
  delivered: string[]
}

interface IChecked {
  /** 最後に処理済みとした通話の日時 (ISO 8601) */
  datetime: string
  /** 配信中の通話の配信状態。旧形式のファイルには存在しない */
  pending?: IPending
}

export class Checked {
  public static isFirst(): boolean {
    const checkedPath = PATH.CHECKED_FILE
    return !fs.existsSync(checkedPath)
  }

  public static isChecked(date: string, time: string): boolean {
    const checked = Checked.load()
    if (!checked) {
      return false
    }
    const previousDateObject = new Date(checked.datetime)
    const dateObject = this.convertDate(date, time)
    return previousDateObject >= dateObject
  }

  /**
   * 指定した通話について、送信に成功済みの宛先キーの一覧を取得する
   *
   * @param date 通話の日付
   * @param time 通話の時刻
   * @returns 送信に成功済みの宛先キー。配信状態が無い、または別の通話のものであれば空
   */
  public static getDelivered(date: string, time: string): string[] {
    const checked = Checked.load()
    const datetime = this.convertDate(date, time).toISOString()
    return checked?.pending?.datetime === datetime
      ? [...checked.pending.delivered]
      : []
  }

  /**
   * 指定した通話について、宛先への送信に成功したことを記録する
   *
   * 処理済みの通話日時 (`datetime`) が存在しない場合は何もしない。
   *
   * @param date 通話の日付
   * @param time 通話の時刻
   * @param key 送信に成功した宛先キー
   */
  public static markDelivered(date: string, time: string, key: string): void {
    const checked = Checked.load()
    if (!checked) {
      return
    }
    const datetime = this.convertDate(date, time).toISOString()
    const pending: IPending =
      checked.pending?.datetime === datetime
        ? checked.pending
        : { datetime, delivered: [] }
    if (pending.delivered.includes(key)) {
      return
    }

    Checked.save({
      ...checked,
      pending: { datetime, delivered: [...pending.delivered, key] },
    })
  }

  /**
   * 通話を処理済みにし、配信状態を破棄する
   *
   * 既に同じ時刻以降が処理済みで `datetime` が更新されない場合でも、
   * 配信状態は必ず破棄する。同一秒内の後続の通話が、前の通話の配信状態を
   * 引き継いで通知されなくなることを防ぐため。
   *
   * @param date 通話の日付
   * @param time 通話の時刻
   */
  public static complete(date: string, time: string): void {
    const dateObject = this.convertDate(date, time)
    const previousChecked = Checked.load()
    if (previousChecked && new Date(previousChecked.datetime) >= dateObject) {
      if (previousChecked.pending) {
        Checked.save({ datetime: previousChecked.datetime })
      }
      return
    }

    Checked.save({
      datetime: dateObject.toISOString(),
    })
  }

  private static convertDate(date: string, time: string): Date {
    return new Date(`${date.replaceAll('/', '-')}T${time}+09:00`)
  }

  private static load(): IChecked | undefined {
    if (!fs.existsSync(PATH.CHECKED_FILE)) {
      return
    }
    const json = fs.readFileSync(PATH.CHECKED_FILE).toString()
    return JSON.parse(json) as IChecked
  }

  /**
   * 書き込み中のクラッシュによる破損を避けるため、同一ディレクトリの一時ファイルに
   * 書き込んでから rename で置き換える。
   * ファイル単体を bind mount している場合などで rename できないときは、
   * 従来どおり直接書き込む。
   */
  private static save(checked: IChecked): void {
    const json = JSON.stringify(checked)
    const temporaryPath = path.join(
      path.dirname(PATH.CHECKED_FILE),
      `.${path.basename(PATH.CHECKED_FILE)}.tmp`
    )
    try {
      fs.writeFileSync(temporaryPath, json)
      fs.renameSync(temporaryPath, PATH.CHECKED_FILE)
    } catch {
      try {
        fs.rmSync(temporaryPath, { force: true })
      } catch {
        // 一時ファイルの後始末に失敗しても、直接書き込みを続行する
      }
      fs.writeFileSync(PATH.CHECKED_FILE, json)
    }
  }
}
