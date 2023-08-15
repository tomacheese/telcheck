import axios from 'axios'
import { load } from 'cheerio'
import { Configuration, PATH } from './config'
import fs from 'node:fs'
import { Logger } from '@book000/node-utils'

interface PhoneDetail {
  name: string
  source: string
}

export interface GoogleSearchResult {
  count: number
  items: {
    title: string
    url: string
    snippet: string
  }[]
  source: string
}

export type PhoneDetailResult = PhoneDetail | GoogleSearchResult | null

class BaseSearchNumber {
  public readonly serviceName: string
  protected readonly $axios

  constructor(serviceName: string) {
    this.serviceName = serviceName

    this.$axios = axios.create({
      timeout: 10_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/109.0',
      },
      validateStatus: () => true,
    })
  }

  public async search(number: string): Promise<PhoneDetailResult> {
    throw new Error(`Not implemented: ${number}@${this.serviceName}`)
  }
}

class AnonymousCall extends BaseSearchNumber {
  constructor() {
    super('非通知着信')
  }

  public async search(number: string): Promise<PhoneDetailResult> {
    if (number === 'anonymous') {
      return {
        name: '非通知着信',
        source: this.serviceName,
      }
    }
    return null
  }
}

class Phones extends BaseSearchNumber {
  constructor() {
    super('電話帳')
  }

  public async search(number: string): Promise<PhoneDetailResult> {
    if (!fs.existsSync(PATH.PHONES_FILE)) {
      return null
    }
    const tsv = fs
      .readFileSync(PATH.PHONES_FILE)
      .toString()
      .replaceAll('\r', '')
    const phones = tsv.split('\n').map((line) => {
      const [name, number] = line.split('\t')
      return { name, number }
    })
    const result = phones.find((phone) => phone.number === number)
    if (result) {
      return {
        name: result.name,
        source: this.serviceName,
      }
    }
    return null
  }
}

class TelNavi extends BaseSearchNumber {
  private readonly titleRegex = /^電話番号\d+は(.+)$/

  constructor() {
    super('電話帳ナビ `telnavi.jp`')
  }

  public async search(number: string): Promise<PhoneDetailResult> {
    const response = await axios.get(`https://telnavi.jp/phone/${number}`)
    if (response.status !== 200) {
      throw new Error(`Failed to get telnavi: ${response.status}`)
    }

    const $ = load(response.data)
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
    const response = await this.$axios.get(url)
    if (response.status !== 200) {
      throw new Error(`Failed to get google search: ${response.status}`)
    }

    if (!response.data.items) {
      return null
    }

    const count = response.data.searchInformation.formattedTotalResults
    const results = response.data.items
      .slice(0, 3)
      .map((item: { title: any; link: any; snippet: any }) => ({
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
  number: string,
): Promise<PhoneDetailResult> {
  const logger = Logger.configure('GoogleSearch::searchNumber')
  const searchers = [
    new AnonymousCall(),
    new Phones(),
    new TelNavi(),
    new GoogleSearch(config),
  ]
  for (const searcher of searchers) {
    const result = await searcher.search(number).catch((error) => {
      logger.error('Failed to search number', error)
      return null
    })
    if (result) {
      return result
    }
  }
  return null
}

export function isPhoneDetail(
  result: PhoneDetailResult,
): result is PhoneDetail {
  return result !== null && 'name' in result
}

export function isGoogleSearchResult(
  result: PhoneDetailResult,
): result is GoogleSearchResult {
  return result !== null && 'count' in result
}
