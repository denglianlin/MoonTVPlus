/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedMetaInfo,
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/correct
 * 纠正视频的TMDB映射
 */
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const body = await request.json();
    const { folder, tmdbId, title, posterPath, releaseDate, overview, voteAverage, mediaType } = body;

    if (!folder || !tmdbId) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (!openListConfig || !openListConfig.URL || !openListConfig.Token) {
      return NextResponse.json(
        { error: 'OpenList 未配置' },
        { status: 400 }
      );
    }

    const rootPath = openListConfig.RootPath || '/';
    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Token,
      openListConfig.Username,
      openListConfig.Password
    );

    // 读取现有 metainfo.json
    let metaInfo: MetaInfo | null = getCachedMetaInfo(rootPath);

    if (!metaInfo) {
      try {
        const metainfoPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}metainfo.json`;
        const fileResponse = await client.getFile(metainfoPath);

        if (fileResponse.code === 200 && fileResponse.data.raw_url) {
          const downloadUrl = fileResponse.data.raw_url;
          const contentResponse = await fetch(downloadUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
          });

          if (!contentResponse.ok) {
            throw new Error(`下载失败: ${contentResponse.status}`);
          }

          const content = await contentResponse.text();
          metaInfo = JSON.parse(content);
        }
      } catch (error) {
        console.error('[OpenList Correct] 读取 metainfo.json 失败:', error);
        return NextResponse.json(
          { error: 'metainfo.json 读取失败' },
          { status: 500 }
        );
      }
    }

    if (!metaInfo) {
      return NextResponse.json(
        { error: 'metainfo.json 不存在' },
        { status: 404 }
      );
    }

    // 更新视频信息
    metaInfo.folders[folder] = {
      tmdb_id: tmdbId,
      title: title,
      poster_path: posterPath,
      release_date: releaseDate || '',
      overview: overview || '',
      vote_average: voteAverage || 0,
      media_type: mediaType,
      last_updated: Date.now(),
      failed: false, // 纠错后标记为成功
    };

    // 保存 metainfo.json
    const metainfoPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}metainfo.json`;
    const metainfoContent = JSON.stringify(metaInfo, null, 2);

    await client.uploadFile(metainfoPath, metainfoContent);

    // 更新缓存
    invalidateMetaInfoCache(rootPath);
    setCachedMetaInfo(rootPath, metaInfo);

    return NextResponse.json({
      success: true,
      message: '纠错成功',
    });
  } catch (error) {
    console.error('视频纠错失败:', error);
    return NextResponse.json(
      { error: '纠错失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
