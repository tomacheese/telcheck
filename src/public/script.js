/* eslint-disable no-console */
/* global alert */

async function isWebPushSupported() {
  // グローバル空間にNotificationがあればNotification APIに対応しているとみなす
  if (!('Notification' in window)) {
    return false
  }
  // グローバル変数navigatorにserviceWorkerプロパティがあればサービスワーカーに対応しているとみなす
  if (!('serviceWorker' in navigator)) {
    return false
  }
  try {
    const sw = await navigator.serviceWorker.ready
    // 利用可能になったサービスワーカーがpushManagerプロパティがあればPush APIに対応しているとみなす
    if (!('pushManager' in sw)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function getVapidPublicKey() {
  const response = await fetch('/api/vapidPublicKey')
  if (!response.ok) {
    throw new Error('VAPID公開鍵取得失敗')
  }
  const json = await response.json()
  return json.public_key
}

async function getDestinationNames() {
  const response = await fetch('/api/destinations')
  if (!response.ok) {
    throw new Error('送信先名取得失敗')
  }
  const json = await response.json()
  return json.destinations
}

/**
 *
 * @param {HTMLSelectElement} destinationNameSelect
 */
async function initDestinationNameSelect(destinationNameSelect) {
  const destinationNames = await getDestinationNames()
  if (destinationNames.length === 0) {
    throw new Error('Failed to get destination names! No destinations found.')
  }
  for (const destinationName of destinationNames) {
    const option = document.createElement('option')
    option.value = destinationName
    option.textContent = destinationName
    destinationNameSelect.append(option)
  }
}

/**
 * @param {string} [destinationName]
 */
async function subscribe(destinationName) {
  if (!(await isWebPushSupported())) {
    throw new Error('This browser does not support web push')
  }
  const validPublicKey = await getVapidPublicKey()

  if (window.Notification.permission === 'default') {
    const result = await window.Notification.requestPermission()
    if (result === 'default') {
      throw new Error('Permission prompt dismissed.')
    }
  }
  if (window.Notification.permission === 'denied') {
    throw new Error('Permission denied.')
  }

  const currentLocalSubscription = await navigator.serviceWorker.ready.then(
    (worker) =>
      worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: validPublicKey,
      }),
  )

  const subscriptionJSON = currentLocalSubscription.toJSON()
  if (subscriptionJSON.endpoint == null || subscriptionJSON.keys == null) {
    throw new Error('Subscription endpoint or keys are missing.')
  }

  try {
    const response = await fetch('/api/subscribe', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destinationName,
        endpoint: subscriptionJSON.endpoint,
        expiration_time: subscriptionJSON.expirationTime ?? null,
        keys: {
          p256dh: subscriptionJSON.keys.p256dh,
          auth: subscriptionJSON.keys.auth,
        },
      }),
    })
    if (!response.ok) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} [destinationName]
 */
async function unsubscribe(destinationName) {
  if (!(await isWebPushSupported())) {
    throw new Error('This browser does not support web push')
  }
  const sw = await navigator.serviceWorker.ready
  const currentLocalSubscription = await sw.pushManager.getSubscription()
  if (currentLocalSubscription == null) {
    throw new Error('Not subscribed.')
  }
  const subscriptionJSON = currentLocalSubscription.toJSON()
  if (subscriptionJSON.endpoint == null || subscriptionJSON.keys == null) {
    throw new Error('Subscription endpoint or keys are missing.')
  }

  const response = await fetch('/api/subscribe', {
    method: 'delete',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      destinationName,
      endpoint: subscriptionJSON.endpoint,
      expiration_time: subscriptionJSON.expirationTime ?? null,
      keys: {
        p256dh: subscriptionJSON.keys.p256dh,
        auth: subscriptionJSON.keys.auth,
      },
    }),
  })
  if (response.status === 404) {
    throw new Error('Already unsubscribed.')
  }

  if (!response.ok) {
    return false
  }

  return true
}

async function main() {
  /** @type {HTMLButtonElement | null} */
  const subscribeButton = document.querySelector('#subscribe')
  /** @type {HTMLButtonElement | null} */
  const unsubscribeButton = document.querySelector('#unsubscribe')
  /** @type {HTMLButtonElement | null} */
  const forceReloadButton = document.querySelector('#force-reload')
  /** @type {HTMLSelectElement | null} */
  const destinationNameSelect = document.querySelector('#destination-name')
  /** @type {HTMLDivElement | null} */
  const modal = document.querySelector('#modal')
  /** @type {HTMLDivElement | null} */
  const modalNotSupported = document.querySelector('#modal-not-supported')

  if (
    subscribeButton == null ||
    unsubscribeButton == null ||
    forceReloadButton == null ||
    destinationNameSelect == null ||
    modal == null ||
    modalNotSupported == null
  ) {
    throw new Error('elements is null.')
  }

  forceReloadButton.addEventListener('click', () => {
    // @ts-ignore
    window.location.reload(true)
  })

  const isSupported = await isWebPushSupported()
  if (!isSupported) {
    modalNotSupported.classList.add('is-active')
    modal.classList.remove('is-active')
    return
  }

  subscribeButton.disabled = true
  unsubscribeButton.disabled = true
  initDestinationNameSelect(destinationNameSelect).then(() => {
    subscribeButton.disabled = false
    unsubscribeButton.disabled = false

    modal.classList.remove('is-active')
  })

  subscribeButton.addEventListener('click', async () => {
    try {
      const result = await subscribe(destinationNameSelect.value)
      if (!result) {
        alert('通知の購読に失敗しました')
      }
    } catch (error) {
      console.error(error)
      // @ts-ignore
      alert(`通知の購読に失敗しました: ${error.message}`)
    }
  })

  unsubscribeButton.addEventListener('click', async () => {
    try {
      const result = await unsubscribe()
      if (result) {
        alert('通知を解除しました')
      } else {
        alert('通知の解除に失敗しました')
      }
    } catch (error) {
      console.error(error)
      // @ts-ignore
      alert(`通知の解除に失敗しました: ${error.message}`)
    }
  })
}

main()
