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
