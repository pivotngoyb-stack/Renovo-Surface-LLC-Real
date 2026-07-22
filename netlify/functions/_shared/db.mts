import { drizzle } from 'drizzle-orm/netlify-db'
import * as schema from '../../../db/schema'

export const db = drizzle()
export { schema }
