import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { DeliverableDestination, DeliveryTracker } from './delivery'
import {
  DeliveryStore,
  FileDeliveryStore,
  PersistedDeliveries,
} from './delivery-store'

const KEYS = ['key-a', 'key-b']

/**
 * テスト用の宛先。failures の回数だけ失敗してから成功する。
 * onSend で、送信時に progress へ送信済み項目を記録する処理を差し込める。
 */
function createDestination(
  failures = 0,
  onSend?: (progress: Set<string>) => void
) {
  let remaining = failures
  const messages: string[] = []
  const progresses: Set<string>[] = []
  const destination: DeliverableDestination = {
    send(message: string, progress: Set<string>) {
      messages.push(message)
      progresses.push(new Set(progress))
      onSend?.(progress)
      if (remaining > 0) {
        remaining--
        return Promise.reject(new Error('send failed'))
      }
      return Promise.resolve()
    },
  }
  return { destination, messages, progresses }
}

describe('DeliveryTracker の永続化', () => {
  let directory = ''
  let filePath = ''

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telcheck-'))
    filePath = path.join(directory, 'delivery.json')
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('再起動後も、成功済みの宛先には再送せず、失敗した宛先にだけ送信する', async () => {
    const ok = createDestination()
    const ng = createDestination(1)
    const first = new DeliveryTracker(new FileDeliveryStore(filePath))
    await assert.rejects(
      first.deliver(
        'call',
        [ok.destination, ng.destination],
        () => Promise.resolve('message'),
        KEYS
      )
    )

    // 再起動を模擬して、同じファイルを使う新しいトラッカーで再試行する
    const second = new DeliveryTracker(new FileDeliveryStore(filePath))
    await second.deliver(
      'call',
      [ok.destination, ng.destination],
      () => Promise.resolve('message'),
      KEYS
    )

    assert.deepEqual(ok.messages, ['message'])
    assert.equal(ng.messages.length, 2)
  })

  it('宛先の並びが変わっても、宛先キーで成功済みの宛先を判別する', async () => {
    const ok = createDestination()
    const ng = createDestination(1)
    await assert.rejects(
      new DeliveryTracker(new FileDeliveryStore(filePath)).deliver(
        'call',
        [ok.destination, ng.destination],
        () => Promise.resolve('message'),
        KEYS
      )
    )

    await new DeliveryTracker(new FileDeliveryStore(filePath)).deliver(
      'call',
      [ng.destination, ok.destination],
      () => Promise.resolve('message'),
      ['key-b', 'key-a']
    )

    assert.deepEqual(ok.messages, ['message'])
    assert.equal(ng.messages.length, 2)
  })

  it('宛先内の送信済み項目 (Web Push の購読など) も再起動後に引き継ぐ', async () => {
    const webPush = createDestination(1, (progress) => {
      progress.add('https://push.example.invalid/endpoint-1')
    })
    await assert.rejects(
      new DeliveryTracker(new FileDeliveryStore(filePath)).deliver(
        'call',
        [webPush.destination],
        () => Promise.resolve('message'),
        ['key-a']
      )
    )

    await new DeliveryTracker(new FileDeliveryStore(filePath)).deliver(
      'call',
      [webPush.destination],
      () => Promise.resolve('message'),
      ['key-a']
    )

    assert.deepEqual(
      [...webPush.progresses[1]],
      ['https://push.example.invalid/endpoint-1']
    )
  })

  it('全宛先に送信できた後も、通話が処理対象から外れるまで配送済みの記録を残す', async () => {
    const store = new FileDeliveryStore(filePath)
    const ok = createDestination()
    await new DeliveryTracker(store).deliver(
      'call',
      [ok.destination],
      () => Promise.resolve('message'),
      ['key-a']
    )
    assert.equal(Object.keys(store.load()).length, 1)

    // 通話を確認済みにする前に再起動しても、送信済みの宛先へ再送せず、
    // 送信するものが無いのでメッセージも生成しない
    let created = 0
    await new DeliveryTracker(store).deliver(
      'call',
      [ok.destination],
      () => {
        created++
        return Promise.resolve('message')
      },
      ['key-a']
    )

    assert.deepEqual(ok.messages, ['message'])
    assert.equal(created, 0)

    // 通話が確認済みになり、処理対象から外れたら破棄される
    new DeliveryTracker(store).prune(new Set())
    assert.deepEqual(store.load(), {})
  })

  it('同じプロセスで確認済みにする前に再度呼ばれても、送信済みの宛先へ再送しない', async () => {
    const tracker = new DeliveryTracker(new FileDeliveryStore(filePath))
    const ok = createDestination()
    const deliver = () =>
      tracker.deliver(
        'call',
        [ok.destination],
        () => Promise.resolve('message'),
        ['key-a']
      )

    await deliver()
    await deliver()

    assert.deepEqual(ok.messages, ['message'])
  })

  it('メッセージの生成に失敗しても、保存済みの配送状態を失わない', async () => {
    const store = new FileDeliveryStore(filePath)
    const ok = createDestination()
    const ng = createDestination(1)
    await assert.rejects(
      new DeliveryTracker(store).deliver(
        'call',
        [ok.destination, ng.destination],
        () => Promise.resolve('message'),
        KEYS
      )
    )
    const tracker = new DeliveryTracker(store)

    await assert.rejects(
      tracker.deliver(
        'call',
        [ok.destination, ng.destination],
        () => Promise.reject(new Error('search failed')),
        KEYS
      ),
      /search failed/
    )
    await tracker.deliver(
      'call',
      [ok.destination, ng.destination],
      () => Promise.resolve('message'),
      KEYS
    )

    assert.deepEqual(ok.messages, ['message'])
  })

  it('保存された配送状態に電話番号などの通話キーを平文で含めない', async () => {
    const store = new FileDeliveryStore(filePath)
    await assert.rejects(
      new DeliveryTracker(store).deliver(
        '2026/10/22|12:34:56|incoming|0312345678|0398765432|connected',
        [createDestination(1).destination],
        () => Promise.resolve('message'),
        ['key-a']
      )
    )

    const content = fs.readFileSync(filePath).toString()
    assert.ok(!content.includes('0312345678'))
    assert.ok(!content.includes('0398765432'))
  })

  it('処理対象から外れた通話の配送状態は、保存されたものも破棄する', async () => {
    const store = new FileDeliveryStore(filePath)
    await assert.rejects(
      new DeliveryTracker(store).deliver(
        'old-call',
        [createDestination(1).destination],
        () => Promise.resolve('message'),
        ['key-a']
      )
    )
    assert.equal(Object.keys(store.load()).length, 1)

    new DeliveryTracker(store).prune(new Set(['another-call']))

    assert.deepEqual(store.load(), {})
  })

  it('処理対象の通話の配送状態は、prune しても保存されたまま残る', async () => {
    const store = new FileDeliveryStore(filePath)
    await assert.rejects(
      new DeliveryTracker(store).deliver(
        'call',
        [createDestination(1).destination],
        () => Promise.resolve('message'),
        ['key-a']
      )
    )

    new DeliveryTracker(store).prune(new Set(['call']))

    assert.equal(Object.keys(store.load()).length, 1)
  })

  it('異なる通話の配送状態は互いに影響しない', async () => {
    const store = new FileDeliveryStore(filePath)
    const a = createDestination()
    await new DeliveryTracker(store).deliver(
      'call-1',
      [a.destination],
      () => Promise.resolve('message-1'),
      ['key-a']
    )

    await new DeliveryTracker(store).deliver(
      'call-2',
      [a.destination],
      () => Promise.resolve('message-2'),
      ['key-a']
    )

    assert.deepEqual(a.messages, ['message-1', 'message-2'])
  })

  it('宛先キーを渡さない場合は永続化しない', async () => {
    const store = new FileDeliveryStore(filePath)
    await assert.rejects(
      new DeliveryTracker(store).deliver(
        'call',
        [createDestination(1).destination],
        () => Promise.resolve('message')
      )
    )

    assert.deepEqual(store.load(), {})
  })

  it('永続化に失敗しても、送信自体は失敗させず、メモリ上の状態で再送を防ぐ', async () => {
    const saved: PersistedDeliveries[] = []
    const store: DeliveryStore = {
      load: () => ({}),
      save: (deliveries) => {
        saved.push(deliveries)
        throw new Error('disk full')
      },
    }
    const tracker = new DeliveryTracker(store)
    const ok = createDestination()
    const ng = createDestination(1)

    await assert.rejects(
      tracker.deliver(
        'call',
        [ok.destination, ng.destination],
        () => Promise.resolve('message'),
        KEYS
      ),
      /Failed to deliver to 1 destinations \(#1\)/
    )
    await tracker.deliver(
      'call',
      [ok.destination, ng.destination],
      () => Promise.resolve('message'),
      KEYS
    )

    assert.ok(saved.length > 0)
    assert.deepEqual(ok.messages, ['message'])
    assert.equal(ng.messages.length, 2)
  })

  it('他の宛先の完了を待たずに、成功した宛先を永続化する', async () => {
    const store = new FileDeliveryStore(filePath)
    const fast = createDestination()
    const { promise: released, resolve: release } =
      Promise.withResolvers<undefined>()
    const slow: DeliverableDestination = { send: () => released }
    const delivering = new DeliveryTracker(store).deliver(
      'call',
      [fast.destination, slow],
      () => Promise.resolve('message'),
      KEYS
    )

    // 遅い宛先が完了する前に、速い宛先の成功が保存されている
    await new Promise((resolve) => setTimeout(resolve, 20))
    const [entry] = Object.values(store.load())
    assert.deepEqual(entry.delivered, ['key-a'])

    release(undefined)
    await delivering
  })

  it('壊れた配送状態のファイルでも、送信は通常どおり行う', async () => {
    fs.writeFileSync(filePath, '{ broken')
    const a = createDestination()

    await new DeliveryTracker(new FileDeliveryStore(filePath)).deliver(
      'call',
      [a.destination],
      () => Promise.resolve('message'),
      ['key-a']
    )

    assert.deepEqual(a.messages, ['message'])
  })
})
