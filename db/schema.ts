import { pgTable, serial, text, integer, numeric, timestamp, boolean, pgEnum, date } from 'drizzle-orm/pg-core'

export const estimateStatusEnum = pgEnum('estimate_status', ['draft', 'sent', 'viewed', 'approved', 'declined'])
export const workOrderStatusEnum = pgEnum('work_order_status', ['pending', 'signed'])
export const signatureTypeEnum = pgEnum('signature_type', ['drawn', 'typed'])

export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  company: text('company'),
  propertyAddress: text('property_address'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const estimates = pgTable('estimates', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').notNull().references(() => clients.id),
  token: text('token').notNull().unique(),
  status: estimateStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),
  validUntil: date('valid_until'),
  viewedAt: timestamp('viewed_at'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const estimateLineItems = pgTable('estimate_line_items', {
  id: serial('id').primaryKey(),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  unitPrice: numeric('unit_price').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const workOrders = pgTable('work_orders', {
  id: serial('id').primaryKey(),
  estimateId: integer('estimate_id').notNull().references(() => estimates.id),
  token: text('token').notNull().unique(),
  termsText: text('terms_text').notNull(),
  status: workOrderStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const signatures = pgTable('signatures', {
  id: serial('id').primaryKey(),
  workOrderId: integer('work_order_id').notNull().references(() => workOrders.id),
  signerName: text('signer_name').notNull(),
  signatureType: signatureTypeEnum('signature_type').notNull(),
  signatureData: text('signature_data').notNull(),
  consentConfirmed: boolean('consent_confirmed').notNull(),
  ipAddress: text('ip_address'),
  signedAt: timestamp('signed_at').defaultNow().notNull(),
})
