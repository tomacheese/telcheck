import { Logger } from '@book000/node-utils'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { IDestination } from './config'

/** 永続化する 1 つの通話の配送状態 */
export interface PersistedDelivery {
  /** 送信に成功した宛先キー */
  delivered: string[]
  /** 宛先キーごとの、宛先内の送信済み項目 (Web Push の購読 endpoint など) */
  progress: Record<string, string[]>
}

/** 保存するファイルの権限。Web Push の購読 endpoint を含むため、所有者のみ読み書きできるようにする */
const FILE_MODE = 0o600

/** 通話キーのハッシュをキーにした、永続化する配送状態 */
export type PersistedDeliveries = Record<string, PersistedDelivery>

/** 配送状態の保存先 */
export interface DeliveryStore {
  /** 保存済みの配送状態を読み込む。存在しない・読めない場合は空を返す */
  load(): PersistedDeliveries
  /** 配送状態を保存する */
  save(deliveries: PersistedDeliveries): void
}

/**
 * 文字列のハッシュ (SHA-256, 16 進数) を返す
 *
 * 電話番号などをファイルに平文で残さないために使う。入力の空間が小さい値 (電話番号など) は
 * 総当たりで推測され得るため、秘匿を保証するものではない。保存先のファイルは、
 * 電話番号一覧など他の機密と同様に `data/` 配下で管理し、公開しないこと。
 *
 * @param value ハッシュ化する文字列
 * @returns ハッシュ値
 */
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
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
 * 宛先ごとの配送状態を識別するキーを生成する
 *
 * 宛先の設定 (通知条件 `condition` を除く) のハッシュを用いる。Webhook URL や
 * トークンなどの機密値をファイルに平文で保存しないため。通知条件は宛先の同一性に
 * 関係しないため含めず、条件を編集しても同じ宛先として扱う。
 * 同一の設定が複数ある場合は、出現順の番号を付けて区別する。
 *
 * @param configs 宛先の設定一覧
 * @returns 設定一覧と同じ順序の宛先キー
 */
export function getDestinationKeys(configs: readonly IDestination[]): string[] {
  const occurrences = new Map<string, number>()
  return configs.map((config) => {
    const identity = Object.fromEntries(
      Object.entries(config).filter(([key]) => key !== 'condition')
    )
    const digest = hash(canonicalize(identity))
    const occurrence = occurrences.get(digest) ?? 0
    occurrences.set(digest, occurrence + 1)
    return `${digest}#${occurrence}`
  })
}

/**
 * 値が文字列の配列かどうかを判定する
 *
 * @param value 判定する値
 * @returns 文字列の配列であれば true
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * ログに出力するエラーの種類を返す
 *
 * JSON の解析エラーのメッセージにはファイル内容の断片が含まれ得るため、
 * メッセージは含めず、名前と fs エラーの `code` (EACCES など) だけを返す。
 *
 * @param error 捕捉したエラー
 * @returns エラーの名前と code
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error'
  }
  const { code } = error as NodeJS.ErrnoException
  return code ? `${error.name} (${code})` : error.name
}

/**
 * 読み込んだ値から、形式が正しい通話の配送状態だけを取り出す
 *
 * @param value JSON から読み込んだ値
 * @returns 形式が正しい配送状態
 */
function parseDeliveries(value: unknown): PersistedDeliveries {
  const result: PersistedDeliveries = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return result
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== 'object') {
      continue
    }
    const { delivered, progress } = entry as {
      delivered?: unknown
      progress?: unknown
    }
    if (!isStringArray(delivered)) {
      continue
    }
    const parsedProgress: Record<string, string[]> = {}
    if (progress !== null && typeof progress === 'object') {
      for (const [destinationKey, items] of Object.entries(progress)) {
        if (isStringArray(items)) {
          parsedProgress[destinationKey] = items
        }
      }
    }
    result[key] = { delivered, progress: parsedProgress }
  }
  return result
}

/**
 * 配送状態を JSON ファイルに保存するストア
 */
export class FileDeliveryStore implements DeliveryStore {
  /** 直接書き込みへのフォールバックを警告済みか。毎回の保存で同じ警告を出さないための印 */
  private warnedFallback = false

  /**
   * @param filePath 保存先のファイルパス
   */
  constructor(private readonly filePath: string) {}

  /**
   * 保存済みの配送状態を読み込む
   *
   * ファイルが存在しない場合、または壊れていて読み込めない場合は空を返す。
   * 壊れたファイルで通知を止めないため。読み込めなかった場合は警告をログに出力する。
   *
   * @returns 保存済みの配送状態
   */
  public load(): PersistedDeliveries {
    if (!fs.existsSync(this.filePath)) {
      return {}
    }
    try {
      const json = fs.readFileSync(this.filePath).toString()
      return parseDeliveries(JSON.parse(json))
    } catch (error) {
      Logger.configure('FileDeliveryStore.load').warn(
        `Failed to load delivery state, treating as empty (duplicates may occur): ${describeError(error)}`
      )
      return {}
    }
  }

  /**
   * 配送状態を保存する
   *
   * 書き込み中のクラッシュによる破損を避けるため、同一ディレクトリの一時ファイルに
   * 書き込んでから rename で置き換える。
   * ファイル単体を bind mount している場合などで rename できないときは、
   * 直接書き込む。
   *
   * @param deliveries 保存する配送状態
   */
  public save(deliveries: PersistedDeliveries): void {
    const json = JSON.stringify(deliveries)
    const temporaryPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.tmp`
    )
    try {
      fs.writeFileSync(temporaryPath, json, { mode: FILE_MODE })
      // mode は新規作成時にしか効かないため、既存のファイルの権限も揃える
      fs.chmodSync(temporaryPath, FILE_MODE)
      fs.renameSync(temporaryPath, this.filePath)
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true })
      } catch {
        // 一時ファイルの後始末に失敗しても、直接書き込みを続行する
      }
      if (!this.warnedFallback) {
        this.warnedFallback = true
        Logger.configure('FileDeliveryStore.save').warn(
          `Failed to replace delivery state atomically, writing directly: ${describeError(error)}`
        )
      }
      fs.writeFileSync(this.filePath, json, { mode: FILE_MODE })
      fs.chmodSync(this.filePath, FILE_MODE)
    }
  }
}
