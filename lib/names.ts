// Feed-name helpers shared by the start page (server) and the open-feed form (client): Web Crypto only.

const ADJECTIVES = [
  "amber", "brave", "calm", "clever", "cosmic", "crisp", "dusty", "eager", "fancy", "gentle",
  "golden", "hidden", "humble", "jolly", "keen", "lucky", "mellow", "misty", "nimble", "quiet",
  "rapid", "rusty", "silent", "sleepy", "snowy", "sunny", "swift", "tidy", "velvet", "witty",
];
const ANIMALS = [
  "badger", "beaver", "bison", "crane", "dingo", "falcon", "ferret", "gecko", "heron", "ibis",
  "jackal", "koala", "lemur", "lynx", "marmot", "moose", "narwhal", "ocelot", "otter", "panda",
  "puffin", "quokka", "raven", "salmon", "stoat", "tapir", "toucan", "walrus", "wombat", "yak",
];
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Uint32 % small n: bias under 1e-8, irrelevant here.
const pick = <T>(xs: readonly T[] | string, r: number) => xs[r % xs.length];

export function suggestFeedName(): string {
  const r = crypto.getRandomValues(new Uint32Array(6));
  const suffix = Array.from(r.slice(2), (x) => pick(CHARS, x)).join("");
  return `${pick(ADJECTIVES, r[0])}-${pick(ANIMALS, r[1])}-${suffix}`;
}

export function normalizeFeedInput(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}
