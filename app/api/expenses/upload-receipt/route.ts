import { cookies } from 'next/headers';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { MIN_EXPENSE_YEAR } from '@/lib/expenses-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Receipts go straight from the browser to Blob storage; this route only mints
 * the upload token and acknowledges completion. Posting the file through here
 * capped receipts at Vercel's 4.5MB request-body limit, which rejected photos
 * before the function ever ran (the browser got a non-JSON 413).
 */
export const MAX_RECEIPT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const RECEIPT_PATHNAME_PATTERN = /^expenses\/(\d{4})\/[a-zA-Z0-9._-]+$/;

const ALLOWED_CONTENT_TYPES = [
  'image/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export async function POST(request: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return errorResponse('BLOB_READ_WRITE_TOKEN is not configured', 500);
    }

    const body = (await request.json()) as HandleUploadBody;

    const result = await handleUpload({
      request,
      body,
      token,
      onBeforeGenerateToken: async (pathname) => {
        // Blob's completion callback carries a signature rather than the CRM
        // session cookie, so middleware lets this path through and the token
        // half of the handshake re-checks the session itself.
        const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
        if (!(await verifySessionToken(sessionToken))) {
          throw new Error('Unauthorized');
        }

        const match = RECEIPT_PATHNAME_PATTERN.exec(pathname);
        if (!match) {
          throw new Error('Invalid receipt path');
        }

        if (Number(match[1]) < MIN_EXPENSE_YEAR) {
          throw new Error(`Receipt year must be ${MIN_EXPENSE_YEAR} or later`);
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_RECEIPT_SIZE_BYTES,
          addRandomSuffix: true,
        };
      },
      // The browser already has the blob URL when upload() resolves and saves it
      // on the expense row, so there is nothing left to record here.
      onUploadCompleted: async () => {},
    });

    return jsonResponse(result);
  } catch (error) {
    console.error('Error preparing receipt upload:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload receipt';
    return errorResponse(message, message === 'Unauthorized' ? 401 : 400);
  }
}
