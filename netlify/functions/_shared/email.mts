const SITE_URL = process.env.SITE_URL || 'https://renovosurface.com'
const FROM = process.env.RESEND_FROM_EMAIL || 'Renovo Surface Solutions <notifications@renovosurface.com>'
const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'Pngoy@renovosurface.com'

interface SendEmailArgs {
  to: string
  subject: string
  html: string
}

/**
 * Sends via Resend. If RESEND_API_KEY isn't set yet, logs instead of throwing so
 * the rest of the estimate/work-order flow keeps working during setup.
 */
export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not set — skipping send. Would have emailed "${subject}" to ${to}`)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[email] Resend send failed (${res.status}): ${body}`)
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
        Renovo Surface Solutions LLC &middot; 30 N Orange Street, Salt Lake City, UT 84116 &middot; 801-369-2330
      </div>
    </div>
  </div>`
}

function button(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block; background:#1B7FE8; color:#ffffff; text-decoration:none; font-weight:bold; padding:14px 28px; border-radius:999px; margin-top:16px;">${label}</a>`
}

export async function sendEstimateToClient(clientEmail: string, clientName: string, token: string) {
  const url = `${SITE_URL}/estimate.html?t=${token}`
  await sendEmail({
    to: clientEmail,
    subject: 'Your Estimate from Renovo Surface Solutions',
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Your estimate from Renovo Surface Solutions is ready to view. Click below to see the details and approve it whenever you're ready.</p>
      ${button('View Your Estimate', url)}
    `),
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

export async function sendWorkOrderToClient(clientEmail: string, clientName: string, token: string) {
  const url = `${SITE_URL}/work-order.html?t=${token}`
  await sendEmail({
    to: clientEmail,
    subject: 'Work Order Ready for Your Signature',
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Your work order is ready. Please review and sign electronically so we can get started.</p>
      ${button('Review & Sign', url)}
    `),
  })
}

export async function sendInvoiceToClient(clientEmail: string, clientName: string, token: string, invoiceNumber: string, total: string) {
  const url = `${SITE_URL}/invoice.html?t=${token}`
  await sendEmail({
    to: clientEmail,
    subject: `Invoice ${invoiceNumber} from Renovo Surface Solutions`,
    html: wrapper(`
      <h2 style="color:#0D1F38; margin-top:0;">Hi ${clientName},</h2>
      <p style="color:#4A5A72; line-height:1.6;">Invoice ${invoiceNumber} is ready — total due: <strong>${total}</strong>.</p>
      ${button('View Invoice', url)}
    `),
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
