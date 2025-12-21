/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * POST /api/admin/openlist
 * 保存 OpenList 配置
 */
export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { action, URL, Token, Username, Password, RootPath } = body;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 获取配置
    const adminConfig = await getConfig();

    // 权限检查
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    if (action === 'save') {
      // 保存配置
      if (!URL) {
        return NextResponse.json({ error: '缺少URL参数' }, { status: 400 });
      }

      let finalToken = Token;

      // 如果没有Token但有账号密码，尝试登录获取Token
      if (!finalToken && Username && Password) {
        try {
          console.log('[OpenList Config] 使用账号密码登录获取Token');
          finalToken = await OpenListClient.login(URL, Username, Password);
          console.log('[OpenList Config] 登录成功，获取到Token');
        } catch (error) {
          console.error('[OpenList Config] 登录失败:', error);
          return NextResponse.json(
            { error: '使用账号密码登录失败: ' + (error as Error).message },
            { status: 400 }
          );
        }
      }

      // 检查是否有Token
      if (!finalToken) {
        return NextResponse.json(
          { error: '请提供Token或账号密码' },
          { status: 400 }
        );
      }

      adminConfig.OpenListConfig = {
        URL,
        Token: finalToken,
        Username: Username || undefined,
        Password: Password || undefined,
        RootPath: RootPath || '/',
        LastRefreshTime: adminConfig.OpenListConfig?.LastRefreshTime,
        ResourceCount: adminConfig.OpenListConfig?.ResourceCount,
      };

      await db.saveAdminConfig(adminConfig);

      return NextResponse.json({
        success: true,
        message: '保存成功',
      });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('OpenList 配置操作失败:', error);
    return NextResponse.json(
      { error: '操作失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
