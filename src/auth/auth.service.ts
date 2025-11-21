import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly authServiceUrl = process.env.AUTH_SERVICE_URL;

  async validateToken(token: string) {
    try {
      const response = await axios.get(`${this.authServiceUrl}/api/auth/validate`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
    }
  }

  async getUserInfo(token: string) {
    try {
      const response = await axios.get(`${this.authServiceUrl}/api/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
  }
}