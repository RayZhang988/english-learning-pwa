import { AppError } from '../../core/errors/AppError.ts'

export type MicrophonePermissionState =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unsupported'
  | 'unknown'

export interface MicrophonePermissionService {
  query(): Promise<MicrophonePermissionState>
  request(): Promise<MediaStream>
}

function isPermissionState(value: string): value is PermissionState {
  return value === 'granted' || value === 'denied' || value === 'prompt'
}

export const browserMicrophonePermission: MicrophonePermissionService = {
  async query() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'unsupported'
    }

    if (!navigator.permissions?.query) {
      return 'unknown'
    }

    try {
      const result = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      })

      return isPermissionState(result.state) ? result.state : 'unknown'
    } catch {
      // Safari versions differ here; a failed query must not be treated as denial.
      return 'unknown'
    }
  },

  async request() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new AppError('permission_denied', '当前浏览器不支持麦克风录音。')
    }

    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      throw new AppError('permission_denied', '无法取得麦克风权限。', {
        cause: error,
        recoverable: true,
      })
    }
  },
}
