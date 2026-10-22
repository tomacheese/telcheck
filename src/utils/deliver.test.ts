import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { IDestination } from './config'
import {
  DeliveryStore,
  Sendable,
  deliverCall,
  getDestinationKeys,
} from './deliver'
import { getDestination } from './destination'

const DATE = '2026/10/22'
const TIME = '12:34:56'

function createConfig(name: string, url = `https://example.invalid/${name}`) {
  return {
    type: 'slack',
    webhook_url: url,
    name,
    condition: {},
  } as unknown as IDestination
}

/** 配信状態をメモリ上に保持するテスト用ストア */
class MemoryStore implements DeliveryStore {
  public completed: string[] = []
  public pending: { key: string; delivered: string[] } | undefined

  public getDelivered(date: string, time: string): string[] {
    const key = `${date} ${time}`
    return this.pending?.key === key ? [...this.pending.delivered] : []
  }

  public markDelivered(date: string, time: string, destinationKey: string) {
    const key = `${date} ${time}`
    if (this.pending?.key !== key) {
      this.pending = { key, delivered: [] }
    }
    this.pending.delivered.push(destinationKey)
  }

  public complete(date: string, time: string) {
    this.completed.push(`${date} ${time}`)
    this.pending = undefined
  }
}

function createLogger() {
  const logs: string[] = []
  return {
    logs,
    info: (message: string) => {
      logs.push(message)
    },
    error: (message: string) => {
      logs.push(message)
    },
  }
}

/** 宛先名ごとに送信の振る舞いを切り替えられるテスト用の宛先を生成する */
function createDestinationFactory(
  behaviors: Record<string, () => Promise<void>>
) {
  const sent: string[] = []
  const createDestination = (config: IDestination): Sendable => ({
    send: async () => {
      sent.push(config.name)
      await behaviors[config.name]()
    },
  })
  return { sent, createDestination }
}

const succeed = () => Promise.resolve()
const fail = () => Promise.reject(new Error('boom'))

void describe('deliverCall', () => {
  void test('一部の宛先が失敗しても通話は処理済みにならず、成功した宛先が記録される', async () => {
    const store = new MemoryStore()
    const configs = [createConfig('A'), createConfig('B')]
    const { sent, createDestination } = createDestinationFactory({
      A: succeed,
      B: fail,
    })

    await assert.rejects(
      deliverCall({
        isFirst: false,
        date: DATE,
        time: TIME,
        destinationConfigs: configs,
        createDestination,
        message: 'm',
        store,
        logger: createLogger(),
      }),
      /Failed to deliver to 1 of 2 destinations/
    )

    assert.deepEqual(
      sent.toSorted((a, b) => a.localeCompare(b)),
      ['A', 'B']
    )
    assert.deepEqual(store.completed, [])
    assert.deepEqual(store.pending?.delivered, [getDestinationKeys(configs)[0]])
  })

  void test('復旧後の再試行では、成功済みの宛先に再送せず、失敗した宛先にだけ送信して処理済みにする', async () => {
    const store = new MemoryStore()
    const configs = [createConfig('A'), createConfig('B')]
    const failing = createDestinationFactory({ A: succeed, B: fail })
    const options = {
      isFirst: false,
      date: DATE,
      time: TIME,
      destinationConfigs: configs,
      message: 'm',
      store,
      logger: createLogger(),
    }
    await assert.rejects(
      deliverCall({ ...options, createDestination: failing.createDestination })
    )

    const recovered = createDestinationFactory({ A: succeed, B: succeed })
    await deliverCall({
      ...options,
      createDestination: recovered.createDestination,
    })

    assert.deepEqual(recovered.sent, ['B'])
    assert.deepEqual(store.completed, [`${DATE} ${TIME}`])
    assert.equal(store.pending, undefined)
  })

  void test('全宛先が成功すれば、各宛先へ 1 回ずつ送信して処理済みにする', async () => {
    const store = new MemoryStore()
    const { sent, createDestination } = createDestinationFactory({
      A: succeed,
      B: succeed,
    })

    await deliverCall({
      isFirst: false,
      date: DATE,
      time: TIME,
      destinationConfigs: [createConfig('A'), createConfig('B')],
      createDestination,
      message: 'm',
      store,
      logger: createLogger(),
    })

    assert.deepEqual(
      sent.toSorted((a, b) => a.localeCompare(b)),
      ['A', 'B']
    )
    assert.deepEqual(store.completed, [`${DATE} ${TIME}`])
  })

  void test('宛先が無ければ、送信せずに処理済みにする', async () => {
    const store = new MemoryStore()
    const { sent, createDestination } = createDestinationFactory({})

    await deliverCall({
      isFirst: false,
      date: DATE,
      time: TIME,
      destinationConfigs: [],
      createDestination,
      message: 'm',
      store,
      logger: createLogger(),
    })

    assert.deepEqual(sent, [])
    assert.deepEqual(store.completed, [`${DATE} ${TIME}`])
  })

  void test('初回起動では、送信せずに処理済みにする', async () => {
    const store = new MemoryStore()
    const { sent, createDestination } = createDestinationFactory({
      A: succeed,
    })

    await deliverCall({
      isFirst: true,
      date: DATE,
      time: TIME,
      destinationConfigs: [createConfig('A')],
      createDestination,
      message: 'm',
      store,
      logger: createLogger(),
    })

    assert.deepEqual(sent, [])
    assert.deepEqual(store.completed, [`${DATE} ${TIME}`])
  })

  void test('別の通話の配信状態は、配信済みとして扱わない', async () => {
    const store = new MemoryStore()
    const configs = [createConfig('A')]
    store.markDelivered(DATE, '00:00:00', getDestinationKeys(configs)[0])
    const { sent, createDestination } = createDestinationFactory({
      A: succeed,
    })

    await deliverCall({
      isFirst: false,
      date: DATE,
      time: TIME,
      destinationConfigs: configs,
      createDestination,
      message: 'm',
      store,
      logger: createLogger(),
    })

    assert.deepEqual(sent, ['A'])
  })

  void test('同一設定の宛先が複数あっても、キーが衝突せずそれぞれに送信される', async () => {
    const store = new MemoryStore()
    const configs = [createConfig('A'), createConfig('A')]
    const keys = getDestinationKeys(configs)
    assert.notEqual(keys[0], keys[1])
    const { sent, createDestination } = createDestinationFactory({
      A: succeed,
    })

    await deliverCall({
      isFirst: false,
      date: DATE,
      time: TIME,
      destinationConfigs: configs,
      createDestination,
      message: 'm',
      store,
      logger: createLogger(),
    })

    assert.deepEqual(sent, ['A', 'A'])
  })

  void test('send が同期的に例外を投げても、他の宛先の送信と記録は継続する', async () => {
    const store = new MemoryStore()
    const configs = [createConfig('A'), createConfig('B')]
    const sent: string[] = []
    const createDestination = (config: IDestination): Sendable => ({
      send: (): Promise<void> => {
        sent.push(config.name)
        if (config.name === 'A') {
          throw new Error('sync boom')
        }
        return Promise.resolve()
      },
    })

    await assert.rejects(
      deliverCall({
        isFirst: false,
        date: DATE,
        time: TIME,
        destinationConfigs: configs,
        createDestination,
        message: 'm',
        store,
        logger: createLogger(),
      }),
      /Failed to deliver to 1 of 2 destinations/
    )

    assert.deepEqual(
      sent.toSorted((a, b) => a.localeCompare(b)),
      ['A', 'B']
    )
    assert.deepEqual(store.completed, [])
    assert.deepEqual(store.pending?.delivered, [getDestinationKeys(configs)[1]])
  })

  void test('失敗のログに機密値を含めない', async () => {
    const store = new MemoryStore()
    const logger = createLogger()
    const { createDestination } = createDestinationFactory({ A: fail })

    await assert.rejects(
      deliverCall({
        isFirst: false,
        date: DATE,
        time: TIME,
        destinationConfigs: [
          createConfig('A', 'https://example.invalid/secret-token'),
        ],
        createDestination,
        message: 'm',
        store,
        logger,
      })
    )

    assert.ok(logger.logs.some((l) => l.includes('A (slack): boom')))
    assert.ok(logger.logs.every((l) => !l.includes('secret-token')))
  })

  void test('実際の URL 解析エラーでも、Webhook URL の秘密値をログに出力しない', async () => {
    const store = new MemoryStore()
    const logger = createLogger()
    const config = {
      type: 'slack',
      // ポート番号が不正で、fetch() が URL 全体を含む解析エラーを投げる
      webhook_url: 'https://hooks.slack.com:bad/services/FAKE-SECRET-TOKEN',
      name: 'S',
      condition: {},
    } as unknown as IDestination

    await assert.rejects(
      deliverCall({
        isFirst: false,
        date: DATE,
        time: TIME,
        destinationConfigs: [config],
        createDestination: getDestination,
        message: 'm',
        store,
        logger,
      })
    )

    assert.ok(
      logger.logs.some((l) => l.includes('Failed to send to destination: S'))
    )
    assert.ok(logger.logs.every((l) => !l.includes('FAKE-SECRET-TOKEN')))
  })

  void test('URL に含まれないトークンや、設定に無い URL もログに出力しない', async () => {
    const store = new MemoryStore()
    const logger = createLogger()
    const config = {
      type: 'discord-bot',
      token: 'FAKE-BOT-TOKEN',
      channel_id: '123456789',
      name: 'D',
      condition: {},
    } as unknown as IDestination
    const createDestination = (): Sendable => ({
      send: () =>
        Promise.reject(
          new Error(
            'failed with FAKE-BOT-TOKEN at https://example.invalid/hook/OTHER-SECRET?x=1'
          )
        ),
    })

    await assert.rejects(
      deliverCall({
        isFirst: false,
        date: DATE,
        time: TIME,
        destinationConfigs: [config],
        createDestination,
        message: 'm',
        store,
        logger,
      })
    )

    assert.ok(logger.logs.some((l) => l.includes('D (discord-bot)')))
    assert.ok(
      logger.logs.every(
        (l) => !l.includes('FAKE-BOT-TOKEN') && !l.includes('OTHER-SECRET')
      )
    )
  })
})

void describe('getDestinationKeys', () => {
  void test('設定のキー順が違っても同じキーになる', () => {
    const a = { type: 'slack', webhook_url: 'u', name: 'A', condition: {} }
    const b = { name: 'A', condition: {}, webhook_url: 'u', type: 'slack' }
    assert.deepEqual(
      getDestinationKeys([a as unknown as IDestination]),
      getDestinationKeys([b as unknown as IDestination])
    )
  })

  void test('設定が異なればキーも異なる', () => {
    const keys = getDestinationKeys([
      createConfig('A', 'https://example.invalid/1'),
      createConfig('A', 'https://example.invalid/2'),
    ])
    assert.notEqual(keys[0], keys[1])
  })
})
