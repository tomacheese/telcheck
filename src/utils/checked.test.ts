import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { Checked } from './checked'
import { IDestination, PATH } from './config'
import { Sendable, deliverCall } from './deliver'

const DATE = '2026/10/22'
const TIME = '12:34:56'
// +09:00 の 2026-10-22 12:34:56 を UTC で表したもの
const ISO = '2026-10-22T03:34:56.000Z'

let temporaryDirectory = ''
let originalCheckedFile = ''

function readFile(): unknown {
  return JSON.parse(fs.readFileSync(PATH.CHECKED_FILE).toString())
}

function writeFile(content: unknown) {
  fs.writeFileSync(PATH.CHECKED_FILE, JSON.stringify(content))
}

function createConfig(name: string) {
  return {
    type: 'slack',
    webhook_url: `https://example.invalid/${name}`,
    name,
    condition: {},
  } as unknown as IDestination
}

void describe('Checked', () => {
  beforeEach(() => {
    originalCheckedFile = PATH.CHECKED_FILE
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'telcheck-'))
    PATH.CHECKED_FILE = path.join(temporaryDirectory, 'checked.json')
  })

  afterEach(() => {
    PATH.CHECKED_FILE = originalCheckedFile
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  void test('pending を持たない旧形式のファイルを読み込める', () => {
    writeFile({ datetime: ISO })

    assert.equal(Checked.isFirst(), false)
    assert.equal(Checked.isChecked(DATE, TIME), true)
    assert.equal(Checked.isChecked(DATE, '12:34:57'), false)
    assert.deepEqual(Checked.getDelivered(DATE, '12:34:57'), [])
  })

  void test('配信状態はファイルに永続化され、再読み込みしても保持される', () => {
    writeFile({ datetime: '2026-10-22T00:00:00.000Z' })

    Checked.markDelivered(DATE, TIME, 'key-a')
    Checked.markDelivered(DATE, TIME, 'key-a')
    Checked.markDelivered(DATE, TIME, 'key-b')

    assert.deepEqual(Checked.getDelivered(DATE, TIME), ['key-a', 'key-b'])
    assert.deepEqual(readFile(), {
      datetime: '2026-10-22T00:00:00.000Z',
      pending: { datetime: ISO, delivered: ['key-a', 'key-b'] },
    })
  })

  void test('別の通話の配信状態は引き継がず、置き換える', () => {
    writeFile({
      datetime: '2026-10-22T00:00:00.000Z',
      pending: { datetime: '2026-10-22T01:00:00.000Z', delivered: ['old'] },
    })

    assert.deepEqual(Checked.getDelivered(DATE, TIME), [])
    Checked.markDelivered(DATE, TIME, 'key-a')

    assert.deepEqual(readFile(), {
      datetime: '2026-10-22T00:00:00.000Z',
      pending: { datetime: ISO, delivered: ['key-a'] },
    })
  })

  void test('処理済みの日時が無い場合、markDelivered は何も保存しない', () => {
    Checked.markDelivered(DATE, TIME, 'key-a')

    assert.equal(fs.existsSync(PATH.CHECKED_FILE), false)
  })

  void test('complete は日時を更新して配信状態を破棄する', () => {
    writeFile({
      datetime: '2026-10-22T00:00:00.000Z',
      pending: { datetime: ISO, delivered: ['key-a'] },
    })

    Checked.complete(DATE, TIME)

    assert.deepEqual(readFile(), { datetime: ISO })
  })

  void test('complete は日時が更新されない場合でも配信状態を破棄し、日時は戻さない', () => {
    writeFile({
      datetime: ISO,
      pending: { datetime: ISO, delivered: ['key-a'] },
    })

    Checked.complete(DATE, '12:34:00')

    assert.deepEqual(readFile(), { datetime: ISO })
  })

  void test('書き込み後に一時ファイルが残らない', () => {
    Checked.complete(DATE, TIME)

    assert.deepEqual(fs.readdirSync(temporaryDirectory), ['checked.json'])
  })

  void test('一時ファイルに書き込めない場合は、直接書き込む', () => {
    // 一時ファイルのパスがディレクトリで塞がれている状態を作る
    fs.mkdirSync(path.join(temporaryDirectory, '.checked.json.tmp'))

    Checked.complete(DATE, TIME)

    assert.deepEqual(readFile(), { datetime: ISO })
  })

  void test('再起動を模擬しても、成功済みの宛先に再送されない', async () => {
    writeFile({ datetime: '2026-10-22T00:00:00.000Z' })
    const configs = [createConfig('A'), createConfig('B')]
    const options = {
      isFirst: false,
      date: DATE,
      time: TIME,
      destinationConfigs: configs,
      message: 'm',
      store: Checked,
      logger: { info: () => 0, error: () => 0 },
    }
    const failing = (config: IDestination): Sendable => ({
      send: () =>
        config.name === 'B'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(),
    })
    await assert.rejects(
      deliverCall({ ...options, createDestination: failing })
    )

    // Checked は静的クラスで、状態はすべてファイルにある。
    // そのため、このまま再度呼び出すことが再起動後の再試行に相当する。
    const sent: string[] = []
    await deliverCall({
      ...options,
      createDestination: (config) => ({
        send: () => {
          sent.push(config.name)
          return Promise.resolve()
        },
      }),
    })

    assert.deepEqual(sent, ['B'])
    assert.equal(Checked.isChecked(DATE, TIME), true)
    assert.deepEqual(readFile(), { datetime: ISO })
  })

  void test('同一秒の通話が連続しても、各通話が全宛先へ 1 回ずつ通知される', async () => {
    writeFile({ datetime: '2026-10-22T00:00:00.000Z' })
    const configs = [createConfig('A'), createConfig('B')]
    const sent: string[] = []
    const createDestination = (config: IDestination): Sendable => ({
      send: () => {
        sent.push(config.name)
        return Promise.resolve()
      },
    })

    // checker() は同一秒の通話をまとめて取得し、順に処理する
    for (let call = 0; call < 3; call++) {
      await deliverCall({
        isFirst: false,
        date: DATE,
        time: TIME,
        destinationConfigs: configs,
        createDestination,
        message: 'm',
        store: Checked,
        logger: { info: () => 0, error: () => 0 },
      })
    }

    assert.deepEqual(
      sent.toSorted((a, b) => a.localeCompare(b)),
      ['A', 'A', 'A', 'B', 'B', 'B']
    )
  })

  void test('初回起動では、送信せずにファイルを作成する', async () => {
    assert.equal(Checked.isFirst(), true)
    const sent: string[] = []

    await deliverCall({
      isFirst: Checked.isFirst(),
      date: DATE,
      time: TIME,
      destinationConfigs: [createConfig('A')],
      createDestination: (config) => ({
        send: () => {
          sent.push(config.name)
          return Promise.resolve()
        },
      }),
      message: 'm',
      store: Checked,
      logger: { info: () => 0, error: () => 0 },
    })

    assert.deepEqual(sent, [])
    assert.deepEqual(readFile(), { datetime: ISO })
  })
})
