const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'
const FROM = process.env.RESEND_FROM_EMAIL || 'Renovo Surface Solutions <notifications@renovosurface.com>'
const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'Pngoy@renovosurface.com'

interface EmailAttachment {
  filename: string
  content: string // base64-encoded
}

interface SendEmailArgs {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
}

/**
 * Sends via Resend. If RESEND_API_KEY isn't set yet, logs instead of throwing so
 * the rest of the estimate/work-order flow keeps working during setup.
 * Returns false only on an actual Resend API failure (not on the no-key no-op),
 * so callers that need to know can alert someone instead of failing silently.
 */
export async function sendEmail({ to, subject, html, attachments }: SendEmailArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not set — skipping send. Would have emailed "${subject}" to ${to}`)
    return true
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html, ...(attachments?.length ? { attachments } : {}) }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`[email] Resend send failed (${res.status}): ${body}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[email] Resend send threw`, err)
    return false
  }
}

function wrapper(bodyHtml: string): string {
  return `
  <div style="font-family: Arial, sans-serif; background:#F5F8FC; padding:32px;">
    <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #E4EBF4;">
      <div style="background:#0D1F38; padding:24px; text-align:center;">
        <img src="${SITE_URL}/images/logo.png" alt="Renovo Surface Solutions" style="height:56px;">
      </div>
      <div style="padding:32px;">
        ${bodyHtml}
      </div>
      <div style="background:#F5F8FC; padding:16px; text-align:center; font-size:12px; color:#8A98AC;">
        Renovo Surface Solutions LLC &middot; 30 N Orange Street, Salt Lake City, UT 84116 &middot; 801-369-2330<br>
        <a href="${SITE_URL}/client/login.html" style="color:#8A98AC;">View all your documents in your account</a>
      </div>
    </div>
  </div>`
}

function button(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block; background:#1B7FE8; color:#ffffff; text-decoration:none; font-weight:bold; padding:14px 28px; border-radius:999px; margin-top:16px;">${label}</a>`
}

/**
 * The proposal, as a link and as a file.
 *
 * The link is how most clients will read it and how they accept. The
 * attachment is for the ones who cannot use a link: a procurement officer
 * forwarding a bid to a committee, or a portal that wants a document uploaded.
 * Sending only a link quietly excludes exactly the buyers worth winning.
 */
export async function sendEstimateToClient(
  clientEmail: string,
  clientName: string,
  token: string,
  pdf?: { filename: string; bytes: Uint8Array } | null,
) {
  const url = `${SITE_URL}/estimate.html?t=${token}`
  await sendEmail({
    to: clientEmail,
    subject: 'Your Proposal from Renovo Surface Solutions',
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Your proposal from Renovo Surface Solutions is ready. Click below to read the full scope and accept it whenever you're ready.</p>
      ${button('View Your Proposal', url)}
      ${pdf ? `<p style="color:#8A98AC; line-height:1.6; font-size:14px;">A PDF copy is attached for your records, or to forward to whoever needs it.</p>` : ''}
    `),
    attachments: pdf ? [{ filename: pdf.filename, content: Buffer.from(pdf.bytes).toString('base64') }] : undefined,
  })
}

export async function notifyAdminEstimateViewed(clientName: string, estimateId: number) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Estimate Viewed — ${clientName}`,
    html: wrapper(`<p style="color:#4A5A72;"><strong>${clientName}</strong> just viewed estimate #${estimateId}.</p>`),
  })
}

export async function notifyAdminEstimateApproved(clientName: string, estimateId: number) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `✅ Estimate Approved — ${clientName}`,
    html: wrapper(`<p style="color:#4A5A72;"><strong>${clientName}</strong> approved estimate #${estimateId}. Time to convert it to a work order and send it for signature.</p>`),
  })
}

export async function notifyAdminEstimateDeclined(clientName: string, estimateId: number) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Estimate — Changes Requested — ${clientName}`,
    html: wrapper(`<p style="color:#4A5A72;"><strong>${clientName}</strong> requested changes on estimate #${estimateId}.</p>`),
  })
}

export async function sendWorkOrderToClient(clientEmail: string, clientName: string, token: string): Promise<boolean> {
  const url = `${SITE_URL}/work-order.html?t=${token}`
  return sendEmail({
    to: clientEmail,
    subject: 'Work Order Ready for Your Signature',
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Your work order is ready. Please review and sign electronically so we can get started.</p>
      ${button('Review & Sign', url)}
    `),
  })
}

export async function sendInvoiceToClient(clientEmail: string, clientName: string, token: string, invoiceNumber: string, total: string, pdfBytes?: Uint8Array): Promise<boolean> {
  const url = `${SITE_URL}/invoice.html?t=${token}`
  return sendEmail({
    to: clientEmail,
    subject: `Invoice ${invoiceNumber} from Renovo Surface Solutions`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Invoice ${invoiceNumber} is ready — total due: <strong>${total}</strong>.</p>
      ${button('View Invoice', url)}
    `),
    attachments: pdfBytes ? [{ filename: `${invoiceNumber}.pdf`, content: Buffer.from(pdfBytes).toString('base64') }] : undefined,
  })
}

export async function sendReceiptToClient(clientEmail: string, clientName: string, invoiceNumber: string, total: string) {
  await sendEmail({
    to: clientEmail,
    subject: `Receipt — Invoice ${invoiceNumber} Paid`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Thanks, ${clientName}!</h2>
      <p style="color:#4A5A72; line-height:1.6;">We've recorded payment of <strong>${total}</strong> for invoice ${invoiceNumber}. This email is your receipt.</p>
    `),
  })
}

export async function notifyAdminInvoicePaid(clientName: string, invoiceNumber: string, total: string) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `💰 Invoice Paid — ${clientName} — ${total}`,
    html: wrapper(`<p style="color:#4A5A72;"><strong>${clientName}</strong> — invoice ${invoiceNumber} marked paid (${total}).</p>`),
  })
}

export async function sendPartialPaymentReceipt(clientEmail: string, clientName: string, invoiceNumber: string, amountPaid: string, balanceDue: string) {
  await sendEmail({
    to: clientEmail,
    subject: `Payment Received — Invoice ${invoiceNumber}`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Thanks, ${clientName}!</h2>
      <p style="color:#4A5A72; line-height:1.6;">We've recorded a payment of <strong>${amountPaid}</strong> toward invoice ${invoiceNumber}. Remaining balance due: <strong>${balanceDue}</strong>.</p>
    `),
  })
}

export async function notifyAdminPartialPaymentReceived(clientName: string, invoiceNumber: string, amountPaid: string, balanceDue: string) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `💵 Partial Payment Received — ${clientName} — ${amountPaid}`,
    html: wrapper(`<p style="color:#4A5A72;"><strong>${clientName}</strong> — invoice ${invoiceNumber}: payment of ${amountPaid} received, ${balanceDue} still due.</p>`),
  })
}

const REMINDER_COPY: Record<number, { subject: string; heading: string; body: string }> = {
  1: {
    subject: 'Friendly Reminder — Invoice {num} Due',
    heading: 'Just a friendly reminder',
    body: 'This is a quick reminder that invoice {num} for {total} is now past due. If you\'ve already sent payment, thank you — please disregard this message.',
  },
  2: {
    subject: 'Second Reminder — Invoice {num} Past Due',
    heading: 'Invoice still outstanding',
    body: 'Invoice {num} for {total} is now more than a week past due. Please arrange payment at your earliest convenience, or contact us if you have any questions.',
  },
  3: {
    subject: 'Final Notice — Invoice {num} Significantly Past Due',
    heading: 'Final notice',
    body: 'Invoice {num} for {total} is now more than two weeks past due. Please contact us right away at 801-369-2330 to arrange payment or discuss this invoice.',
  },
}

export async function sendOverdueReminder(clientEmail: string, clientName: string, token: string, invoiceNumber: string, total: string, stage: number) {
  const copy = REMINDER_COPY[stage]
  if (!copy) return
  const url = `${SITE_URL}/invoice.html?t=${token}`
  await sendEmail({
    to: clientEmail,
    subject: copy.subject.replace('{num}', invoiceNumber),
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">${copy.heading}</h2>
      <p style="color:#4A5A72; line-height:1.6;">Hi ${clientName}, ${copy.body.replace('{num}', invoiceNumber).replace(/{total}/g, total)}</p>
      ${button('View & Pay Invoice', url)}
    `),
  })
}

export async function notifyAdminInvoiceOverdue(clientName: string, invoiceNumber: string, total: string, daysOverdue: number) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `⚠️ Invoice ${daysOverdue}+ Days Overdue — ${clientName}`,
    html: wrapper(`<p style="color:#4A5A72;"><strong>${clientName}</strong> — invoice ${invoiceNumber} (${total}) is ${daysOverdue}+ days overdue. A reminder was just sent to the client.</p>`),
  })
}

export async function notifyAdminAutoChargeFailed(clientName: string, invoiceId: number, reason: string) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `⚠️ Auto-Charge Failed — ${clientName}`,
    html: wrapper(`
      <p style="color:#4A5A72;">The saved card on file for <strong>${clientName}</strong> failed on invoice #${invoiceId}.</p>
      <p style="color:#4A5A72;"><strong>Reason:</strong> ${reason}</p>
      <p style="color:#4A5A72;">The invoice email was still sent normally so the client can pay manually. You may want to follow up with them directly.</p>
    `),
  })
}

export async function notifyAdminEmailDeliveryFailed(clientName: string, clientEmail: string, whatFailed: string, link: string) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `⚠️ Email Delivery Failed — ${whatFailed} for ${clientName}`,
    html: wrapper(`
      <p style="color:#4A5A72;">The ${whatFailed} email to <strong>${clientName}</strong> (${clientEmail}) failed to send.</p>
      <p style="color:#4A5A72;">Please follow up directly — call, text, or forward this link: <a href="${link}" style="color:#1B7FE8;">${link}</a></p>
    `),
  })
}

export async function sendRecurringInvoiceToClient(clientEmail: string, clientName: string, token: string, invoiceNumber: string, total: string, description: string) {
  const url = `${SITE_URL}/invoice.html?t=${token}`
  await sendEmail({
    to: clientEmail,
    subject: `Invoice ${invoiceNumber} — ${description}`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Your recurring invoice for <strong>${description}</strong> is ready — total due: <strong>${total}</strong>.</p>
      ${button('View Invoice', url)}
    `),
  })
}

export async function sendSignedWorkOrderConfirmation(clientEmail: string, clientName: string, workOrderId: number) {
  const html = wrapper(`
    <h2 style="color:#0D1F38; margin-top:0;">Signed &amp; Confirmed</h2>
    <p style="color:#4A5A72; line-height:1.6;">Thanks, ${clientName} — work order #${workOrderId} has been signed and we're scheduling the work. We'll be in touch with next steps.</p>
  `)
  await sendEmail({ to: clientEmail, subject: 'Work Order Signed — Renovo Surface Solutions', html })
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `✅ Work Order Signed — ${clientName}`,
    html: wrapper(`<p style="color:#4A5A72;"><strong>${clientName}</strong> signed work order #${workOrderId}. Time to schedule the job.</p>`),
  })
}

export async function sendSubcontractorAgreementLink(subEmail: string, subName: string, token: string) {
  const url = `${SITE_URL}/subcontractor-agreement.html?t=${token}`
  await sendEmail({
    to: subEmail,
    subject: 'Subcontractor Agreement — Renovo Surface Solutions',
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${subName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Before your first job with Renovo Surface Solutions, please review and sign the subcontractor agreement below.</p>
      ${button('Review & Sign Agreement', url)}
    `),
  })
}

export async function sendClientLoginLink(clientEmail: string, clientName: string, magicLinkUrl: string) {
  await sendEmail({
    to: clientEmail,
    subject: 'Your Renovo Surface Solutions Login Link',
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Click below to view all your estimates, work orders, invoices, and contracts. This link expires in 15 minutes and can only be used once.</p>
      ${button('Log In to Your Account', magicLinkUrl)}
      <p style="color:#8A98AC; font-size:0.85rem; margin-top:16px;">If you didn't request this, you can safely ignore this email.</p>
    `),
  })
}

export async function notifyAdminFunctionError(functionName: string, message: string, requestInfo: string) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `⚠️ Server Error — ${functionName}`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Something broke</h2>
      <p style="color:#4A5A72;"><strong>${functionName}</strong> threw an unhandled error.</p>
      <p style="color:#4A5A72; font-size:0.85rem;">${requestInfo}</p>
      <pre style="white-space:pre-wrap; background:#F5F8FC; padding:12px; border-radius:8px; font-size:0.8rem; color:#B23A3A;">${message}</pre>
    `),
  })
}

export async function notifyAdminSubcontractorAgreementSigned(subName: string) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `✅ Subcontractor Agreement Signed — ${subName}`,
    html: wrapper(`<p style="color:#4A5A72;"><strong>${subName}</strong> signed their subcontractor agreement. They're cleared to start work.</p>`),
  })
}

/**
 * The client accepted, and the work order Renovo promised them did not get
 * created. The proposal page has already told them "we will contact you within
 * two hours", so this is a commitment made and not yet kept.
 *
 * Previously this failure only reached console.error, where nobody would ever
 * see it. The dashboard also surfaces these, so the alert missing does not mean
 * the job is lost.
 */
export async function notifyAdminWorkOrderCreationFailed(
  clientName: string,
  estimateId: number,
  reason: string,
) {
  const link = `${SITE_URL}/admin/estimate-detail.html?id=${estimateId}`
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `\u26A0\uFE0F ACTION NEEDED \u2014 work order not created for ${clientName}`,
    html: wrapper(`
      <p style="color:#4A5A72;"><strong>${clientName}</strong> accepted estimate #${estimateId}, but the work order could not be created automatically.</p>
      <p style="color:#4A5A72;">They have been told you will contact them within two hours, so this needs a hand now:
        open the estimate and use <strong>Convert to Work Order</strong>.</p>
      <p style="color:#4A5A72;"><a href="${link}" style="color:#1B7FE8;">${link}</a></p>
      <p style="color:#8A98AC; font-size:0.85rem;"><strong>Technical reason:</strong> ${reason}</p>
    `),
  })
}

/**
 * A change order sent for signature.
 *
 * Deliberately states the amount in the email body rather than only behind the
 * link. This is a request for more money than the client agreed to, and making
 * them click through to find out how much reads as though it is being hidden.
 */
export async function sendChangeOrderToClient(
  clientEmail: string,
  clientName: string,
  token: string,
  number: string,
  total: string,
  summary: string,
  pdf?: { filename: string; bytes: Uint8Array } | null,
): Promise<boolean> {
  const url = `${SITE_URL}/change-order.html?t=${token}`
  const isCredit = total.trim().startsWith('-')
  return sendEmail({
    to: clientEmail,
    subject: `${number} for your approval — ${isCredit ? 'credit' : 'additional work'}`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">
        We have run into something on your job that changes the scope, and we need your approval
        before we go any further.
      </p>
      <p style="color:#4A5A72; line-height:1.6; margin:0 0 4px;"><strong>${number}</strong></p>
      <p style="color:#4A5A72; line-height:1.6; margin:0 0 4px;">${summary}</p>
      <p style="color:#0D1F38; font-size:18px; font-weight:bold; margin:12px 0 0;">
        ${isCredit ? 'Credit' : 'Additional cost'}: ${total}
      </p>
      <p style="color:#4A5A72; line-height:1.6;">
        Nothing under this change order is done until you sign it. If you would rather talk it
        through first, call us on 801-369-2330.
      </p>
      ${button('Review & Sign', url)}
      ${pdf ? `<p style="color:#8A98AC; line-height:1.6; font-size:14px;">A PDF copy is attached, for your records or to send to whoever raises the purchase order.</p>` : ''}
    `),
    attachments: pdf ? [{ filename: pdf.filename, content: Buffer.from(pdf.bytes).toString('base64') }] : undefined,
  })
}

export async function notifyAdminChangeOrderSigned(clientName: string, number: string, total: string) {
  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `${number} approved by ${clientName}`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">${number} approved</h2>
      <p style="color:#4A5A72; line-height:1.6;">
        ${clientName} signed ${number} for ${total}. The revised contract sum is on the work order.
      </p>
    `),
  })
}

export async function notifyAdminChangeOrderDeclined(clientName: string, number: string, reason: string) {
  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `${number} declined by ${clientName}`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">${number} declined</h2>
      <p style="color:#4A5A72; line-height:1.6;">${clientName} turned down ${number}.</p>
      ${reason ? `<p style="color:#4A5A72; line-height:1.6;"><strong>What they said:</strong> ${reason}</p>` : ''}
      <p style="color:#4A5A72; line-height:1.6;">
        The crew should not do this work. If it has already started, stop and call them.
      </p>
    `),
  })
}
