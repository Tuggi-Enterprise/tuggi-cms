declare module 'srtm-elevation' {
  export class TileSet {
    constructor(cacheDir: string);
    getElevation(
      latLng: [number, number],
      callback: (err: any, elevation: number) => void
    ): void;
  }
}
