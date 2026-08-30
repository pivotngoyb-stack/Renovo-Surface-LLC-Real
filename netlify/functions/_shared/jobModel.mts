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
}

/* ---------- types ---------- */

export interface LineItemLike {
  description: string
  serviceType: string | null
  calculatorInputs: string | null
  estimatedDurationHours: string | number | null
  estimatedProductCost: string | number | null
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
  warnings: string[]
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
}

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
  constructionRough: ['N95 or P100 respirator (respirable silica)', 'Safety glasses', 'Cut-resistant gloves', 'Steel-toe boots', 'Hard hat and hi-vis vest (active site)'],
  constructionProgress: ['N95 respirator', 'Safety glasses', 'Cut-resistant gloves', 'Steel-toe boots', 'Hard hat and hi-vis vest (active site)'],
  constructionFinal: ['N95 respirator (residual dust)', 'Safety glasses', 'Nitrile gloves', 'Non-slip footwear', 'Knee pads'],
  constructionTouchup: ['Safety glasses', 'Nitrile gloves', 'Non-slip footwear'],
  graffitiRemoval: ['Organic-vapor respirator with N95 pre-filter', 'Tyvek coverall', 'Viton or PVC chemical gloves', 'Face shield over goggles'],
}

function complianceFor(service: string, inputs: Record<string, string>): ComplianceItem[] {
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

/* ---------- plan assembly ---------- */

export function buildJobPlan(lineItems: LineItemLike[]): JobPlan {
  const planned = lineItems.filter(li => li.serviceType && SERVICE_LABELS[li.serviceType])
  const warnings: string[] = []

  const skipped = lineItems.length - planned.length
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

  const phases: Phase[] = [
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
  if (delta > MATERIAL_VARIANCE_TOLERANCE) {
    warnings.push(
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
    warnings,
  }
}
