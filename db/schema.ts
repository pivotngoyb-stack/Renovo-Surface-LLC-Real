import { pgTable, serial, text, integer, numeric, timestamp, boolean, pgEnum, date } from 'drizzle-orm/pg-core'

export const estimateStatusEnum = pgEnum('estimate_status', ['draft', 'sent', 'viewed', 'approved', 'declined'])
export const workOrderStatusEnum = pgEnum('work_order_status', ['pending', 'signed'])
export const signatureTypeEnum = pgEnum('signature_type', ['drawn', 'typed'])
export const invoiceStatusEnum = pgEnum('invoice_status', ['unpaid', 'partially_paid', 'paid'])
export const contractStatusEnum = pgEnum('contract_status', ['active', 'paused', 'cancelled'])
export const paymentTypeEnum = pgEnum('payment_type', ['flat', 'percentage'])
export const subAgreementStatusEnum = pgEnum('sub_agreement_status', ['pending', 'signed'])
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'check', 'card', 'stripe', 'other'])
export const photoCategoryEnum = pgEnum('photo_category', ['before', 'after'])

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
})

export const workOrders = pgTable('work_orders', {
  id: serial('id').primaryKey(),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id),
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
  description: text('description').notNull(),
  amount: numeric('amount').notNull(),
  billingDay: integer('billing_day').notNull(),
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
