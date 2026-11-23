import { generateVAPIDKeys, sendNotification } from 'web-push'

/** ESM の export を直接変更せず、送信処理をテストで差し替えるための境界。 */
export const webPushClient = { generateVAPIDKeys, sendNotification }
