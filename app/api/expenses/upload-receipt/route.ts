import { put } from '@vercel/blob';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { MIN_EXPENSE_YEAR, normalizeExpenseYear } from '@/lib/expenses-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const OFFICE_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function isSupportedReceiptType(contentType: string): boolean {
  return (
    contentType.startsWith('image/') ||
    contentType === 'application/pdf' ||
    OFFICE_MIME_TYPES.has(contentType)
  );
}

export async function POST(request: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return errorResponse('BLOB_READ_WRITE_TOKEN is not configured', 500);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const requestedYear = formData.get('year');
    const year = normalizeExpenseYear(
      typeof requestedYear === 'string' ? requestedYear : undefined
    );

    if (!(file instanceof File)) {
      return errorResponse('Receipt file is required', 400);
    }

    if (!file.name || file.size === 0) {
      return errorResponse('Receipt file is empty', 400);
    }

    if (file.size > MAX_RECEIPT_SIZE_BYTES) {
      return errorResponse('Receipt file must be 10MB or smaller', 400);
    }

    if (!file.type || !isSupportedReceiptType(file.type)) {
      return errorResponse(
        'Supported receipt types: images, PDF, and Office docs (Word/Excel/PowerPoint)',
        400
      );
    }

    if (year < MIN_EXPENSE_YEAR) {
      return errorResponse(`Receipt year must be ${MIN_EXPENSE_YEAR} or later`, 400);
    }

    const safeName = sanitizeFilename(file.name);
    const pathname = `expenses/${year}/${Date.now()}-${safeName}`;

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
    console.error('Error uploading receipt:', error);
    return errorResponse('Failed to upload receipt');
  }
}
