/**
 * Wikimedia Commons Image Extractor Service
 * 
 * This service extracts images from Wikimedia Commons URLs and downloads them
 * for storage in our Supabase bucket.
 */

export interface WikimediaImageInfo {
  title: string;
  url: string;
  description: string;
  author: string;
  license: string;
  size: number;
  width: number;
  height: number;
  mime: string;
}

export interface WikimediaExtractionResult {
  success: boolean;
  images: WikimediaImageInfo[];
  error?: string;
}

export class WikimediaImageExtractor {
  private static readonly WIKIMEDIA_API_BASE = 'https://commons.wikimedia.org/w/api.php';
  private static readonly WIKIMEDIA_COMMONS_BASE = 'https://commons.wikimedia.org';

  /**
   * Extract images from a Wikimedia Commons category URL
   */
  static async extractImagesFromCategory(categoryUrl: string): Promise<WikimediaExtractionResult> {
    try {
      // Parse the category name from the URL
      const categoryName = this.extractCategoryName(categoryUrl);
      if (!categoryName) {
        return {
          success: false,
          images: [],
          error: 'Could not extract category name from URL'
        };
      }

      // Get images from the category using Wikimedia API
      const images = await this.getImagesFromCategory(categoryName);
      
      return {
        success: true,
        images
      };
    } catch (error) {
      return {
        success: false,
        images: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Extract images from a Wikimedia Commons file URL
   */
  static async extractImageFromFile(fileUrl: string): Promise<WikimediaExtractionResult> {
    try {
      // Parse the file name from the URL
      const fileName = this.extractFileName(fileUrl);
      if (!fileName) {
        return {
          success: false,
          images: [],
          error: 'Could not extract file name from URL'
        };
      }

      // Get image info using Wikimedia API
      const imageInfo = await this.getImageInfo(fileName);
      
      return {
        success: true,
        images: imageInfo ? [imageInfo] : []
      };
    } catch (error) {
      return {
        success: false,
        images: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Extract the best image from OSM tags (wikimedia_commons field)
   */
  static async extractImageFromOSMTags(osmTags: any): Promise<WikimediaExtractionResult> {
    try {
      if (!osmTags || !osmTags.wikimedia_commons) {
        return {
          success: false,
          images: [],
          error: 'No wikimedia_commons field found in OSM tags'
        };
      }

      const wikimediaCommons = osmTags.wikimedia_commons;
      
      // Check if it's a category or file URL
      if (wikimediaCommons.includes('/wiki/Category:')) {
        return await this.extractImagesFromCategory(wikimediaCommons);
      } else if (wikimediaCommons.includes('/wiki/File:')) {
        return await this.extractImageFromFile(wikimediaCommons);
      } else {
        return {
          success: false,
          images: [],
          error: 'Unsupported Wikimedia Commons URL format'
        };
      }
    } catch (error) {
      return {
        success: false,
        images: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Download image data from Wikimedia Commons
   */
  static async downloadImage(imageInfo: WikimediaImageInfo): Promise<ArrayBuffer> {
    const response = await fetch(imageInfo.url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    return await response.arrayBuffer();
  }

  /**
   * Extract category name from Wikimedia Commons category URL
   */
  private static extractCategoryName(url: string): string | null {
    const match = url.match(/\/wiki\/Category:(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * Extract file name from Wikimedia Commons file URL
   */
  private static extractFileName(url: string): string | null {
    const match = url.match(/\/wiki\/File:(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * Get images from a Wikimedia Commons category
   */
  private static async getImagesFromCategory(categoryName: string): Promise<WikimediaImageInfo[]> {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'categorymembers',
      cmtitle: `Category:${categoryName}`,
      cmtype: 'file',
      cmlimit: '10', // Limit to 10 images
      cmnamespace: '6' // File namespace
    });

    const response = await fetch(`${this.WIKIMEDIA_API_BASE}?${params}`);
    if (!response.ok) {
      throw new Error(`Wikimedia API error: ${response.status}`);
    }

    const data = await response.json();
    const files = data.query?.categorymembers || [];

    // Get detailed info for each file
    const imageInfos: WikimediaImageInfo[] = [];
    for (const file of files) {
      const imageInfo = await this.getImageInfo(file.title);
      if (imageInfo) {
        imageInfos.push(imageInfo);
      }
    }

    return imageInfos;
  }

  /**
   * Get detailed image information from Wikimedia Commons
   */
  private static async getImageInfo(fileName: string): Promise<WikimediaImageInfo | null> {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      titles: fileName,
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1600' // High resolution
    });

    const response = await fetch(`${this.WIKIMEDIA_API_BASE}?${params}`);
    if (!response.ok) {
      throw new Error(`Wikimedia API error: ${response.status}`);
    }

    const data = await response.json();
    const pages = data.query?.pages;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];

    if (!page || !page.imageinfo || page.imageinfo.length === 0) {
      return null;
    }

    const imageInfo = page.imageinfo[0];
    const metadata = imageInfo.extmetadata || {};

    return {
      title: page.title,
      url: imageInfo.url,
      description: metadata.ImageDescription?.value || '',
      author: metadata.Artist?.value || metadata.Creator?.value || 'Unknown',
      license: metadata.LicenseShortName?.value || metadata.License?.value || 'Unknown',
      size: imageInfo.size || 0,
      width: imageInfo.width || 0,
      height: imageInfo.height || 0,
      mime: imageInfo.mime || 'image/jpeg'
    };
  }

  /**
   * Generate a safe filename for storage
   */
  static generateSafeFilename(poiName: string, imageTitle: string, index: number = 1): string {
    // Clean the POI name
    const cleanPoiName = poiName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 30);

    // Clean the image title
    const cleanImageTitle = imageTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 20);

    const timestamp = Date.now();
    const extension = this.getFileExtension(imageTitle);
    
    return `${cleanPoiName}-${cleanImageTitle}-${timestamp}-${index}${extension}`;
  }

  /**
   * Get file extension from image title or MIME type
   */
  private static getFileExtension(imageTitle: string, mimeType?: string): string {
    // Try to get extension from filename first
    const match = imageTitle.match(/\.([^.]+)$/);
    if (match) {
      return `.${match[1].toLowerCase()}`;
    }

    // Fallback to MIME type
    if (mimeType) {
      const mimeToExt: { [key: string]: string } = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg'
      };
      return mimeToExt[mimeType] || '.jpg';
    }

    return '.jpg'; // Default fallback
  }
}
