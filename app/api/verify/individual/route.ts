import { NextRequest, NextResponse } from 'next/server';

// Feature de verificação de descrições DESCONTINUADA (substituída pelo Google
// grounding). A EF verify-batch e as tabelas de score/claims foram removidas.
// Stub inerte mantido para não quebrar os callers (VerificationBadge).
// Ver docs/cleanup-verification-feature-removal.md
export async function POST(request: NextRequest) {
  const { description_id } = await request.json().catch(() => ({ description_id: null }));
  if (!description_id) {
    return NextResponse.json({ error: 'description_id is required' }, { status: 400 });
  }
  return NextResponse.json(
    { success: false, disabled: true, message: 'Verificação descontinuada (Google grounding).' },
    { status: 200 }
  );
}
