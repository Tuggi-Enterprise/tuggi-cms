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

  /**
   * Obtém a elevação de uma coordenada em metros (acima do nível do mar)
   * 100% Offline se o tile já estiver no cache local.
   */
  public async getElevation(lat: number, lng: number): Promise<number | null> {
    return new Promise((resolve) => {
      this.srtmTiles.getElevation([lat, lng], (err: any, elevation: number) => {
        if (err) {
          console.error(`[SRTMLocalService] Erro ao ler elevação para ${lat},${lng}:`, err);
          resolve(null);
          return;
        }
        
        if (elevation === undefined || elevation === null) {
          resolve(null);
          return;
        }

        resolve(Math.round(elevation));
      });
    });
  }
}
