import { pgTable, serial, text, integer, numeric, timestamp, boolean, pgEnum, date } from 'drizzle-orm/pg-core'

export const estimateStatusEnum = pgEnum('estimate_status', ['draft', 'sent', 'viewed', 'approved', 'declined'])
// 'signed' is the client authorising a one-off job. 'completed' is a visit
// under a standing contract, which nobody signs each time -- the contract was
// the authorisation, and the visit is dispatch.
export const workOrderStatusEnum = pgEnum('work_order_status', ['pending', 'signed', 'completed'])
// An authorization is the document a client signs to approve a one-off job.
// A visit is one occurrence under a contract they already signed.
export const workOrderKindEnum = pgEnum('work_order_kind', ['authorization', 'visit'])
export const signatureTypeEnum = pgEnum('signature_type', ['drawn', 'typed'])
export const invoiceStatusEnum = pgEnum('invoice_status', ['unpaid', 'partially_paid', 'paid'])
export const contractStatusEnum = pgEnum('contract_status', ['active', 'paused', 'cancelled'])
export const paymentTypeEnum = pgEnum('payment_type', ['flat', 'percentage'])
export const subAgreementStatusEnum = pgEnum('sub_agreement_status', ['pending', 'signed'])
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'check', 'card', 'stripe', 'other'])
export const photoCategoryEnum = pgEnum('photo_category', ['before', 'after'])
// A project with a deposit bills twice: the deposit holds the crew, the
// balance falls due on completion. 'full' is everything else.
export const invoiceKindEnum = pgEnum('invoice_kind', ['full', 'deposit', 'balance'])
// A change order is sent, then either signed or turned down. Draft is the
// window in which Renovo can still fix the wording.
export const changeOrderStatusEnum = pgEnum('change_order_status', ['draft', 'sent', 'approved', 'declined'])

export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  company: text('company'),
  propertyAddress: text('property_address'),
  notes: text('notes'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const estimates = pgTable('estimates', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').notNull().references(() => clients.id),
  token: text('token').notNull().unique(),
  status: estimateStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),
  // The job's own name and address. On construction work the general
  // contractor is the client, but the site is what the proposal is about.
  projectName: text('project_name'),
  siteAddress: text('site_address'),
  // Evidence the price is grounded in an actual site visit.
  // Government solicitations need a different document shape: unit pricing,
  // base plus option years, a vendor registration block, and wage flags.
  bidMode: text('bid_mode').notNull().default('standard'),
  solicitationNumber: text('solicitation_number'),
  optionYears: integer('option_years').notNull().default(0),
  prevailingWage: boolean('prevailing_wage').notNull().default(false),
  // Percent of the total required up front to schedule the crew. Null means
  // no deposit. Percent rather than a fixed amount so it survives a scope
  // revision -- a $4,000 deposit on a job that grew to $12,000 is not a
  // deposit any more, it is a rounding error.
  depositPct: numeric('deposit_pct'),
  // The client's purchase order. Institutional buyers -- school districts,
  // hospitals, municipalities -- issue one before work starts, and their AP
  // department will not pay an invoice that does not quote it. Captured here
  // and carried to every document downstream, because the number the client
  // gave at acceptance is the number that has to appear on the invoice.
  poNumber: text('po_number'),
  walkthroughDate: date('walkthrough_date'),
  siteConditions: text('site_conditions'),
  validUntil: date('valid_until'),
  viewedAt: timestamp('viewed_at'),
  approvedAt: timestamp('approved_at'),
  taxApplied: boolean('tax_applied').notNull().default(false),
  taxAmount: numeric('tax_amount').notNull().default('0'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const estimateLineItems = pgTable('estimate_line_items', {
  id: serial('id').primaryKey(),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  unitPrice: numeric('unit_price').notNull(),
  // Unit of measure for this line: job, visit, sqft, hour, each.
  unit: text('unit').notNull().default('job'),
  // How often this line recurs. Drives annual contract value and the service
  // schedule matrix -- a weekly line and a monthly line at the same price are
  // not the same contract, and a bid that cannot say which is not comparable.
  frequency: text('frequency').notNull().default('one_time'),
  // Which property this line belongs to on a multi-site portfolio proposal.
  // Null on single-location work, which stays ungrouped.
  siteName: text('site_name'),
  sortOrder: integer('sort_order').notNull().default(0),
  // An alternate the client may accept or decline. Excluded from the base
  // total so the headline price stays comparable against competing bids.
  isOptional: boolean('is_optional').notNull().default(false),
  serviceType: text('service_type'),
  calculatorInputs: text('calculator_inputs'),
  basePrice: numeric('base_price'),
  finalPrice: numeric('final_price'),
  estimatedDurationHours: numeric('estimated_duration_hours'),
  estimatedProductCost: numeric('estimated_product_cost'),
  // Subcontracted work is costed against the sub's invoice, not Renovo's crew.
  // First-class columns rather than another key inside calculatorInputs,
  // because "which jobs did I sub out, and what did they cost me" is a real
  // query and a JSON text blob is the wrong place to answer it from.
  subcontracted: boolean('subcontracted').notNull().default(false),
  subcontractorCost: numeric('subcontractor_cost'),
  subcontractCoordinationPct: numeric('subcontract_coordination_pct'),
})

export const workOrders = pgTable('work_orders', {
  id: serial('id').primaryKey(),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id),
  // Set when this work order is one visit under a standing contract. Null on
  // a one-off job, which is authorised by the estimate alone.
  recurringContractId: integer('recurring_contract_id').references(() => recurringContracts.id),
  // Which visit this is in the contract's run, 1-based. Gives the crew and the
  // client a stable reference ("visit 14") that a date alone does not when a
  // visit gets moved.
  visitSequence: integer('visit_sequence'),
  kind: workOrderKindEnum('kind').notNull().default('authorization'),
  token: text('token').notNull().unique(),
  termsText: text('terms_text').notNull(),
  status: workOrderStatusEnum('status').notNull().default('pending'),
  // When the crew is booked to be on site. Nullable: a work order exists from
  // the moment an estimate is approved, which is usually before it is booked.
  scheduledDate: date('scheduled_date'),
  // Local start time as 'HH:MM'. Kept separate from the date so an unscheduled
  // or all-day job does not have to invent a time, and so after-hours work
  // (floor care especially) can carry a real start without timezone guesswork.
  scheduledStart: text('scheduled_start'),
  // When the work was actually finished. This is what makes a service history
  // real rather than a list of documents.
  completedAt: timestamp('completed_at'),
  // What the job actually took. Everything upstream is an estimate; without
  // this the profitability report can only ever grade its own homework, and a
  // production rate that is wrong stays wrong because nothing contradicts it.
  actualHours: numeric('actual_hours'),
  actualCrewSize: integer('actual_crew_size'),
  actualHoursNote: text('actual_hours_note'),
  // What the chemicals and consumables actually cost on this job. Hours were
  // the bigger lever, but a job that burns three times the degreaser is a job
  // whose chemical model is wrong, and nothing else would ever say so.
  actualMaterialsCost: numeric('actual_materials_cost'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const signatures = pgTable('signatures', {
  id: serial('id').primaryKey(),
  workOrderId: integer('work_order_id').notNull().references(() => workOrders.id),
  signerName: text('signer_name').notNull(),
  signatureType: signatureTypeEnum('signature_type').notNull(),
  signatureData: text('signature_data').notNull(),
  consentConfirmed: boolean('consent_confirmed').notNull(),
  termsAgreed: boolean('terms_agreed').notNull().default(false),
  serviceTypeShown: text('service_type_shown'),
  ipAddress: text('ip_address'),
  signedAt: timestamp('signed_at').defaultNow().notNull(),
})

export const recurringContracts = pgTable('recurring_contracts', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').notNull().references(() => clients.id),
  // The estimate this contract was sold on, when it came from one. Null for a
  // contract typed straight into the contracts page. Without it there is no way
  // to tell that a quoted weekly job already has billing set up, and no way for
  // the profitability report to find the invoices a contract actually raised.
  estimateId: integer('estimate_id').references(() => estimates.id),
  description: text('description').notNull(),
  amount: numeric('amount').notNull(),
  billingDay: integer('billing_day').notNull(),
  // A blanket PO covering the contract term. Institutional clients issue one
  // per fiscal year rather than one per invoice, so it lives on the contract
  // and every invoice raised under it inherits the number.
  poNumber: text('po_number'),
  // How often the crew is on site. Distinct from billingDay, which is when the
  // client is charged: a weekly contract billed monthly has four visits behind
  // one invoice. Without this a contract cannot say what work it owes.
  visitFrequency: text('visit_frequency').notNull().default('monthly'),
  status: contractStatusEnum('status').notNull().default('active'),
  lastBilledAt: timestamp('last_billed_at'),
  autoChargeEnabled: boolean('auto_charge_enabled').notNull().default(false),
  stripePaymentMethodId: text('stripe_payment_method_id'),
  cardBrand: text('card_brand'),
  cardLast4: text('card_last4'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').notNull().references(() => clients.id),
  workOrderId: integer('work_order_id').references(() => workOrders.id),
  recurringContractId: integer('recurring_contract_id').references(() => recurringContracts.id),
  token: text('token').notNull().unique(),
  status: invoiceStatusEnum('status').notNull().default('unpaid'),
  notes: text('notes'),
  dueDate: date('due_date'),
  taxApplied: boolean('tax_applied').notNull().default(false),
  taxAmount: numeric('tax_amount').notNull().default('0'),
  kind: invoiceKindEnum('kind').notNull().default('full'),
  // Copied forward from the estimate or the contract when the invoice is
  // raised, and editable after -- a PO can be amended, or issued late, and an
  // invoice already sent may need the new number before AP will release it.
  poNumber: text('po_number'),
  reminderStage: integer('reminder_stage').notNull().default(0),
  lastReminderSentAt: timestamp('last_reminder_sent_at'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  paidAt: timestamp('paid_at'),
})

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  unitPrice: numeric('unit_price').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const invoicePayments = pgTable('invoice_payments', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id),
  amount: numeric('amount').notNull(),
  method: paymentMethodEnum('method').notNull(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const subcontractorAgreements = pgTable('subcontractor_agreements', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  subcontractorName: text('subcontractor_name').notNull(),
  subcontractorPhone: text('subcontractor_phone').notNull(),
  subcontractorEmail: text('subcontractor_email'),
  paymentType: paymentTypeEnum('payment_type').notNull(),
  paymentAmount: numeric('payment_amount'),
  paymentPercentage: numeric('payment_percentage'),
  status: subAgreementStatusEnum('status').notNull().default('pending'),
  signerName: text('signer_name'),
  signatureType: signatureTypeEnum('signature_type'),
  signatureData: text('signature_data'),
  consentConfirmed: boolean('consent_confirmed').notNull().default(false),
  ipAddress: text('ip_address'),
  signedAt: timestamp('signed_at'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const subcontractorPayments = pgTable('subcontractor_payments', {
  id: serial('id').primaryKey(),
  subcontractorAgreementId: integer('subcontractor_agreement_id').notNull().references(() => subcontractorAgreements.id),
  amount: numeric('amount').notNull(),
  method: paymentMethodEnum('method').notNull(),
  paidDate: date('paid_date').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const loginAttempts = pgTable('login_attempts', {
  id: serial('id').primaryKey(),
  key: text('key').notNull(),
  attemptedAt: timestamp('attempted_at').defaultNow().notNull(),
})

export const workOrderPhotos = pgTable('work_order_photos', {
  id: serial('id').primaryKey(),
  workOrderId: integer('work_order_id').notNull().references(() => workOrders.id),
  token: text('token').notNull().unique(),
  blobKey: text('blob_key').notNull(),
  category: photoCategoryEnum('category').notNull(),
  caption: text('caption'),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
})

/**
 * Walk-through photos attached to an estimate, shown on the client proposal.
 *
 * Deliberately a separate table from workOrderPhotos rather than a polymorphic
 * owner column. These are a different artifact: a walk-through photo documents
 * the condition a price was based on, and it is published to a prospect who has
 * not bought anything yet. Job photos are before/after evidence on work already
 * sold. Sharing one table would have meant making work_order_id nullable on a
 * table that already holds live rows, to save a handful of duplicated columns.
 */
/**
 * A client signing acceptance of a proposal.
 *
 * Kept separate from the work-order signatures table for the same reason the
 * photos are: that table has work_order_id NOT NULL and holds live rows, and
 * making it nullable to save a handful of duplicated columns is not worth
 * touching a legally significant record for.
 *
 * The proposal already printed 'Accepted by (signature)' while the web page
 * offered only a button. This is what makes the two agree.
 */
export const estimateSignatures = pgTable('estimate_signatures', {
  id: serial('id').primaryKey(),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id),
  signerName: text('signer_name').notNull(),
  signerTitle: text('signer_title'),
  signatureType: signatureTypeEnum('signature_type').notNull(),
  signatureData: text('signature_data').notNull(),
  consentConfirmed: boolean('consent_confirmed').notNull().default(false),
  ipAddress: text('ip_address'),
  signedAt: timestamp('signed_at').defaultNow().notNull(),
})

export const estimatePhotos = pgTable('estimate_photos', {
  id: serial('id').primaryKey(),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id),
  token: text('token').notNull().unique(),
  blobKey: text('blob_key').notNull(),
  caption: text('caption'),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
})

/**
 * A signed amendment to a work order already in progress.
 *
 * Scope grows on almost every job of any size -- a floor strips down to a
 * substrate that needs a second pass, a client adds two restrooms while the
 * crew is on site. Without a document for it there are only two options, and
 * both are bad: absorb the cost, or put a line on the final invoice that the
 * client never agreed to. The second is where disputes come from.
 *
 * Amounts may be negative. Scope shrinks too, and a change order that can only
 * add is a document Renovo would quietly avoid using on the jobs where it is
 * most needed.
 *
 * Signature columns are inline rather than a separate table. The work order and
 * the proposal both keep theirs apart, but only because those tables already
 * held live rows when signing was added. This one is new, so the record can sit
 * where it belongs.
 */
export const changeOrders = pgTable('change_orders', {
  id: serial('id').primaryKey(),
  /*
   * What this change order amends: exactly one of these is set.
   *
   * A one-off job is amended through its work order. A standing contract has
   * no work order to hang off -- adding a floor to a weekly route changes the
   * agreement itself, and the visits underneath it are dispatch, not the thing
   * being renegotiated. Nullable rather than a second table because everything
   * else about the document is identical: the same lines, the same signature,
   * the same refusal to bill until it is signed.
   */
  workOrderId: integer('work_order_id').references(() => workOrders.id),
  recurringContractId: integer('recurring_contract_id').references(() => recurringContracts.id),
  // 1-based within whatever it amends. What the client and the crew call it,
  // and what the invoice line has to cite: "Change Order #2".
  sequence: integer('sequence').notNull(),
  token: text('token').notNull().unique(),
  status: changeOrderStatusEnum('status').notNull().default('draft'),
  // What changed and, separately, why. The reason is what makes this defensible
  // a year later: "client requested" and "condition found on site" are very
  // different conversations, and the document should not blur them.
  description: text('description').notNull(),
  reason: text('reason'),
  // A change order frequently needs its own PO amendment; AP will reject the
  // extra against the original number.
  poNumber: text('po_number'),
  /*
   * The monthly amount the contract becomes, on a contract change order.
   *
   * Stored rather than derived at approval. The client signs a document naming
   * a figure, and that figure is what must take effect -- recomputing it later
   * against a contract that has moved in the meantime would bill them something
   * they never agreed to. Null on a work order change order, which changes a
   * job total rather than a standing rate.
   */
  newMonthlyAmount: numeric('new_monthly_amount'),
  // Days added to the schedule, if any. A change that adds work usually adds
  // time, and a client who signed for the extra cost but not the extra day is
  // still going to be surprised.
  scheduleImpactDays: integer('schedule_impact_days').notNull().default(0),
  signerName: text('signer_name'),
  signerTitle: text('signer_title'),
  signatureType: signatureTypeEnum('signature_type'),
  signatureData: text('signature_data'),
  consentConfirmed: boolean('consent_confirmed').notNull().default(false),
  ipAddress: text('ip_address'),
  declineReason: text('decline_reason'),
  sentAt: timestamp('sent_at'),
  viewedAt: timestamp('viewed_at'),
  respondedAt: timestamp('responded_at'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const changeOrderLineItems = pgTable('change_order_line_items', {
  id: serial('id').primaryKey(),
  changeOrderId: integer('change_order_id').notNull().references(() => changeOrders.id),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  unitPrice: numeric('unit_price').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})
