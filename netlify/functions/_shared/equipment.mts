/**
 * Equipment ownership cost, per hour of use.
 *
 * This cost used to live inside the flat overhead percentage, which cannot
 * work: a window-cleaning hour runs about $2 of machine and a truck-mount
 * carpet hour runs about $9. One percentage applied to both either overcharges
 * the light service or quietly eats the margin on the heavy one. Overhead now
 * covers the business (vehicles, admin, software, insurance) and equipment is
 * costed against the jobs that actually run the machines.
 *
 * The basis is deliberately simple and auditable, because a contracting officer
 * may ask for it:
 *
 *   hourly cost = (purchase - salvage) / useful life hours + maintenance/hour
 *
 * Maintenance covers wear parts an operator replaces on a schedule -- pump
 * seals, unloaders, hoses, brushes, filters, DI resin -- not repairs.
 *
 * Rented equipment is NOT here. A lift is a pass-through billed at its day
 * rate, not an asset Renovo is depreciating.
 */

export interface Machine {
  key: string
  label: string
  /** What Renovo pays for the machine, new. */
  purchase: number
  /** Resale at the end of its working life. Most of this gear is worth little. */
  salvage: number
  /** Hours of use before replacement. */
  lifeHours: number
  /** Wear parts and scheduled service, per hour of use. */
  maintenancePerHour: number
}

const m = (
  key: string, label: string, purchase: number, salvage: number,
  lifeHours: number, maintenancePerHour: number,
): Machine => ({ key, label, purchase, salvage, lifeHours, maintenancePerHour })

export const MACHINES: Machine[] = [
  m('hotWasher', 'Hot-water pressure washer (4 GPM / 3,500 PSI)', 7500, 750, 2500, 1.2),
  m('surfaceCleaner', 'Rotary surface cleaner attachment', 900, 50, 2000, 0.15),
  m('reclaim', 'Wash-water containment and vacuum recovery', 3500, 200, 3000, 0.25),
  m('truckMount', 'Truck-mount hot-water extractor', 32000, 4000, 5000, 2.5),
  m('portableExtractor', 'Portable hot-water extractor', 3200, 200, 2500, 0.6),
  m('agitator', 'Rotary / cylindrical carpet agitator', 1800, 100, 2500, 0.3),
  m('spinner', 'Tile and grout spinner tool', 2200, 150, 2000, 0.4),
  m('autoScrubber', 'Walk-behind auto scrubber', 8500, 900, 4000, 1),
  m('burnisher', 'High-speed floor burnisher', 3000, 250, 3000, 0.7),
  m('swingBuffer', 'Low-speed swing buffer', 1400, 100, 3000, 0.35),
  m('wetVac', 'Wet/dry vacuum', 600, 0, 2500, 0.1),
  m('hepaVac', 'HEPA backpack vacuum', 750, 0, 3000, 0.15),
  m('electrostatic', 'Electrostatic disinfection sprayer', 2400, 150, 2000, 0.35),
  m('airMovers', 'Air movers (set of four)', 1200, 60, 4000, 0.1),
  m('rideOnSweeper', 'Ride-on parking lot sweeper', 38000, 6000, 6000, 3.5),
  m('blower', 'Backpack blower', 500, 0, 2000, 0.2),
  m('gutterVac', 'Gutter vacuum system with carbon poles', 2800, 150, 2000, 0.35),
  m('waterFedPole', 'Water-fed pole system with DI filtration', 3500, 200, 3000, 0.6),
  m('airlessSprayer', 'Airless sprayer (sealer application)', 2600, 150, 2000, 0.45),
]

const byKey = new Map(MACHINES.map(x => [x.key, x]))

/**
 * Which machines run on which service. Mirrors the equipment lists in
 * jobModel, minus the hand tools and consumables that are not depreciated.
 */
export const SERVICE_EQUIPMENT: Record<string, string[]> = {
  pressureWashing: ['hotWasher', 'surfaceCleaner', 'reclaim'],
  windowCleaning: ['waterFedPole'],
  janitorial: ['hepaVac', 'wetVac'],
  floorCare: ['autoScrubber', 'burnisher', 'swingBuffer', 'wetVac'],
  dumpsterPad: ['hotWasher', 'surfaceCleaner', 'reclaim'],
  lotSweeping: ['rideOnSweeper', 'blower'],
  disinfection: ['electrostatic', 'hepaVac'],
  gutterCleaning: ['gutterVac', 'blower'],
  concreteSealing: ['hotWasher', 'airlessSprayer'],
  graffitiRemoval: ['hotWasher', 'reclaim'],
  canopyWashing: ['hotWasher', 'reclaim', 'wetVac'],
  fuelIsland: ['hotWasher', 'surfaceCleaner', 'reclaim', 'wetVac'],
  carpetExtraction: ['portableExtractor', 'agitator', 'airMovers'],
  tileGrout: ['spinner', 'portableExtractor'],
  ventCleaning: ['hepaVac'],
  constructionRough: ['hepaVac', 'wetVac', 'blower'],
  constructionProgress: ['hepaVac', 'wetVac'],
  constructionFinal: ['hepaVac', 'wetVac', 'autoScrubber'],
  constructionTouchup: ['hepaVac'],
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Ownership plus maintenance, per hour of use. */
export function machineHourlyCost(machine: Machine): number {
  const life = Math.max(1, machine.lifeHours)
  const depreciation = Math.max(0, machine.purchase - machine.salvage) / life
  return round2(depreciation + Math.max(0, machine.maintenancePerHour))
}

export interface EquipmentLine {
  key: string
  label: string
  hourlyCost: number
  hours: number
  cost: number
}

export interface EquipmentCost {
  /** Combined machine cost per hour for this service. */
  hourlyCost: number
  /** That rate over the hours worked. */
  total: number
  lines: EquipmentLine[]
}

/**
 * What the machines cost to run this job.
 *
 * Every machine listed for the service is charged for the full duration. That
 * is deliberate: a burnisher sitting in the van on a strip-and-wax job is still
 * being consumed by the job that brought it, and splitting a floor-care visit
 * into per-machine minutes is a precision the estimate does not have.
 */
export function equipmentCostFor(service: string, hours: number): EquipmentCost {
  const keys = SERVICE_EQUIPMENT[service] || []
  const h = Math.max(0, hours)

  const lines = keys.map(k => byKey.get(k)).filter((x): x is Machine => !!x).map(machine => {
    const hourlyCost = machineHourlyCost(machine)
    return {
      key: machine.key,
      label: machine.label,
      hourlyCost,
      hours: h,
      cost: round2(hourlyCost * h),
    }
  })

  const hourlyCost = round2(lines.reduce((sum, l) => sum + l.hourlyCost, 0))
  return { hourlyCost, total: round2(hourlyCost * h), lines }
}

/**
 * Rented equipment, billed to the client at cost plus markup rather than
 * depreciated. Renovo does not own a lift and should not pretend to.
 */
export interface Rental {
  key: string
  label: string
  dayRate: number
  note?: string
}

export const RENTALS: Rental[] = [
  { key: 'scissorLift19', label: 'Scissor lift, 19 ft', dayRate: 185 },
  { key: 'scissorLift26', label: 'Scissor lift, 26 ft', dayRate: 250 },
  { key: 'boomLift45', label: 'Articulating boom lift, 45 ft', dayRate: 450, note: 'Delivery and pickup are usually billed separately by the rental yard.' },
  { key: 'dumpster20', label: 'Construction debris dumpster, 20 yd', dayRate: 550, note: 'Priced per haul, not per day. Overweight loads are surcharged at the landfill scale.' },
  { key: 'floorScrubberRental', label: 'Auto scrubber, rented for a large one-off', dayRate: 150 },
]
