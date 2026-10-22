import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeliverableDestination, DeliveryTracker } from './delivery'

/**
 * テスト用の宛先。failures の回数だけ失敗してから成功する。
 */
function createDestination(failures = 0) {
  let remaining = failures
  const messages: string[] = []
  const progresses: Set<string>[] = []
  const destination: DeliverableDestination = {
    send(message: string, progress: Set<string>) {
      messages.push(message)
      progresses.push(progress)
      if (remaining > 0) {
        remaining--
        return Promise.reject(new Error('send failed'))
      }
      return Promise.resolve()
    },
  }
  return { destination, messages, progresses }
}

describe('DeliveryTracker', () => {
  it('全宛先に送信できた場合は正常終了する', async () => {
    const tracker = new DeliveryTracker()
    const a = createDestination()
    const b = createDestination()
    await tracker.deliver('call', [a.destination, b.destination], () =>
      Promise.resolve('message')
    )
    assert.deepEqual(a.messages, ['message'])
    assert.deepEqual(b.messages, ['message'])
  })

  it('一部の宛先が失敗した場合は reject し、成功した宛先へは再送しない', async () => {
    const tracker = new DeliveryTracker()
    const ok = createDestination()
    const ng = createDestination(1)
    let created = 0
    const createMessage = () => {
      created++
      return Promise.resolve(`message-${created}`)
    }

    await assert.rejects(
      tracker.deliver('call', [ok.destination, ng.destination], createMessage),
      /Failed to deliver to 1 destinations \(#1\)/
    )
    await tracker.deliver(
      'call',
      [ok.destination, ng.destination],
      createMessage
    )

    assert.deepEqual(ok.messages, ['message-1'])
    // 失敗した宛先にだけ、同じメッセージで再送される
    assert.deepEqual(ng.messages, ['message-1', 'message-1'])
    // 再試行ではメッセージを再生成しない
    assert.equal(created, 1)
  })

  it('一部の宛先が失敗しても、他の宛先への送信は最後まで行う', async () => {
    const tracker = new DeliveryTracker()
    const ng = createDestination(1)
    const ok = createDestination()
    await assert.rejects(
      tracker.deliver('call', [ng.destination, ok.destination], () =>
        Promise.resolve('message')
      )
    )
    assert.deepEqual(ok.messages, ['message'])
  })

  it('全宛先に送信できた後は状態を破棄する', async () => {
    const tracker = new DeliveryTracker()
    const a = createDestination()
    let created = 0
    const createMessage = () => {
      created++
      return Promise.resolve('message')
    }
    await tracker.deliver('call', [a.destination], createMessage)
    await tracker.deliver('call', [a.destination], createMessage)
    assert.equal(created, 2)
  })

  it('prune で対象外の通話の状態を破棄する', async () => {
    const tracker = new DeliveryTracker()
    const ng = createDestination(1)
    let created = 0
    const createMessage = () => {
      created++
      return Promise.resolve('message')
    }
    await assert.rejects(
      tracker.deliver('call', [ng.destination], createMessage)
    )
    tracker.prune(new Set(['other']))
    await tracker.deliver('call', [ng.destination], createMessage)
    assert.equal(created, 2)
  })

  it('prune で対象の通話の状態は維持する', async () => {
    const tracker = new DeliveryTracker()
    const ng = createDestination(1)
    let created = 0
    const createMessage = () => {
      created++
      return Promise.resolve('message')
    }
    await assert.rejects(
      tracker.deliver('call', [ng.destination], createMessage)
    )
    tracker.prune(new Set(['call']))
    await tracker.deliver('call', [ng.destination], createMessage)
    assert.equal(created, 1)
  })

  it('メッセージ生成に失敗した場合は reject し、次回は再生成する', async () => {
    const tracker = new DeliveryTracker()
    const a = createDestination()
    await assert.rejects(
      tracker.deliver('call', [a.destination], () =>
        Promise.reject(new Error('search failed'))
      )
    )
    assert.deepEqual(a.messages, [])
    await tracker.deliver('call', [a.destination], () =>
      Promise.resolve('message')
    )
    assert.deepEqual(a.messages, ['message'])
  })

  it('宛先内の進捗は同じ通話の再送時にだけ引き継ぎ、別の通話には引き継がない', async () => {
    const tracker = new DeliveryTracker()
    const ng = createDestination(1)
    const createMessage = () => Promise.resolve('message')

    // 通話 A: 失敗後に再送する。同じ Set が渡される
    await assert.rejects(
      tracker.deliver('call-a', [ng.destination], createMessage)
    )
    await tracker.deliver('call-a', [ng.destination], createMessage)
    assert.equal(ng.progresses[0], ng.progresses[1])

    // 通話 A が失敗したまま対象から外れた後、同じ内容の通話 B は新しい Set で送信される
    const ng2 = createDestination(1)
    await assert.rejects(
      tracker.deliver('call-a2', [ng2.destination], createMessage)
    )
    ng2.progresses[0].add('https://push.example.com/a')
    tracker.prune(new Set(['call-b']))
    await tracker.deliver('call-b', [ng2.destination], createMessage)
    assert.notEqual(ng2.progresses[0], ng2.progresses[1])
    assert.equal(ng2.progresses[1].size, 0)
  })
})
