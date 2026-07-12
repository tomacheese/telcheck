import { Config } from '@/utils/config'
import { WebPush } from '@/utils/web-push'
import { FastifyInstance } from 'fastify'

/**
 * REST API ルーターの基底クラス
 */
export abstract class BaseRouter {
  protected fastify: FastifyInstance
  protected config: Config
  protected webPush: WebPush
  protected version: string

  constructor(
    fastify: FastifyInstance,
    config: Config,
    webPush: WebPush,
    version: string
  ) {
    this.fastify = fastify
    this.config = config
    this.webPush = webPush
    this.version = version
  }

  /**
   * ルーターを初期化する
   *
   * this.fastify.register() でルーターを登録する
   */
  abstract init(): Promise<void>
}
