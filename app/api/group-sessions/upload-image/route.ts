import { put } from '@vercel/blob';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export async function POST(request: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return errorResponse('BLOB_READ_WRITE_TOKEN is not configured', 500);
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return errorResponse('Image file is required', 400);
    }

    if (!file.type || !file.type.startsWith('image/')) {
      return errorResponse('Only image files are supported', 400);
    }

    if (file.size === 0) {
      return errorResponse('Image file is empty', 400);
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return errorResponse('Image file must be 8MB or smaller', 400);
    }

    const safeName = sanitizeFilename(file.name || 'group-session-image');
    const pathname = `group-sessions/${Date.now()}-${safeName}`;

    const blob = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: true,
      token,
    });

    return jsonResponse({
      url: blob.url,
      pathname: blob.pathname,
      download_url: blob.downloadUrl,
      content_type: blob.contentType,
      size: file.size,
      uploaded_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error uploading group session image:', error);
    return errorResponse('Failed to upload image');
  }
}
