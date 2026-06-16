import { TileSet } from 'srtm-elevation';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Serviço para leitura offline de elevação usando dados SRTM da NASA.
 * Faz o download de tiles (.hgt) sob demanda para o disco e retorna a elevação
 * em 0ms (100% offline) após o primeiro acesso à região.
 */
export class SRTMLocalService {
  private static instance: SRTMLocalService;
  private srtmTiles: TileSet;

  // Per-tile in-flight Promise map. If two workers ask for points in the same
  // 1°×1° SRTM tile concurrently, the library tries to download the same ZIP
  // to AppData\Local\Temp twice and the second open fails with EPERM on Windows.
  // We dedupe by tile key so the first lookup downloads and the rest await it.
  private tileLocks: Map<string, Promise<unknown>> = new Map();

  private constructor() {
    const srtmCacheDir = path.join(process.cwd(), 'data', 'srtm-cache');
    if (!fs.existsSync(srtmCacheDir)) {
      fs.mkdirSync(srtmCacheDir, { recursive: true });
    }

    // Inicializa a biblioteca de elevação com a pasta de cache local
    this.srtmTiles = new TileSet(srtmCacheDir);
  }

  public static getInstance(): SRTMLocalService {
    if (!SRTMLocalService.instance) {
      SRTMLocalService.instance = new SRTMLocalService();
    }
    return SRTMLocalService.instance;
  }

  private static tileKey(lat: number, lng: number): string {
    // SRTM tiles are 1°×1°, keyed by the integer floor of lat and lng.
    return `${Math.floor(lat)}_${Math.floor(lng)}`;
  }

  /**
   * Single-flight invoke of the SRTM library, retrying once on EPERM in case
   * we still race against an antivirus or a residual lock from a prior crash.
   */
  private async fetchElevation(lat: number, lng: number): Promise<number | null> {
    const attempt = () => new Promise<number | null>((resolve, reject) => {
      try {
        this.srtmTiles.getElevation([lat, lng], (err: any, elevation: number) => {
          if (err) return reject(err);
          if (elevation === undefined || elevation === null) return resolve(null);
          resolve(Math.round(elevation));
        });
      } catch (syncErr) {
        reject(syncErr);
      }
    });

    try {
      return await attempt();
    } catch (err: any) {
      if (err && err.code === 'EPERM') {
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
        try {
          return await attempt();
        } catch (retryErr) {
          console.error(`[SRTMLocalService] EPERM persisted for ${lat},${lng}:`, retryErr);
          return null;
        }
      }
      console.error(`[SRTMLocalService] Error reading elevation for ${lat},${lng}:`, err);
      return null;
    }
  }

  /**
   * Obtém a elevação de uma coordenada em metros (acima do nível do mar)
   * 100% Offline se o tile já estiver no cache local.
   */
  public async getElevation(lat: number, lng: number): Promise<number | null> {
    // SRTM coverage is 60°S to 60°N. Locations outside (e.g. north Alaska) crash the lib.
    if (lat > 60 || lat < -60) {
      return null;
    }

    const key = SRTMLocalService.tileKey(lat, lng);
    const inFlight = this.tileLocks.get(key) as Promise<number | null> | undefined;
    if (inFlight) {
      // Another worker is already touching this tile. Wait for its lookup to
      // finish (it downloads the .hgt to the cache dir), then do ours — by now
      // the tile is on disk so no second download happens.
      try { await inFlight; } catch { /* swallow */ }
    }

    const p = this.fetchElevation(lat, lng);
    this.tileLocks.set(key, p);
    try {
      return await p;
    } finally {
      // Only clear if it's still the same Promise (a newer one shouldn't be replaced).
      if (this.tileLocks.get(key) === p) this.tileLocks.delete(key);
    }
  }
}
