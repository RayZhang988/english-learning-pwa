export type NetworkStatus = 'online' | 'offline'
export type NetworkStatusListener = (status: NetworkStatus) => void

export interface NetworkStatusService {
  current(): NetworkStatus
  subscribe(listener: NetworkStatusListener): () => void
}

export const browserNetworkStatus: NetworkStatusService = {
  current() {
    return navigator.onLine ? 'online' : 'offline'
  },

  subscribe(listener) {
    const onOnline = () => listener('online')
    const onOffline = () => listener('offline')

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  },
}
