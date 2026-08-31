import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { notFound } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { buildProposalPdf, proposalFilename } from './_shared/proposalDocument.mts'

/**
 * The proposal as a downloadable PDF.
 *
 * Reachable with the proposal token and nothing else, exactly like the web
 * proposal it mirrors: the client already has the link, and requiring a login
 * to download the document they were sent would be absurd.
 *
 * Unlike the web route this does NOT mark the estimate viewed. A download is
 * not a read -- a procurement system fetching attachments would otherwise
 * report the buyer as having opened a bid nobody has looked at.
 */
export default withErrorHandling('proposal-pdf', async (request: Request, context: Context) => {
  const token = context.params.token
  const [estimate] = await db.select().from(schema.estimates).where(eq(schema.estimates.token, token)).limit(1)
  if (!estimate) return notFound()

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, estimate.clientId)).limit(1)

  const bytes = await buildProposalPdf(estimate, client || null)
  const filename = proposalFilename(estimate.id)

  // Attachment by default, because a procurement portal wants a file on disk.
  // ?view=1 renders it in the browser instead, for a client who would rather
  // read it than download it.
  const inline = new URL(request.url).searchParams.get('view') === '1'

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      // A proposal can be revised in place, so this must not be cached hard the
      // way an immutable photo is.
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  })
})

export const config = {
  path: '/api/proposal/:token/pdf',
}
