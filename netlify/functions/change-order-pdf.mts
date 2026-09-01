import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import { db, schema } from './_shared/db.mts'
import { isAuthenticated } from './_shared/auth.mts'
import { notFound } from './_shared/http.mts'
import { withErrorHandling } from './_shared/errorHandler.mts'
import { buildChangeOrderPdf, changeOrderFilename } from './_shared/changeOrderDocument.mts'

/**
 * The change order as a downloadable file.
 *
 * Reachable with the change order token, like the web page it mirrors: the
 * client already has the link, and asking them to log in to download the
 * document they were sent would be absurd.
 *
 * A draft is not downloadable by a client, for the same reason it is not
 * readable by one -- it is Renovo still writing it. An admin can pull it to
 * check how it prints before sending.
 *
 * Downloading does not mark the change order viewed. A mail client or a
 * procurement system fetching the attachment would otherwise record the client
 * as having read something nobody has opened.
 */
export default withErrorHandling('change-order-pdf', async (request: Request, context: Context) => {
  const token = context.params.token
  const [changeOrder] = await db
    .select()
    .from(schema.changeOrders)
    .where(eq(schema.changeOrders.token, token))
    .limit(1)
  if (!changeOrder) return notFound()
  if (changeOrder.status === 'draft' && !isAuthenticated(request)) return notFound()

  const bytes = await buildChangeOrderPdf(changeOrder)
  const filename = changeOrderFilename(changeOrder.workOrderId, changeOrder.sequence)

  // Attachment by default, so it lands in a file where a client's own records
  // live. ?view=1 renders it in the browser for someone who would rather read.
  const inline = new URL(request.url).searchParams.get('view') === '1'

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      // A draft can still be edited, and an answered one gains a signature, so
      // this must not be cached the way an immutable file would be.
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  })
})

export const config = {
  path: '/api/change-order/:token/pdf',
}
