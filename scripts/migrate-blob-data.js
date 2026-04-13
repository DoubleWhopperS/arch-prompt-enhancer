#!/usr/bin/env node
/**
 * 数据迁移：将旧路径的 Blob 数据迁移到用户隔离路径
 *
 * 旧路径: gallery/metadata.json, ref-library/metadata.json
 * 新路径: gallery/{userId}/metadata.json, ref-library/{userId}/metadata.json
 *
 * 用法: BLOB_READ_WRITE_TOKEN=xxx node scripts/migrate-blob-data.js <admin-user-id>
 */

const BLOB_API = 'https://blob.vercel-storage.com';

const token = process.env.BLOB_READ_WRITE_TOKEN;
const adminUserId = process.argv[2];

if (!token) {
  console.error('❌ 请设置环境变量 BLOB_READ_WRITE_TOKEN');
  process.exit(1);
}
if (!adminUserId) {
  console.error('❌ 用法: node scripts/migrate-blob-data.js <admin-user-id>');
  console.error('   admin-user-id 从 Supabase Dashboard → Authentication → Users 获取');
  process.exit(1);
}

async function readBlob(path) {
  const listResp = await fetch(`${BLOB_API}?prefix=${encodeURIComponent(path)}&limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listResp.ok) return null;

  const { blobs } = await listResp.json();
  if (!blobs || blobs.length === 0) return null;

  const blobUrl = blobs[0].downloadUrl || blobs[0].url;
  const dataResp = await fetch(blobUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!dataResp.ok) return null;
  return await dataResp.json();
}

async function writeBlob(path, data) {
  const resp = await fetch(`${BLOB_API}/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-version': '7',
      'x-content-type': 'application/json',
      'x-add-random-suffix': 'false',
      'x-allow-overwrite': '1',
      'x-vercel-blob-access': 'private',
    },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`写入 ${path} 失败: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  return true;
}

async function migrate(oldPath, newPath, label) {
  console.log(`\n📦 迁移 ${label}...`);
  console.log(`   旧路径: ${oldPath}`);
  console.log(`   新路径: ${newPath}`);

  const data = await readBlob(oldPath);
  if (!data) {
    console.log(`   ⏭️  旧路径无数据，跳过`);
    return;
  }

  const existingNew = await readBlob(newPath);
  if (existingNew && existingNew.length > 0) {
    console.log(`   ⚠️  新路径已有 ${existingNew.length} 条数据，跳过（避免覆盖）`);
    return;
  }

  const count = Array.isArray(data) ? data.length : '?';
  console.log(`   📄 读取到 ${count} 条记录`);

  await writeBlob(newPath, data);
  console.log(`   ✅ 写入成功`);
}

async function main() {
  console.log('🚀 开始迁移 Blob 数据');
  console.log(`   管理员 userId: ${adminUserId}`);

  await migrate(
    'gallery/metadata.json',
    `gallery/${adminUserId}/metadata.json`,
    '图库 (Gallery)'
  );

  await migrate(
    'ref-library/metadata.json',
    `ref-library/${adminUserId}/metadata.json`,
    '参考图库 (Ref Library)'
  );

  console.log('\n🎉 迁移完成！');
  console.log('   旧数据保留未删除，确认新路径数据正常后可手动清理');
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message);
  process.exit(1);
});
