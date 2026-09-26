import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { reportPlatformUsage } from '../common/platform-usage';

/** Consumo de Cloudinary para los indicadores de costos de Authoriza. */
function trackUpload(result: { bytes?: number } | undefined) {
  reportPlatformUsage({ platform: 'CLOUDINARY', metric: 'uploads', quantity: 1 });
  if (result?.bytes) reportPlatformUsage({ platform: 'CLOUDINARY', metric: 'upload_bytes', quantity: result.bytes });
}

@Injectable()
export class CloudinaryService {
  async uploadImage(file: Express.Multer.File, folder: string = 'payment-vouchers'): Promise<any> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { 
          resource_type: 'auto',
          folder,
        },
        (error, result) => {
          if (error) return reject(error);
          trackUpload(result);
          resolve(result);
        },
      ).end(file.buffer);
    });
  }
}