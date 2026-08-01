// axios 削除

import { load } from 'cheerio'
import { Configuration, PATH } from './config'
import fs from 'node:fs'
import { Logger } from '@book000/node-utils'

interface PhoneDetail {
  name: string
  source: string
}

interface GoogleCustomSearchResponse {
  searchInformation: {
    formattedTotalResults: string
  }
  items?: {
    title: string
    link: string
    snippet: string
  }[]
}

export interface GoogleSearchResult {
  count: string
  items: {
    title: string
    url: string
    snippet: string
  }[]
  source: string
}

export type PhoneDetailResult = PhoneDetail | GoogleSearchResult | null

/**
 * 検索先サービスから返された HTTP エラーレスポンスを表すエラー
 *
 * アクセス制限による想定内の失敗かどうかは検索先サービスごとに意味が異なる
 * (例: TelNavi の 403 は bot ブロック、Google Custom Search の 403 は
 * キー設定不備やクォータ超過の可能性がある)ため、判定は throw 側で行い、
 * 結果を `expected` に保持する。
 * @param serviceLabel エラーメッセージに表示するサービス名
 * @param status HTTP ステータスコード
 * @param expected 呼び出し元でフォールバックのみで済む想定内の失敗かどうか
 */
class SearchNumberHttpError extends Error {
  constructor(
    serviceLabel: string,
    public readonly status: number,
    public readonly expected: boolean
  ) {
    super(`Failed to get ${serviceLabel}: ${status}`)
    this.name = 'SearchNumberHttpError'
  }
}

class BaseSearchNumber {
  public readonly serviceName: string
  constructor(serviceName: string) {
    this.serviceName = serviceName
  }

  public search(number: string): Promise<PhoneDetailResult> {
    throw new Error(`Not implemented: ${number}@${this.serviceName}`)
  }
}

class AnonymousCall extends BaseSearchNumber {
  constructor() {
    super('非通知着信')
  }

  public search(number: string): Promise<PhoneDetailResult> {
    if (number === 'anonymous') {
      return Promise.resolve({
        name: '非通知着信',
        source: this.serviceName,
      })
    }
    return Promise.resolve(null)
  }
}

class Phones extends BaseSearchNumber {
  constructor() {
    super('電話帳')
  }

  public search(number: string): Promise<PhoneDetailResult> {
    if (!fs.existsSync(PATH.PHONES_FILE)) {
      return Promise.resolve(null)
    }
    const tsv = fs
      .readFileSync(PATH.PHONES_FILE)
      .toString()
      .replaceAll('\r', '')
    const phones = tsv.split('\n').map((line) => {
      const [name, number] = line.split('\t', 2)
      return { name, number }
    })
    const result = phones.find((phone) => phone.number === number)
    if (result) {
      return Promise.resolve({
        name: result.name,
        source: this.serviceName,
      })
    }
    return Promise.resolve(null)
  }
}

class TelNavi extends BaseSearchNumber {
  private readonly titleRegex = /^電話番号\d+は(.+)$/

  constructor() {
    super('電話帳ナビ `telnavi.jp`')
  }

  public async search(number: string): Promise<PhoneDetailResult> {
    const res = await fetch(`https://telnavi.jp/phone/${number}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; telcheck)' },
    })
    if (!res.ok) {
      // telnavi.jp は bot ブロックとして 403・429 を返すことがあり、
      // 次の検索先へフォールバックするだけで済む想定内の失敗として扱う
      throw new SearchNumberHttpError(
        'telnavi',
        res.status,
        res.status === 403 || res.status === 429
      )
    }
    const html = await res.text()
    const $ = load(html)
    const title = $('title').text()
    const match = this.titleRegex.exec(title)
    if (match) {
      return {
        name: match[1],
        source: this.serviceName,
      }
    }

    return null
  }
}

class GoogleSearch extends BaseSearchNumber {
  private readonly config: Configuration

  constructor(config: Configuration) {
    super('Google検索')

    this.config = config
  }

  public async search(number: string): Promise<PhoneDetailResult> {
    if (!this.config.google_search) {
      // Google search not configured
      return null
    }

    const searchKey = this.config.google_search.key
    const searchCx = this.config.google_search.cx

    const url = `https://www.googleapis.com/customsearch/v1?key=${searchKey}&cx=${searchCx}&lr=lang_ja&q="${number}"`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      // 403 はキー設定不備やクォータ超過など人による対応が必要な失敗の
      // 可能性があるため想定内には含めず、429（レート制限）のみ想定内とする
      throw new SearchNumberHttpError(
        'google search',
        res.status,
        res.status === 429
      )
    }
    const data: GoogleCustomSearchResponse = await res.json()
    if (!data.items) {
      return null
    }
    const count = data.searchInformation.formattedTotalResults
    const results = data.items.slice(0, 3).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    }))
    return {
      count,
      items: results,
      source: this.serviceName,
    }
  }
}

export async function searchNumber(
  config: Configuration,
  number: string
): Promise<PhoneDetailResult> {
  const logger = Logger.configure('GoogleSearch::searchNumber')
  const searchers = [
    new AnonymousCall(),
    new Phones(),
    new TelNavi(),
    new GoogleSearch(config),
  ]
  for (const searcher of searchers) {
    const result = await searcher.search(number).catch((error: unknown) => {
      // 各検索先で想定内と判定されたアクセス制限は、次の検索先へ
      // フォールバックするだけで済むため warn に留める
      if (error instanceof SearchNumberHttpError && error.expected) {
        logger.warn(`Failed to search number: ${error.message}`)
        return null
      }
      logger.error('Failed to search number', error as Error)
      return null
    })
    if (result) {
      return result
    }
  }
  return null
}

export function isPhoneDetail(
  result: PhoneDetailResult
): result is PhoneDetail {
  return result !== null && 'name' in result
}

export function isGoogleSearchResult(
  result: PhoneDetailResult
): result is GoogleSearchResult {
  return result !== null && 'count' in result
}
