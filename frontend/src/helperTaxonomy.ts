import type { Helper } from "./types";

export interface CanonicalServiceGroup {
  name: string;
  patterns: RegExp[];
}

export const CANONICAL_SERVICES: CanonicalServiceGroup[] = [
  {
    name: "Electrical & Electrician",
    patterns: [/electr/i, /wiring/i, /switch/i, /mcb/i, /fuse/i, /fan/i, /light/i, /inverter/i, /ups/i],
  },
  {
    name: "Plumbing & Sanitary",
    patterns: [
      /plumb/i,
      /pipe/i,
      /tap/i,
      /faucet/i,
      /leak/i,
      /drain/i,
      /toilet/i,
      /flush/i,
      /basin/i,
      /sanitary/i,
      /bathroom[\s_]fit/i,
      /tank[\s_]refill/i,
      /water_tank/i,
    ],
  },
  {
    name: "AC Repair & Service",
    patterns: [/\bac\b/i, /ac[\s_-]/i, /cooling/i, /gas[\s_]refill/i, /gas[\s_]fill/i, /air[\s_]condition/i],
  },
  {
    name: "Cleaning & Housekeeping",
    patterns: [
      /clean/i,
      /housekeep/i,
      /house[\s_]keeping/i,
      /broom/i,
      /mop/i,
      /sofa/i,
      /carpet/i,
      /clothes[\s_]wash/i,
    ],
  },
  {
    name: "Carpentry & Furniture",
    patterns: [
      /carpent/i,
      /furniture/i,
      /wood/i,
      /assembly/i,
      /shelf/i,
      /wardrobe/i,
      /door/i,
      /window/i,
      /lock/i,
      /curtain/i,
      /decking/i,
    ],
  },
  {
    name: "Appliance Repair",
    patterns: [
      /appliance/i,
      /refrigerator/i,
      /fridge/i,
      /washing[\s_]machine/i,
      /microwave/i,
      /oven/i,
      /tv/i,
      /geyser/i,
      /purifier/i,
      /home[\s_-]theatre/i,
    ],
  },
  {
    name: "Painting & Waterproofing",
    patterns: [/paint/i, /putty/i, /waterproof/i],
  },
  {
    name: "Packers & Movers",
    patterns: [/pack/i, /mov/i, /shifting/i, /relocation/i, /loading/i, /unloading/i],
  },
  {
    name: "Driver & Chauffeur",
    patterns: [/driver/i, /chauffeur/i, /driving/i, /transport/i, /cab/i],
  },
  {
    name: "Delivery & Logistics",
    patterns: [
      /deliver/i,
      /courier/i,
      /parcel/i,
      /pickup/i,
      /grocery/i,
      /water[\s_]can/i,
      /water[\s_]tanker/i,
      /emergency[\s_]water/i,
    ],
  },
  {
    name: "Pest Control",
    patterns: [/pest/i, /termite/i, /mosquito/i, /cockroach/i, /rodent/i],
  },
  {
    name: "Cooking & Chef",
    patterns: [/cook/i, /chef/i, /meal/i, /catering/i, /baker/i, /cake/i, /cuisine/i],
  },
  {
    name: "Gardening & Lawn Care",
    patterns: [/garden/i, /plant/i, /lawn/i, /mow/i, /trim/i, /weed/i, /landscap/i, /irrigation/i],
  },
  {
    name: "Beauty, Spa & Grooming",
    patterns: [
      /beauty/i,
      /salon/i,
      /spa/i,
      /massage/i,
      /barber/i,
      /hair/i,
      /groom/i,
      /facial/i,
      /manicure/i,
      /pedicure/i,
      /makeup/i,
      /mehndi/i,
      /nail/i,
    ],
  },
  {
    name: "Security & CCTV",
    patterns: [/cctv/i, /camera/i, /security/i, /guard/i, /watchman/i, /patrol/i],
  },
  {
    name: "Elder & Patient Care",
    patterns: [/care/i, /elder/i, /patient/i, /hospital/i, /medication/i, /companion/i, /pet/i],
  },
  {
    name: "Events & Photography",
    patterns: [
      /event/i,
      /photograph/i,
      /videograph/i,
      /shoot/i,
      /dj/i,
      /sound/i,
      /decorat/i,
      /party[\s_]planning/i,
    ],
  },
  {
    name: "Vehicle & Car Care",
    patterns: [
      /car[\s_]wash/i,
      /car[\s_]repair/i,
      /foam[\s_]wash/i,
      /two[\s_]wheeler/i,
      /polish/i,
      /auto[\s_]electr/i,
      /detailing/i,
    ],
  },
  {
    name: "Construction & Renovation",
    patterns: [/construction/i, /renovation/i, /decking/i, /civil/i, /building/i, /flooring/i],
  },
  {
    name: "IT & Computer Support",
    patterns: [
      /computer/i,
      /laptop/i,
      /it[\s_]support/i,
      /data/i,
      /sql/i,
      /developer/i,
      /system[\s_]operator/i,
      /power[\s_]bi/i,
      /html/i,
      /css/i,
    ],
  },
  {
    name: "Tutoring & Education",
    patterns: [
      /tutor/i,
      /tuition/i,
      /teach/i,
      /coach/i,
      /exam/i,
      /spoken[\s_]english/i,
      /language/i,
      /math/i,
      /science/i,
    ],
  },
  {
    name: "Professional & Business",
    patterns: [
      /account/i,
      /legal/i,
      /financ/i,
      /tax/i,
      /consult/i,
      /office/i,
      /virtual[\s_]assistant/i,
      /writing/i,
      /resume/i,
      /hr[\s_]services/i,
      /business/i,
      /aadhaar/i,
      /document/i,
      /designer/i,
      /mis[\s_]executive/i,
    ],
  },
  {
    name: "General Repairs & Support",
    patterns: [/repair/i, /fix/i, /helper/i, /general/i, /other/i, /alteration/i, /zipper/i],
  },
];

/**
 * Returns unified canonical service group names for any helper based on raw skills and categories.
 * Eliminates duplicate tags with same intent (e.g. ac repair, ac service -> AC Repair & Service).
 */
export function getCanonicalServices(h: Helper | null | undefined): string[] {
  if (!h) return [];
  const rawList = Array.from(new Set([...(h.categories || []), ...(h.skills || [])]));
  if (rawList.length === 0) {
    return ["General Helper"];
  }

  const matched = new Set<string>();
  for (const raw of rawList) {
    if (!raw) continue;
    const cleanRaw = raw.trim();
    for (const group of CANONICAL_SERVICES) {
      if (group.patterns.some((p) => p.test(cleanRaw))) {
        matched.add(group.name);
        break;
      }
    }
  }

  return matched.size > 0 ? Array.from(matched) : ["General Helper"];
}

export const CANONICAL_LOCATION_ALIASES: Record<string, string> = {
  mahabubnagar: "Mahabubnagar",
  mahbubnagar: "Mahabubnagar",
  "mahabubnagar rural": "Mahabubnagar",
  "mahbubnagar rural": "Mahabubnagar",
  siddipet: "Siddipet",
  "siddipet old bus station": "Siddipet",
  bengaluru: "Bengaluru (Bangalore)",
  bangalore: "Bengaluru (Bangalore)",
  visakhapatnam: "Visakhapatnam",
  "visakhapatnam railway station": "Visakhapatnam",
  ramachandrapur: "Ramachandrapuram",
  ramachandrapuram: "Ramachandrapuram",
  karimnagar: "Karimnagar",
  secunderabad: "Secunderabad",
  hyderabad: "Hyderabad",
  gachibowli: "Gachibowli",
  madhapur: "Madhapur",
  "hitec city": "Hitec City",
  "hitec-city": "Hitec City",
  kondapur: "Kondapur",
  kukatpally: "Kukatpally",
  dilsukhnagar: "Dilsukhnagar",
  ameerpet: "Ameerpet",
  begumpet: "Begumpet",
  nizamabad: "Nizamabad",
  vanasthalipuram: "Vanasthalipuram",
  warangal: "Warangal",
  hanamkonda: "Hanamkonda",
  "kphb colony": "KPHB Colony",
  "kphb-colony": "KPHB Colony",
  "bn reddy nagar": "BN Reddy Nagar",
  "bn-reddy-nagar": "BN Reddy Nagar",
  "lb nagar": "LB Nagar",
  "lb-nagar": "LB Nagar",
  "dr a s rao nagar": "Dr. AS Rao Nagar",
  "dr-a-s-rao-nagar": "Dr. AS Rao Nagar",
  "rk puram": "RK Puram",
  "rk-puram": "RK Puram",
  "new delhi": "New Delhi",
  "greater noida": "Greater Noida",
  "pimpri chinchwad": "Pimpri-Chinchwad",
  "pimpri-chinchwad": "Pimpri-Chinchwad",
  "meerpet hb colony": "Meerpet HB Colony",
  "meerpet-hb-colony": "Meerpet HB Colony",
};

export const STATE_NAMES = new Set([
  "telangana",
  "andhra pradesh",
  "karnataka",
  "maharashtra",
  "tamil nadu",
  "bihar",
  "india",
  "state",
]);

/**
 * Cleans and standardizes raw location names into human-readable title-cased names,
 * eliminating hyphens, lowercase variations, and landmark suffixes.
 */
export function cleanLocationName(loc: string | null | undefined): string | null {
  if (!loc || loc.length < 2 || loc.includes("+")) return null;
  const locClean = loc.trim();
  // Filter out 24-character hexadecimal MongoDB IDs
  if (locClean.length === 24 && /^[0-9a-fA-F]{24}$/.test(locClean)) return null;
  // If it's a long street address (> 35 chars) or has 6-digit postal code, skip as a discrete location tag
  if (locClean.length > 35 || /\b\d{6}\b/.test(locClean)) return null;

  const normalizedKey = locClean.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (STATE_NAMES.has(normalizedKey)) return null;

  if (CANONICAL_LOCATION_ALIASES[normalizedKey]) {
    return CANONICAL_LOCATION_ALIASES[normalizedKey];
  }

  // Capitalize words properly, keeping short acronyms uppercase (e.g. BN, RK, LB)
  const words = locClean.replace(/[-_]+/g, " ").split(/\s+/);
  return words
    .map((w) => {
      const lower = w.toLowerCase();
      if (["bn", "rk", "lb", "as", "hp", "ec", "hb"].includes(lower)) {
        return w.toUpperCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Returns de-duplicated canonical locations for a helper from their city and work areas.
 */
export function getCanonicalLocations(h: Helper | null | undefined): string[] {
  if (!h) return [];
  const rawList: string[] = [];
  if (h.city) rawList.push(h.city);
  if (h.work_areas && Array.isArray(h.work_areas)) rawList.push(...h.work_areas);

  const matched = new Set<string>();
  for (const raw of rawList) {
    const cleaned = cleanLocationName(raw);
    if (cleaned) {
      matched.add(cleaned);
    }
  }

  return Array.from(matched);
}

/**
 * Formats a clean, readable location summary for a helper row.
 */
export function formatHelperDisplayLocation(h: Helper | null | undefined): string {
  if (!h) return "Location not set";
  const cityClean = cleanLocationName(h.city);
  const areasClean = (h.work_areas || []).map(cleanLocationName).filter(Boolean) as string[];

  if (cityClean && areasClean.length > 0) {
    const uniqueAreas = Array.from(new Set(areasClean.filter((a) => a.toLowerCase() !== cityClean.toLowerCase())));
    if (uniqueAreas.length > 0) {
      return `${cityClean} (${uniqueAreas.slice(0, 2).join(", ")})`;
    }
    return cityClean;
  }
  if (cityClean) return cityClean;
  if (areasClean.length > 0) {
    const uniqueAreas = Array.from(new Set(areasClean));
    return uniqueAreas.slice(0, 2).join(", ");
  }
  if (h.address) {
    const addrClean = cleanLocationName(h.address);
    if (addrClean) return addrClean;
    const firstPart = h.address.split(",")[0]?.trim();
    if (firstPart && firstPart.length < 30) return firstPart;
  }
  return "Location not set";
}

