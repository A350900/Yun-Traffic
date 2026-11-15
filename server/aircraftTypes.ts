// ICAO type designator → common model name, for the most frequently seen types.
// Anything not listed falls back to the description from the aircraft database.

export const TYPE_NAMES: Record<string, string> = {
  // Airbus
  A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo', A318: 'Airbus A318',
  A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321', A306: 'Airbus A300-600',
  A30B: 'Airbus A300', A310: 'Airbus A310', A332: 'Airbus A330-200', A333: 'Airbus A330-300',
  A337: 'Airbus BelugaXL', A338: 'Airbus A330-800neo', A339: 'Airbus A330-900neo', A342: 'Airbus A340-200',
  A343: 'Airbus A340-300', A345: 'Airbus A340-500', A346: 'Airbus A340-600', A359: 'Airbus A350-900',
  A35K: 'Airbus A350-1000', A388: 'Airbus A380-800', BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300',
  A3ST: 'Airbus Beluga', A400: 'Airbus A400M Atlas',
  // Boeing
  B712: 'Boeing 717', B721: 'Boeing 727-100', B722: 'Boeing 727-200', B732: 'Boeing 737-200',
  B733: 'Boeing 737-300', B734: 'Boeing 737-400', B735: 'Boeing 737-500', B736: 'Boeing 737-600',
  B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900', B37M: 'Boeing 737 MAX 7',
  B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10', B741: 'Boeing 747-100',
  B742: 'Boeing 747-200', B743: 'Boeing 747-300', B744: 'Boeing 747-400', B748: 'Boeing 747-8',
  B74S: 'Boeing 747SP', B752: 'Boeing 757-200', B753: 'Boeing 757-300', B762: 'Boeing 767-200',
  B763: 'Boeing 767-300', B764: 'Boeing 767-400', B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR',
  B773: 'Boeing 777-300', B77W: 'Boeing 777-300ER', B778: 'Boeing 777-8', B779: 'Boeing 777-9',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10', C17: 'Boeing C-17 Globemaster III',
  K35R: 'Boeing KC-135 Stratotanker', P8: 'Boeing P-8 Poseidon', E3TF: 'Boeing E-3 Sentry',
  // McDonnell Douglas
  MD11: 'McDonnell Douglas MD-11', MD82: 'McDonnell Douglas MD-82', MD83: 'McDonnell Douglas MD-83',
  MD88: 'McDonnell Douglas MD-88', MD90: 'McDonnell Douglas MD-90', DC10: 'McDonnell Douglas DC-10',
  // Embraer
  E135: 'Embraer ERJ-135', E145: 'Embraer ERJ-145', E170: 'Embraer E170', E75S: 'Embraer E175',
  E75L: 'Embraer E175', E190: 'Embraer E190', E195: 'Embraer E195', E290: 'Embraer E190-E2',
  E295: 'Embraer E195-E2', E35L: 'Embraer Legacy 600', E50P: 'Embraer Phenom 100', E55P: 'Embraer Phenom 300',
  E545: 'Embraer Legacy 450', E550: 'Embraer Legacy 500', E120: 'Embraer EMB 120 Brasilia',
  // Bombardier / de Havilland
  CRJ1: 'Bombardier CRJ100', CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900',
  CRJX: 'Bombardier CRJ1000', DH8A: 'De Havilland Dash 8-100', DH8B: 'De Havilland Dash 8-200',
  DH8C: 'De Havilland Dash 8-300', DH8D: 'De Havilland Dash 8-400', DHC6: 'De Havilland Twin Otter',
  CL30: 'Bombardier Challenger 300', CL35: 'Bombardier Challenger 350', CL60: 'Bombardier Challenger 600',
  GLEX: 'Bombardier Global Express', GL5T: 'Bombardier Global 5000', GL7T: 'Bombardier Global 7500',
  LJ35: 'Learjet 35', LJ45: 'Learjet 45', LJ60: 'Learjet 60', LJ75: 'Learjet 75',
  // ATR and other regionals
  AT43: 'ATR 42-300', AT45: 'ATR 42-500', AT46: 'ATR 42-600', AT72: 'ATR 72', AT75: 'ATR 72-500',
  AT76: 'ATR 72-600', SF34: 'Saab 340', SB20: 'Saab 2000', JS41: 'BAe Jetstream 41', B190: 'Beechcraft 1900',
  SU95: 'Sukhoi Superjet 100', C919: 'COMAC C919', AJ27: 'COMAC ARJ21', A748: 'Hawker Siddeley 748',
  // Business jets
  GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V', GLF6: 'Gulfstream G650', G280: 'Gulfstream G280',
  GA5C: 'Gulfstream G500', GA6C: 'Gulfstream G600', GA7C: 'Gulfstream G700', F2TH: 'Dassault Falcon 2000',
  F900: 'Dassault Falcon 900', FA7X: 'Dassault Falcon 7X', FA8X: 'Dassault Falcon 8X', FA6X: 'Dassault Falcon 6X',
  C25A: 'Cessna Citation CJ2', C25B: 'Cessna Citation CJ3', C25C: 'Cessna Citation CJ4', C525: 'Cessna CitationJet',
  C510: 'Cessna Citation Mustang', C560: 'Cessna Citation V', C56X: 'Cessna Citation Excel', C680: 'Cessna Citation Sovereign',
  C68A: 'Cessna Citation Latitude', C700: 'Cessna Citation Longitude', C750: 'Cessna Citation X', H25B: 'Hawker 800',
  PC24: 'Pilatus PC-24', HDJT: 'HondaJet', SF50: 'Cirrus Vision Jet',
  // Turboprops and light aircraft
  PC12: 'Pilatus PC-12', C208: 'Cessna 208 Caravan', B350: 'Beechcraft King Air 350', BE20: 'Beechcraft King Air 200',
  BE9L: 'Beechcraft King Air 90', TBM9: 'Daher TBM 900', TBM7: 'Daher TBM 700', C172: 'Cessna 172 Skyhawk',
  C182: 'Cessna 182 Skylane', C152: 'Cessna 152', C206: 'Cessna 206', C210: 'Cessna 210', P28A: 'Piper PA-28 Cherokee',
  PA28: 'Piper PA-28 Cherokee', PA32: 'Piper PA-32', PA34: 'Piper Seneca', PA46: 'Piper Malibu', SR20: 'Cirrus SR20',
  SR22: 'Cirrus SR22', DA40: 'Diamond DA40', DA42: 'Diamond DA42', DA62: 'Diamond DA62', BE36: 'Beechcraft Bonanza',
  BE58: 'Beechcraft Baron', M20P: 'Mooney M20',
  // Helicopters
  R44: 'Robinson R44', R22: 'Robinson R22', R66: 'Robinson R66', EC35: 'Airbus H135', EC45: 'Airbus H145',
  EC30: 'Airbus H130', EC55: 'Airbus H155', EC75: 'Airbus H175', AS50: 'Airbus AS350 Écureuil', AS65: 'Airbus AS365 Dauphin',
  A109: 'Leonardo AW109', A139: 'Leonardo AW139', A169: 'Leonardo AW169', A189: 'Leonardo AW189', B06: 'Bell 206',
  B407: 'Bell 407', B429: 'Bell 429', B412: 'Bell 412', S76: 'Sikorsky S-76', S92: 'Sikorsky S-92', H60: 'Sikorsky UH-60 Black Hawk',
  // Military transports
  C130: 'Lockheed C-130 Hercules', C30J: 'Lockheed C-130J Super Hercules', C5M: 'Lockheed C-5M Super Galaxy',
  A124: 'Antonov An-124', IL76: 'Ilyushin Il-76',
}

/** Title-case an upper-case database description: "BOEING 737-900" → "Boeing 737-900". */
function tidy(desc: string) {
  return desc
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(\d+[a-z]+)\b/gi, (w) => w.toUpperCase()) // 737-900er → 737-900ER
}

/**
 * Best human name for an aircraft. `detail` is the precise model string from
 * the aircraft database (e.g. "737NG 932ER/W"), used to spot ER/LR variants.
 */
export function aircraftName(typeCode: string | null, detail?: string | null, manufacturer?: string | null, desc?: string | null) {
  let name = typeCode ? TYPE_NAMES[typeCode] : undefined
  if (name) {
    // The type code doesn't distinguish e.g. 737-900 vs 737-900ER; the model string does.
    const variant = detail?.match(/\d(ER|LR|XR|SP)\b/i)?.[1]?.toUpperCase()
    if (variant && !name.endsWith(variant)) name += variant
    return name
  }
  if (desc) return tidy(desc)
  if (manufacturer && detail) return `${manufacturer} ${detail}`
  return typeCode
}
