/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OpenListFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  sign?: string; // 临时下载签名
  raw_url?: string; // 完整下载链接
  thumb?: string;
  type: number;
  path?: string;
}

export interface OpenListListResponse {
  code: number;
  message: string;
  data: {
    content: OpenListFile[];
    total: number;
    readme: string;
    write: boolean;
  };
}

export interface OpenListGetResponse {
  code: number;
  message: string;
  data: OpenListFile;
}

export class OpenListClient {
  constructor(
    private baseURL: string,
    private token: string,
    private username?: string,
    private password?: string
  ) {}

  /**
   * 使用账号密码登录获取Token
   */
  static async login(
    baseURL: string,
    username: string,
    password: string
  ): Promise<string> {
    const response = await fetch(`${baseURL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenList 登录失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200 || !data.data?.token) {
      throw new Error('OpenList 登录失败: 未获取到Token');
    }

    return data.data.token;
  }

  /**
   * 刷新Token（如果配置了账号密码）
   */
  private async refreshToken(): Promise<boolean> {
    if (!this.username || !this.password) {
      return false;
    }

    try {
      console.log('[OpenListClient] Token可能失效，尝试使用账号密码重新登录');
      this.token = await OpenListClient.login(
        this.baseURL,
        this.username,
        this.password
      );
      console.log('[OpenListClient] Token刷新成功');
      return true;
    } catch (error) {
      console.error('[OpenListClient] Token刷新失败:', error);
      return false;
    }
  }

  /**
   * 执行请求，如果401则尝试刷新Token后重试
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retried = false
  ): Promise<Response> {
    const response = await fetch(url, options);

    // 如果是401且未重试过且有账号密码，尝试刷新Token后重试
    if (response.status === 401 && !retried && this.username && this.password) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // 更新请求头中的Token
        const newOptions = {
          ...options,
          headers: {
            ...options.headers,
            Authorization: this.token,
          },
        };
        return this.fetchWithRetry(url, newOptions, true);
      }
    }

    return response;
  }

  private getHeaders() {
    return {
      Authorization: this.token, // 不带 bearer
      'Content-Type': 'application/json',
    };
  }

  // 列出目录
  async listDirectory(
    path: string,
    page = 1,
    perPage = 100
  ): Promise<OpenListListResponse> {
    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/list`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        path,
        password: '',
        refresh: false,
        page,
        per_page: perPage,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenList API 错误: ${response.status}`);
    }

    return response.json();
  }

  // 获取文件信息
  async getFile(path: string): Promise<OpenListGetResponse> {
    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/get`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        path,
        password: '',
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenList API 错误: ${response.status}`);
    }

    return response.json();
  }

  // 上传文件
  async uploadFile(path: string, content: string): Promise<void> {
    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/put`, {
      method: 'PUT',
      headers: {
        Authorization: this.token,
        'Content-Type': 'text/plain; charset=utf-8',
        'File-Path': encodeURIComponent(path),
        'As-Task': 'false',
      },
      body: content,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenList 上传失败: ${response.status} - ${errorText}`);
    }

    // 上传成功后刷新目录缓存
    const dir = path.substring(0, path.lastIndexOf('/')) || '/';
    await this.refreshDirectory(dir);
  }

  // 刷新目录缓存
  async refreshDirectory(path: string): Promise<void> {
    try {
      const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/list`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          path,
          password: '',
          refresh: true,
          page: 1,
          per_page: 1,
        }),
      });

      if (!response.ok) {
        console.warn(`刷新目录缓存失败: ${response.status}`);
      }
    } catch (error) {
      console.warn('刷新目录缓存失败:', error);
    }
  }

  // 删除文件
  async deleteFile(path: string): Promise<void> {
    const dir = path.substring(0, path.lastIndexOf('/')) || '/';
    const fileName = path.substring(path.lastIndexOf('/') + 1);

    const response = await this.fetchWithRetry(`${this.baseURL}/api/fs/remove`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        names: [fileName],
        dir: dir,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenList 删除失败: ${response.status}`);
    }
  }
}
