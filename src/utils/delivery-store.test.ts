import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { IDestination } from './config'
import { FileDeliveryStore, getDestinationKeys } from './delivery-store'

function createConfig(name: string, url = `https://example.invalid/${name}`) {
  return {
    type: 'slack',
    webhook_url: url,
    name,
    condition: {},
  } as unknown as IDestination
}

describe('FileDeliveryStore', () => {
  let directory = ''
  let filePath = ''

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telcheck-'))
    filePath = path.join(directory, 'delivery.json')
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('ファイルが無い場合は空を返す', () => {
    assert.deepEqual(new FileDeliveryStore(filePath).load(), {})
  })

  it('保存した配送状態を読み込める', () => {
    const store = new FileDeliveryStore(filePath)
    const deliveries = {
      call: { delivered: ['a', 'b'], progress: { a: ['endpoint'] } },
    }

    store.save(deliveries)

    assert.deepEqual(new FileDeliveryStore(filePath).load(), deliveries)
  })

  it('壊れたファイルは空として扱う', () => {
    fs.writeFileSync(filePath, '{ broken')

    assert.deepEqual(new FileDeliveryStore(filePath).load(), {})
  })

  it('形式が正しくない項目は読み飛ばす', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        ok: { delivered: ['a'], progress: { a: ['x'], b: 'invalid' } },
        noProgress: { delivered: ['a'] },
        broken: { delivered: 'a' },
      })
    )

    assert.deepEqual(new FileDeliveryStore(filePath).load(), {
      ok: { delivered: ['a'], progress: { a: ['x'] } },
      noProgress: { delivered: ['a'], progress: {} },
    })
  })

  it('配列など想定外の形式は空として扱う', () => {
    fs.writeFileSync(filePath, '[]')

    assert.deepEqual(new FileDeliveryStore(filePath).load(), {})
  })

  it('書き込み後に一時ファイルが残らない', () => {
    new FileDeliveryStore(filePath).save({})

    assert.deepEqual(fs.readdirSync(directory), ['delivery.json'])
  })

  it('一時ファイルに書き込めない場合は、直接書き込む', () => {
    // 一時ファイルのパスがディレクトリで塞がれている状態を作る
    fs.mkdirSync(path.join(directory, '.delivery.json.tmp'))
    const store = new FileDeliveryStore(filePath)

    store.save({ call: { delivered: ['a'], progress: {} } })

    assert.deepEqual(store.load(), {
      call: { delivered: ['a'], progress: {} },
    })
  })
})

describe('getDestinationKeys', () => {
  it('設定のキー順が違っても同じキーになる', () => {
    const a = { type: 'slack', webhook_url: 'u', name: 'A', condition: {} }
    const b = { name: 'A', condition: {}, webhook_url: 'u', type: 'slack' }

    assert.deepEqual(
      getDestinationKeys([a as unknown as IDestination]),
      getDestinationKeys([b as unknown as IDestination])
    )
  })

  it('設定が異なればキーも異なる', () => {
    const keys = getDestinationKeys([
      createConfig('A', 'https://example.invalid/1'),
      createConfig('A', 'https://example.invalid/2'),
    ])

    assert.notEqual(keys[0], keys[1])
  })

  it('同一設定が複数ある場合も、キーが衝突しない', () => {
    const keys = getDestinationKeys([createConfig('A'), createConfig('A')])

    assert.notEqual(keys[0], keys[1])
  })

  it('並び順が変わっても、宛先ごとのキーは変わらない', () => {
    const [a, b] = getDestinationKeys([createConfig('A'), createConfig('B')])
    const [b2, a2] = getDestinationKeys([createConfig('B'), createConfig('A')])

    assert.equal(a, a2)
    assert.equal(b, b2)
  })

  it('通知条件 (condition) を編集しても、同じ宛先として同じキーになる', () => {
    const base = createConfig('A') as unknown as Record<string, unknown>
    const [before] = getDestinationKeys([
      {
        ...base,
        condition: { direction: 'incoming' },
      } as unknown as IDestination,
    ])
    const [after] = getDestinationKeys([
      {
        ...base,
        condition: { direction: 'outgoing' },
      } as unknown as IDestination,
    ])

    assert.equal(before, after)
  })

  it('キーに Webhook URL などの設定値を平文で含めない', () => {
    const [key] = getDestinationKeys([
      createConfig('A', 'https://example.invalid/secret-token'),
    ])

    assert.ok(!key.includes('secret-token'))
    assert.ok(!key.includes('example.invalid'))
  })
})
