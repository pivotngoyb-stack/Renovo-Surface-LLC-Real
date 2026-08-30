/**
 * Scope, exclusions and assumptions per service.
 *
 * This is the content engine behind the proposal document. A commercial buyer
 * comparing bids reads three things: what you will do, what you will not do,
 * and what you are assuming about their site. A one-line description answers
 * none of them, and the silence is what scope disputes are made of.
 *
 * Exclusions carry as much weight as scope. They are the written record that
 * stops a GC arguing window interiors were "obviously" part of a final clean.
 *
 * Every entry is written to be read by a facility manager or a general
 * contractor, not by us. Plain nouns, no marketing.
 */

export interface ServiceScope {
  /** Heading used for this service's section in the proposal. */
  label: string
  /** What is included, as discrete verifiable tasks. */
  scope: string[]
  /** What is deliberately not included. */
  exclusions: string[]
  /** Site conditions the price depends on. */
  assumptions: string[]
}

/** Applies to every proposal regardless of service mix. */
export const UNIVERSAL_EXCLUSIONS: string[] = [
  'Repair, replacement, or restoration of any surface, fixture, or finish. Renovo is a cleaning contractor and performs no trade work.',
  'Removal or remediation of hazardous materials, including asbestos, lead paint, mold, biohazard, or unidentified chemical spills.',
  'Work requiring a trade license Renovo does not hold: electrical, plumbing, roofing, HVAC, or structural.',
  'Moving or lifting furniture, equipment, or stock over 50 lbs, unless listed as a priced line item.',
  'Any area not listed in the scope above, and any area that cannot be safely accessed on the service date.',
]

export const UNIVERSAL_ASSUMPTIONS: string[] = [
  'Pricing is based on the site conditions described to us or observed at walkthrough. Materially different conditions found on arrival will be documented with photos and re-quoted before work proceeds.',
  'Client provides safe, unobstructed access to all service areas during the agreed window, including keys, codes, or an on-site contact.',
  'Client provides access to water and 110V power at no charge unless the line item states otherwise.',
  'Work is performed during normal business hours unless an after-hours rate is shown in the pricing table.',
]

/**
 * Added only when the bid covers a healthcare setting. A clinic's compliance
 * officer screens for this language before they read the price, and applying
 * it to a gas station bid would read as boilerplate.
 */
export const HEALTHCARE_STATEMENTS: string[] = [
  'Renovo personnel assigned to healthcare facilities receive HIPAA awareness training and operate under a signed confidentiality agreement. Protected health information encountered incidentally is never accessed, photographed, removed, or discussed.',
  'A Business Associate Agreement will be executed prior to service where the covered entity determines one is required.',
  'Crews follow facility infection-control protocol, including any isolation, precaution, or restricted-area signage in force at the time of service.',
  'Regulated medical waste and sharps are never handled. Containers are worked around and any breach is reported to facility staff immediately.',
  'Personnel are background-checked and badged, and sign in through the facility\u2019s own visitor process on every visit.',
]

/** Shown on every proposal. Commercial buyers screen on this before price. */
export const COMPLIANCE_STATEMENTS: string[] = [
  'Renovo Surface Solutions LLC carries commercial general liability insurance. A certificate of insurance naming the client as additional insured is available on request before work begins.',
  'All technicians are trained on the chemicals and equipment specified for this scope. Safety Data Sheets for every product are carried on the truck and available on request.',
  'Wash water and cleaning effluent are contained and disposed of in accordance with the Clean Water Act and local ordinance. Nothing is discharged to a storm drain.',
  'W-9 available on request for vendor onboarding.',
]

export const SERVICE_SCOPE: Record<string, ServiceScope> = {
  pressureWashing: {
    label: 'Commercial Pressure Washing',
    scope: [
      'Pre-inspection and photo documentation of existing surface condition before any water is applied.',
      'Application of commercial-grade detergent or degreaser appropriate to the soil type and substrate.',
      'Hot-water pressure washing at the pressure and tip selected for the surface material.',
      'Surface-cleaner pass on flatwork for an even finish without wand striping.',
      'Spot treatment of oil, gum, tire marks, and organic staining where present.',
      'Rinse-down of adjacent glass, doors, and landscaping affected by overspray.',
      'After photos supplied with the completion record.',
    ],
    exclusions: [
      'Removal of stains that have chemically bonded to or etched the substrate. These are documented at pre-inspection and are not a service defect.',
      'Sealing, striping, crack repair, or any coating application.',
      'Roof or elevated surface washing not specifically listed above.',
      'Restoration of surfaces already spalling, delaminating, or failing prior to service.',
    ],
    assumptions: [
      'A working water spigot is available within 150 feet of the work area.',
      'Vehicles and obstructions are cleared from the wash area before crew arrival.',
      'Drainage in the area is adequate and functional.',
    ],
  },

  windowCleaning: {
    label: 'Commercial Window Cleaning',
    scope: [
      'Interior and exterior glass cleaned by squeegee to a streak-free finish, unless exterior-only is specified in pricing.',
      'Frames, sills, and tracks wiped down.',
      'Hard-water and mineral spot treatment where present.',
      'Entry glass and door glass detailed, including push plates and handles.',
    ],
    exclusions: [
      'Replacement of failed seals, cracked panes, or damaged screens.',
      'Removal of paint, adhesive, or construction debris bonded to glass, unless quoted as a separate line.',
      'Permanent mineral etching, which is damage to the glass itself and cannot be cleaned off.',
      'Glass above the height stated in pricing, or any glass requiring rope access.',
    ],
    assumptions: [
      'Interior glass is accessible without moving furniture, stock, or displays.',
      'Ground beneath exterior glass is stable and safe for ladder footing.',
    ],
  },

  janitorial: {
    label: 'Janitorial Services',
    scope: [
      'Restroom sanitizing: fixtures, partitions, touchpoints, mirrors, and floors; consumables restocked from client-supplied stock.',
      'Hard-floor sweeping and damp mopping with neutral cleaner.',
      'Carpet vacuuming in all traffic areas.',
      'Trash and recycling collected, liners replaced, waste taken to the client dumpster.',
      'Horizontal surface dusting and disinfection of shared touchpoints.',
      'Interior glass and entry door spot-cleaning.',
      'Break room surfaces, sinks, and exterior of appliances wiped down.',
    ],
    exclusions: [
      'Consumable supplies (paper, soap, liners) unless a supply line item is included.',
      'Dishes, personal items, and the interior of refrigerators, microwaves, or personal desks.',
      'Carpet extraction, hard-floor stripping, or machine burnishing, which are quoted separately.',
      'Exterior windows, exterior areas, and any tenant space not listed.',
    ],
    assumptions: [
      'The frequency shown in pricing is per visit; the schedule is agreed in the service agreement.',
      'Client supplies restroom and break-room consumables unless otherwise quoted.',
      'Areas are reasonably clear of personal belongings at service time.',
    ],
  },

  floorCare: {
    label: 'Commercial Floor Care',
    scope: [
      'Area protected and signed; furniture in the work area moved where under 50 lbs.',
      'Existing finish stripped or scrubbed per the service specified.',
      'Floor neutralized and rinsed, edges and corners detailed by hand.',
      'Professional-grade finish applied in the number of coats stated, with cure time between coats.',
      'Baseboards wiped down and the area returned to service on completion of cure.',
    ],
    exclusions: [
      'Repair or replacement of broken, lifting, or missing tile.',
      'Subfloor moisture remediation, and any finish failure caused by subfloor moisture.',
      'Guaranteed removal of finish embedded in cracked or porous tile.',
      'Moving of fixtures, shelving, or equipment over 50 lbs.',
    ],
    assumptions: [
      'The area can be taken fully out of service for the duration of the work plus cure time.',
      'Power is available in the work area for machine operation.',
      'Existing finish is a standard commercial floor finish, not an epoxy or urethane coating.',
    ],
  },

  dumpsterPad: {
    label: 'Dumpster Pad Cleaning & Deodorizing',
    scope: [
      'Pad and surrounding apron degreased and hot-water pressure washed.',
      'Grease and biological contamination broken down and removed.',
      'Commercial enzyme deodorizer applied where specified.',
      'Wash water contained, vacuum-recovered, and disposed of lawfully.',
      'Enclosure walls and bollards rinsed where reachable.',
    ],
    exclusions: [
      'Moving of the dumpster itself. The container must be emptied and moved by the waste hauler or client before service.',
      'Repair of damaged enclosure gates, bollards, or pad surface.',
      'Removal of loose garbage or bulk waste inside the enclosure, unless quoted.',
      'Odor caused by the container itself rather than the pad.',
    ],
    assumptions: [
      'The dumpster is emptied and moved clear of the pad on the service date.',
      'A sanitary disposal point or client authorization for off-site disposal is available.',
    ],
  },

  lotSweeping: {
    label: 'Parking Lot Sweeping',
    scope: [
      'Drive aisles, parking stalls, and perimeter curb lines swept.',
      'Litter, gravel, leaves, and construction sand collected and removed.',
      'Debris disposed of to the client dumpster or hauled off where quoted.',
      'Entry aprons and loading areas included.',
    ],
    exclusions: [
      'Removal of hazardous material, needles, or large-volume broken glass. These are reported and quoted separately.',
      'Pressure washing, oil-stain removal, striping, or crack sealing.',
      'Snow and ice removal.',
      'Sweeping of areas blocked by parked vehicles at the time of service.',
    ],
    assumptions: [
      'The lot is accessible and substantially clear of vehicles during the agreed window.',
      'Fixed obstacles such as bollards and drainage grates have been disclosed.',
    ],
  },

  disinfection: {
    label: 'Disinfection & Sanitizing',
    scope: [
      'EPA List N registered disinfectant applied by electrostatic sprayer to all hard surfaces in scope.',
      'High-touch points treated directly: door hardware, switches, rails, shared equipment.',
      'Full label dwell time observed on every treated surface.',
      'Re-entry signage posted and the area released only after the required interval.',
      'Treatment record supplied for the client compliance file.',
    ],
    exclusions: [
      'Any guarantee against future infection, transmission, or illness.',
      'Treatment of soft goods, upholstery, or porous surfaces not rated for the product.',
      'Air duct, HVAC, or whole-air treatment.',
      'Removal of soil. Disinfection is applied to cleaned surfaces; heavy soil requires a cleaning line item first.',
    ],
    assumptions: [
      'The area can be vacated for treatment and for the full re-entry interval.',
      'Sensitive equipment and food-contact surfaces are identified before treatment.',
    ],
  },

  gutterCleaning: {
    label: 'Gutter & Downspout Cleaning',
    scope: [
      'Debris removed from all reachable gutter runs by hand and bagged.',
      'Gutter runs flushed to confirm flow to the downspouts.',
      'Downspouts checked for free discharge at grade.',
      'Debris hauled from site.',
      'Any damage observed during service reported with photos.',
    ],
    exclusions: [
      'Repair, resealing, re-hanging, re-pitching, or replacement of gutters, hangers, or fascia.',
      'Gutter guard supply or installation.',
      'Clearing of underground drain lines or downspout blockages not reachable by flushing.',
      'Roof surface cleaning, and any work requiring walking on the roof.',
      'Sections that cannot be reached safely, which are documented and excluded from the price.',
    ],
    assumptions: [
      'Ground conditions allow safe ladder or lift footing at every access point.',
      'Overhead service drops and power lines have been identified.',
    ],
  },

  concreteSealing: {
    label: 'Concrete Sealing',
    scope: [
      'Surface confirmed clean and dry, verified with a moisture meter before application.',
      'Sealer applied at manufacturer coverage rate in the number of coats stated.',
      'Edges and control joints cut in by hand.',
      'Area barricaded and signed for the full cure window.',
      'Product data sheet supplied for the client records.',
    ],
    exclusions: [
      'Crack repair, spall repair, joint replacement, or any concrete restoration.',
      'Guaranteed adhesion over previously sealed or coated concrete without full stripping, which is a separate scope.',
      'Uniform appearance across patched, repaired, or differently aged concrete.',
      'Damage caused by traffic entering the area before the stated cure time.',
    ],
    assumptions: [
      'The slab can be closed to foot traffic for 4-6 hours and to vehicles for 24-48 hours.',
      'Ambient temperature will be between 50°F and 90°F with no rain forecast for 24 hours.',
      'Any prior sealer, coating, or curing compound has been disclosed.',
    ],
  },

  graffitiRemoval: {
    label: 'Graffiti Removal',
    scope: [
      'Test patch performed in an inconspicuous area and reviewed before full application.',
      'Surface-appropriate remover applied, with poultice where the substrate is porous.',
      'Controlled-pressure rinse selected to avoid etching the substrate.',
      'Wash water containing paint solids contained, recovered, and disposed of lawfully.',
      'Sacrificial anti-graffiti coating applied where quoted.',
    ],
    exclusions: [
      'Any guarantee of complete removal. Pigment that has penetrated porous masonry may leave permanent shadowing after all reasonable attempts.',
      'Restoration of paint, sealer, or factory finish removed along with the graffiti on a coated surface.',
      'Repainting or refinishing of the treated area.',
      'Removal of graffiti applied after the service date.',
    ],
    assumptions: [
      'Client accepts the test-patch result before full-area work proceeds.',
      'Substrate type and any prior coatings have been disclosed.',
      'A lawful disposal point for recovered wash water is available.',
    ],
  },

  canopyWashing: {
    label: 'Canopy & Column Washing',
    scope: [
      'Canopy underside and deck degreased to remove accumulated petroleum film and road grime.',
      'Fascia panels washed on all elevations and rinsed to a uniform finish.',
      'All support columns cleaned from canopy line to base, including bollard sleeves where fitted.',
      'Light lenses and sign faces wiped where reachable from the lift.',
      'Wash water contained and vacuum-recovered; nothing discharged to a storm drain.',
      'Before and after photo documentation supplied.',
    ],
    exclusions: [
      'Electrical work of any kind, including lamp or ballast replacement inside canopy light fixtures.',
      'Repainting, refinishing, or repair of fascia panels, columns, or column wraps.',
      'Removal of oxidation, chalking, or fading in the fascia finish itself, which is coating failure rather than soil.',
      'Structural inspection or certification of the canopy.',
      'Work during fuel delivery or while any island beneath the work area is in service.',
    ],
    assumptions: [
      'The fuel islands beneath the work area can be coned off and taken out of service for the duration.',
      'Ground beneath the canopy is level and rated for lift operation.',
      'Overhead clearance permits a lift; otherwise the work is re-quoted with alternative access.',
    ],
  },

  fuelIsland: {
    label: 'Fuel Island Service',
    scope: [
      'Islands, curbs and pump surrounds degreased and hot-water washed.',
      'Dispenser faces, nozzles holsters and card readers wiped down.',
      'Trash receptacle surrounds and squeegee stations cleaned and restocked from client stock.',
      'Concrete pad beneath and between islands degreased.',
      'Wash water contained and vacuum-recovered for lawful disposal.',
    ],
    exclusions: [
      'Any work on the dispensers themselves beyond exterior wiping. Renovo does not open, service, or calibrate fuel equipment.',
      'Removal of permanent staining where petroleum has penetrated the concrete. This is documented at pre-inspection.',
      'Handling, transfer, or disposal of fuel, and any response to an active leak or release.',
      'Line striping, bollard painting, or concrete repair.',
    ],
    assumptions: [
      'Islands are taken out of service in sections during the work window.',
      'No active fuel release or contamination event is present; if one is found, work stops and the operator is notified immediately.',
      'A lawful disposal point for recovered wash water is available.',
    ],
  },

  carpetExtraction: {
    label: 'Commercial Carpet Cleaning',
    scope: [
      'Carpet vacuumed and traffic lanes pre-treated before extraction.',
      'Carpet agitated and cleaned by the method quoted, then extracted.',
      'Spots and stains treated individually where treatable.',
      'Furniture under 50 lbs moved and replaced; protectors placed under legs as needed.',
      'Air movers placed in high-traffic areas to shorten dry time.',
    ],
    exclusions: [
      'Guaranteed removal of permanent staining, bleach spots, dye transfer, urine damage, or wear patterns worn into the pile.',
      'Repair, re-stretching, seam work, or replacement of carpet.',
      'Moving of furniture, equipment, or filing over 50 lbs, unless quoted as a separate line.',
      'Colour restoration or dyeing.',
    ],
    assumptions: [
      'Dry time of 4-8 hours is acceptable; airflow and HVAC availability affect this materially.',
      'Areas are cleared of personal belongings and floor clutter before crew arrival.',
      'Carpet is a commercial-grade synthetic suitable for the method quoted; wool and natural fibres are re-quoted.',
    ],
  },

  tileGrout: {
    label: 'Tile & Grout Cleaning',
    scope: [
      'Grout lines cleaned with pressurised hot water and simultaneous extraction.',
      'Tile surface degreased and residue haze removed.',
      'Edges, corners and cove base detailed by hand.',
      'Floor neutralised and dried on completion.',
      'Penetrating grout sealer applied where quoted.',
    ],
    exclusions: [
      'Regrouting, grout colour-sealing, tile replacement, or repair of cracked or loose tile.',
      'Guaranteed uniform grout colour. Cleaning reveals the true colour, which varies where grout has been patched or previously sealed.',
      'Removal of permanent staining that has penetrated unsealed grout.',
      'Subfloor moisture remediation.',
    ],
    assumptions: [
      'The area can be taken out of service during cleaning and for the sealer cure where sealing is included.',
      'A floor drain or approved disposal point is available for extracted water.',
      'Existing grout is sound; loose or missing grout is reported rather than cleaned over.',
    ],
  },

  ventCleaning: {
    label: 'Vent & Diffuser Cleaning',
    scope: [
      'Supply and return registers and diffusers removed where accessible.',
      'Grilles washed, dried and refitted.',
      'Ceiling and wall collar around each opening wiped down.',
      'Visible dust removed from the first accessible section of duct behind each opening.',
      'Filters replaced from client-supplied stock where requested.',
    ],
    exclusions: [
      'Full duct-system cleaning. This is surface and register cleaning only, not NADCA whole-system remediation.',
      'HVAC mechanical work of any kind: coils, blowers, dampers, or controls.',
      'Mould remediation or air quality testing.',
      'Openings that cannot be reached safely from a standard ladder or lift.',
      'Filter supply, unless quoted as a separate line.',
    ],
    assumptions: [
      'HVAC is shut down during the work for the areas being serviced.',
      'Register locations are accessible without moving fixed equipment or stock.',
    ],
  },

  /* ---------- construction cleanup: before, between, after ---------- */

  constructionRough: {
    label: 'Construction Cleanup — Rough Clean (Before Finishes)',
    scope: [
      'Construction debris, offcuts, packaging, and banding removed from all interior areas in scope.',
      'Debris carried out and staged to the container, or hauled off where quoted.',
      'Floors swept or HEPA-vacuumed; wet methods used on concrete to control respirable dust.',
      'Large horizontal surfaces knocked down and gross dust removed.',
      'Window and door openings cleared of debris and packaging.',
      'Site left broom-clean and ready for finish trades.',
    ],
    exclusions: [
      'Any construction, demolition, repair, or trade work. Renovo is a cleaning contractor only.',
      'Removal of material designated for reuse by the general contractor or any trade.',
      'Hazardous or regulated waste, including solvents, adhesives, sealant tubes, batteries, and unlabeled containers.',
      'Detail cleaning of any kind. Fixtures, frames, tracks, and glass are addressed in the Final Clean phase.',
      'Repeat clearing of debris generated by trades after our crew leaves the area.',
    ],
    assumptions: [
      'A dumpster or container is on site and available, unless haul-off is a priced line item.',
      'Areas in scope are released to us and trades are not actively working in them during our window.',
      'Temporary power and lighting are available in all work areas.',
    ],
  },

  constructionProgress: {
    label: 'Construction Cleanup — Progress Clean (Between Trades)',
    scope: [
      'Recurring site cleanup on the agreed frequency while trades are working.',
      'Daily-use debris, packaging, and offcuts collected from work areas and corridors.',
      'Egress paths, stairs, and corridors kept clear and swept for site safety.',
      'Container area kept orderly and debris consolidated.',
      'Common-area and site restroom servicing where included in pricing.',
      'Entry and jobsite office areas kept presentable for owner and inspector visits.',
    ],
    exclusions: [
      'Any construction, demolition, repair, or trade work. Renovo is a cleaning contractor only.',
      'Cleanup of a specific trade’s own debris where that trade is contractually responsible for it, unless directed in writing by the general contractor.',
      'Hazardous or regulated waste of any kind.',
      'Detail or final cleaning. This phase maintains the site; it does not deliver it.',
      'Container rental, hauling, or tipping fees unless quoted as a line item.',
    ],
    assumptions: [
      'Frequency and duration are as stated in pricing and are billed per visit.',
      'The general contractor identifies which areas are released for cleaning at each visit.',
      'A container with available capacity is on site at each visit.',
    ],
  },

  constructionFinal: {
    label: 'Construction Cleanup — Final Clean (After Completion)',
    scope: [
      'Detail clean of all interior surfaces in scope, top down.',
      'Fixtures, casework, shelving, doors, frames, hardware, and switch plates cleaned.',
      'Vents, diffusers, and light fixtures wiped free of construction dust.',
      'Interior glass, window tracks, and sills cleaned; labels and adhesive removed from glass.',
      'Floors vacuumed, damp-mopped, or machine-scrubbed per the finish installed.',
      'Restrooms fully sanitized, fixtures polished, and consumables stocked where supplied.',
      'Final walk with the site superintendent, delivered inspection-ready.',
    ],
    exclusions: [
      'Any construction, demolition, repair, or trade work. Renovo is a cleaning contractor only.',
      'Removal of paint overspray, drywall compound, adhesive, grout haze, or sealant bonded to a finished surface, unless quoted as a separate remediation line.',
      'Exterior surfaces, roofs, and site work unless separately listed.',
      'Re-cleaning of areas re-entered by trades after our sign-off. That is the Touch-Up phase.',
      'Hazardous or regulated waste.',
    ],
    assumptions: [
      'All trades are complete and off the floor in the areas released to us.',
      'Permanent power, lighting, water, and HVAC are operating.',
      'Rough clean has been completed by others or is a separate priced phase; final-clean pricing does not include bulk debris removal.',
    ],
  },

  constructionTouchup: {
    label: 'Construction Cleanup — Touch-Up Clean (Punch List)',
    scope: [
      'Re-clean of areas disturbed by punch-list corrections and trade re-entry.',
      'Glass and mirrors de-smudged; fingerprints removed from hardware and glazing.',
      'Horizontal surfaces re-dusted and floors spot-cleaned.',
      'Restrooms refreshed and re-stocked.',
      'Timed to immediately precede owner walkthrough or occupancy inspection.',
    ],
    exclusions: [
      'Any construction, demolition, repair, or trade work. Renovo is a cleaning contractor only.',
      'Full re-clean of areas where trades performed substantial new work. That is re-quoted as a Final Clean.',
      'Bulk debris generated by punch-list corrections, unless quoted.',
      'Repeat visits beyond the number stated in pricing.',
    ],
    assumptions: [
      'Punch-list corrections are complete before our crew mobilizes.',
      'The walkthrough date is confirmed at least 48 hours in advance.',
      'Building systems are operating and the space is secured.',
    ],
  },
}

export interface ProposalScope {
  sections: ServiceScope[]
  exclusions: string[]
  assumptions: string[]
  compliance: string[]
}

/**
 * Assembles proposal content from the services actually quoted.
 *
 * Exclusions and assumptions are deduplicated across services -- a job with
 * three construction phases should say "Renovo is a cleaning contractor only"
 * once, not three times.
 */
export function buildProposalScope(serviceTypes: (string | null | undefined)[]): ProposalScope {
  const keys = [...new Set(serviceTypes.filter((k): k is string => !!k && !!SERVICE_SCOPE[k]))]
  const sections = keys.map(k => SERVICE_SCOPE[k])

  const seenEx = new Set<string>()
  const exclusions: string[] = []
  for (const line of [...sections.flatMap(s => s.exclusions), ...UNIVERSAL_EXCLUSIONS]) {
    if (seenEx.has(line)) continue
    seenEx.add(line)
    exclusions.push(line)
  }

  const seenAs = new Set<string>()
  const assumptions: string[] = []
  for (const line of [...UNIVERSAL_ASSUMPTIONS, ...sections.flatMap(s => s.assumptions)]) {
    if (seenAs.has(line)) continue
    seenAs.add(line)
    assumptions.push(line)
  }

  // Healthcare language is additive and only when it applies.
  const healthcare = keys.some(k => k === 'disinfection' || k === 'ventCleaning')
  const compliance = healthcare
    ? [...COMPLIANCE_STATEMENTS, ...HEALTHCARE_STATEMENTS]
    : COMPLIANCE_STATEMENTS

  return { sections, exclusions, assumptions, compliance }
}
