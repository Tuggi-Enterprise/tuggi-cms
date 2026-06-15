import { NextRequest, NextResponse } from 'next/server';

// Feature de verificação DESCONTINUADA (Google grounding). As tabelas de
// score/claims foram removidas; este endpoint retorna sempre "sem verificação"
// para manter o VerificationBadge funcionando inerte (mostra "não verificado").
// Ver docs/cleanup-verification-feature-removal.md
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { description_id, attraction_id } = body ?? {};
  if (!description_id && !attraction_id) {
    return NextResponse.json(
      { error: 'Either description_id or attraction_id is required' },
      { status: 400 }
    );
  }
  return NextResponse.json({
    verification_status: null,
    score: null,
    last_verified_at: null,
    is_original: false,
    language: null,
  });
}
