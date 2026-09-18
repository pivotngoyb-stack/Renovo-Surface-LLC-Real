/**
 * Job Plan engine -- turns an already-priced work order into an executable
 * field plan: crew size, chemical quantities, tools, a phased timeline, water
 * volume, and runoff-compliance requirements.
 *
 * INTERNAL ONLY. Nothing in here is ever served from a public token route. The
 * sole caller is /api/admin/work-orders/:id/job-plan, which is session-gated,
 * so none of this reaches the client-facing work order page.
 *
 * Labor time is deliberately NOT recomputed here -- it is read from the value
 * the pricing calculator already stored on each line item. A second time model
 * would drift from the first, and you would quote three hours while planning
 * five. The plan consumes the quote's number so the two can never disagree.
 *
 * Every default below is an industry figure with its source noted. They assume
 * a mid-size commercial kit and are deliberately conservative.
 */

/* ---------- shop defaults (industry values, no per-shop config yet) ---------- */

/** Hot-water belt-drive unit. GPM drives both production rate and water use. */
const MACHINE_GPM = 5.5

/** Fraction of on-site time the trigger is actually pulled, per service. The
 *  rest is setup, chemical application, dwell and recovery -- none of which
 *  consume water. Services absent from this map use no pressurized water. */
const TRIGGER_FRACTION_BY_SERVICE: Record<string, number> = {
  pressureWashing: 0.7,
  dumpsterPad: 0.7,
  graffitiRemoval: 0.2,
  canopyWashing: 0.6,
  fuelIsland: 0.65,
}

/** Max techs that can productively work a job at once, capped by equipment.
 *  A second tech does not halve a floor-care job when you own one buffer. */
const MAX_PARALLEL: Record<string, number> = {
  pressureWashing: 2,
  windowCleaning: 3,
  janitorial: 4,
  floorCare: 2,
  dumpsterPad: 2,
  lotSweeping: 1,
  disinfection: 2,
  // Gutter work parallelises poorly: one tech on the ladder, one footing it.
  gutterCleaning: 2,
  // Sealer must go down wet-edge in one pass, so a second applicator helps
  // only on large slabs -- and never more than two.
  concreteSealing: 2,
  graffitiRemoval: 2,
  // Construction cleanup is the one service that genuinely scales with bodies:
  // an empty building, no client operations to work around, and independent
  // areas. Crew size is limited by supervision, not by equipment.
  constructionRough: 6,
  constructionProgress: 3,
  constructionFinal: 8,
  constructionTouchup: 4,
  // One lift, one operator, one ground hand. A fourth body has nowhere to go.
  canopyWashing: 3,
  fuelIsland: 2,
  carpetExtraction: 2,
  tileGrout: 2,
  ventCleaning: 3,
  // A house fits two or three cleaners before they are working in each
  // other's way; an empty move-out takes a fourth.
  houseCleaning: 3,
  deepCleaning: 3,
  moveOutCleaning: 4,
}

/** Target on-site window before we add a second tech. */
const TARGET_WINDOW_HOURS = 8

/** Concentrate cost per gallon, used for the plan-vs-quote margin check. */
const CHEM_COST_PER_GAL: Record<string, number> = {
  'Sodium hypochlorite 12.5%': 4,
  'Soft wash surfactant': 25,
  'Butyl/citrus degreaser': 22,
  'Enzyme odor neutralizer': 28,
  'Floor stripper': 30,
  'Floor finish (20% solids)': 45,
  'Neutral floor cleaner': 18,
  'Restroom disinfectant': 24,
  'Glass cleaner': 12,
  'EPA List N disinfectant': 30,
  'Concrete sealer': 35,
  'Graffiti remover gel': 60,
  'Poultice powder': 30,
  'Anti-graffiti sacrificial coating': 55,
  'Heavy-duty all-purpose cleaner': 16,
  'Glass cleaner concentrate': 14,
  'Adhesive / label remover': 34,
  'Neutral pH floor cleaner': 18,
  'Carpet pre-spray': 22,
  'Carpet extraction detergent': 20,
  'Tile & grout cleaner (alkaline)': 24,
  'Penetrating grout sealer': 42,
  'Oil absorbent (granular)': 15,
}

/* ---------- types ---------- */

export interface LineItemLike {
  description: string
  serviceType: string | null
  calculatorInputs: string | null
  estimatedDurationHours: string | number | null
  estimatedProductCost: string | number | null
  isOptional?: boolean | null
}

export interface ChemicalNeed {
  product: string
  purpose: string
  dilution: string
  mixedGallons: number
  concentrateGallons: number
  waterGallons: number
  dwellMinutes: number
  cost: number
  caution?: string
}

export interface Phase {
  label: string
  minutes: number
}

export interface ComplianceItem {
  level: 'critical' | 'standard'
  requirement: string
  detail: string
}

/** One room's worth of the crew checklist. */
export interface ChecklistArea {
  area: string
  items: string[]
}

export interface JobPlan {
  services: string[]
  laborHours: number
  crew: { techs: number; hoursEach: number; rationale: string }
  phases: Phase[]
  onSiteHours: number
  chemicals: ChemicalNeed[]
  equipment: string[]
  ppe: string[]
  water: { gallons: number; note: string }
  compliance: ComplianceItem[]
  weather: string[]
  costCheck: {
    plannedChemicalCost: number
    quotedProductCost: number
    delta: number
    status: 'ok' | 'over'
  }
  /**
   * Room by room, what a finished clean has to include. Homes only for now:
   * a house is judged by whether the list was done, and a cleaner working
   * alone, or a sub on their first visit, has nobody else to ask.
   */
  checklist: ChecklistArea[]
  /** Things the crew standing on site needs to know. Safe to hand out. */
  warnings: string[]
  /**
   * Things only the office needs to know, because they are about money.
   *
   * Kept apart from `warnings` rather than filtered out downstream: a filter
   * that matches on wording stops matching the day somebody rewords the
   * warning, and then the margin goes out on a crew link without anyone
   * noticing. Split at the source, a new office-only warning is withheld by
   * default -- it has to be deliberately moved to be exposed.
   */
  internalWarnings: string[]
}

/* ---------- helpers ---------- */

const n = (v: unknown, fallback = 0): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}

const round = (x: number, places = 2): number => {
  const f = 10 ** places
  return Math.round(x * f) / f
}

/** Round up to a quarter gallon -- you cannot buy 0.37 of a jug. */
const purchaseGallons = (x: number): number => Math.ceil(x * 4) / 4

function parseInputs(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const SERVICE_LABELS: Record<string, string> = {
  pressureWashing: 'Pressure Washing',
  windowCleaning: 'Window Cleaning',
  janitorial: 'Janitorial',
  floorCare: 'Floor Care',
  dumpsterPad: 'Dumpster Pad',
  lotSweeping: 'Lot Sweeping',
  disinfection: 'Disinfection',
  gutterCleaning: 'Gutter Cleaning',
  concreteSealing: 'Concrete Sealing',
  graffitiRemoval: 'Graffiti Removal',
  constructionRough: 'Construction Cleanup — Rough',
  constructionProgress: 'Construction Cleanup — Progress',
  constructionFinal: 'Construction Cleanup — Final',
  constructionTouchup: 'Construction Cleanup — Touch-Up',
  canopyWashing: 'Canopy & Column Washing',
  fuelIsland: 'Fuel Island Service',
  carpetExtraction: 'Carpet Cleaning',
  tileGrout: 'Tile & Grout Cleaning',
  ventCleaning: 'Vent & Diffuser Cleaning',
  houseCleaning: 'House Cleaning',
  deepCleaning: 'Deep Cleaning',
  moveOutCleaning: 'Move-In / Move-Out Cleaning',
}

/** Cleaning somebody's home, as opposed to a building. */
export const HOME_SERVICES = new Set(['houseCleaning', 'deepCleaning', 'moveOutCleaning'])

/* ---------- chemical models ---------- */

function chem(
  product: string,
  purpose: string,
  dilution: string,
  mixedGallons: number,
  concentrateGallons: number,
  dwellMinutes: number,
  caution?: string
): ChemicalNeed {
  const buy = purchaseGallons(concentrateGallons)
  return {
    product,
    purpose,
    dilution,
    mixedGallons: round(mixedGallons, 1),
    concentrateGallons: buy,
    waterGallons: round(Math.max(mixedGallons - concentrateGallons, 0), 1),
    dwellMinutes,
    cost: round(buy * (CHEM_COST_PER_GAL[product] ?? 0)),
    caution,
  }
}

function chemicalsFor(service: string, inputs: Record<string, string>): ChemicalNeed[] {
  switch (service) {
    case 'pressureWashing': {
      const sqft = n(inputs.pw_sqft)
      const contamination = n(inputs.pw_contamination, 1)
      if (sqft <= 0) return []

      // Heavy grease and petroleum: degreaser only. Sodium hypochlorite does
      // not cut oil, and putting it on a fuel-stained forecourt just creates a
      // runoff problem without cleaning anything.
      if (contamination >= 1.5) {
        const mixed = sqft / 250 // ~250 sqft per mixed gallon on heavy soil
        return [
          chem(
            'Butyl/citrus degreaser',
            'Cut petroleum and grease film',
            '1:4 concentrate to water',
            mixed,
            mixed / 5,
            15,
            'Never substitute sodium hypochlorite here -- it will not lift oil and worsens the runoff profile.'
          ),
        ]
      }

      // Organic soiling (algae, mildew, general grime): standard soft wash.
      const mixed = sqft / 300 // ~300 sqft per mixed gallon downstreamed
      return [
        chem(
          'Sodium hypochlorite 12.5%',
          'Kill algae, mildew and organic staining',
          '1:3 concentrate to water (~3% solution)',
          mixed,
          mixed / 4,
          10
        ),
        chem(
          'Soft wash surfactant',
          'Cling and dwell on vertical or sloped surfaces',
          '2 oz per mixed gallon (~1% of batch)',
          mixed,
          (mixed * 2) / 128,
          0
        ),
      ]
    }

    case 'dumpsterPad': {
      const count = Math.max(n(inputs.dp_count, 1), 1)
      const out = [
        chem(
          'Butyl/citrus degreaser',
          'Break down compacted grease and biological load',
          '1:4 concentrate to water',
          count * 4,
          (count * 4) / 5,
          15,
          'Grease-laden wash water is process wastewater. It cannot reach a storm drain.'
        ),
      ]
      if (inputs.dp_odor === 'yes') {
        out.push(
          chem(
            'Enzyme odor neutralizer',
            'Digest residual organics causing odor',
            '1:32 concentrate to water',
            count * 1,
            count / 32,
            0
          )
        )
      }
      return out
    }

    case 'floorCare': {
      const sqft = n(inputs.fc_sqft)
      if (sqft <= 0) return []
      const rate = n((inputs.fc_serviceType || '').split('|')[0], 0.35)
      const isStrip = rate >= 0.6

      if (isStrip) {
        // ~1 gallon of diluted stripper per 100 sqft, mixed 4-8 oz/gal (6 avg).
        const stripperMixed = sqft / 100
        const coats = 4 // 3-5 recommended; 4 is the durable middle
        const finishGallons = (sqft / 2000) * coats
        return [
          chem(
            'Floor stripper',
            'Dissolve existing finish down to bare tile',
            '6 oz per gallon of water',
            stripperMixed,
            (stripperMixed * 6) / 128,
            20,
            'Stripper slurry goes to a mop sink or sanitary drain. Never outside, never a storm drain.'
          ),
          chem(
            'Floor finish (20% solids)',
            `Rebuild gloss -- ${coats} coats at ~2,000 sqft per gallon per coat`,
            'Ready to use, do not dilute',
            finishGallons,
            finishGallons,
            30
          ),
        ]
      }

      const finishGallons = (sqft / 2000) * 2
      return [
        chem('Neutral floor cleaner', 'Scrub prep before recoat', '1:64 concentrate to water', sqft / 3000, sqft / 3000 / 64, 0),
        chem('Floor finish (20% solids)', 'Recoat -- 2 coats', 'Ready to use, do not dilute', finishGallons, finishGallons, 30),
      ]
    }

    case 'janitorial': {
      const sqft = n(inputs.jan_sqft)
      const restrooms = n(inputs.jan_restrooms)
      const mop = sqft / 3000
      const out: ChemicalNeed[] = []
      if (mop > 0) out.push(chem('Neutral floor cleaner', 'Hard-floor mopping solution', '1:64 concentrate to water', mop, mop / 64, 0))
      if (restrooms > 0) {
        out.push(
          chem(
            'Restroom disinfectant',
            `Fixture and touchpoint sanitizing -- ${restrooms} restroom(s)`,
            '1:64 concentrate to water',
            restrooms * 0.5,
            (restrooms * 0.5) / 64,
            10
          )
        )
      }
      out.push(chem('Glass cleaner', 'Interior glass and mirrors', 'Ready to use', 0.25, 0.25, 0))
      return out
    }

    case 'disinfection': {
      const sqft = n(inputs.di_sqft)
      if (sqft <= 0) return []
      // Electrostatic application covers roughly 3,000 sqft per mixed gallon.
      const mixed = sqft / 3000
      return [
        chem(
          'EPA List N disinfectant',
          'Registered kill claim on hard surfaces',
          '1:64 concentrate to water',
          mixed,
          mixed / 64,
          10,
          'Observe the full label dwell time -- the kill claim is void if the surface dries early.'
        ),
      ]
    }

    case 'windowCleaning': {
      const panes = n(inputs.wc_panes)
      if (panes <= 0) return []
      // One ~3 gal bucket of solution covers roughly 100 panes, and it takes
      // about an ounce of concentrate to charge it. Glass work is labor, not
      // chemical -- the concentrate figure here is deliberately tiny.
      const buckets = panes / 100
      return [chem('Glass cleaner', 'Squeegee solution', '1 oz per 3 gal bucket', buckets * 3, (buckets * 1) / 128, 0)]
    }

    case 'canopyWashing': {
      const sqft = n(inputs.cw_sqft)
      const columns = n(inputs.cw_columns)
      if (sqft <= 0) return []
      const mixed = sqft / 220 // overhead work uses more solution than flatwork
      return [
        chem('Butyl/citrus degreaser', 'Cut petroleum film from the canopy underside', '1:4 concentrate to water', mixed, mixed / 5, 10,
          'Overhead application means it comes back down. Full face protection, and never work under an unmasked island.'),
        chem('Heavy-duty all-purpose cleaner', `Fascia panels and ${columns} columns`, '1:20 concentrate to water', columns * 0.5, (columns * 0.5) / 20, 0),
      ]
    }

    case 'fuelIsland': {
      const islands = Math.max(n(inputs.fi_islands), 1)
      const out: ChemicalNeed[] = [
        chem('Butyl/citrus degreaser', `Island and pump surround degreasing -- ${islands} island(s)`, '1:4 concentrate to water', islands * 3, (islands * 3) / 5, 15,
          'Fuel-contaminated wash water is process wastewater. Contain and recover every drop.'),
      ]
      if (inputs.fi_spill === 'yes') {
        out.push(chem('Oil absorbent (granular)', 'Fuel spill treatment and pickup', 'Applied dry', 1, 1, 0,
          'Used absorbent is contaminated waste. Bag it and dispose lawfully -- it does not go in the site dumpster.'))
      }
      return out
    }

    case 'carpetExtraction': {
      const sqft = n(inputs.ce_sqft)
      if (sqft <= 0) return []
      const soil = n(inputs.ce_soil, 1)
      return [
        chem('Carpet pre-spray', 'Traffic-lane pre-treatment before extraction', '1:32 concentrate to water', (sqft / 1000) * soil, ((sqft / 1000) * soil) / 32, 10,
          'Pre-spray must not dry on the fibre. Work in sections small enough to extract before it flashes off.'),
        chem('Carpet extraction detergent', 'In-tank cleaning solution', '1:64 concentrate to water', sqft / 800, (sqft / 800) / 64, 0),
      ]
    }

    case 'tileGrout': {
      const sqft = n(inputs.tg_sqft)
      if (sqft <= 0) return []
      const out: ChemicalNeed[] = [
        chem('Tile & grout cleaner (alkaline)', 'Break down grease and soil in the grout line', '1:8 concentrate to water', sqft / 300, (sqft / 300) / 8, 10),
      ]
      if (inputs.tg_seal === 'yes') {
        out.push(chem('Penetrating grout sealer', 'Resist future staining in cleaned grout', 'Ready to use', sqft / 350, sqft / 350, 60,
          'Grout must be fully dry before sealing. Sealing damp grout traps moisture and clouds the line permanently.'))
      }
      return out
    }

    case 'ventCleaning': {
      const vents = Math.max(n(inputs.vc_vents), 1)
      return [
        chem('Heavy-duty all-purpose cleaner', `Wash ${vents} grille(s) and wipe collars`, '1:20 concentrate to water', vents * 0.08, (vents * 0.08) / 20, 0),
      ]
    }

    case 'constructionRough': {
      const sqft = n(inputs.xr_sqft)
      if (sqft <= 0) return []
      // Rough clean is mostly hauling. The only real consumable is the wet
      // method used to keep concrete dust down -- see the silica note below.
      return [
        chem('Heavy-duty all-purpose cleaner', 'Knock down gross soil on hard surfaces', '1:20 concentrate to water', sqft / 3000, sqft / 3000 / 20, 0,
          'Do NOT dry sweep concrete. Wet the surface or use HEPA vacuuming -- dry sweeping silica dust is an OSHA violation where those methods are feasible.'),
      ]
    }

    case 'constructionProgress': {
      const sqft = n(inputs.xp_sqft)
      const restrooms = n(inputs.xp_restrooms)
      const out: ChemicalNeed[] = []
      if (sqft > 0) out.push(chem('Heavy-duty all-purpose cleaner', 'Spot cleaning in active work areas', '1:20 concentrate to water', sqft / 6000, sqft / 6000 / 20, 0))
      if (restrooms > 0) out.push(chem('Restroom disinfectant', `Site restroom servicing -- ${restrooms} unit(s)`, '1:64 concentrate to water', restrooms * 0.4, (restrooms * 0.4) / 64, 10))
      return out
    }

    case 'constructionFinal': {
      const sqft = n(inputs.xf_sqft)
      const restrooms = n(inputs.xf_restrooms)
      if (sqft <= 0) return []
      const out: ChemicalNeed[] = [
        chem('Heavy-duty all-purpose cleaner', 'Detail clean of casework, frames, doors and fixtures', '1:20 concentrate to water', sqft / 1500, sqft / 1500 / 20, 0),
        chem('Glass cleaner concentrate', 'Interior glass, mirrors, tracks and sills', '1:64 concentrate to water', sqft / 2500, sqft / 2500 / 64, 0),
        chem('Adhesive / label remover', 'Manufacturer labels, stickers and adhesive on glass and fixtures', 'Ready to use', Math.max(sqft / 12000, 0.25), Math.max(sqft / 12000, 0.25), 5,
          'Test on one pane first. The wrong solvent hazes coated or low-E glass, and that is a replacement, not a re-clean.'),
        chem('Neutral pH floor cleaner', 'Final damp mop or auto-scrub on finished floors', '1:64 concentrate to water', sqft / 2000, sqft / 2000 / 64, 0),
      ]
      if (restrooms > 0) {
        out.push(chem('Restroom disinfectant', `Full sanitize and stock -- ${restrooms} restroom(s)`, '1:64 concentrate to water', restrooms * 0.75, (restrooms * 0.75) / 64, 10))
      }
      return out
    }

    case 'constructionTouchup': {
      const sqft = n(inputs.xt_sqft)
      if (sqft <= 0) return []
      return [
        chem('Glass cleaner concentrate', 'De-smudge glass, mirrors and hardware', '1:64 concentrate to water', sqft / 4000, sqft / 4000 / 64, 0),
        chem('Heavy-duty all-purpose cleaner', 'Re-dust and spot-clean surfaces disturbed by punch work', '1:20 concentrate to water', sqft / 5000, sqft / 5000 / 20, 0),
      ]
    }

    case 'gutterCleaning':
      // Intentionally empty. Gutter work is hand labor and a hose -- adding a
      // chemical line here would just put a cost on the plan that no one buys.
      return []

    case 'concreteSealing': {
      const sqft = n(inputs.cs_sqft)
      if (sqft <= 0) return []
      const coverage = n((inputs.cs_sealerType || '').split('|')[0], 200)
      const coats = n(inputs.cs_coats, 1)
      const porosity = n(inputs.cs_porosity, 1)
      // Must match the estimate calculator exactly: first coat at the bare-slab
      // rate, later coats at 70% because the surface is already partly sealed.
      const gallons = (sqft / coverage) * porosity * (1 + 0.7 * (coats - 1))
      return [
        chem(
          'Concrete sealer',
          `${coats} coat(s) at ~${coverage} sqft per gallon`,
          'Ready to use, do not dilute',
          gallons,
          gallons,
          coats > 1 ? 90 : 0,
          'Slab must be clean AND bone dry -- sealing over trapped moisture clouds the finish and can delaminate. Allow 24 hours after any washing. Foot traffic at 4-6 hrs, vehicles at 24-48 hrs, full cure 72 hrs.'
        ),
      ]
    }

    case 'graffitiRemoval': {
      const sqft = n(inputs.gr_sqft)
      if (sqft <= 0) return []
      const surface = n(inputs.gr_surface, 1)
      const severity = n(inputs.gr_severity, 1)
      const out: ChemicalNeed[] = [
        chem(
          'Graffiti remover gel',
          'Lift paint without etching the substrate',
          'Ready to use, brush on',
          Math.max(sqft / 150, 0.25) * severity,
          Math.max(sqft / 150, 0.25) * severity,
          15,
          'Always test a small patch first. Aggressive removers can ghost or etch masonry, and the damage costs more than the tag did.'
        ),
      ]
      // Porous stone and bare concrete need a poultice to draw pigment back
      // out of the pores -- surface remover alone just spreads it.
      if (surface >= 1.8) {
        out.push(
          chem(
            'Poultice powder',
            'Draw pigment out of porous stone or bare concrete',
            'Mix to a peanut-butter paste with the remover',
            sqft / 100,
            sqft / 100,
            240,
            'Poultice needs hours of dwell under plastic. Plan a return visit rather than waiting on site.'
          )
        )
      }
      if (inputs.gr_sealAfter === 'yes') {
        out.push(
          chem('Anti-graffiti sacrificial coating', 'Make the next tag wash off', 'Ready to use', sqft / 200, sqft / 200, 60)
        )
      }
      return out
    }

    default:
      return []
  }
}

/* ---------- equipment, PPE, compliance ---------- */

const EQUIPMENT: Record<string, string[]> = {
  pressureWashing: [
    `Hot-water pressure washer (${MACHINE_GPM} GPM / 3,500+ PSI)`,
    '20-24" surface cleaner',
    'Downstream injector + chemical hose',
    '150 ft pressure hose, 50 ft extension',
    '15° and 40° tips, turbo nozzle',
  ],
  dumpsterPad: [
    // Deliberately the same strings as pressureWashing so a combined job lists
    // one machine and one surface cleaner, not two of each.
    `Hot-water pressure washer (${MACHINE_GPM} GPM / 3,500+ PSI)`,
    '20-24" surface cleaner',
    'Stiff deck brush for pre-agitation',
    'Wet vacuum + berm kit for recovery',
  ],
  floorCare: [
    '20" swing machine (low speed) with strip pads',
    'Wet vacuum and mop bucket set',
    'Doodlebug and edging tools',
    'Finish mop + fresh microfiber flat mop head',
    '"Wet Floor" signage and door barricades',
  ],
  janitorial: [
    'Vacuum, mop bucket and wringer',
    'Microfiber cloth set (color-coded by area)',
    'Restroom caddy and bowl tools',
    'Trash liners and cart',
  ],
  windowCleaning: ['Squeegees (6", 12", 18")', 'Scrubber/strip washer', 'Extension pole', 'Ladder or water-fed pole', 'Detail towels'],
  lotSweeping: ['Backpack blower', 'Push broom and flat shovel', 'Contractor bags', 'Traffic cones'],
  disinfection: ['Electrostatic sprayer', 'Backup pump sprayer', 'Surface dwell timer', 'Re-entry signage'],
  gutterCleaning: [
    'Extension ladder with standoff stabilizer',
    'Gutter scoop and hand tools',
    'Backpack blower',
    'Garden hose + downspout flush attachment',
    'Debris tarps and contractor bags',
    'Ladder-level base or leveler',
  ],
  concreteSealing: [
    'Low-pressure chemical sprayer (solvent-rated)',
    'Back-roller / microfiber applicator on pole',
    'Edging brush and cut-in tools',
    'Concrete moisture meter',
    'Barricades, cones and caution tape for the cure window',
  ],
  canopyWashing: [
    'Scissor or boom lift rated for the canopy height',
    `Hot-water pressure washer (${MACHINE_GPM} GPM / 3,500+ PSI)`,
    'Downstream injector and extension wand',
    'Wash-water containment mats and wet vacuum',
    'Cones and barrier tape to close the islands beneath',
  ],
  fuelIsland: [
    `Hot-water pressure washer (${MACHINE_GPM} GPM / 3,500+ PSI)`,
    'Surface cleaner and detail wand',
    'Storm drain covers and containment berm',
    'Wet vacuum for recovery',
    'Absorbent granules and contaminated-waste bags',
  ],
  carpetExtraction: [
    'Truck-mount or portable hot-water extractor',
    'Rotary or cylindrical agitation machine',
    'Pre-spray applicator',
    'Air movers',
    'Furniture blocks and corner guards',
  ],
  tileGrout: [
    'Pressurised spinner tool with simultaneous extraction',
    'Hot-water extractor',
    'Grout brushes and hand detail tools',
    'Sealer applicator with fine tip',
    'Wet-floor signage',
  ],
  ventCleaning: [
    'Step ladder or scissor lift by ceiling height',
    'HEPA vacuum with brush attachments',
    'Grille wash tubs and drying racks',
    'Drop cloths for floor and furniture protection',
  ],
  constructionRough: [
    'HEPA-filtered vacuums (silica-rated)',
    'Flat-bed carts and debris barrels',
    'Contractor bags, brooms, flat shovels, scrapers',
    'Pump sprayer for wet-method dust control',
    'Freight elevator protection / floor runners',
  ],
  constructionProgress: [
    'HEPA-filtered vacuum and broom kit',
    'Debris barrels and contractor bags',
    'Restroom service caddy',
    'Wet-floor and egress signage',
  ],
  constructionFinal: [
    'HEPA-filtered vacuums',
    'Auto-scrubber or microfiber flat-mop system (per finish)',
    'Extension poles, ladders, and detail brushes',
    'Squeegees, scrapers and plastic razor blades for glass',
    'Microfiber cloth set, colour-coded by area',
    'Ladder or lift for high vents and light fixtures',
  ],
  constructionTouchup: [
    'Microfiber cloth set and glass kit',
    'Cordless vacuum for spot work',
    'Restroom service caddy',
  ],
  graffitiRemoval: [
    'Hot-water pressure washer with LOW-pressure tips (masonry safe)',
    'Soft and medium nylon brushes',
    'Plastic sheeting and trowel for poultice work',
    'Containment tarps and wet vacuum for recovery',
    'Test-patch kit',
  ],
  // The same strings across the three, so a deep clean and a recurring clean
  // on one quote list one vacuum, not two.
  houseCleaning: [
    'Backpack or upright vacuum with a hard-floor setting',
    'Microfiber cloths, color-coded: kitchen, bathroom, dusting, glass',
    'Flat mop with clean pads',
    'Caddy: all-purpose cleaner, bathroom disinfectant, glass cleaner, scrub brushes',
    'Trash liners',
    'Two-step stool',
  ],
  deepCleaning: [
    'Backpack or upright vacuum with a hard-floor setting',
    'Microfiber cloths, color-coded: kitchen, bathroom, dusting, glass',
    'Flat mop with clean pads',
    'Caddy: all-purpose cleaner, bathroom disinfectant, glass cleaner, scrub brushes',
    'Trash liners',
    'Two-step stool',
    'Grout brush and detail brushes',
    'Hard-water and soap-scum remover',
    'Degreaser for the range hood and filter',
    'Extension duster for fans and vents',
  ],
  moveOutCleaning: [
    'Backpack or upright vacuum with a hard-floor setting',
    'Microfiber cloths, color-coded: kitchen, bathroom, dusting, glass',
    'Flat mop with clean pads',
    'Caddy: all-purpose cleaner, bathroom disinfectant, glass cleaner, scrub brushes',
    'Trash liners',
    'Two-step stool',
    'Grout brush and detail brushes',
    'Hard-water and soap-scum remover',
    'Degreaser for the range hood and filter',
    'Extension duster for fans and vents',
    'Oven cleaner and a plastic scraper',
    'Squeegee and scrubber for interior windows',
  ],
}

const PPE: Record<string, string[]> = {
  pressureWashing: ['Chemical-splash goggles', 'Nitrile gloves', 'Waterproof boots', 'Hearing protection'],
  dumpsterPad: ['Chemical-splash goggles', 'Nitrile gloves', 'Waterproof boots', 'N95 (biological load)'],
  floorCare: ['Chemical-splash goggles', 'Nitrile gloves', 'Non-slip boots', 'Knee pads'],
  janitorial: ['Nitrile gloves', 'Safety glasses for chemical decanting'],
  windowCleaning: ['Safety glasses', 'Cut-resistant gloves', 'Fall protection above 6 ft'],
  lotSweeping: ['Hi-vis vest', 'Safety glasses', 'Dust mask', 'Hearing protection'],
  disinfection: ['Respirator per product label', 'Chemical-splash goggles', 'Nitrile gloves'],
  gutterCleaning: ['Fall-protection harness and anchor above 6 ft', 'Cut-resistant gloves (screws and sheet-metal edges)', 'Safety glasses', 'Hard hat'],
  concreteSealing: ['Organic-vapor respirator (solvent-borne sealer)', 'Chemical-splash goggles', 'Nitrile gloves', 'Non-slip boots'],
  canopyWashing: ['Fall-protection harness in the lift', 'Full face shield (overhead chemical)', 'Chemical-resistant gloves', 'Hard hat', 'Waterproof boots'],
  fuelIsland: ['Chemical-splash goggles', 'Nitrile gloves', 'Waterproof boots', 'Hi-vis vest (live forecourt)'],
  carpetExtraction: ['Nitrile gloves', 'Safety glasses for chemical decanting', 'Non-slip footwear'],
  tileGrout: ['Chemical-splash goggles', 'Chemical-resistant gloves', 'Non-slip boots', 'Knee pads'],
  ventCleaning: ['N95 respirator (settled dust)', 'Safety glasses', 'Nitrile gloves'],
  constructionRough: ['N95 or P100 respirator (respirable silica)', 'Safety glasses', 'Cut-resistant gloves', 'Steel-toe boots', 'Hard hat and hi-vis vest (active site)'],
  constructionProgress: ['N95 respirator', 'Safety glasses', 'Cut-resistant gloves', 'Steel-toe boots', 'Hard hat and hi-vis vest (active site)'],
  constructionFinal: ['N95 respirator (residual dust)', 'Safety glasses', 'Nitrile gloves', 'Non-slip footwear', 'Knee pads'],
  constructionTouchup: ['Safety glasses', 'Nitrile gloves', 'Non-slip footwear'],
  graffitiRemoval: ['Organic-vapor respirator with N95 pre-filter', 'Tyvek coverall', 'Viton or PVC chemical gloves', 'Face shield over goggles'],
  houseCleaning: ['Nitrile gloves', 'Shoe covers, or shoes worn indoors only'],
  deepCleaning: ['Nitrile gloves', 'Shoe covers, or shoes worn indoors only', 'Safety glasses for overhead dusting and spraying'],
  moveOutCleaning: ['Nitrile gloves', 'Shoe covers, or shoes worn indoors only', 'Safety glasses for overhead dusting and spraying', 'Mask rated for the oven cleaner in use (see its label)'],
}

/*
 * Rules for working in somebody's home. The storm-drain and SDS defaults below
 * are written for a forecourt; inside a house, what goes wrong is a door left
 * open, a mixed chemical, and a broken vase nobody mentioned.
 */
const HOME_RULES: ComplianceItem[] = [
  {
    level: 'critical',
    requirement: 'Never leave the home unlocked or the alarm off',
    detail: 'Lock every door you came in through and set the alarm if there is one. If a code does not work, call the office before you leave -- never walk away from an open house.',
  },
  {
    level: 'critical',
    requirement: 'Never mix bleach with ammonia or acid cleaners',
    detail: 'Bleach with an ammonia glass cleaner, or with a toilet-bowl acid, makes a toxic gas. One product per surface, and rinse before switching.',
  },
  {
    level: 'standard',
    requirement: 'Photograph damage before you start',
    detail: 'Anything already broken, stained or scratched: photograph it on arrival, so the record shows it was there before us.',
  },
  {
    level: 'standard',
    requirement: 'Report breakage the same day',
    detail: 'If something breaks, stop, photograph it, and call the office before you leave. The client hears it from us, not finds it.',
  },
  {
    level: 'standard',
    requirement: 'Rooms marked off-limits stay off-limits',
    detail: 'If the home notes say a room is not to be entered, do not enter it, even to vacuum the doorway.',
  },
]

function complianceFor(service: string, inputs: Record<string, string>): ComplianceItem[] {
  if (HOME_SERVICES.has(service)) return HOME_RULES
  const contamination = n(inputs.pw_contamination, 1)
  const jobType = inputs.pw_jobType || ''
  const petroleum = service === 'pressureWashing' && (contamination >= 1.5 || /gas station|parking/i.test(jobType))

  if (petroleum || service === 'dumpsterPad') {
    return [
      {
        level: 'critical',
        requirement: 'Contain and recover ALL wash water -- no storm drain discharge',
        detail:
          'Petroleum and grease make this runoff process wastewater under the Clean Water Act. Section 301 prohibits discharging it to a storm drain, and penalties run as high as $50,000 per day. Berm the area, vacuum-recover the water, and dispose to a sanitary sewer with the operator\'s permission -- or evaporate under berm.',
      },
      { level: 'standard', requirement: 'Storm drain covers/mats staged before the first drop of water', detail: 'Cover every inlet inside the wash footprint and downhill of it.' },
      { level: 'standard', requirement: 'SDS on truck for every chemical listed above', detail: 'Required on site and on request.' },
    ]
  }

  if (service === 'floorCare') {
    return [
      { level: 'critical', requirement: 'Stripper slurry to mop sink / sanitary drain only', detail: 'Finish and stripper solids must never reach an exterior or storm drain.' },
      { level: 'standard', requirement: 'Wet-floor signage and access control for full cure', detail: 'Floor stays closed until the last coat cures.' },
    ]
  }

  if (service === 'graffitiRemoval') {
    return [
      {
        level: 'critical',
        requirement: 'Contain and recover ALL wash water -- no storm drain discharge',
        detail:
          'Rinse water here carries dissolved paint solids and solvent. That is process wastewater under the Clean Water Act, and Section 301 prohibits discharging it to a storm drain -- penalties reach $50,000 per day. Tarp and berm the work area, vacuum-recover, and dispose to sanitary sewer with permission.',
      },
      {
        level: 'critical',
        requirement: 'Test patch before touching the full area',
        detail: 'Confirm the remover does not ghost, etch or discolour this substrate. On historic or porous masonry the wrong product does permanent damage that costs far more than the graffiti.',
      },
      { level: 'standard', requirement: 'Respirator fit and solvent ventilation', detail: 'Organic-vapor cartridges, and no enclosed alcove work without airflow.' },
    ]
  }

  if (service === 'concreteSealing') {
    return [
      { level: 'critical', requirement: 'Slab must be clean and fully dry before sealer goes down', detail: 'Sealing over trapped moisture clouds the finish and can delaminate the whole application. Allow 24 hours after any washing, and confirm with a moisture meter.' },
      { level: 'critical', requirement: 'Barricade the area through the cure window', detail: 'Foot traffic at 4-6 hrs, vehicle traffic at 24-48 hrs, full cure 72 hrs. Early traffic prints the finish permanently.' },
      { level: 'standard', requirement: 'Check the product VOC rating against local limits', detail: 'Solvent-borne sealers are restricted in some jurisdictions.' },
    ]
  }

  if (service === 'canopyWashing' || service === 'fuelIsland') {
    return [
      {
        level: 'critical',
        requirement: 'Contain and recover ALL wash water -- no storm drain discharge',
        detail:
          'Fuel-contaminated runoff is process wastewater under the Clean Water Act. Section 301 prohibits discharging it to a storm drain and penalties reach $50,000 per day. Cover every inlet, berm the area, vacuum-recover, and dispose to sanitary sewer with the operator\u2019s written permission.',
      },
      {
        level: 'critical',
        requirement: 'Islands out of service before work begins -- never work over a live dispenser',
        detail: 'Cone and tape the affected islands and confirm shutdown with the site manager. No work proceeds during a fuel delivery.',
      },
      ...(service === 'canopyWashing' ? [{
        level: 'critical' as const,
        requirement: 'Fall protection in the lift, every time it leaves the ground',
        detail: 'Harness clipped to the manufacturer anchor. Check ground bearing and overhead clearance before elevating.',
      }] : []),
      { level: 'standard' as const, requirement: 'No electrical work inside canopy light fixtures', detail: 'Wash around them. Lamp and ballast work is a licensed trade.' },
      { level: 'standard' as const, requirement: 'SDS on site for every chemical carried', detail: 'Fuel retailers audit this on arrival.' },
    ]
  }

  if (service === 'tileGrout' || service === 'carpetExtraction') {
    return [
      { level: 'critical', requirement: 'Extracted water to a sanitary drain, never outside', detail: 'Recovered solution carries detergent and soil. A mop sink or approved drain only.' },
      { level: 'standard', requirement: 'Wet-floor signage and access control until dry', detail: 'Carpet takes 4-8 hours; sealed grout needs its full cure. Slip claims start here.' },
      { level: 'standard', requirement: 'Test an inconspicuous area first', detail: 'Confirm colourfastness on carpet and that the cleaner does not etch the tile finish.' },
    ]
  }

  if (service === 'ventCleaning') {
    return [
      { level: 'critical', requirement: 'HVAC shut down for the zone being serviced', detail: 'Removing a live register pulls loosened dust straight into the occupied space and the return.' },
      { level: 'standard', requirement: 'Protect floors and furniture below every opening', detail: 'What comes off a return grille is years of settled dust.' },
      { level: 'standard', requirement: 'Report any mould or moisture rather than cleaning it', detail: 'Visible growth is a remediation scope Renovo does not hold.' },
    ]
  }

  if (service === 'constructionRough' || service === 'constructionProgress' || service === 'constructionFinal' || service === 'constructionTouchup') {
    const active = service === 'constructionRough' || service === 'constructionProgress'
    return [
      {
        level: 'critical',
        requirement: 'No dry sweeping of concrete or drywall dust — wet method or HEPA vacuum only',
        detail:
          'OSHA 29 CFR 1926.1153 restricts respirable crystalline silica exposure. Dry sweeping concrete dust where wetting or HEPA vacuuming is feasible is a citable violation, and the dust is the single largest health exposure on a construction cleanup. Wet the surface or use a silica-rated HEPA vacuum, every time.',
      },
      ...(active ? [{
        level: 'critical' as const,
        requirement: 'Active jobsite — hard hat, hi-vis, steel-toe, and the GC\u2019s site orientation',
        detail: 'Other trades are working overhead and around us. Sign in with the superintendent, follow the site safety plan, and never enter a barricaded or tagged-out area.',
      }] : []),
      { level: 'standard' as const, requirement: 'Debris to the GC container or a licensed hauler only', detail: 'No construction debris in client or municipal waste. Regulated waste (solvents, adhesives, batteries, sealant tubes) is never ours to remove.' },
      { level: 'standard' as const, requirement: 'Protect finished surfaces before working above them', detail: 'Floor runners and covers go down before high work. A scratched finished floor at handover is a chargeback.' },
      { level: 'standard' as const, requirement: 'SDS on site for every chemical carried', detail: 'GCs audit this. Keep the binder in the truck.' },
    ]
  }

  if (service === 'gutterCleaning') {
    return [
      { level: 'critical', requirement: 'Fall protection above 6 ft -- harness and anchor, no exceptions', detail: 'Ladder work is the single highest-injury task on this list. Set the ladder at a 4:1 pitch, tie off, and never work from the top two rungs.' },
      { level: 'standard', requirement: 'Bag gutter debris -- do not flush it to the storm drain', detail: 'Organic sludge and roof grit count as a discharge. Bag it and haul it out.' },
      { level: 'standard', requirement: 'Spot power lines before raising a ladder', detail: 'Check the service drop at every access point.' },
    ]
  }

  return [
    { level: 'standard', requirement: 'Keep wash/rinse water out of storm drains', detail: 'Even clean-looking rinse water counts as a discharge if it carries detergent.' },
    { level: 'standard', requirement: 'SDS available on site', detail: 'For every chemical carried on the truck.' },
  ]
}

function weatherFor(services: string[]): string[] {
  const out: string[] = []
  if (services.includes('pressureWashing') || services.includes('dumpsterPad') || services.includes('lotSweeping')) {
    out.push('Do not wash below 40°F -- surfaces glaze and lines can freeze. Salt Lake City hits this from roughly November through March.')
    out.push('Sodium hypochlorite loses strength fast in direct sun and heat. Mix on site, use within the shift, keep the batch shaded.')
    out.push('Wind above ~15 mph makes overspray control and containment unreliable.')
  }
  if (services.includes('windowCleaning')) out.push('Avoid direct sun on glass -- solution flashes off and streaks before the squeegee lands.')
  if (services.includes('floorCare')) out.push('High humidity extends finish cure time; plan longer between coats.')
  if (services.includes('canopyWashing')) {
    out.push('No lift work in wind above ~20 mph. A canopy deck at 20 feet is the worst place on the site to be caught by a gust.')
  }
  if (services.includes('carpetExtraction')) {
    out.push('Humidity drives dry time. Without HVAC or air movers, 4-8 hours becomes overnight and the client finds damp carpet in the morning.')
  }
  if (services.some(s => s.startsWith('construction'))) {
    out.push('Unconditioned building: in winter, water left on concrete freezes and in summer it flashes off before it can be mopped. Confirm permanent HVAC is running before the final clean.')
    out.push('Site power and lighting must be live for a final clean. Temporary lighting hides dust that the owner walkthrough will not.')
  }
  if (services.includes('gutterCleaning')) {
    out.push('No ladder work in wind above ~20 mph, on ice, or during active precipitation.')
    out.push('Frozen debris will not scoop. If the gutters are iced, reschedule rather than chipping at them.')
  }
  if (services.includes('concreteSealing')) {
    out.push('Sealer applies between 50°F and 90°F only. Outside that window it will not film or cure correctly.')
    out.push('No rain within 24 hours of application -- check the forecast before mixing, not after.')
    out.push('Slab must be dry through, not just surface-dry. Allow 24 hours after any pressure washing.')
  }
  if (services.includes('graffitiRemoval')) {
    out.push('Removers work slower in cold. Below ~50°F expect longer dwell and a second application.')
    out.push('Direct sun dries gel remover before it can work -- shade the wall or work the shaded side first.')
  }
  return out
}

/** Combine repeats of the same product into a single purchase line. */
function mergeChemicals(items: ChemicalNeed[]): ChemicalNeed[] {
  const byProduct = new Map<string, ChemicalNeed>()
  for (const item of items) {
    const existing = byProduct.get(item.product)
    if (!existing) {
      byProduct.set(item.product, { ...item })
      continue
    }
    const purposes = new Set([...existing.purpose.split(' + '), ...item.purpose.split(' + ')])
    const cautions = new Set([existing.caution, item.caution].filter(Boolean) as string[])
    existing.purpose = [...purposes].join(' + ')
    existing.mixedGallons = round(existing.mixedGallons + item.mixedGallons, 1)
    // Re-round the summed concentrate so the purchase figure stays on a
    // quarter-gallon boundary rather than the sum of two rounded numbers.
    existing.concentrateGallons = purchaseGallons(existing.concentrateGallons + item.concentrateGallons)
    existing.waterGallons = round(existing.waterGallons + item.waterGallons, 1)
    existing.dwellMinutes = Math.max(existing.dwellMinutes, item.dwellMinutes)
    existing.cost = round(existing.concentrateGallons * (CHEM_COST_PER_GAL[existing.product] ?? 0))
    existing.caution = cautions.size ? [...cautions].join(' ') : undefined
  }
  return [...byProduct.values()]
}

/* ---------- homes: the checklist and the order of work ---------- */

/*
 * The crew's version of the scope library's home entries. Same content, a
 * different reader: the client's list says what they get, this one says what
 * to do, in the words a cleaner uses standing in the room.
 *
 * Each clean is the one before it plus its own layer, as the proposal says:
 * a deep clean is a standard clean plus detail work, a move-out a deep clean
 * plus the insides of everything.
 */
const HOME_CHECKLIST: Record<string, ChecklistArea[]> = {
  houseCleaning: [
    { area: 'Kitchen', items: ['Counters and backsplash', 'Sink and faucet, polished', 'Stovetop', 'Outside of hood, oven, dishwasher and fridge', 'Inside the microwave', 'Cabinet fronts, spots', 'Table and chairs'] },
    { area: 'Bathrooms', items: ['Toilet: inside, outside and around the base', 'Tub, shower and tile', 'Glass shower door', 'Sink, vanity and fixtures', 'Mirror, streak-free'] },
    { area: 'Bedrooms and living areas', items: ['Dust high to low: furniture tops, shelves, sills, frames, lamps, electronics', 'Beds made (fresh linens if left out)', 'Light switches and door handles'] },
    { area: 'Whole home', items: ['Cobwebs', 'Trash emptied, new liners', 'Carpets and rugs vacuumed', 'Hard floors vacuumed, then mopped'] },
  ],
  deepCleaning: [
    { area: 'Kitchen', items: ['Cabinet fronts degreased', 'Range hood and filter', 'Small appliances wiped'] },
    { area: 'Bathrooms', items: ['Soap scum and hard water off glass, tile and fixtures', 'Shower grout scrubbed'] },
    { area: 'Whole home', items: ['Baseboards hand-wiped', 'Door frames, doors and trim', 'Blinds, slat by slat', 'Window sills and tracks', 'Vent covers and return grilles', 'Ceiling fans and light fixtures in reach', 'Behind and under furniture one person can move'] },
  ],
  moveOutCleaning: [
    { area: 'Kitchen', items: ['Inside every cabinet and drawer', 'Inside the oven', 'Inside the fridge and freezer', 'Inside the dishwasher'] },
    { area: 'Bathrooms', items: ['Inside cabinets and drawers'] },
    { area: 'Whole home', items: ['Inside closets: shelves, rods, floor', 'Interior windows and sliding door glass, tracks too', 'Walls spot-cleaned (stop if the paint rubs)', 'Switch plates and outlet covers'] },
  ],
}

const HOME_LAYERS: Record<string, string[]> = {
  houseCleaning: ['houseCleaning'],
  deepCleaning: ['houseCleaning', 'deepCleaning'],
  moveOutCleaning: ['houseCleaning', 'deepCleaning', 'moveOutCleaning'],
}

/** The calculator's field prefix per service -- MIRRORS HOME_KIND in estimate-new.html. */
const HOME_PREFIX: Record<string, string> = { houseCleaning: 'hc', deepCleaning: 'dc', moveOutCleaning: 'mo' }

/*
 * Extras the client bought, read back off the calculator inputs. The wording
 * matches the base lists where the task is the same, so an extra that a
 * deeper clean already includes lands on the list once.
 */
const HOME_EXTRA_ITEMS: Array<{ key: string; area: string; item: (v: string) => string | null }> = [
  { key: 'oven', area: 'Kitchen', item: v => (v ? 'Inside the oven' : null) },
  { key: 'fridge', area: 'Kitchen', item: v => (v ? 'Inside the fridge and freezer' : null) },
  { key: 'cabinets', area: 'Kitchen', item: v => (v ? 'Inside every cabinet (emptied)' : null) },
  { key: 'baseboards', area: 'Whole home', item: v => (v ? 'Baseboards hand-wiped' : null) },
  { key: 'windows', area: 'Whole home', item: v => (n(v) > 0 ? `Interior windows (${n(v)})` : null) },
  { key: 'blinds', area: 'Whole home', item: v => (n(v) > 0 ? `Blinds (${n(v)})` : null) },
  { key: 'garage', area: 'Extras', item: v => (v ? 'Garage swept' : null) },
  { key: 'patio', area: 'Extras', item: v => (v ? 'Patio or balcony swept' : null) },
]

/** Rooms in the order they are worked, whatever order the lines came in. */
const HOME_AREA_ORDER = ['Bathrooms', 'Kitchen', 'Bedrooms and living areas', 'Whole home', 'Extras']

function homeChecklist(lines: LineItemLike[]): ChecklistArea[] {
  const byArea = new Map<string, string[]>()
  const add = (area: string, item: string) => {
    const list = byArea.get(area) || []
    if (!list.includes(item)) list.push(item)
    byArea.set(area, list)
  }
  for (const li of lines) {
    const service = li.serviceType || ''
    if (!HOME_SERVICES.has(service)) continue
    for (const layer of HOME_LAYERS[service]) {
      for (const a of HOME_CHECKLIST[layer]) for (const item of a.items) add(a.area, item)
    }
    const inputs = parseInputs(li.calculatorInputs)
    for (const x of HOME_EXTRA_ITEMS) {
      const item = x.item(inputs[`${HOME_PREFIX[service]}_${x.key}`] || '')
      if (item) add(x.area, item)
    }
  }
  return HOME_AREA_ORDER.filter(a => byArea.has(a)).map(area => ({ area, items: byArea.get(area) as string[] }))
}

/*
 * The order a house is cleaned in. Bathrooms first, so the disinfectant sits
 * for its dwell time while the rest of the room is done; top to bottom in
 * every room, so dust falls on what is still to be cleaned; floors last,
 * backing out toward the door, so nobody walks on a finished floor.
 */
function homePhases(hoursEach: number): Phase[] {
  const work = Math.max(30, Math.round(hoursEach * 60))
  return [
    { label: 'Arrive: read the home notes, unload, walk through and photograph anything already damaged', minutes: 10 },
    { label: 'Bathrooms: spray the disinfectant first so it can sit, then work top to bottom', minutes: Math.round(work * 0.3) },
    { label: 'Kitchen: top to bottom, sink last', minutes: Math.round(work * 0.25) },
    { label: 'Bedrooms and living areas: dust top to bottom, then make the beds', minutes: Math.round(work * 0.25) },
    { label: 'Floors last, backing out toward the door: vacuum, then mop', minutes: Math.round(work * 0.2) },
    { label: 'Final walk: check the list, empty the vacuum, lock up and set the alarm', minutes: 10 },
  ]
}

/* ---------- plan assembly ---------- */

export function buildJobPlan(lineItems: LineItemLike[]): JobPlan {
  /*
   * Optional lines are excluded before anything else is counted.
   *
   * An optional line is work the client was shown and did not buy. Left in, it
   * loads its hours, its chemicals, its equipment and its water into the
   * dispatch plan: the crew brings sealer for a slab nobody sealed, the day is
   * planned at twenty hours instead of twelve, and the profitability report
   * compares the hours actually worked against an estimate that included work
   * that never happened. The admin page already sums estimated hours over
   * non-optional lines only, so leaving them in here also made the two figures
   * on the same screen disagree.
   */
  const sold = lineItems.filter(li => !li.isOptional)
  const planned = sold.filter(li => li.serviceType && SERVICE_LABELS[li.serviceType])
  const warnings: string[] = []

  const skipped = sold.length - planned.length
  if (skipped > 0) {
    warnings.push(
      `${skipped} line item(s) were added manually rather than through the pricing calculator, so they carry no job data and are not covered by this plan. Their time and materials are not included below.`
    )
  }

  const services = [...new Set(planned.map(li => li.serviceType as string))]
  const laborHours = planned.reduce((sum, li) => sum + n(li.estimatedDurationHours), 0)

  // Wash-then-seal is the normal way this gets sold, and it cannot be done in
  // one visit -- the slab needs a full day to dry through or the sealer clouds
  // and delaminates. Catch it at planning time, not on the callback.
  if (services.includes('concreteSealing') && services.some(s => s === 'pressureWashing' || s === 'dumpsterPad' || s === 'graffitiRemoval')) {
    warnings.push(
      'This work order pairs washing with concrete sealing. The slab must dry a full 24 hours before sealer goes down, so these cannot be the same visit -- schedule the sealing as a separate return trip.'
    )
  }

  // Crew: bounded by how many people the equipment can actually keep busy.
  const parallelCap = services.length ? Math.max(...services.map(s => MAX_PARALLEL[s] ?? 1)) : 1
  const wanted = laborHours > 0 ? Math.ceil(laborHours / TARGET_WINDOW_HOURS) : 1
  const techs = Math.max(1, Math.min(wanted, parallelCap))
  const hoursEach = techs > 0 ? laborHours / techs : laborHours

  let rationale: string
  if (wanted > parallelCap) {
    rationale = `${laborHours.toFixed(1)} labor hours would want ${wanted} techs to fit an ${TARGET_WINDOW_HOURS}-hour day, but the equipment only keeps ${parallelCap} productive at once. Expect this to run long or split across days.`
    warnings.push(`This job cannot be compressed into one ${TARGET_WINDOW_HOURS}-hour day with the equipment on hand.`)
  } else if (techs === 1) {
    rationale = `${laborHours.toFixed(1)} labor hours fits inside a single ${TARGET_WINDOW_HOURS}-hour day for one tech.`
  } else {
    rationale = `${laborHours.toFixed(1)} labor hours split ${techs} ways to land inside an ${TARGET_WINDOW_HOURS}-hour day. Equipment supports ${parallelCap} working at once.`
  }

  // Chemicals across every planned line item, then merged by product. A crew
  // loading the truck wants one number per jug, not the same degreaser listed
  // once for the forecourt and again for the dumpster pad.
  const rawChemicals: ChemicalNeed[] = []
  for (const li of planned) {
    rawChemicals.push(...chemicalsFor(li.serviceType as string, parseInputs(li.calculatorInputs)))
  }
  const chemicals = mergeChemicals(rawChemicals)

  // Phases. Dwell is real dead time a raw hours figure hides.
  // Dwell a crew can reasonably stand through. Inter-coat dry time on sealer
  // (~90 min) is genuinely on-site waiting; a 4-hour poultice is not -- that
  // is a return visit, and counting it as on-site hours would wreck both the
  // crew schedule and the day's costing.
  const ATTENDED_DWELL_CAP = 120
  const rawMaxDwell = chemicals.reduce((m, c) => Math.max(m, c.dwellMinutes), 0)
  const maxDwell = Math.min(rawMaxDwell, ATTENDED_DWELL_CAP)
  if (rawMaxDwell > ATTENDED_DWELL_CAP) {
    warnings.push(
      `One product on this job needs ${rawMaxDwell} minutes of dwell -- far longer than a crew should stand and watch it. Schedule that as unattended dwell or a return visit. It is deliberately not counted in the on-site hours below.`
    )
  }
  const needsRecovery =
    services.some(s => s === 'dumpsterPad' || s === 'graffitiRemoval') ||
    planned.some(li => {
      const i = parseInputs(li.calculatorInputs)
      return li.serviceType === 'pressureWashing' && n(i.pw_contamination, 1) >= 1.5
    })

  // A house is not staged like a forecourt: no berms, no dwell on a slab.
  const homeOnly = services.length > 0 && services.every(s => HOME_SERVICES.has(s))
  const phases: Phase[] = homeOnly ? homePhases(hoursEach) : [
    { label: 'Mobilize and stage equipment', minutes: needsRecovery ? 30 : 20 },
    ...(needsRecovery ? [{ label: 'Berm area and cover storm drains', minutes: 15 }] : []),
    ...(chemicals.length ? [{ label: 'Apply chemical', minutes: Math.max(10, Math.round(hoursEach * 60 * 0.15)) }] : []),
    ...(maxDwell ? [{ label: `Dwell (${maxDwell} min, do not let it dry)`, minutes: maxDwell }] : []),
    { label: 'Main work', minutes: Math.round(hoursEach * 60) },
    ...(needsRecovery ? [{ label: 'Vacuum-recover and dispose wash water', minutes: 25 }] : []),
    { label: 'Final walk and demobilize', minutes: 15 },
  ]
  const onSiteHours = phases.reduce((s, p) => s + p.minutes, 0) / 60

  // Water: only counted while the trigger is actually pulled. Graffiti work is
  // mostly brushing and dwell with brief low-pressure rinses, so billing it at
  // the flatwork rate would have you hauling a tank you never touch.
  const gallons = Math.round(
    planned.reduce((sum, li) => {
      const fraction = TRIGGER_FRACTION_BY_SERVICE[li.serviceType as string]
      if (!fraction) return sum
      return sum + n(li.estimatedDurationHours) * 60 * fraction * MACHINE_GPM
    }, 0)
  )
  // Thousands separator so the note matches how the figure is rendered in the
  // dispatch panel -- "1,502 gal" beside "About 1502 gal" reads as two numbers.
  const gallonsLabel = gallons.toLocaleString('en-US')
  const water = {
    gallons,
    note: gallons === 0
      ? 'No pressurized water required for this job.'
      : gallons > 200
        ? `About ${gallonsLabel} gal at ${MACHINE_GPM} GPM. Confirm a site spigot before rolling, or bring a buffer tank -- this exceeds what most tanks carry.`
        : `About ${gallonsLabel} gal at ${MACHINE_GPM} GPM. A standard buffer tank covers this.`,
  }

  const equipment = [...new Set(services.flatMap(s => EQUIPMENT[s] ?? []))]
  const ppe = [...new Set(services.flatMap(s => PPE[s] ?? []))]
  if (needsRecovery) equipment.push('Storm drain covers / inlet mats', 'Berm or containment sock kit')

  // Compliance, de-duplicated by requirement text, critical items first.
  const complianceAll = planned.flatMap(li => complianceFor(li.serviceType as string, parseInputs(li.calculatorInputs)))
  const hasFullContainment = complianceAll.some(c => c.level === 'critical' && c.requirement.startsWith('Contain and recover'))
  const seen = new Set<string>()
  const compliance = complianceAll
    // On a mixed job the strictest rule wins. Telling a crew to recover ALL
    // wash water and also merely "keep it out of storm drains" reads as if the
    // looser rule were an option somewhere on site. It isn't.
    .filter(c => !(hasFullContainment && c.requirement.startsWith('Keep wash/rinse water')))
    // Same for the two SDS rules -- one line about SDS, not two.
    .filter(c => !(hasFullContainment && c.requirement === 'SDS available on site'))
    .filter(c => (seen.has(c.requirement) ? false : (seen.add(c.requirement), true)))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))

  // Does the plan cost more in chemicals than the quote assumed?
  const plannedChemicalCost = round(chemicals.reduce((s, c) => s + c.cost, 0))
  const quotedProductCost = round(planned.reduce((s, li) => s + n(li.estimatedProductCost), 0))
  const delta = round(plannedChemicalCost - quotedProductCost)
  // Chemicals are bought by the jug, so the plan rounds up where the estimate
  // priced a fractional gallon. A couple of dollars of that is arithmetic, not
  // a margin problem -- warning on it every time would train you to ignore the
  // warning that actually matters.
  const MATERIAL_VARIANCE_TOLERANCE = 5
  const internalWarnings: string[] = []
  if (delta > MATERIAL_VARIANCE_TOLERANCE) {
    internalWarnings.push(
      `Chemicals for this plan cost about ${delta.toFixed(2)} more than the estimate assumed. That comes straight out of the job's margin -- worth checking before dispatch.`
    )
  }

  return {
    services: services.map(s => SERVICE_LABELS[s]),
    laborHours: round(laborHours, 1),
    crew: { techs, hoursEach: round(hoursEach, 1), rationale },
    phases,
    onSiteHours: round(onSiteHours, 1),
    chemicals,
    equipment,
    ppe,
    water,
    compliance,
    weather: weatherFor(services),
    costCheck: { plannedChemicalCost, quotedProductCost, delta, status: delta > MATERIAL_VARIANCE_TOLERANCE ? 'over' : 'ok' },
    checklist: homeChecklist(planned),
    warnings,
    internalWarnings,
  }
}
