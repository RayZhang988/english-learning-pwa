export interface OfflineAssetDescriptor {
  readonly url: string
  readonly revision?: string
}

export interface OfflinePackageManifest {
  readonly packageId: string
  readonly version: string
  readonly assets: readonly OfflineAssetDescriptor[]
}

export interface OfflinePackageRecord extends OfflinePackageManifest {
  readonly cacheName: string
  readonly installedAt: string
}

export interface OfflineAssetStore {
  install(
    manifest: OfflinePackageManifest,
    signal?: AbortSignal,
  ): Promise<OfflinePackageRecord>
  getPackage(packageId: string): Promise<OfflinePackageRecord | undefined>
  getAsset(packageId: string, url: string): Promise<Response | undefined>
  remove(packageId: string): Promise<void>
}
